"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/require-user";
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from "@/lib/password";

export type PasswordState = { error: string | null; notice: string | null };

const schema = z
  .object({
    current: z.string().min(1, { message: "Enter your current password" }),
    next: z.string().min(MIN_PASSWORD_LENGTH, {
      message: `New password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    }),
    confirm: z.string(),
  })
  .refine((value) => value.next === value.confirm, {
    message: "The two new passwords do not match",
  });

export async function changePassword(
  _prev: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  const user = await requireUser();

  const parsed = schema.safeParse({
    current: formData.get("current"),
    next: formData.get("next"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message, notice: null };
  }

  const record = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { passwordHash: true },
  });

  // Knowing the current password is required, so a walk-up at an unlocked screen
  // cannot change it.
  if (!record.passwordHash || !(await verifyPassword(record.passwordHash, parsed.data.current))) {
    return { error: "That is not your current password", notice: null };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(parsed.data.next) },
  });

  await prisma.auditLog.create({
    data: { userId: user.id, action: "PASSWORD_CHANGE", entity: "User", entityId: user.id },
  });

  return { error: null, notice: "Password changed." };
}
