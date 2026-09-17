// Pure constants, safe to import from a client component. Anything that needs
// STORE_TZ lives in src/lib/format.ts, which reads the validated environment
// and is therefore server-only.

export const ORDER_STATUSES = [
  "pending",
  "processing",
  "on-hold",
  "completed",
  "cancelled",
  "refunded",
  "failed",
] as const;

export function orderStatusVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "completed") return "default";
  if (status === "processing" || status === "on-hold") return "secondary";
  if (status === "cancelled" || status === "failed") return "destructive";
  return "outline";
}
