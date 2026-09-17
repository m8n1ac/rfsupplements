import { requireUser } from "@/lib/require-user";
import { AppNav } from "@/app/(app)/app-nav";

// Every authenticated page hangs off this layout, so authorization is enforced
// on the server for all of them. There is no middleware doing this as well.
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <AppNav user={user} />
      <main className="mx-auto w-full max-w-6xl flex-1 p-6">{children}</main>
    </div>
  );
}
