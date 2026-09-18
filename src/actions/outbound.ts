"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser, type CurrentUser } from "@/lib/require-user";
import { readFresh, StaleRecordError, wooPost, wooPut, WooWriteError } from "@/lib/woo/write";
import { wooOrder } from "@/lib/woo/schemas";
import { mapOrder, mapOrderItems } from "@/lib/sync/mappers";
import { ORDER_STATUSES } from "@/lib/order-status";
import type { Prisma } from "@/generated/prisma/client";

export type OutboundState = { error: string | null; notice: string | null };

const OK = (notice: string): OutboundState => ({ error: null, notice });

/**
 * Every outbound action funnels through this so the failure contract is written
 * once: a stale record and a Woo rejection both surface to the user, and
 * neither writes anything locally (spec §6.2 rules 1 and 4).
 */
async function attempt(run: () => Promise<OutboundState>): Promise<OutboundState> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof StaleRecordError || error instanceof WooWriteError) {
      return { error: error.message, notice: null };
    }
    throw error;
  }
}

async function audit(
  user: CurrentUser,
  action: string,
  entity: string,
  entityId: string,
  before: Prisma.InputJsonValue,
  after: Prisma.InputJsonValue,
): Promise<void> {
  await prisma.auditLog.create({
    data: { userId: user.id, action, entity, entityId, before, after },
  });
}

// ------------------------------------------------------------------ orders

const statusSchema = z.object({
  status: z.enum(ORDER_STATUSES),
});

export async function changeOrderStatus(
  wooId: number,
  _prev: OutboundState,
  formData: FormData,
): Promise<OutboundState> {
  const user = await requireUser();

  return attempt(async () => {
    const parsed = statusSchema.safeParse({ status: formData.get("status") });
    if (!parsed.success) {
      return { error: "That is not a WooCommerce order status.", notice: null };
    }

    const current = await prisma.order.findUniqueOrThrow({ where: { wooId } });
    if (current.status === parsed.data.status) {
      return { error: "The order is already in that status.", notice: null };
    }

    await readFresh(`/wc/v3/orders/${wooId}`, current.modifiedAtWoo);

    const response = await wooPut(`/wc/v3/orders/${wooId}`, { status: parsed.data.status });
    const saved = await storeOrder(response, current.contactId);

    await audit(
      user,
      "ORDER_STATUS",
      "Order",
      current.id,
      { status: current.status },
      { status: saved.status },
    );

    if (current.contactId) {
      await prisma.activity.create({
        data: {
          contactId: current.contactId,
          type: "ORDER_STATUS",
          refId: current.id,
          summary: `${user.name} changed order #${current.number} from ${current.status} to ${saved.status}`,
          occurredAt: new Date(),
        },
      });
    }

    revalidatePath(`/orders/${wooId}`);
    revalidatePath("/orders");
    return OK(`Order #${current.number} is now ${saved.status}.`);
  });
}

const noteSchema = z.object({
  note: z.string().trim().min(1, { message: "A note needs some text" }).max(5000),
  customerNote: z.boolean(),
});

const wooNoteResponse = z.object({ id: z.number().int() }).loose();

export async function addWooOrderNote(
  wooId: number,
  _prev: OutboundState,
  formData: FormData,
): Promise<OutboundState> {
  const user = await requireUser();

  return attempt(async () => {
    const parsed = noteSchema.safeParse({
      note: formData.get("note"),
      customerNote: formData.get("customerNote") === "on",
    });
    if (!parsed.success) {
      return { error: parsed.error.issues[0].message, notice: null };
    }

    const order = await prisma.order.findUniqueOrThrow({ where: { wooId } });

    // A note does not change the order, but a stale page might be about to
    // annotate an order someone else has already moved on.
    await readFresh(`/wc/v3/orders/${wooId}`, order.modifiedAtWoo);

    const response = await wooPost(`/wc/v3/orders/${wooId}/notes`, {
      note: parsed.data.note,
      customer_note: parsed.data.customerNote,
    });

    const wooNote = wooNoteResponse.parse(response);

    const saved = await prisma.note.create({
      data: {
        orderId: order.id,
        contactId: order.contactId,
        body: parsed.data.note,
        authorId: user.id,
        visibility: parsed.data.customerNote ? "WOO_CUSTOMER" : "WOO_PRIVATE",
        wooNoteId: wooNote.id,
      },
    });

    await audit(user, "ORDER_NOTE", "Order", order.id, {}, {
      wooNoteId: wooNote.id,
      customerNote: parsed.data.customerNote,
    });

    if (order.contactId) {
      await prisma.activity.create({
        data: {
          contactId: order.contactId,
          type: "NOTE",
          refId: saved.id,
          summary: `${user.name} added a ${parsed.data.customerNote ? "customer-visible" : "private"} note to order #${order.number}`,
          occurredAt: new Date(),
        },
      });
    }

    revalidatePath(`/orders/${wooId}`);
    return OK(
      parsed.data.customerNote
        ? "Note added and emailed to the customer by WooCommerce."
        : "Private note added in WooCommerce.",
    );
  });
}

async function storeOrder(response: unknown, contactId: string | null) {
  const parsed = wooOrder.parse(response);
  const data = mapOrder(parsed, contactId);

  return prisma.$transaction(async (tx) => {
    const saved = await tx.order.upsert({
      where: { wooId: parsed.id },
      create: data,
      update: data,
    });
    await tx.orderItem.deleteMany({ where: { orderId: saved.id } });
    await tx.orderItem.createMany({ data: mapOrderItems(parsed, saved.id) });
    return saved;
  });
}

