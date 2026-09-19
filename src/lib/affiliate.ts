// Solid Affiliate stores first and last name as free text on the affiliate row,
// separately from the WP user. They are frequently incomplete, and in this
// store several are entered the wrong way round ("Shiver Allison" for
// allison.shiver86@…). The CRM shows what is there and falls back to the email
// rather than inventing a tidier name than the source has.
export function affiliateName(affiliate: {
  firstName: string | null;
  lastName: string | null;
  email: string;
}): string {
  const name = [affiliate.firstName, affiliate.lastName].filter(Boolean).join(" ").trim();
  return name || affiliate.email || "unnamed affiliate";
}

// Referral statuses Solid Affiliate uses. "unpaid" is the one that costs money.
export const REFERRAL_STATUSES = ["unpaid", "paid", "rejected"] as const;
