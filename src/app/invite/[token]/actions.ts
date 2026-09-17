"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword, MIN_PASSWORD_LENGTH } from "@/lib/password";
import { findPendingInvite } from "@/lib/invite";

export type PasswordState = { error: string | null; done: boolean };

const EXPIRED = "This invite is no longer valid. Ask an administrator for a new one.";

const passwordSchema = z
  .object({
    password: z.string().min(MIN_PASSWORD_LENGTH, {
      message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    }),
    confirm: z.string(),
  })
  .refine((value) => value.password === value.confirm, {
    message: "The two passwords do not match",
  });

// Setting the password accepts the invite and completes setup.
export async function setInvitePassword(
  token: string,
  _prev: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  const invite = await findPendingInvite(token);
  if (!invite) {
    return { error: EXPIRED, done: false };
  }

  const parsed = passwordSchema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message, done: false };
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: invite.userId },
      data: { passwordHash: await hashPassword(parsed.data.password) },
    }),
    prisma.invite.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date() },
    }),
  ]);

  return { error: null, done: true };
}
