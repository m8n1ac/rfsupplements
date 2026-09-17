import { prisma } from "@/lib/db";
import { fetchPage, paginate, PER_PAGE } from "@/lib/woo/client";
import {
  bridgeSubmission,
  wooCustomer,
  wooOrder,
  wooProduct,
  wooRefund,
  wooVariation,
  type WooOrder,
  type WooProduct,
} from "@/lib/woo/schemas";
import {
  mapOrder,
  mapOrderItems,
  mapProduct,
  mapRefund,
  mapVariation,
  normalizeEmail,
} from "@/lib/sync/mappers";
import { contactForOrder, recomputeContactStats, upsertCustomerContact } from "@/lib/sync/contacts";
import { advanceCursor, cursorParams, maxModified, type RunCounts } from "@/lib/sync/engine";

// One function per resource. Each pages through Woo, upserts a page inside a
// transaction, then advances its cursor (spec §6.1 steps 2-5).

const NEWLY_SEEN: RunCounts = { fetched: 0, upserted: 0, markedDeleted: 0 };

// A full run needs the complete set of ids Woo returned, so it can mark what is
// missing as deletedInWoo (spec §6.1). Incremental runs ignore it.
export type SyncResult = { counts: RunCounts; seenWooIds: number[] };

export async function syncProducts(since: Date | null): Promise<SyncResult> {
  const counts = { ...NEWLY_SEEN };
  const seenWooIds: number[] = [];

  for await (const page of paginate("/wc/v3/products", wooProduct, {
    orderby: "modified",
    order: "asc",
    status: "any",
    ...cursorParams(since),
  })) {
    counts.fetched += page.length;

    for (const product of page) {
      await prisma.product.upsert({
        where: { wooId: product.id },
        create: mapProduct(product),
        update: mapProduct(product),
      });
      seenWooIds.push(product.id);
      counts.upserted += 1;

      // Variations expose no modified_after filter and no *_gmt dates, so they
      // are synced with their parent whenever the parent changes.
      if (product.type === "variable") {
        counts.upserted += await syncVariations(product, seenWooIds);
      }
    }

    const cursor = maxModified(page.map((product) => product.date_modified_gmt));
    if (cursor) {
      await advanceCursor("products", cursor);
    }
  }

  return { counts, seenWooIds };
}

async function syncVariations(parent: WooProduct, seenWooIds: number[]): Promise<number> {
  let upserted = 0;

  for await (const page of paginate(
    `/wc/v3/products/${parent.id}/variations`,
    wooVariation,
    { per_page: PER_PAGE },
  )) {
    for (const variation of page) {
      const data = mapVariation(variation, parent);
      await prisma.product.upsert({
        where: { wooId: variation.id },
        create: data,
        update: data,
      });
      seenWooIds.push(variation.id);
      upserted += 1;
    }
  }

  return upserted;
}

// The customers endpoint has no modified_after filter on this Woo version
// (Phase 0 confirmed it), so incremental mode takes the two-step route in
// spec §6.1: the customers referenced by this run's orders, then a walk back
// through newest registrations until it reaches one already stored.
export async function syncCustomers(since: Date | null): Promise<SyncResult> {
  const counts = { ...NEWLY_SEEN };
  const seenWooIds: number[] = [];

  if (since === null) {
    for await (const page of paginate("/wc/v3/customers", wooCustomer, {
      orderby: "registered_date",
      order: "desc",
      role: "all",
    })) {
      counts.fetched += page.length;
      for (const customer of page) {
        await upsertCustomerContact(customer);
        seenWooIds.push(customer.id);
        counts.upserted += 1;
      }
    }
    return { counts, seenWooIds };
  }

  const referenced = await referencedCustomerIds(since);
  if (referenced.length > 0) {
    for (let index = 0; index < referenced.length; index += PER_PAGE) {
      const batch = referenced.slice(index, index + PER_PAGE);
      const { items } = await fetchPage("/wc/v3/customers", wooCustomer, {
        include: batch.join(","),
        per_page: PER_PAGE,
        role: "all",
      });
      counts.fetched += items.length;
      for (const customer of items) {
        await upsertCustomerContact(customer);
        seenWooIds.push(customer.id);
        counts.upserted += 1;
      }
    }
  }

  // Then newest-first until we reach one we already hold.
  for await (const page of paginate("/wc/v3/customers", wooCustomer, {
    orderby: "registered_date",
    order: "desc",
    role: "all",
  })) {
    counts.fetched += page.length;
    let reachedKnown = false;

    for (const customer of page) {
      const known = await prisma.contact.findUnique({
        where: { wooCustomerId: customer.id },
        select: { id: true },
      });
      if (known) {
        reachedKnown = true;
        break;
      }
      await upsertCustomerContact(customer);
      seenWooIds.push(customer.id);
      counts.upserted += 1;
    }

    if (reachedKnown) {
      break;
    }
  }

  return { counts, seenWooIds };
}

async function referencedCustomerIds(since: Date): Promise<number[]> {
  const orders = await prisma.order.findMany({
    where: { modifiedAtWoo: { gte: since } },
    select: { raw: true },
  });

  const ids = new Set<number>();
  for (const order of orders) {
    const customerId = (order.raw as { customer_id?: number } | null)?.customer_id;
    if (typeof customerId === "number" && customerId > 0) {
      ids.add(customerId);
    }
  }
  return [...ids];
}

