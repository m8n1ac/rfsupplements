"use client";

import { useActionState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createUser,
  resendInvite,
  setUserActive,
  type UserFormState,
} from "@/app/(app)/settings/users/actions";

const INITIAL: UserFormState = { error: null, notice: null };

export function CreateUserForm() {
  const [state, formAction, pending] = useActionState(createUser, INITIAL);

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
      <div className="grid gap-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="role">Role</Label>
        <select
          id="role"
          name="role"
          defaultValue="STAFF"
          className="border-input bg-background h-9 rounded-md border px-3 text-sm"
        >
          <option value="STAFF">STAFF</option>
          <option value="ADMIN">ADMIN</option>
        </select>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Inviting…" : "Send invite"}
      </Button>
      {state.error ? (
        <Alert variant="destructive" className="sm:col-span-4">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      {state.notice ? (
        <Alert className="sm:col-span-4">
          <AlertDescription>{state.notice}</AlertDescription>
        </Alert>
      ) : null}
    </form>
  );
}

export function UserRowActions({
  userId,
  active,
  pending,
  isSelf,
}: {
  userId: string;
  active: boolean;
  pending: boolean;
  isSelf: boolean;
}) {
  const [, resendAction, resending] = useActionState(resendInvite, INITIAL);
  const [, activeAction, saving] = useActionState(setUserActive, INITIAL);

  return (
    <div className="flex justify-end gap-2">
      {pending ? (
        <form action={resendAction}>
          <input type="hidden" name="userId" value={userId} />
          <Button type="submit" variant="outline" size="sm" disabled={resending}>
            Resend invite
          </Button>
        </form>
      ) : null}
      {isSelf ? null : (
        <form action={activeAction}>
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="active" value={active ? "false" : "true"} />
          <Button type="submit" variant="outline" size="sm" disabled={saving}>
            {active ? "Deactivate" : "Reactivate"}
          </Button>
        </form>
      )}
    </div>
  );
}
