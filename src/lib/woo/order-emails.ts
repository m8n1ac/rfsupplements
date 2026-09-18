// Which order statuses send mail, read from this store's WooCommerce email
// settings rather than assumed from the defaults. All six are enabled here.
//
// The dialog names the specific email so nobody changes a status and finds out
// afterwards that the customer was told (spec §6.2 rule 5).

export type StatusEmail = {
  /** Who receives it. */
  audience: "customer" | "store";
  /** The WooCommerce email's own name. */
  email: string;
};

export const STATUS_EMAILS: Record<string, StatusEmail> = {
  processing: { audience: "customer", email: "Processing order" },
  completed: { audience: "customer", email: "Completed order" },
  "on-hold": { audience: "customer", email: "Order on-hold" },
  refunded: { audience: "customer", email: "Refunded order" },
  cancelled: { audience: "store", email: "Cancelled order" },
  failed: { audience: "store", email: "Failed order" },
};

export function emailWarningFor(status: string): string | null {
  const mail = STATUS_EMAILS[status];
  if (!mail) return null;

  return mail.audience === "customer"
    ? `WooCommerce will email the customer its "${mail.email}" notification.`
    : `WooCommerce will email the store owners its "${mail.email}" notification. The customer is not emailed.`;
}
