import type { Role } from "@/generated/prisma/enums";

// One definition, used by both the sidebar and the mobile drawer.
export const NAV_LINKS = [
  { href: "/", label: "Dashboard", adminOnly: false },
  { href: "/orders", label: "Orders", adminOnly: false },
  { href: "/contacts", label: "Contacts", adminOnly: false },
  { href: "/inquiries", label: "Inquiries", adminOnly: false },
  { href: "/athletes", label: "Athlete Program", adminOnly: false },
  { href: "/affiliates", label: "Affiliates", adminOnly: false },
  { href: "/products", label: "Products", adminOnly: false },
  { href: "/tasks", label: "Tasks", adminOnly: false },
  { href: "/settings/users", label: "Users", adminOnly: true },
  { href: "/settings/sync", label: "Sync", adminOnly: true },
  { href: "/settings/audit", label: "Audit", adminOnly: true },
] as const;

export type NavLink = (typeof NAV_LINKS)[number];

export function linksFor(role: Role): NavLink[] {
  return NAV_LINKS.filter((link) => !link.adminOnly || role === "ADMIN");
}
