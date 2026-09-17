"use client";

import { useActionState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changePassword, type PasswordState } from "@/app/(app)/account/actions";

const INITIAL: PasswordState = { error: null, notice: null };

export function PasswordForm() {
  const [state, formAction, pending] = useActionState(changePassword, INITIAL);

  return (
    <form action={formAction} className="grid max-w-sm gap-4">
      <div className="grid gap-2">
        <Label htmlFor="current">Current password</Label>
        <Input id="current" name="current" type="password" autoComplete="current-password" required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="next">New password</Label>
        <Input id="next" name="next" type="password" autoComplete="new-password" minLength={12} required />
        <p className="text-muted-foreground text-xs">At least 12 characters.</p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="confirm">Confirm new password</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={12} required />
      </div>
      {state.error ? (
        <Alert variant="destructive"><AlertDescription>{state.error}</AlertDescription></Alert>
      ) : null}
      {state.notice ? (
        <Alert><AlertDescription>{state.notice}</AlertDescription></Alert>
      ) : null}
      <div>
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Change password"}</Button>
      </div>
    </form>
  );
}
