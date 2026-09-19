// The Athlete Program application is form 2039 on the website. It arrives
// through the same bridge as every other form and is stored as an Inquiry —
// what makes it its own section is the shape of its payload, not a separate
// table. There is one pipeline for website submissions, not two.
//
// The form's identity lives here so the three places that care agree: the
// Athletes screen that selects them, the Inquiries screen that excludes them,
// and the detail screen that renders the application summary. The sync
// allowlist keys off the numeric form id (INQUIRY_FORM_IDS) because that is
// what the bridge sends; this file keys off the name because that is what the
// Inquiry row stores.

export const ATHLETE_FORM_NAME = "Athlete Program";

// The three tiers offered on the page, in the order they are presented there.
// Anything else the form sends is shown as-is rather than being forced into
// this list — the page and the form can be edited in WordPress without code.
export const ATHLETE_TIERS = ["Professional", "Leader", "Ambassador"] as const;

export type AthleteTier = (typeof ATHLETE_TIERS)[number];

export type AthleteApplication = {
  name: string | null;
  email: string | null;
  instagram: string | null;
  instagramUrl: string | null;
  sport: string | null;
  tier: string | null;
  about: string | null;
};

// Contact Form 7 posts a select as an array and a text input as a string, so
// every read has to tolerate both. An empty string means the field was left
// blank, which is not the same as the field being absent.
function field(payload: Record<string, unknown>, key: string): string | null {
  const raw = payload[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// Handles are entered inconsistently: "@rf_supps", "rf_supps", or a full URL.
// Normalising to a bare handle keeps the display tidy and the link correct.
export function instagramHandle(value: string | null): string | null {
  if (!value) return null;
  const handle = value
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .replace(/\/+$/, "")
    .replace(/^@/, "");
  return handle || null;
}

export function athleteApplication(payload: unknown): AthleteApplication {
  const fields = (payload ?? {}) as Record<string, unknown>;
  const handle = instagramHandle(field(fields, "your-instagram"));

  return {
    name: field(fields, "your-name"),
    email: field(fields, "your-email"),
    instagram: handle,
    instagramUrl: handle ? `https://instagram.com/${handle}` : null,
    sport: field(fields, "your-sport"),
    tier: field(fields, "your-tier"),
    about: field(fields, "tell-us-about"),
  };
}
