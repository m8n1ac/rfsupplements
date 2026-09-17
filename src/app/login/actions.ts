"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn } from "@/lib/auth";

export type LoginState = { error: string | null };

// Every failure returns the same message. Distinguishing "no such user" from
// "wrong password" from "locked out" would hand an attacker an oracle.
const GENERIC_FAILURE =
  "Those details did not work. After 5 failed attempts the account locks for 15 minutes.";

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirect: false,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: GENERIC_FAILURE };
    }
    throw error;
  }

  redirect("/");
}
