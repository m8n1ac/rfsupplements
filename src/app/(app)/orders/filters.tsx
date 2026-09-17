"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ORDER_STATUSES } from "@/lib/order-status";

// Filters write to the URL and let the server re-render. No client-side
// filtering: the table can be 560 rows today and 50,000 later.
export function OrderFilters({ paymentMethods }: { paymentMethods: string[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [search, setSearch] = useState(params.get("q") ?? "");

  function apply(overrides: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(overrides)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    next.delete("page");
    router.push(`/orders?${next.toString()}`);
  }

  const selectClass =
    "border-input bg-background h-9 w-full rounded-md border px-3 text-sm";

  return (
    <form
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
      onSubmit={(event) => {
        event.preventDefault();
        apply({ q: search });
      }}
    >
      <div className="grid gap-1.5 lg:col-span-2">
        <Label htmlFor="q">Search</Label>
        <Input
          id="q"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Order number, name, or email"
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="status">Status</Label>
        <select
          id="status"
          className={selectClass}
          defaultValue={params.get("status") ?? ""}
          onChange={(event) => apply({ status: event.target.value })}
        >
          <option value="">Any status</option>
          {ORDER_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="payment">Payment</Label>
        <select
          id="payment"
          className={selectClass}
          defaultValue={params.get("payment") ?? ""}
          onChange={(event) => apply({ payment: event.target.value })}
        >
          <option value="">Any method</option>
          {paymentMethods.map((method) => (
            <option key={method} value={method}>
              {method}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="coupon">Coupon</Label>
        <select
          id="coupon"
          className={selectClass}
          defaultValue={params.get("coupon") ?? ""}
          onChange={(event) => apply({ coupon: event.target.value })}
        >
          <option value="">Any</option>
          <option value="yes">Used a coupon</option>
          <option value="no">No coupon</option>
        </select>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="from">From</Label>
        <Input
          id="from"
          type="date"
          defaultValue={params.get("from") ?? ""}
          onChange={(event) => apply({ from: event.target.value })}
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="to">To</Label>
        <Input
          id="to"
          type="date"
          defaultValue={params.get("to") ?? ""}
          onChange={(event) => apply({ to: event.target.value })}
        />
      </div>

      <div className="flex items-end gap-2 lg:col-span-2">
        <Button type="submit" size="sm">Search</Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setSearch("");
            router.push("/orders");
          }}
        >
          Clear
        </Button>
      </div>
    </form>
  );
}