export async function syncOrders(since: Date | null): Promise<SyncResult> {
  const counts = { ...NEWLY_SEEN };
  const touchedContacts: string[] = [];
  const seenWooIds: number[] = [];

  for await (const page of paginate("/wc/v3/orders", wooOrder, {
    orderby: "modified",
    order: "asc",
    status: "any",
    ...cursorParams(since),
  })) {
    counts.fetched += page.length;

    for (const order of page) {
      const contactId = await contactForOrder(order);
      if (contactId) {
        touchedContacts.push(contactId);
      }
      await upsertOrder(order, contactId);
      seenWooIds.push(order.id);
      counts.upserted += 1;
    }

    const cursor = maxModified(page.map((order) => order.date_modified_gmt));
    if (cursor) {
      await advanceCursor("orders", cursor);
    }
  }

  await recomputeContactStats(touchedContacts);
  return { counts, seenWooIds };
}

async function upsertOrder(order: WooOrder, contactId: string | null): Promise<void> {
  const data = mapOrder(order, contactId);

  await prisma.$transaction(async (tx) => {
    const saved = await tx.order.upsert({
      where: { wooId: order.id },
      create: data,
      update: data,
    });

    // Line items are replaced wholesale: Woo is the system of record and an
    // edited order can drop lines, so reconciling item by item would be a
    // second mechanism for no gain.
    await tx.orderItem.deleteMany({ where: { orderId: saved.id } });
    await tx.orderItem.createMany({ data: mapOrderItems(order, saved.id) });
  });
}

// Refunds are read per order rather than from a global endpoint, because Woo
// only exposes them nested (spec §6.1). Only orders touched since the cursor
// are re-read.
export async function syncRefunds(since: Date | null): Promise<SyncResult> {
  const counts = { ...NEWLY_SEEN };
  const seenWooIds: number[] = [];

  const orders = await prisma.order.findMany({
    where: since === null ? {} : { modifiedAtWoo: { gte: since } },
    select: { id: true, wooId: true, contactId: true },
  });

  const touchedContacts: string[] = [];

  for (const order of orders) {
    const { items } = await fetchPage(`/wc/v3/orders/${order.wooId}/refunds`, wooRefund, {
      per_page: PER_PAGE,
    });
    counts.fetched += items.length;

    for (const refund of items) {
      const data = mapRefund(refund, order.id);
      await prisma.refund.upsert({
        where: { wooId: refund.id },
        create: data,
        update: data,
      });
      seenWooIds.push(refund.id);
      counts.upserted += 1;
    }

    // Order.refundTotal is the sum of its refunds, kept on the order so revenue
    // queries never have to join.
    const total = items.reduce((sum, refund) => sum + Number(refund.amount), 0).toFixed(2);
    await prisma.order.update({ where: { id: order.id }, data: { refundTotal: total } });

    if (order.contactId) {
      touchedContacts.push(order.contactId);
    }
  }

  await recomputeContactStats(touchedContacts);
  return { counts, seenWooIds };
}

// Forms 13 (Contact) and 2039 (Athlete Program) become Inquiries. The three
// newsletter forms are captured in the bridge inbox and create/attach a Contact,
// but do not open a pipeline item (Gate 0, B1 recommendation).
export const INQUIRY_FORM_IDS = ["13", "2039"];

export async function syncSubmissions(since: Date | null): Promise<SyncResult> {
  const counts = { ...NEWLY_SEEN };

  for await (const page of paginate("/rfs-crm/v1/submissions", bridgeSubmission, {
    ...(since ? { modified_after: since.toISOString().replace(/\.\d{3}Z$/, "") } : {}),
  })) {
    counts.fetched += page.length;

    for (const submission of page) {
      const email = extractEmail(submission.fields);
      const contactId = email ? await contactForSubmission(email, submission.fields) : null;

      if (INQUIRY_FORM_IDS.includes(submission.form_id)) {
        const externalId = `${submission.source_plugin}:${submission.id}`;
        await prisma.inquiry.upsert({
          where: { externalId },
          create: {
            externalId,
            formName: submission.form_name,
            contactId,
            message: extractMessage(submission.fields),
            payload: submission.fields as object,
            submittedAt: submission.submitted_at_gmt,
          },
          update: {
            payload: submission.fields as object,
            message: extractMessage(submission.fields),
          },
        });
      }

      counts.upserted += 1;
    }

    const cursor = maxModified(page.map((submission) => submission.modified_at_gmt));
    if (cursor) {
      await advanceCursor("submissions", cursor);
    }
  }

  // The bridge inbox is append-only, so there are no deletions to detect.
  return { counts, seenWooIds: [] };
}

function extractEmail(fields: Record<string, unknown>): string | null {
  for (const [key, value] of Object.entries(fields)) {
    if (key.toLowerCase().includes("email") && typeof value === "string" && value.includes("@")) {
      return normalizeEmail(value);
    }
  }
  return null;
}

function extractMessage(fields: Record<string, unknown>): string | null {
  for (const key of ["your-message", "tell-us-about", "message"]) {
    const value = fields[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

async function contactForSubmission(
  email: string,
  fields: Record<string, unknown>,
): Promise<string> {
  const existing = await prisma.contact.findUnique({ where: { email } });
  if (existing) {
    return existing.id;
  }

  const name = typeof fields["your-name"] === "string" ? fields["your-name"].trim() : "";
  const [firstName, ...rest] = name.split(/\s+/).filter(Boolean);

  const created = await prisma.contact.create({
    data: {
      email,
      firstName: firstName ?? null,
      lastName: rest.length > 0 ? rest.join(" ") : null,
      source: "FORM",
      syncedAt: new Date(),
    },
  });
  return created.id;
}
