"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setInvitePassword, type PasswordState } from "@/app/invite/[token]/actions";

const INITIAL: PasswordState = { error: null, done: false };

export function InviteFlow({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(
    setInvitePassword.bind(null, token),
    INITIAL,
  );

  if (state.done) {
    return (
      <div className="grid gap-4">
        <Alert>
          <AlertDescription>
            Your account is ready. Sign in with your email and the password you
            just chose.
          </AlertDescription>
        </Alert>
        <Button asChild>
          <Link href="/login">Go to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="password">Choose a password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
        />
        <p className="text-muted-foreground text-xs">At least 12 characters.</p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="confirm">Confirm password</Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
        />
      </div>
      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Finish setup"}
      </Button>
    </form>
  );
}
