import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlobalSearch } from "@/components/crm/global-search";
import { ThemeToggle } from "@/components/theme-toggle";
import { signOut } from "@/lib/auth";
import type { CurrentUser } from "@/lib/require-user";

const LINKS = [
  { href: "/", label: "Dashboard", adminOnly: false },
  { href: "/orders", label: "Orders", adminOnly: false },
  { href: "/contacts", label: "Contacts", adminOnly: false },
  { href: "/inquiries", label: "Inquiries", adminOnly: false },
  { href: "/products", label: "Products", adminOnly: false },
  { href: "/tasks", label: "Tasks", adminOnly: false },
  { href: "/settings/users", label: "Users", adminOnly: true },
  { href: "/settings/sync", label: "Sync", adminOnly: true },
  { href: "/settings/audit", label: "Audit", adminOnly: true },
] as const;

export function AppNav({ user }: { user: CurrentUser }) {
  const links = LINKS.filter((link) => !link.adminOnly || user.role === "ADMIN");

  return (
    <header className="bg-background sticky top-0 z-40 border-b">
      <div className="mx-auto w-full max-w-7xl px-4 py-3">
        <div className="flex items-center gap-3">
          <Link href="/" className="font-semibold whitespace-nowrap">
            RF Supplements
          </Link>

          <div className="ml-auto flex items-center gap-2">
            <GlobalSearch />
            <ThemeToggle />
            <Button asChild variant="ghost" size="sm" className="hidden lg:inline-flex">
              <Link href="/account">{user.email}</Link>
            </Button>
            <Badge variant="secondary" className="hidden sm:inline-flex">{user.role}</Badge>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <Button type="submit" variant="outline" size="sm">Sign out</Button>
            </form>
          </div>
        </div>

        {/* Scrolls horizontally on a phone rather than wrapping into a wall of links. */}
        <nav className="-mx-1 mt-2 flex gap-1 overflow-x-auto">
          {links.map((link) => (
            <Button key={link.href} asChild variant="ghost" size="sm" className="shrink-0">
              <Link href={link.href}>{link.label}</Link>
            </Button>
          ))}
        </nav>
      </div>
    </header>
  );
}
