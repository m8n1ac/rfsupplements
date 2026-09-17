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

// Every page, server action and route handler calls this (spec §9). It reloads
// the user from the database rather than trusting the JWT, so deactivating a
// user or changing their role takes effect on their very next request.
//
// It interrupts rather than returning: redirect() for "not signed in" and
// forbidden() for "wrong role". Both throw Next's control-flow signals, so
// callers need no try/catch, and a page that calls this can never render for
// the wrong user.
export async function requireUser(role?: Role): Promise<CurrentUser> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, name: true, role: true, active: true },
  });

  if (!user || !user.active) {
    redirect("/login");
  }

  if (role && user.role !== role) {
    forbidden();
  }

  return { id: user.id, email: user.email, name: user.name, role: user.role };
}
