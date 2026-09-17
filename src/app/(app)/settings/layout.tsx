import { requireUser } from "@/lib/require-user";

// Everything under /settings is ADMIN-only (spec §9). Enforced here on the
// server, so no settings page can forget to check. STAFF gets a 403.
export default async function SettingsLayout({ children }: LayoutProps<"/settings">) {
  await requireUser("ADMIN");
  return children;
}
