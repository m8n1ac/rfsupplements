import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { recomputeAffiliateStats } from "@/lib/sync/resources";
import { affiliateName } from "@/lib/affiliate";
import { resetDatabase } from "./helpers/db";

// Solid Affiliate stores commission as a FLOAT, and a percentage of an order
// total lands on quarter-cents: 8.4975, 10.615, 33.9925. Rounding each referral
// to two decimals on the way in made the CRM's unpaid total read 95.60 against
// the plugin's own 95.59. These are the real figures from the live programme.

const QUARTER_CENTS = [
  "6.3725",
  "10.6150",
  "19.1200",
  "8.4975",
  "8.4975",
  "33.9925",
  "8.4975",
];

beforeEach(async () => {
  await resetDatabase();
});

async function seedAffiliate(referrals: { status: string; commission: string; order: string }[]) {
  const affiliate = await prisma.affiliate.create({
    data: {
      wooId: 9001,
      email: "affiliate@example.invalid",
      status: "approved",
      commissionType: "site_default",
      commissionRate: "20.00",
    },
  });

  let wooId = 90_000;
  for (const referral of referrals) {
    await prisma.referral.create({
      data: {
        wooId: wooId++,
        affiliateId: affiliate.id,
        orderAmount: referral.order,
        commissionAmount: referral.commission,
        status: referral.status,
        createdAtWoo: new Date("2026-09-01T00:00:00Z"),
      },
    });
  }

  await recomputeAffiliateStats([affiliate.id]);
  return prisma.affiliate.findUniqueOrThrow({ where: { id: affiliate.id } });
}

describe("recomputeAffiliateStats", () => {
  it("totals quarter-cent commissions to the figure Solid Affiliate reports", async () => {
    const affiliate = await seedAffiliate(
      QUARTER_CENTS.map((commission) => ({ status: "unpaid", commission, order: "0.00" })),
    );

    // 95.5925 exactly. Rounded for display this is 95.59 — the plugin's number.
    expect(affiliate.unpaidCommission.toString()).toBe("95.5925");
    expect(Number(affiliate.unpaidCommission).toFixed(2)).toBe("95.59");
    expect(affiliate.referralCount).toBe(7);
  });

  it("keeps paid, unpaid and rejected apart", async () => {
    const affiliate = await seedAffiliate([
      { status: "paid", commission: "10.0000", order: "50.00" },
      { status: "unpaid", commission: "5.5000", order: "25.00" },
      { status: "rejected", commission: "2.2500", order: "11.00" },
    ]);

    // Prisma normalises trailing zeros, so compare values not representations.
    expect(Number(affiliate.paidCommission)).toBe(10);
    expect(Number(affiliate.unpaidCommission)).toBe(5.5);
    expect(Number(affiliate.rejectedCommission)).toBe(2.25);
  });

  it("excludes rejected referrals from referred revenue", async () => {
    const affiliate = await seedAffiliate([
      { status: "paid", commission: "10.0000", order: "50.00" },
      { status: "rejected", commission: "2.2500", order: "11.00" },
    ]);

    // 50, not 61: a rejected sale is not credited to the affiliate.
    expect(Number(affiliate.referredRevenue)).toBe(50);
  });

  it("zeroes an affiliate whose referrals have all gone", async () => {
    const affiliate = await seedAffiliate([]);

    expect(affiliate.referralCount).toBe(0);
    expect(Number(affiliate.unpaidCommission)).toBe(0);
    expect(affiliate.lastReferralAt).toBeNull();
  });
});

describe("affiliateName", () => {
  it("falls back to the email rather than inventing a name", () => {
    expect(affiliateName({ firstName: "Roo", lastName: "Shepherdson", email: "r@x.io" }))
      .toBe("Roo Shepherdson");
    expect(affiliateName({ firstName: "Jackie Shep", lastName: "", email: "j@x.io" }))
      .toBe("Jackie Shep");
    expect(affiliateName({ firstName: null, lastName: null, email: "j@x.io" })).toBe("j@x.io");
  });
});
