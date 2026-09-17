import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { verifyPassword } from "@/lib/password";
import { normalizeRecoveryCode, verifyRecoveryCode, verifyTotp } from "@/lib/totp";
import type { Role } from "@/generated/prisma/enums";

// Auth.js v5, Credentials provider, JWT sessions (Credentials requires it),
// 8-hour maxAge (spec §9).

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;

// HTTP input is a trust boundary (engineering rule 11).
const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1),
  code: z.string().min(1),
});

// Every failed attempt counts toward the lockout, whether the password or the
// second factor was wrong.
async function registerFailure(userId: string, failedLogins: number): Promise<void> {
  const next = failedLogins + 1;
  await prisma.user.update({
    where: { id: userId },
    data: {
      failedLogins: next,
      lockedUntil:
        next >= MAX_FAILED_LOGINS
          ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000)
          : null,
    },
  });
}

// A recovery code is single-use: it is burned the moment it verifies.
async function consumeSecondFactor(
  userId: string,
  totpSecret: string,
  code: string,
): Promise<boolean> {
  if (/^\d{6}$/.test(code.trim())) {
    return verifyTotp(totpSecret, code.trim());
  }

  const normalized = normalizeRecoveryCode(code);
  if (normalized.length === 0) {
    return false;
  }

  const candidates = await prisma.recoveryCode.findMany({
    where: { userId, usedAt: null },
  });

  for (const candidate of candidates) {
    if (await verifyRecoveryCode(candidate.codeHash, normalized)) {
      await prisma.recoveryCode.update({
        where: { id: candidate.id },
        data: { usedAt: new Date() },
      });
      return true;
    }
  }

  return false;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: {},
        password: {},
        code: {},
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) {
          return null;
        }
        const { email, password, code } = parsed.data;

        const user = await prisma.user.findUnique({ where: { email } });

        // No account, deactivated, or the invite was never accepted — all of
        // which look identical to the caller, on purpose.
        if (!user || !user.active || !user.passwordHash || !user.totpSecret) {
          return null;
        }

        if (user.lockedUntil && user.lockedUntil > new Date()) {
          return null;
        }

        if (!(await verifyPassword(user.passwordHash, password))) {
          await registerFailure(user.id, user.failedLogins);
          return null;
        }

        if (!(await consumeSecondFactor(user.id, decrypt(user.totpSecret), code))) {
          await registerFailure(user.id, user.failedLogins);
          return null;
        }

        await prisma.user.update({
          where: { id: user.id },
          data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
        });

        return { id: user.id, email: user.email, name: user.name, role: user.role };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = (user as { role: Role }).role;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.sub!;
      session.user.role = token.role as Role;
      return session;
    },
  },
});
