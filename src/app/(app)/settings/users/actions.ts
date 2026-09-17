"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/require-user";
import { createInvite, inviteUrl } from "@/lib/invite";
import { inviteEmail, sendMail } from "@/lib/mail";

export type UserFormState = { error: string | null; notice: string | null };

const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  name: z.string().trim().min(1, { message: "Name is required" }),
  role: z.enum(["ADMIN", "STAFF"]),
});

// Admins create users; there is no self-signup (spec §9). The new user receives
// a single-use invite and sets their own password and TOTP.
export async function createUser(
  _prev: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const admin = await requireUser("ADMIN");

  const parsed = createUserSchema.safeParse({
    email: formData.get("email"),
    name: formData.get("name"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message, notice: null };
  }

  const { email, name, role } = parsed.data;

  if (await prisma.user.findUnique({ where: { email } })) {
    return { error: `${email} already has an account`, notice: null };
  }

  const user = await prisma.user.create({ data: { email, name, role } });
  const token = await createInvite(user.id, admin.id);

  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: "USER_CREATE",
      entity: "User",
      entityId: user.id,
      after: { email, name, role },
    },
  });

  await sendMail(email, ...mailArgs(name, inviteUrl(token)));

  revalidatePath("/settings/users");
  return { error: null, notice: `Invited ${email}.` };
}

export async function resendInvite(
  _prev: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const admin = await requireUser("ADMIN");

  const userId = String(formData.get("userId") ?? "");
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, passwordHash: true, totpEnrolledAt: true },
  });

  if (!user) {
    return { error: "No such user", notice: null };
  }
  if (user.passwordHash && user.totpEnrolledAt) {
    return { error: `${user.email} has already completed setup`, notice: null };
  }

  const token = await createInvite(user.id, admin.id);
  await sendMail(user.email, ...mailArgs(user.name, inviteUrl(token)));

  revalidatePath("/settings/users");
  return { error: null, notice: `Sent a fresh invite to ${user.email}.` };
}

export async function setUserActive(
  _prev: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const admin = await requireUser("ADMIN");

  const userId = String(formData.get("userId") ?? "");
  const active = formData.get("active") === "true";

  if (userId === admin.id) {
    return { error: "You cannot deactivate your own account", notice: null };
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: { active },
    select: { email: true },
  });

  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: active ? "USER_ACTIVATE" : "USER_DEACTIVATE",
      entity: "User",
      entityId: userId,
      after: { active },
    },
  });

  revalidatePath("/settings/users");
  return { error: null, notice: `${user.email} is now ${active ? "active" : "deactivated"}.` };
}

function mailArgs(name: string, url: string): [string, string] {
  const { subject, text } = inviteEmail(name, url);
  return [subject, text];
}
