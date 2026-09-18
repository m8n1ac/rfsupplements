import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { resetDatabase } from "./helpers/db";
import { seedContact } from "./helpers/seed";

// The Inquiries pipeline has never run against real data: the bridge captures
// nothing until the mu-plugin is reinstalled and a form is submitted from a
// browser. These tests exercise the path against a stubbed bridge response so
// the mapping is not first exercised in production.

const pages: unknown[][] = [];

// The real paginate validates each record with the zod schema and yields the
// parsed result — which is where the date strings become Dates. The stub does
// the same, so these tests exercise the schema rather than stepping around it.
vi.mock("@/lib/woo/client", () => ({
  PER_PAGE: 100,
  fetchPage: vi.fn(),
  paginate: async function* (
    _path: string,
    schema: { parse: (value: unknown) => unknown },
  ) {
    for (const page of pages) {
      if (page.length > 0) yield page.map((record) => schema.parse(record));
    }
  },
}));

const { syncSubmissions, INQUIRY_FORM_IDS } = await import("@/lib/sync/resources");

function submission(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    source_plugin: "cf7",
    form_id: "13",
    form_name: "Contact form 1",
    submitted_at_gmt: "2026-09-18T10:00:00",
    modified_at_gmt: "2026-09-18T10:00:00",
    page_url: "https://rfsupplements.com/contact/",
    mail_status: "mail_sent",
    fields: {
      "your-name": "Dana Example",
      "your-email": "dana@example.com",
      "your-subject": "A question",
      "your-message": "Do you ship to Canada?",
    },
    ...overrides,
  };
}

beforeEach(async () => {
  await resetDatabase();
  pages.length = 0;
});

describe("syncSubmissions", () => {
  it("turns a contact-form submission into an inquiry and a contact", async () => {
    pages.push([submission()]);

    const result = await syncSubmissions(null);
    expect(result.counts.fetched).toBe(1);

    const inquiry = await prisma.inquiry.findFirstOrThrow({ include: { contact: true } });
    expect(inquiry.externalId).toBe("cf7:1");
    expect(inquiry.formName).toBe("Contact form 1");
    expect(inquiry.status).toBe("NEW");
    expect(inquiry.message).toBe("Do you ship to Canada?");
    expect(inquiry.submittedAt.toISOString()).toBe("2026-09-18T10:00:00.000Z");

    // A new email becomes a FORM contact (spec §6.3).
    expect(inquiry.contact?.email).toBe("dana@example.com");
    expect(inquiry.contact?.source).toBe("FORM");
    expect(inquiry.contact?.firstName).toBe("Dana");
    expect(inquiry.contact?.lastName).toBe("Example");
  });

  it("keeps every field in the payload, not just the message", async () => {
    pages.push([submission()]);
    await syncSubmissions(null);

    const inquiry = await prisma.inquiry.findFirstOrThrow();
    expect(inquiry.payload).toMatchObject({
      "your-subject": "A question",
      "your-name": "Dana Example",
    });
  });

  it("attaches to an existing contact rather than duplicating it", async () => {
    const existing = await seedContact("dana@example.com");
    pages.push([submission()]);

    await syncSubmissions(null);

    expect(await prisma.contact.count()).toBe(1);
    const inquiry = await prisma.inquiry.findFirstOrThrow();
    expect(inquiry.contactId).toBe(existing.id);
    // An existing buyer must not be relabelled as a form lead.
    const contact = await prisma.contact.findUniqueOrThrow({ where: { id: existing.id } });
    expect(contact.source).toBe("WOO_GUEST");
  });

  it("promotes only the contact and athlete-program forms", async () => {
    // Gate 0, B1: all five forms are captured, but the three newsletter forms
    // would flood the pipeline if each became an inquiry.
    pages.push([
      submission({ id: 1, form_id: "13", form_name: "Contact form 1" }),
      submission({ id: 2, form_id: "2039", form_name: "Athlete Program" }),
      submission({ id: 3, form_id: "2015", form_name: "Newsletter-SignUp" }),
      submission({ id: 4, form_id: "2061", form_name: "Newsletter Form (Popup)" }),
      submission({ id: 5, form_id: "3610", form_name: "WELCOME15" }),
    ]);

    await syncSubmissions(null);

    const inquiries = await prisma.inquiry.findMany({ orderBy: { externalId: "asc" } });
    expect(inquiries.map((row) => row.formName)).toEqual(["Contact form 1", "Athlete Program"]);
    expect(INQUIRY_FORM_IDS).toEqual(["13", "2039"]);
  });

  it("still records a contact for a newsletter signup", async () => {
    pages.push([
      submission({
        id: 9,
        form_id: "2015",
        form_name: "Newsletter-SignUp",
        fields: { "your-email": "subscriber@example.com" },
      }),
    ]);

    await syncSubmissions(null);

    expect(await prisma.inquiry.count()).toBe(0);
    const contact = await prisma.contact.findUniqueOrThrow({
      where: { email: "subscriber@example.com" },
    });
    expect(contact.source).toBe("FORM");
  });

  it("is idempotent: re-reading a submission updates rather than duplicates", async () => {
    pages.push([submission()]);
    await syncSubmissions(null);

    pages.length = 0;
    pages.push([
      submission({
        fields: {
          "your-name": "Dana Example",
          "your-email": "dana@example.com",
          "your-message": "Edited message",
        },
      }),
    ]);
    await syncSubmissions(null);

    const inquiries = await prisma.inquiry.findMany();
    expect(inquiries).toHaveLength(1);
    expect(inquiries[0].message).toBe("Edited message");
  });

  it("reads the athlete form's message from its own field name", async () => {
    pages.push([
      submission({
        id: 7,
        form_id: "2039",
        form_name: "Athlete Program",
        fields: {
          "your-name": "Sam Athlete",
          "your-email": "sam@example.com",
          "your-sport": "Track",
          "your-tier": "Elite",
          "tell-us-about": "Two-time state champion.",
        },
      }),
    ]);

    await syncSubmissions(null);

    const inquiry = await prisma.inquiry.findFirstOrThrow();
    expect(inquiry.message).toBe("Two-time state champion.");
    expect(inquiry.payload).toMatchObject({ "your-tier": "Elite" });
  });

  it("keeps a submission with no email, unattached", async () => {
    pages.push([submission({ id: 11, fields: { "your-message": "No contact details" } })]);

    await syncSubmissions(null);

    const inquiry = await prisma.inquiry.findFirstOrThrow();
    expect(inquiry.contactId).toBeNull();
    expect(await prisma.contact.count()).toBe(0);
  });
});
