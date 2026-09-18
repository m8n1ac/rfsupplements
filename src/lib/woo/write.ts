import "server-only";

import { z } from "zod";
import { env } from "@/lib/env";

// Outbound writes (spec §6.2). Every write is Woo-first:
//
//   1. GET the record from Woo and refuse if it changed since the CRM copy
//   2. write to Woo
//   3. upsert Woo's response locally — its answer is the truth
//   4. record an AuditLog row
//
// On failure nothing is written locally. There is no local-first queue and no
// retry loop, so a sync loop is impossible by construction: the pull is
// idempotent and an outbound write never triggers another outbound write.

const authorization = `Basic ${Buffer.from(
  `${env.WOO_USER}:${env.WOO_APP_PASSWORD}`,
).toString("base64")}`;

/** The store changed underneath us. The caller must refresh, never merge. */
export class StaleRecordError extends Error {
  constructor() {
    super("This record changed in the store — refresh and try again.");
    this.name = "StaleRecordError";
  }
}

/** WooCommerce refused the write. Its message is shown to the user verbatim. */
export class WooWriteError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "WooWriteError";
  }
}

const wooErrorBody = z.object({ message: z.string() }).loose();

async function call(path: string, method: "GET" | "PUT" | "POST", body?: unknown): Promise<unknown> {
  const response = await fetch(`${env.WOO_BASE_URL}${path}`, {
    method,
    headers: {
      authorization,
      accept: "application/json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    // Woo's own message is the most useful thing we can show, so it is passed
    // through rather than replaced with something generic.
    const parsed = wooErrorBody.safeParse(payload);
    throw new WooWriteError(
      response.status,
      parsed.success ? parsed.data.message : `WooCommerce returned ${response.status}`,
    );
  }

  return payload;
}

const modifiedShape = z.object({ date_modified_gmt: z.string().nullable() }).loose();

/**
 * Reads the record from Woo and refuses if the store's copy is newer than ours.
 *
 * Equal timestamps are fine — that is the normal case, meaning the sync is
 * current. Only a strictly newer store copy means someone edited it in wp-admin
 * since we last looked.
 */
export async function readFresh(path: string, crmModifiedAt: Date | null): Promise<unknown> {
  const record = await call(path, "GET");

  const parsed = modifiedShape.safeParse(record);
  if (!parsed.success) {
    throw new Error(`Unexpected WooCommerce response from ${path}`);
  }

  const wooModified = parsed.data.date_modified_gmt
    ? new Date(`${parsed.data.date_modified_gmt}Z`)
    : null;

  if (wooModified && crmModifiedAt && wooModified.getTime() > crmModifiedAt.getTime()) {
    throw new StaleRecordError();
  }

  return record;
}

export function wooPut(path: string, body: unknown): Promise<unknown> {
  return call(path, "PUT", body);
}

export function wooPost(path: string, body: unknown): Promise<unknown> {
  return call(path, "POST", body);
}
