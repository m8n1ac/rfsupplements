import Link from "next/link";
import { Button } from "@/components/ui/button";
import { buildQuery, type Query } from "@/lib/search-params";

// A row of toggle filters that keeps its state in the URL. Clicking the active
// option clears it, so every filter is its own on/off switch and the back
// button walks the filter history.
//
// A filter needs at least two options to be a filter. With one, every choice
// selects the whole set — the affiliate list showed a Status control offering
// only "approved" because all twenty are, which reads as a broken control
// rather than an empty one. Where the options come from the data, the control
// appears when the data makes it meaningful.
export function FilterGroup({
  label,
  current,
  options,
  query,
  param,
  basePath,
}: {
  label: string;
  current: string | undefined;
  options: { value: string; label: string }[];
  query: Query;
  param: string;
  basePath: string;
}) {
  if (options.length < 2) return null;

  return (
    <div className="grid gap-1.5">
      <span className="text-muted-foreground text-xs tracking-wide uppercase">{label}</span>
      <div className="flex flex-wrap gap-1">
        {options.map((option) => (
          <Button
            key={option.value}
            asChild
            size="sm"
            variant={current === option.value ? "secondary" : "ghost"}
          >
            <Link
              href={`${basePath}${buildQuery(query, {
                [param]: current === option.value ? undefined : option.value,
              })}`}
            >
              {option.label}
            </Link>
          </Button>
        ))}
      </div>
    </div>
  );
}
