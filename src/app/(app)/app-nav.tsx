import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth";
import type { CurrentUser } from "@/lib/require-user";

// Phase 1 ships the shell and its navigation. The Orders, Contacts, Inquiries
// and Tasks screens arrive in Phase 3, the dashboard in Phase 4.
const LINKS = [
  { href: "/", label: "Dashboard", adminOnly: false },
  { href: "/orders", label: "Orders", adminOnly: false },
  { href: "/contacts", label: "Contacts", adminOnly: false },
  { href: "/inquiries", label: "Inquiries", adminOnly: false },
  { href: "/tasks", label: "Tasks", adminOnly: false },
  { href: "/settings/users", label: "Users", adminOnly: true },
  { href: "/settings/sync", label: "Sync", adminOnly: true },
] as const;

export function AppNav({ user }: { user: CurrentUser }) {
  const links = LINKS.filter((link) => !link.adminOnly || user.role === "ADMIN");

  return (
    <header className="border-b">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-4 p-4">
        <span className="font-semibold">RF Supplements Ops</span>
        <nav className="flex flex-wrap items-center gap-1">
          {links.map((link) => (
            <Button key={link.href} asChild variant="ghost" size="sm">
              <Link href={link.href}>{link.label}</Link>
            </Button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-muted-foreground text-sm">{user.email}</span>
          <Badge variant="secondary">{user.role}</Badge>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <Button type="submit" variant="outline" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
