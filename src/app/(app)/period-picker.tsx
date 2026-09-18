"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PERIOD_KEYS, PERIOD_LABELS, type PeriodKey } from "@/lib/metrics/period";

// The period lives in the URL, so a dashboard view can be shared or bookmarked.
export function PeriodPicker({ active }: { active: PeriodKey }) {
  const router = useRouter();
  const params = useSearchParams();

  function select(key: PeriodKey) {
    const next = new URLSearchParams(params.toString());
    next.set("period", key);
    if (key !== "custom") {
      next.delete("from");
      next.delete("to");
    }
    router.push(`/?${next.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-wrap gap-1">
        {PERIOD_KEYS.map((key) => (
          <Button
            key={key}
            size="sm"
            variant={active === key ? "secondary" : "ghost"}
            onClick={() => select(key)}
          >
            {PERIOD_LABELS[key]}
          </Button>
        ))}
      </div>

      {active === "custom" ? (
        <form action="/" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="period" value="custom" />
          <Input
            type="date"
            name="from"
            defaultValue={params.get("from") ?? ""}
            className="h-8 w-auto"
            aria-label="From date"
          />
          <Input
            type="date"
            name="to"
            defaultValue={params.get("to") ?? ""}
            className="h-8 w-auto"
            aria-label="To date"
          />
          <Button type="submit" size="sm">Apply</Button>
        </form>
      ) : null}
    </div>
  );
}
