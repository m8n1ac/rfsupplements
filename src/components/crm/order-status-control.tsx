"use client";

import { useActionState, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { changeOrderStatus, type OutboundState } from "@/actions/outbound";
import { emailWarningFor } from "@/lib/woo/order-emails";
import { ORDER_STATUSES } from "@/lib/order-status";

const INITIAL: OutboundState = { error: null, notice: null };

// The status is written to WooCommerce first; the CRM stores whatever Woo
// answers. Choosing a different status opens the confirm dialog, which names
// the specific email WooCommerce will send rather than warning vaguely.
export function OrderStatusControl({ wooId, current }: { wooId: number; current: string }) {
  const [state, formAction, pending] = useActionState(
    changeOrderStatus.bind(null, wooId),
    INITIAL,
  );
  const [chosen, setChosen] = useState<string>(current);

  const open = chosen !== current;
  const warning = emailWarningFor(chosen);

  return (
    <div className="grid gap-3">
      <div className="grid gap-2">
        <label htmlFor="status" className="text-muted-foreground text-xs uppercase tracking-wide">
          Order status
        </label>
        <select
          id="status"
          value={chosen}
          onChange={(event) => setChosen(event.target.value)}
          className="border-input bg-background h-9 rounded-md border px-3 text-sm"
        >
          {ORDER_STATUSES.map((status) => (
            <option key={status} value={status}>{status}</option>
          ))}
        </select>
        <p className="text-muted-foreground text-xs">
          Currently <strong>{current}</strong>. Choosing another asks for confirmation.
        </p>
      </div>

      <Dialog open={open} onOpenChange={(next) => !next && setChosen(current)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change status to {chosen}?</DialogTitle>
            <DialogDescription>
              This writes to WooCommerce immediately. The store is the system of
              record, so the change takes effect there first.
            </DialogDescription>
          </DialogHeader>

          <Alert>
            {warning ? <AlertTriangle className="size-4" /> : null}
            <AlertDescription>
              {warning ?? "WooCommerce sends no notification for this status."}
            </AlertDescription>
          </Alert>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setChosen(current)}>
              Cancel
            </Button>
            <form action={formAction}>
              <input type="hidden" name="status" value={chosen} />
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? "Writing to WooCommerce…" : "Change status"}
              </Button>
            </form>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {state.error ? (
        <Alert variant="destructive"><AlertDescription>{state.error}</AlertDescription></Alert>
      ) : null}
      {state.notice ? (
        <Alert><AlertDescription>{state.notice}</AlertDescription></Alert>
      ) : null}
    </div>
  );
}
