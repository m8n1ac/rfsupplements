"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/require-user";
import { resolveContactId, targetPaths, type CrmTarget } from "@/actions/targets";

export type NoteState = { error: string | null };

const schema = z.object({
  body: z.string().trim().min(1, { message: "A note needs some text" }).max(5000),
});

// Phase 3 notes are INTERNAL only. Notes that write back to WooCommerce
// (WOO_PRIVATE, WOO_CUSTOMER) arrive with outbound sync in Phase 5.
export async function addNote(
  target: CrmTarget,
  _prev: NoteState,
  formData: FormData,
): Promise<NoteState> {
  const user = await requireUser();

  const parsed = schema.safeParse({ body: formData.get("body") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const contactId = await resolveContactId(target);

  await prisma.$transaction(async (tx) => {
    const note = await tx.note.create({
      data: {
        ...target,
        body: parsed.data.body,
        authorId: user.id,
        visibility: "INTERNAL",
      },
    });

    if (contactId) {
      await tx.activity.create({
        data: {
          contactId,
          type: "NOTE",
          refId: note.id,
          summary: `${user.name} added a note`,
          occurredAt: note.createdAt,
        },
      });
    }
  });

  // Answering an inquiry counts as the first response (spec §10.5).
  if (target.inquiryId) {
    await prisma.inquiry.updateMany({
      where: { id: target.inquiryId, firstResponseAt: null },
      data: { firstResponseAt: new Date() },
    });
  }

  for (const path of targetPaths(target)) {
    revalidatePath(path);
  }

  return { error: null };
}

export async function deleteNote(noteId: string, target: CrmTarget): Promise<void> {
  const user = await requireUser();

  // Staff can remove their own notes; an admin can remove any.
  const note = await prisma.note.findUnique({ where: { id: noteId } });
  if (!note || (note.authorId !== user.id && user.role !== "ADMIN")) {
    throw new Error("Not allowed to delete that note");
  }

  await prisma.$transaction([
    prisma.activity.deleteMany({ where: { type: "NOTE", refId: noteId } }),
    prisma.note.delete({ where: { id: noteId } }),
  ]);

  for (const path of targetPaths(target)) {
    revalidatePath(path);
  }
}