// ---------------------------------------------------------------- contacts

const addressSchema = z.object({
  first_name: z.string().trim().max(100),
  last_name: z.string().trim().max(100),
  company: z.string().trim().max(100),
  address_1: z.string().trim().max(200),
  address_2: z.string().trim().max(200),
  city: z.string().trim().max(100),
  state: z.string().trim().max(100),
  postcode: z.string().trim().max(20),
  country: z.string().trim().max(2),
  phone: z.string().trim().max(50),
});

const contactSchema = z.object({
  firstName: z.string().trim().max(100),
  lastName: z.string().trim().max(100),
  phone: z.string().trim().max(50),
  billing: addressSchema,
  shipping: addressSchema,
});

function readAddress(formData: FormData, prefix: string): Record<string, string> {
  const fields = [
    "first_name",
    "last_name",
    "company",
    "address_1",
    "address_2",
    "city",
    "state",
    "postcode",
    "country",
    "phone",
  ];
  return Object.fromEntries(
    fields.map((field) => [field, String(formData.get(`${prefix}_${field}`) ?? "").trim()]),
  );
}

/**
 * Customer email is never editable here: it is the customer's WooCommerce login
 * (spec §6.2 rule 6). Guest contacts have no Woo record, so they are edited
 * locally only and the UI labels them "CRM-only contact" (rule 7).
 */
export async function updateContact(
  contactId: string,
  _prev: OutboundState,
  formData: FormData,
): Promise<OutboundState> {
  const user = await requireUser();

  return attempt(async () => {
    const contact = await prisma.contact.findUniqueOrThrow({ where: { id: contactId } });

    const parsed = contactSchema.safeParse({
      firstName: formData.get("firstName"),
      lastName: formData.get("lastName"),
      phone: formData.get("phone"),
      billing: readAddress(formData, "billing"),
      shipping: readAddress(formData, "shipping"),
    });
    if (!parsed.success) {
      return { error: parsed.error.issues[0].message, notice: null };
    }

    const before = {
      firstName: contact.firstName,
      lastName: contact.lastName,
      phone: contact.phone,
      billing: contact.billing,
      shipping: contact.shipping,
    };

    if (contact.wooCustomerId === null) {
      // CRM-only contact: nothing to write to Woo.
      const saved = await prisma.contact.update({
        where: { id: contactId },
        data: {
          firstName: parsed.data.firstName || null,
          lastName: parsed.data.lastName || null,
          phone: parsed.data.phone || null,
          billing: parsed.data.billing as Prisma.InputJsonValue,
          shipping: parsed.data.shipping as Prisma.InputJsonValue,
        },
      });

      await audit(user, "CONTACT_EDIT_LOCAL", "Contact", contactId, before, {
        firstName: saved.firstName,
        lastName: saved.lastName,
        phone: saved.phone,
      });
      await recordFieldEdit(user, contactId, "CRM-only contact");

      revalidatePath(`/contacts/${contactId}`);
      return OK("Contact updated. This is a CRM-only contact, so nothing was sent to the store.");
    }

    await readFresh(`/wc/v3/customers/${contact.wooCustomerId}`, contact.modifiedAtWoo);

    const response = await wooPut(`/wc/v3/customers/${contact.wooCustomerId}`, {
      first_name: parsed.data.firstName,
      last_name: parsed.data.lastName,
      billing: { ...parsed.data.billing, phone: parsed.data.phone },
      shipping: parsed.data.shipping,
    });

    const saved = await storeCustomer(response, contactId);

    await audit(user, "CONTACT_EDIT", "Contact", contactId, before, {
      firstName: saved.firstName,
      lastName: saved.lastName,
      phone: saved.phone,
    });
    await recordFieldEdit(user, contactId, "WooCommerce");

    revalidatePath(`/contacts/${contactId}`);
    return OK("Contact updated in WooCommerce.");
  });
}

async function recordFieldEdit(user: CurrentUser, contactId: string, where: string): Promise<void> {
  await prisma.activity.create({
    data: {
      contactId,
      type: "FIELD_EDIT",
      refId: contactId,
      summary: `${user.name} edited contact details (${where})`,
      occurredAt: new Date(),
    },
  });
}

const wooCustomerResponse = z
  .object({
    id: z.number().int(),
    first_name: z.string(),
    last_name: z.string(),
    date_modified_gmt: z.string().nullable(),
    billing: z.object({ phone: z.string().optional() }).loose(),
    shipping: z.object({}).loose(),
  })
  .loose();

async function storeCustomer(response: unknown, contactId: string) {
  const parsed = wooCustomerResponse.parse(response);

  return prisma.contact.update({
    where: { id: contactId },
    data: {
      firstName: parsed.first_name || null,
      lastName: parsed.last_name || null,
      phone: parsed.billing.phone || null,
      billing: parsed.billing as Prisma.InputJsonValue,
      shipping: parsed.shipping as Prisma.InputJsonValue,
      modifiedAtWoo: parsed.date_modified_gmt ? new Date(`${parsed.date_modified_gmt}Z`) : null,
      syncedAt: new Date(),
      raw: parsed as unknown as Prisma.InputJsonValue,
    },
  });
}
