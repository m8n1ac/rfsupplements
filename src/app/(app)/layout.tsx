import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlobalSearch } from "@/components/crm/global-search";
import { ThemeToggle } from "@/components/theme-toggle";
import { signOut } from "@/lib/auth";
import { requireUser } from "@/lib/require-user";
import { linksFor } from "@/app/(app)/nav-links";
import { NavList } from "@/app/(app)/nav-list";
import { MobileNav } from "@/app/(app)/mobile-nav";

// Every authenticated page hangs off this layout, so authorization is enforced
// on the server for all of them. There is no middleware doing this as well.
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const links = linksFor(user.role);

  return (
    <div className="flex min-h-full flex-1">
      {/* Fixed sidebar from lg up; a drawer below that. */}
      <aside className="bg-sidebar hidden w-64 shrink-0 flex-col border-r lg:flex">
        <div className="px-5 py-6">
          <Link href="/" className="text-2xl font-semibold tracking-tight">
            RF Supplements
          </Link>
          <p className="text-muted-foreground mt-0.5 text-xs">Operations</p>
        </div>
        <div className="px-3 pb-6">
          <NavList links={links} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background sticky top-0 z-40 border-b">
          <div className="flex items-center gap-3 px-4 py-3">
            <MobileNav links={links} />
            <Link href="/" className="text-xl font-semibold tracking-tight lg:hidden">
              RF Supplements
            </Link>

            <div className="ml-auto flex items-center gap-2">
              <GlobalSearch />
              <ThemeToggle />
              <Button asChild variant="ghost" size="sm" className="hidden xl:inline-flex">
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
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
