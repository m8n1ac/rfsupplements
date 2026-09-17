"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/require-user";
const statusSchema = z.enum(["NEW", "OPEN", "WAITING", "WON", "CLOSED"]);

// firstResponseAt is set the first time anyone moves an inquiry out of NEW or
// adds a note (spec §10.5). Notes handle their own half in src/actions/notes.ts.
export async function setInquiryStatus(inquiryId: string, formData: FormData): Promise<void> {
  const user = await requireUser();

  const parsed = statusSchema.safeParse(formData.get("status"));
  if (!parsed.success) {
    throw new Error("Unknown inquiry status");
  }
  const status = parsed.data;

  const current = await prisma.inquiry.findUniqueOrThrow({
    where: { id: inquiryId },
    select: { status: true, firstResponseAt: true, contactId: true, formName: true },
  });

  const now = new Date();
  const leavingNew = current.status === "NEW" && status !== "NEW";

  await prisma.inquiry.update({
    where: { id: inquiryId },
    data: {
      status,
      firstResponseAt:
        current.firstResponseAt ?? (leavingNew ? now : null),
      closedAt: status === "WON" || status === "CLOSED" ? now : null,
    },
  });

  if (current.contactId) {
    await prisma.activity.create({
      data: {
        contactId: current.contactId,
        type: "INQUIRY",
        refId: inquiryId,
        summary: `${user.name} moved "${current.formName}" to ${status}`,
        occurredAt: now,
      },
    });
  }

  revalidatePath("/inquiries");
  revalidatePath(`/inquiries/${inquiryId}`);
}

export async function assignInquiry(inquiryId: string, formData: FormData): Promise<void> {
  await requireUser();

  const raw = String(formData.get("assigneeId") ?? "");
  await prisma.inquiry.update({
    where: { id: inquiryId },
    data: { assigneeId: raw === "" ? null : raw },
  });

  revalidatePath("/inquiries");
  revalidatePath(`/inquiries/${inquiryId}`);
}
