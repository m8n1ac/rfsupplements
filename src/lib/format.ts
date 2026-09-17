import { env } from "@/lib/env";

export { ORDER_STATUSES, orderStatusVariant } from "@/lib/order-status";

// Everything is stored in UTC and displayed in the store's timezone (Gate 0, A2).
// The timezone is a value, never a hardcoded offset: California observes DST.

const dateTime = new Intl.DateTimeFormat("en-US", {
  timeZone: env.STORE_TZ,
  dateStyle: "medium",
  timeStyle: "short",
});

const dateOnly = new Intl.DateTimeFormat("en-US", {
  timeZone: env.STORE_TZ,
  dateStyle: "medium",
});

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function formatDateTime(value: Date | null | undefined): string {
  return value ? dateTime.format(value) : "—";
}

export function formatDate(value: Date | null | undefined): string {
  return value ? dateOnly.format(value) : "—";
}

// Prisma hands back Decimal; formatting goes through its string form so the
// value never passes through a float on the way to the screen.
export function formatMoney(value: { toString(): string } | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return currency.format(Number(value.toString()));
}

export function formatRelative(value: Date | null | undefined): string {
  if (!value) return "—";

  const days = Math.floor((Date.now() - value.getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

export function fullName(
  contact: { firstName: string | null; lastName: string | null; email: string },
): string {
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim();
  return name || contact.email;
}
