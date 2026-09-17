import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";

// Invites are single-use and expire 24 hours after creation (spec §9).
// The token is 32 random bytes, so it is stored as a plain SHA-256 digest:
// there is nothing to brute-force and no need for a slow KDF here.

export const INVITE_TTL_HOURS = 24;

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function inviteUrl(token: string): string {
  return `${env.AUTH_URL}/invite/${token}`;
}

// Issuing a new invite invalidates any outstanding one for that user.
export async function createInvite(userId: string, createdById: string): Promise<string> {
  const token = randomBytes(32).toString("hex");

  await prisma.$transaction([
    prisma.invite.deleteMany({ where: { userId, acceptedAt: null } }),
    prisma.invite.create({
      data: {
        userId,
        tokenHash: hashInviteToken(token),
        expiresAt: new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000),
        createdById,
      },
    }),
  ]);

  return token;
}

export type PendingInvite = {
  id: string;
  userId: string;
  email: string;
  name: string;
};

// Returns null for unknown, expired, or already-accepted tokens alike.
export async function findPendingInvite(token: string): Promise<PendingInvite | null> {
  const invite = await prisma.invite.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    include: { user: { select: { id: true, email: true, name: true, active: true } } },
  });

  if (!invite || invite.acceptedAt || invite.expiresAt < new Date() || !invite.user.active) {
    return null;
  }

  return {
    id: invite.id,
    userId: invite.user.id,
    email: invite.user.email,
    name: invite.user.name,
  };
}
