// Screens keep their filter state in the URL so a filtered view can be shared,
// bookmarked, and returned to with the back button.

export const PAGE_SIZE = 50;

export type Query = Record<string, string | string[] | undefined>;

export function single(query: Query, key: string): string | undefined {
  const value = query[key];
  const found = Array.isArray(value) ? value[0] : value;
  return found?.trim() ? found.trim() : undefined;
}

export function pageNumber(query: Query): number {
  const raw = Number(single(query, "page") ?? "1");
  return Number.isInteger(raw) && raw > 0 ? raw : 1;
}

export function buildQuery(base: Query, overrides: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(base)) {
    const found = Array.isArray(value) ? value[0] : value;
    if (found) params.set(key, found);
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined || value === "") {
      params.delete(key);
    } else {
      params.set(key, String(value));
    }
  }

  const query = params.toString();
  return query ? `?${query}` : "";
}
