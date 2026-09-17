"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { hashPassword, MIN_PASSWORD_LENGTH } from "@/lib/password";
import { createRecoveryCodes, hashRecoveryCode, verifyTotp } from "@/lib/totp";
import { findPendingInvite } from "@/lib/invite";

export type PasswordState = { error: string | null };
export type TotpState = { error: string | null; recoveryCodes: string[] | null };

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

export async function setInvitePassword(
  token: string,
  _prev: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  const invite = await findPendingInvite(token);
  if (!invite) {
    return { error: EXPIRED };
  }

  const parsed = passwordSchema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  await prisma.user.update({
    where: { id: invite.userId },
    data: { passwordHash: await hashPassword(parsed.data.password) },
  });

  // Re-render the page so it advances to the TOTP step, which it decides from
  // the stored state rather than from client-side step tracking.
  revalidatePath(`/invite/${token}`);
  return { error: null };
}

// Confirming the code completes enrolment: it accepts the invite and returns the
// eight recovery codes, which are shown exactly once and stored only as hashes.
export async function confirmInviteTotp(
  token: string,
  _prev: TotpState,
  formData: FormData,
): Promise<TotpState> {
  const invite = await findPendingInvite(token);
  if (!invite) {
    return { error: EXPIRED, recoveryCodes: null };
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: invite.userId },
    select: { totpSecret: true, passwordHash: true },
  });

  if (!user.passwordHash || !user.totpSecret) {
    return { error: EXPIRED, recoveryCodes: null };
  }

  const code = String(formData.get("code") ?? "").trim();
  if (!(await verifyTotp(decrypt(user.totpSecret), code))) {
    return { error: "That code did not match. Check your authenticator and try again.", recoveryCodes: null };
  }

  const recoveryCodes = createRecoveryCodes();
  const codeHashes = await Promise.all(recoveryCodes.map(hashRecoveryCode));

  await prisma.$transaction([
    prisma.user.update({
      where: { id: invite.userId },
      data: { totpEnrolledAt: new Date() },
    }),
    prisma.recoveryCode.deleteMany({ where: { userId: invite.userId } }),
    prisma.recoveryCode.createMany({
      data: codeHashes.map((codeHash) => ({ userId: invite.userId, codeHash })),
    }),
    prisma.invite.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date() },
    }),
  ]);

  return { error: null, recoveryCodes };
}
