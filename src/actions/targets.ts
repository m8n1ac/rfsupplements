import { prisma } from "@/lib/db";

// Notes and tasks attach to a contact, an order, or an inquiry. The shape is
// the same everywhere, so the components and actions take one target type.
export type CrmTarget = {
  contactId?: string;
  orderId?: string;
  inquiryId?: string;
};

// The Activity timeline lives on the contact, so anything attached to an order
// or an inquiry is credited to that record's contact.
export async function resolveContactId(target: CrmTarget): Promise<string | null> {
  if (target.contactId) {
    return target.contactId;
  }
  if (target.orderId) {
    const order = await prisma.order.findUnique({
      where: { id: target.orderId },
      select: { contactId: true },
    });
    return order?.contactId ?? null;
  }
  if (target.inquiryId) {
    const inquiry = await prisma.inquiry.findUnique({
      where: { id: target.inquiryId },
      select: { contactId: true },
    });
    return inquiry?.contactId ?? null;
  }
  return null;
}

// Every screen a target can appear on, so an action can revalidate all of them
// without the caller passing paths around.
export function targetPaths(target: CrmTarget): string[] {
  const paths = ["/"];
  if (target.contactId) paths.push(`/contacts/${target.contactId}`);
  if (target.orderId) paths.push("/orders");
  if (target.inquiryId) paths.push("/inquiries", `/inquiries/${target.inquiryId}`);
  paths.push("/tasks");
  return paths;
}
