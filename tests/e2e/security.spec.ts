import { expect, test, type Page } from "@playwright/test";
import { prisma } from "@/lib/db";
import { createTestUser, deleteTestUsers, TEST_PASSWORD, type TestUser } from "./users";

// Phase 6 hardening checks, asserted rather than eyeballed.

const ADMIN_EMAIL = "e2e-security@rfs.test";
let admin: TestUser;

test.beforeAll(async () => {
  admin = await createTestUser(ADMIN_EMAIL, "ADMIN");
});

test.afterAll(async () => {
  await deleteTestUsers(ADMIN_EMAIL);
  await prisma.$disconnect();
});

async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  await page.fill("#email", admin.email);
  await page.fill("#password", TEST_PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL("/");
}

test("no page triggers a CSP violation", async ({ page }) => {
  const violations: string[] = [];

  // Both channels: the report event, and the console message browsers emit.
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      (window as unknown as { __csp: string[] }).__csp ??= [];
      (window as unknown as { __csp: string[] }).__csp.push(
        `${event.violatedDirective} blocked ${event.blockedURI}`,
      );
    });
  });
  page.on("console", (message) => {
    if (/content security policy/i.test(message.text())) {
      violations.push(message.text());
    }
  });

  await signIn(page);

  for (const path of ["/", "/orders", "/contacts", "/inquiries", "/products", "/tasks", "/settings/sync"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const reported = await page.evaluate(
      () => (window as unknown as { __csp?: string[] }).__csp ?? [],
    );
    violations.push(...reported.map((entry) => `${path}: ${entry}`));
  }

  expect(violations, `CSP violations:\n${violations.join("\n")}`).toEqual([]);
});

test("security headers are present and the site is not indexable", async ({ request }) => {
  const response = await request.get("/login");
  const headers = response.headers();

  expect(headers["strict-transport-security"]).toContain("max-age=31536000");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("no-referrer");
  expect(headers["x-robots-tag"]).toContain("noindex");
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");

  // The header must not be duplicated: nginx owns these, not the app.
  expect(String(headers["x-robots-tag"]).split(",").length).toBeLessThanOrEqual(3);

  const robots = await request.get("/robots.txt");
  expect(await robots.text()).toContain("Disallow: /");
});

test("plain HTTP is redirected to HTTPS", async ({ request }) => {
  const response = await request.get("http://ops.rfsupplements.com/", {
    maxRedirects: 0,
  });
  expect(response.status()).toBe(301);
  expect(response.headers()["location"]).toBe("https://ops.rfsupplements.com/");
});

test("the login endpoint is rate limited by nginx", async ({ request }) => {
  // nginx allows 10/min with a burst of 5. Enough requests in a burst must be
  // rejected, or the brute-force defence is not actually in place.
  const statuses = await Promise.all(
    Array.from({ length: 40 }, () =>
      request
        .post("/api/auth/callback/credentials", {
          data: { email: "nobody@example.invalid", password: "wrong" },
          failOnStatusCode: false,
        })
        .then((response) => response.status()),
    ),
  );

  expect(statuses.filter((status) => status === 503).length).toBeGreaterThan(0);
});
