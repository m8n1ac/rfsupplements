import { prisma } from "@/lib/db";
import { fetchPage, paginate, PER_PAGE } from "@/lib/woo/client";
import {
  bridgeAffiliate,
  bridgeReferral,
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

// Refunds are read per order, because Woo only exposes them nested (spec §6.1).
// Every order payload already carries a refund summary, so only the orders that
// actually have one are fetched — 3 requests on this store, not 557.
export async function syncRefunds(since: Date | null): Promise<SyncResult> {
  const counts = { ...NEWLY_SEEN };
  const seenWooIds: number[] = [];

  const candidates = await prisma.order.findMany({
    where: since === null ? {} : { modifiedAtWoo: { gte: since } },
    select: { id: true, wooId: true, contactId: true, raw: true },
  });

  const withRefunds = candidates.filter((order) => {
    const refunds = (order.raw as { refunds?: unknown[] } | null)?.refunds;
    return Array.isArray(refunds) && refunds.length > 0;
  });

  const touchedContacts: string[] = [];

  for (const order of withRefunds) {
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

    if (order.contactId) {
      touchedContacts.push(order.contactId);
    }
  }

  // Order.refundTotal is set from the summary in the orders step, so there is
  // nothing to write back here.
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

// ---------------------------------------------------------------------------
// Affiliate programme
//
// Solid Affiliate stays the only writer. This mirrors its two tables so an
// affiliate can be read next to the contact and the orders they produced.
// Commission is never recalculated here — the figures are carried across as
// Solid Affiliate computed them.
// ---------------------------------------------------------------------------

export async function syncAffiliates(since: Date | null): Promise<SyncResult> {
  const counts = { ...NEWLY_SEEN };

  for await (const page of paginate("/rfs-crm/v1/affiliates", bridgeAffiliate, {
    ...(since ? { modified_after: since.toISOString().replace(/\.\d{3}Z$/, "") } : {}),
  })) {
    counts.fetched += page.length;

    for (const affiliate of page) {
      // An affiliate is a person the store already knows: match on the WP user's
      // email, which is how they signed up. paymentEmail is where the money goes
      // and is often a different address, so it is never used to match.
      const email = affiliate.email ? normalizeEmail(affiliate.email) : null;
      const contact = email ? await prisma.contact.findUnique({ where: { email } }) : null;

      await prisma.affiliate.upsert({
        where: { wooId: affiliate.id },
        create: {
          wooId: affiliate.id,
          wpUserId: affiliate.user_id || null,
          contactId: contact?.id ?? null,
          email: email ?? "",
          paymentEmail: affiliate.payment_email || null,
          firstName: affiliate.first_name || null,
          lastName: affiliate.last_name || null,
          status: affiliate.status,
          commissionType: affiliate.commission_type,
          commissionRate: affiliate.commission_rate,
          createdAtWoo: affiliate.created_at_gmt,
          modifiedAtWoo: affiliate.updated_at_gmt,
          syncedAt: new Date(),
          raw: affiliate as object,
        },
        update: {
          wpUserId: affiliate.user_id || null,
          contactId: contact?.id ?? null,
          email: email ?? "",
          paymentEmail: affiliate.payment_email || null,
          firstName: affiliate.first_name || null,
          lastName: affiliate.last_name || null,
          status: affiliate.status,
          commissionType: affiliate.commission_type,
          commissionRate: affiliate.commission_rate,
          modifiedAtWoo: affiliate.updated_at_gmt,
          syncedAt: new Date(),
          raw: affiliate as object,
        },
      });

      counts.upserted += 1;
    }

    const cursor = maxModified(page.map((affiliate) => affiliate.updated_at_gmt));
    if (cursor) {
      await advanceCursor("affiliates", cursor);
    }
  }

  // Solid Affiliate has no delete: affiliates are moved to a rejected status.
  return { counts, seenWooIds: [] };
}

export async function syncReferrals(since: Date | null): Promise<SyncResult> {
  const counts = { ...NEWLY_SEEN };
  const touched = new Set<string>();

  for await (const page of paginate("/rfs-crm/v1/referrals", bridgeReferral, {
    ...(since ? { modified_after: since.toISOString().replace(/\.\d{3}Z$/, "") } : {}),
  })) {
    counts.fetched += page.length;

    for (const referral of page) {
      const affiliate = await prisma.affiliate.findUnique({
        where: { wooId: referral.affiliate_id },
        select: { id: true },
      });

      // A referral whose affiliate has not been synced yet is skipped rather
      // than invented. The affiliates resource runs first, and a full sync
      // picks up anything that raced.
      if (!affiliate) continue;

      const fields = {
        affiliateId: affiliate.id,
        orderWooId: referral.order_id,
        orderAmount: referral.order_amount,
        commissionAmount: referral.commission_amount,
        status: referral.status,
        referralType: referral.referral_type || null,
        referralSource: referral.referral_source || null,
        description: referral.description || null,
        refundedAtWoo: referral.refunded_at_gmt,
        modifiedAtWoo: referral.updated_at_gmt,
        syncedAt: new Date(),
      };

      await prisma.referral.upsert({
        where: { wooId: referral.id },
        create: { wooId: referral.id, createdAtWoo: referral.created_at_gmt, ...fields },
        update: fields,
      });

      touched.add(affiliate.id);
      counts.upserted += 1;
    }

    const cursor = maxModified(page.map((referral) => referral.updated_at_gmt));
    if (cursor) {
      await advanceCursor("referrals", cursor);
    }
  }

  await recomputeAffiliateStats(touched);
  return { counts, seenWooIds: [] };
}

// The same shape as recomputeContactStats: the list screen reads one row per
// affiliate instead of aggregating their referrals on every render.
export async function recomputeAffiliateStats(affiliateIds: Iterable<string>): Promise<void> {
  for (const affiliateId of affiliateIds) {
    const referrals = await prisma.referral.findMany({
      where: { affiliateId },
      select: { status: true, commissionAmount: true, orderAmount: true, createdAtWoo: true },
    });

    // Summed as integer ten-thousandths rather than as floats. These figures
    // carry four decimals because a percentage commission lands on quarter-cents,
    // and adding twenty-odd of them as JS numbers is how a total drifts a cent
    // away from the plugin it is supposed to mirror.
    const tenThousandths = (value: { toString(): string }): bigint => {
      const [whole, frac = ""] = value.toString().split(".");
      return BigInt(whole + frac.padEnd(4, "0").slice(0, 4));
    };
    const toDecimal = (total: bigint): string => {
      const negative = total < BigInt(0);
      const digits = (negative ? -total : total).toString().padStart(5, "0");
      const result = `${digits.slice(0, -4)}.${digits.slice(-4)}`;
      return negative ? `-${result}` : result;
    };

    const sum = (status: string) =>
      toDecimal(
        referrals
          .filter((referral) => referral.status === status)
          .reduce((total, referral) => total + tenThousandths(referral.commissionAmount), BigInt(0)),
      );

    // Rejected referrals are excluded from revenue: the sale is not credited to
    // the affiliate, so counting it would overstate what the programme produced.
    const revenue = toDecimal(
      referrals
        .filter((referral) => referral.status !== "rejected")
        .reduce((total, referral) => total + tenThousandths(referral.orderAmount), BigInt(0)),
    );

    const dates = referrals
      .map((referral) => referral.createdAtWoo)
      .filter((date): date is Date => date !== null);

    await prisma.affiliate.update({
      where: { id: affiliateId },
      data: {
        referralCount: referrals.length,
        paidCommission: sum("paid"),
        unpaidCommission: sum("unpaid"),
        rejectedCommission: sum("rejected"),
        referredRevenue: revenue,
        lastReferralAt: dates.length
          ? new Date(Math.max(...dates.map((date) => date.getTime())))
          : null,
      },
    });
  }
}
