import { forbidden, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import type { Role } from "@/generated/prisma/enums";

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
};

// The single source of truth for "who is signed in". The JWT only carries an
// id: the account is reloaded from the database on every call, so deactivating
// a user takes effect on their very next request.
//
// Returns null when there is no session, or when the session points at an
// account that no longer exists or is deactivated. Sign-in and sign-out pages
// use this too, so a stale cookie can never bounce between /login and / .
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, name: true, role: true, active: true },
  });

  if (!user || !user.active) {
    return null;
  }

  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

// Every page, server action and route handler calls this (spec §9). It
// interrupts rather than returning: redirect() for "not signed in" and
// forbidden() for "wrong role". Both throw Next's control-flow signals, so
// callers need no try/catch, and a page that calls this can never render for
// the wrong user.
export async function requireUser(role?: Role): Promise<CurrentUser> {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  if (role && user.role !== role) {
    forbidden();
  }

  return user;
}
