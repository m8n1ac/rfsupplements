"use client";

import { useActionState, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { addWooOrderNote, type OutboundState } from "@/actions/outbound";

const INITIAL: OutboundState = { error: null, notice: null };

// Notes written to WooCommerce, as opposed to the internal CRM notes below them
// on the page. A customer note is emailed by WooCommerce, so the distinction is
// spelled out rather than left to a checkbox label.
export function WooNoteForm({ wooId }: { wooId: number }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [customerNote, setCustomerNote] = useState(false);
  const [state, formAction, pending] = useActionState(
    addWooOrderNote.bind(null, wooId),
    INITIAL,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>WooCommerce order notes</CardTitle>
        <CardDescription>
          These are written to the order in WooCommerce and appear in wp-admin.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          ref={formRef}
          action={async (formData) => {
            await formAction(formData);
            formRef.current?.reset();
            setCustomerNote(false);
          }}
          className="grid gap-3"
        >
          <Textarea name="note" rows={3} placeholder="Note for the order…" required />

          <div className="flex items-start gap-2">
            <Checkbox
              id="customerNote"
              name="customerNote"
              checked={customerNote}
              onCheckedChange={(checked) => setCustomerNote(checked === true)}
            />
            <div className="grid gap-0.5">
              <Label htmlFor="customerNote">Send to the customer</Label>
              <p className="text-muted-foreground text-xs">
                {customerNote
                  ? "WooCommerce will email this note to the customer."
                  : "Private: visible in wp-admin only."}
              </p>
            </div>
          </div>

          {state.error ? (
            <Alert variant="destructive"><AlertDescription>{state.error}</AlertDescription></Alert>
          ) : null}
          {state.notice ? (
            <Alert><AlertDescription>{state.notice}</AlertDescription></Alert>
          ) : null}

          <div>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Writing to WooCommerce…" : "Add note in WooCommerce"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
