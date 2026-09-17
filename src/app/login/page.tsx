import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { LoginForm } from "@/app/login/login-form";

export const metadata: Metadata = { title: "Sign in · RF Supplements Ops" };

export default async function LoginPage() {
  if (await auth()) {
    redirect("/");
  }
  return (
    <main className="flex min-h-full flex-1 items-center justify-center p-6">
      <LoginForm />
    </main>
  );
}
