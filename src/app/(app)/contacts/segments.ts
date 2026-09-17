import type { Prisma } from "@/generated/prisma/client";

// The segments from spec §10.4. Each is a plain where-clause, so the list page
// stays one query and the counts stay honest.
export const SEGMENTS = [
  { key: "all", label: "All" },
  { key: "customers", label: "Customers" },
  { key: "guests", label: "Guests" },
  { key: "leads", label: "Leads" },
  { key: "repeat", label: "Repeat" },
  { key: "at-risk", label: "At risk" },
] as const;

export type SegmentKey = (typeof SEGMENTS)[number]["key"];

const NINETY_DAYS_MS = 90 * 86_400_000;

export function segmentWhere(segment: string): Prisma.ContactWhereInput {
  switch (segment) {
    case "customers":
      return { source: "WOO_CUSTOMER" };
    case "guests":
      return { source: "WOO_GUEST" };
    // A lead has come in through a form and has never ordered.
    case "leads":
      return { source: "FORM", ordersCount: 0 };
    case "repeat":
      return { ordersCount: { gte: 2 } };
    // Two or more orders, but nothing for 90 days.
    case "at-risk":
      return {
        ordersCount: { gte: 2 },
        lastOrderAt: { lt: new Date(Date.now() - NINETY_DAYS_MS) },
      };
    default:
      return {};
  }
}
