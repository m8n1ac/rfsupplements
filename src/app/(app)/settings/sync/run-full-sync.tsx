"use client";

import { useActionState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { runFullSync, type SyncActionState } from "@/app/(app)/settings/sync/actions";

const INITIAL: SyncActionState = { error: null, notice: null };

export function RunFullSyncButton() {
  const [state, formAction, pending] = useActionState(runFullSync, INITIAL);

  return (
    <form action={formAction} className="grid gap-3">
      <div>
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Starting…" : "Run a full sync now"}
        </Button>
      </div>
      {state.notice ? (
        <Alert>
          <AlertDescription>{state.notice}</AlertDescription>
        </Alert>
      ) : null}
      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
    </form>
  );
}
