import { describe, expect, it } from "vitest";
import { cursorParams, maxModified, RESOURCES } from "@/lib/sync/engine";
import { INQUIRY_FORM_IDS } from "@/lib/sync/resources";

describe("maxModified", () => {
  it("returns the latest date", () => {
    const result = maxModified([
      new Date("2026-09-10T00:00:00Z"),
      new Date("2026-09-12T00:00:00Z"),
      new Date("2026-09-11T00:00:00Z"),
    ]);
    expect(result?.toISOString()).toBe("2026-09-12T00:00:00.000Z");
  });

  it("ignores nulls", () => {
    const result = maxModified([null, new Date("2026-01-01T00:00:00Z"), null]);
    expect(result?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("returns null when there is nothing to compare", () => {
    expect(maxModified([])).toBeNull();
    expect(maxModified([null, null])).toBeNull();
  });
});

describe("cursorParams", () => {
  it("asks Woo for GMT comparisons, in Woo's datetime shape", () => {
    const params = cursorParams(new Date("2026-09-10T19:08:27.000Z"));
    expect(params).toEqual({
      modified_after: "2026-09-10T19:08:27",
      dates_are_gmt: "true",
    });
  });

  it("sends no date filter on a full run", () => {
    expect(cursorParams(null)).toEqual({});
  });
});

describe("sync configuration", () => {
  it("runs resources in the order the spec requires", () => {
    expect(RESOURCES).toEqual([
      "products",
      "customers",
      "orders",
      "refunds",
      "submissions",
      "affiliates",
      "referrals",
    ]);
  });

  it("syncs affiliates before referrals", () => {
    // A referral whose affiliate is not in the database yet is skipped rather
    // than invented, so the order is a correctness requirement and not a
    // preference. Reversing it silently drops referrals on a first run.
    expect(RESOURCES.indexOf("affiliates")).toBeLessThan(RESOURCES.indexOf("referrals"));
  });

  it("promotes only the contact and athlete-program forms to inquiries", () => {
    // The three newsletter forms are captured but must not flood the pipeline
    // (Gate 0, B1).
    expect(INQUIRY_FORM_IDS).toEqual(["13", "2039"]);
    for (const newsletterForm of ["2015", "2061", "3610"]) {
      expect(INQUIRY_FORM_IDS).not.toContain(newsletterForm);
    }
  });
});
