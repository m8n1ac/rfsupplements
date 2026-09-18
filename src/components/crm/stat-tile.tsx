import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

// A stat tile is not a chart: one number, its label, and how it moved. The delta
// is text plus an arrow, never colour alone.
export function StatTile({
  label,
  value,
  delta,
  invertDelta = false,
}: {
  label: string;
  value: string;
  /** Fractional change against the prior period; null when there is no basis. */
  delta: number | null;
  /** For measures where down is good, such as refunds. */
  invertDelta?: boolean;
}) {
  const good = delta === null ? null : invertDelta ? delta <= 0 : delta >= 0;
  const Icon = delta === null || delta === 0 ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight;

  return (
    <Card>
      <CardContent className="py-5">
        <p className="text-muted-foreground text-xs uppercase tracking-wide">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
        <p
          className={
            good === null
              ? "text-muted-foreground mt-1 flex items-center gap-1 text-xs"
              : good
                ? "mt-1 flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"
                : "text-destructive mt-1 flex items-center gap-1 text-xs"
          }
        >
          <Icon className="size-3.5" />
          {delta === null
            ? "no prior period"
            : `${delta > 0 ? "+" : ""}${(delta * 100).toFixed(1)}% vs prior`}
        </p>
      </CardContent>
    </Card>
  );
}
