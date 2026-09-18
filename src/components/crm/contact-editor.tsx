"use client";

import { useActionState, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateContact, type OutboundState } from "@/actions/outbound";

const INITIAL: OutboundState = { error: null, notice: null };

export type Address = Record<string, string | undefined>;

const ADDRESS_FIELDS = [
  ["first_name", "First name"],
  ["last_name", "Last name"],
  ["company", "Company"],
  ["address_1", "Address 1"],
  ["address_2", "Address 2"],
  ["city", "City"],
  ["state", "State"],
  ["postcode", "Postcode"],
  ["country", "Country (2 letters)"],
  ["phone", "Phone"],
] as const;

export function ContactEditor({
  contactId,
  isWooCustomer,
  email,
  firstName,
  lastName,
  phone,
  billing,
  shipping,
}: {
  contactId: string;
  isWooCustomer: boolean;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  billing: Address | null;
  shipping: Address | null;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    updateContact.bind(null, contactId),
    INITIAL,
  );

  if (!open) {
    return (
      <div className="grid gap-3">
        {!isWooCustomer ? (
          <Badge variant="outline" className="w-fit">CRM-only contact</Badge>
        ) : null}
        <div>
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            Edit details
          </Button>
        </div>
        {state.notice ? (
          <Alert><AlertDescription>{state.notice}</AlertDescription></Alert>
        ) : null}
      </div>
    );
  }

  return (
    <form action={formAction} className="grid gap-4">
      {isWooCustomer ? (
        <Alert>
          <AlertDescription>
            Saving writes these fields to WooCommerce. If the store has changed
            since this page loaded, the write is refused rather than merged.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert>
          <AlertDescription>
            This is a <strong>CRM-only contact</strong> — a guest buyer with no
            WooCommerce customer record. Changes stay in the CRM.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-2">
        <Label>Email</Label>
        <Input value={email} disabled readOnly />
        <p className="text-muted-foreground text-xs">
          The email is the customer&apos;s store login and is not editable here.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field name="firstName" label="First name" defaultValue={firstName ?? ""} />
        <Field name="lastName" label="Last name" defaultValue={lastName ?? ""} />
        <Field name="phone" label="Phone" defaultValue={phone ?? ""} />
      </div>

      <AddressFields legend="Billing" prefix="billing" address={billing} />
      <AddressFields legend="Shipping" prefix="shipping" address={shipping} />

      {state.error ? (
        <Alert variant="destructive"><AlertDescription>{state.error}</AlertDescription></Alert>
      ) : null}
      {/* Shown here as well as in the collapsed view: saving leaves the form
          open, and a save with no confirmation reads as a save that failed. */}
      {state.notice ? (
        <Alert><AlertDescription>{state.notice}</AlertDescription></Alert>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : isWooCustomer ? "Save to WooCommerce" : "Save"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Field({
  name,
  label,
  defaultValue,
}: {
  name: string;
  label: string;
  defaultValue: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} defaultValue={defaultValue} />
    </div>
  );
}

function AddressFields({
  legend,
  prefix,
  address,
}: {
  legend: string;
  prefix: string;
  address: Address | null;
}) {
  return (
    <fieldset className="grid gap-3">
      <legend className="text-muted-foreground text-xs uppercase tracking-wide">{legend}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {ADDRESS_FIELDS.map(([field, label]) => (
          <Field
            key={field}
            name={`${prefix}_${field}`}
            label={label}
            defaultValue={address?.[field] ?? ""}
          />
        ))}
      </div>
    </fieldset>
  );
}
