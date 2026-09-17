import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/require-user";
import { LoginForm } from "@/app/login/login-form";

export const metadata: Metadata = { title: "Sign in · RF Supplements Ops" };

export default async function LoginPage() {
  // Checks the database, not just the cookie, so a session belonging to a
  // deactivated account lands on the sign-in form instead of bouncing.
  if (await getCurrentUser()) {
    redirect("/");
  }
  return (
    <main className="flex min-h-full flex-1 items-center justify-center p-6">
      <LoginForm />
    </main>
  );
}
