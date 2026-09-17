"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/require-user";

export type TagState = { error: string | null };

const schema = z.object({
  // Tags are free-form but normalised, so "VIP", "vip" and " vip " are one tag.
  name: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, { message: "A tag needs a name" })
    .max(40)
    .regex(/^[a-z0-9][a-z0-9 -]*$/, { message: "Letters, numbers, spaces and hyphens only" }),
});

export async function addTag(
  contactId: string,
  _prev: TagState,
  formData: FormData,
): Promise<TagState> {
  await requireUser();

  const parsed = schema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const tag = await prisma.tag.upsert({
    where: { name: parsed.data.name },
    create: { name: parsed.data.name },
    update: {},
  });

  // Tagging twice is a no-op rather than an error.
  await prisma.contactTag.upsert({
    where: { contactId_tagId: { contactId, tagId: tag.id } },
    create: { contactId, tagId: tag.id },
    update: {},
  });

  revalidatePath(`/contacts/${contactId}`);
  revalidatePath("/contacts");
  return { error: null };
}

export async function removeTag(contactId: string, tagId: string): Promise<void> {
  await requireUser();

  await prisma.contactTag.delete({
    where: { contactId_tagId: { contactId, tagId } },
  });

  revalidatePath(`/contacts/${contactId}`);
  revalidatePath("/contacts");
}
