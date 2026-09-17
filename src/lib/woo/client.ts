import { z } from "zod";
import { env } from "@/lib/env";

// A thin client over the WooCommerce REST API and the rfs-crm-bridge namespace.
// One credential authenticates both (spec §7): the crm-sync Application
// Password, sent as HTTP Basic over HTTPS.
//
// There is no retry and no fallback path (engineering rules 2 and 5). A failed
// request throws, the run fails, and SyncRun.error records why.

const authorization = `Basic ${Buffer.from(
  `${env.WOO_USER}:${env.WOO_APP_PASSWORD}`,
).toString("base64")}`;

export const PER_PAGE = 100;

export class WooError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body: string,
  ) {
    super(`Woo ${status} for ${url}: ${body.slice(0, 300)}`);
    this.name = "WooError";
  }
}

async function request(path: string, params: Record<string, string | number>): Promise<Response> {
  const url = new URL(`${env.WOO_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    headers: { authorization, accept: "application/json" },
  });

  if (!response.ok) {
    throw new WooError(response.status, url.pathname, await response.text());
  }

  return response;
}

export type Page<T> = {
  items: T[];
  totalPages: number;
};

// Fetches one page and validates every record. A record that fails validation
// fails the whole run, by design (spec §6.1 step 3).
export async function fetchPage<T>(
  path: string,
  schema: z.ZodType<T>,
  params: Record<string, string | number>,
): Promise<Page<T>> {
  const response = await request(path, params);
  const raw: unknown = await response.json();

  if (!Array.isArray(raw)) {
    throw new Error(`Expected an array from ${path}, got ${typeof raw}`);
  }

  const items = raw.map((record, index) => {
    const parsed = schema.safeParse(record);
    if (!parsed.success) {
      const id = (record as { id?: unknown })?.id ?? `index ${index}`;
      throw new Error(`Invalid ${path} record ${String(id)}:\n${z.prettifyError(parsed.error)}`);
    }
    return parsed.data;
  });

  return {
    items,
    totalPages: Number(response.headers.get("x-wp-totalpages") ?? "1"),
  };
}

// Walks every page in order, yielding one page at a time so the caller can
// commit and advance its cursor per page (spec §6.1 steps 4 and 5).
export async function* paginate<T>(
  path: string,
  schema: z.ZodType<T>,
  params: Record<string, string | number>,
): AsyncGenerator<T[]> {
  let page = 1;
  let totalPages = 1;

  do {
    const result = await fetchPage(path, schema, { ...params, page, per_page: PER_PAGE });
    totalPages = result.totalPages;

    if (result.items.length > 0) {
      yield result.items;
    }

    page += 1;
  } while (page <= totalPages);
}
