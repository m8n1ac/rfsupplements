// Importing this from a client component is a build error, not a runtime
// surprise in someone's browser: the validated environment is server-only.
import "server-only";

import { z } from "zod";

// Environment is a trust boundary (engineering rule 11), so it is validated once,
// at import, and the process refuses to start if anything is missing or malformed.

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(32),
  AUTH_URL: z.url(),
  STORE_TZ: z.string().min(1),
  // WooCommerce REST, authenticated by the crm-sync Application Password (§7).
  WOO_BASE_URL: z.url(),
  WOO_USER: z.string().min(1),
  WOO_APP_PASSWORD: z.string().min(1),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive(),
  SMTP_USER: z.string().min(1),
  SMTP_PASS: z.string().min(1),
  MAIL_FROM: z.string().min(1),
  ALERT_EMAIL: z.string().min(1),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(
    `Invalid environment:\n${z.prettifyError(parsed.error)}`,
  );
}

export const env = parsed.data;
