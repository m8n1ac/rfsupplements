import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import type { Role } from "@/generated/prisma/enums";

// Auth.js v5, Credentials provider, JWT sessions (Credentials requires it),
// 8-hour maxAge (spec §9).
//
// Spec §9 mandated TOTP for every user. Darrin cancelled that requirement on
// 2026-09-17, so a password is the only factor and the lockout below plus the
// nginx limit_req on /api/auth/ are the only brute-force defences.

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;

// HTTP input is a trust boundary (engineering rule 11).
const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1),
});

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

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: {},
        password: {},
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) {
          return null;
        }
        const { email, password } = parsed.data;

        const user = await prisma.user.findUnique({ where: { email } });

        // No account, deactivated, or the invite was never accepted — all of
        // which look identical to the caller, on purpose.
        if (!user || !user.active || !user.passwordHash) {
          return null;
        }

        if (user.lockedUntil && user.lockedUntil > new Date()) {
          return null;
        }

        if (!(await verifyPassword(user.passwordHash, password))) {
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
