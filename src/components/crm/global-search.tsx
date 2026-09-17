"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import type { SearchHit } from "@/app/api/search/route";

const GROUPS = [
  { kind: "contact" as const, heading: "Contacts" },
  { kind: "order" as const, heading: "Orders" },
  { kind: "inquiry" as const, heading: "Inquiries" },
];

export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((current) => !current);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (term.trim().length === 0) {
      return;
    }

    // Debounced, and abortable so a slow response cannot overwrite a newer one.
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        });
        if (response.ok) {
          const data = (await response.json()) as { hits: SearchHit[] };
          setHits(data.hits);
        }
      } catch {
        // An aborted request is the expected case while typing.
      }
    }, 180);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [term]);

  // Derived rather than stored: an empty box shows nothing without a second
  // render pass to clear the list.
  const visibleHits = term.trim().length === 0 ? [] : hits;

  function go(href: string) {
    setOpen(false);
    setTerm("");
    router.push(href);
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="text-muted-foreground gap-2"
        onClick={() => setOpen(true)}
      >
        <Search className="size-3.5" />
        <span className="hidden sm:inline">Search</span>
        <kbd className="bg-muted hidden rounded px-1.5 text-xs sm:inline">⌘K</kbd>
      </Button>

      <CommandDialog open={open} onOpenChange={setOpen} title="Search" description="Contacts, orders and inquiries">
        <CommandInput
          value={term}
          onValueChange={setTerm}
          placeholder="Search contacts, orders and inquiries…"
        />
        <CommandList>
          {term.trim() && visibleHits.length === 0 ? <CommandEmpty>No matches.</CommandEmpty> : null}
          {GROUPS.map((group) => {
            const groupHits = visibleHits.filter((hit) => hit.kind === group.kind);
            if (groupHits.length === 0) return null;
            return (
              <CommandGroup key={group.kind} heading={group.heading}>
                {groupHits.map((hit) => (
                  <CommandItem
                    key={`${hit.kind}-${hit.id}`}
                    value={`${hit.kind}-${hit.id}-${hit.title}-${hit.subtitle}`}
                    onSelect={() => go(hit.href)}
                  >
                    <span className="font-medium">{hit.title}</span>
                    <span className="text-muted-foreground ml-2 truncate text-xs">{hit.subtitle}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            );
          })}
        </CommandList>
      </CommandDialog>
    </>
  );
}
