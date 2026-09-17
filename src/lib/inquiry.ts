import type { InquiryStatus } from "@/generated/prisma/enums";

// Pipeline order, left to right on the board. Kept out of the actions file
// because a "use server" module may only export async functions.
export const INQUIRY_STATUSES: InquiryStatus[] = ["NEW", "OPEN", "WAITING", "WON", "CLOSED"];
