import Link from "next/link";
import { Button } from "@/components/ui/button";

// Server-rendered pagination: the page number lives in the URL, so a row can be
// opened and the browser's back button returns to the same page.
export function Pagination({
  page,
  pageCount,
  total,
  buildHref,
}: {
  page: number;
  pageCount: number;
  total: number;
  buildHref: (page: number) => string;
}) {
  if (pageCount <= 1) {
    return <p className="text-muted-foreground text-sm">{total} result{total === 1 ? "" : "s"}</p>;
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <p className="text-muted-foreground text-sm">
        Page {page} of {pageCount} · {total} results
      </p>
      <div className="flex gap-2">
        <Button asChild={page > 1} variant="outline" size="sm" disabled={page <= 1}>
          {page > 1 ? <Link href={buildHref(page - 1)}>Previous</Link> : <span>Previous</span>}
        </Button>
        <Button asChild={page < pageCount} variant="outline" size="sm" disabled={page >= pageCount}>
          {page < pageCount ? <Link href={buildHref(page + 1)}>Next</Link> : <span>Next</span>}
        </Button>
      </div>
    </div>
  );
}
