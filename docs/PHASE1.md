# Phase 1 — Foundation

**Date:** 2026-09-17 · **Spec:** `rfs-ops-crm-spec.md` v1.0 §14
**Live at:** https://ops.rfsupplements.com

## Gate 1

| # | Check | Result |
|---|---|---|
| 1 | Valid certificate, login page served | ✅ Let's Encrypt, expires 2026-12-16, `ssl_verify_result:0`, `/login` → 200 |
| 2 | Admin can log in with 2FA; STAFF invite works end to end | ⚠️ **Partial** — both flows pass in Playwright, but no invite *email* has been sent: SMTP is still a placeholder pending the App Password |
| 3 | STAFF gets 403 from Settings (Playwright) | ✅ `expect(response.status()).toBe(403)` |
| 4 | Lockout after 5 bad passwords | ✅ `failedLogins=5`, `lockedUntil` in the future, correct password then refused |
| 5 | Reboot test: service returns on its own | ⚠️ **Not run** — needs a scheduled window; the box also serves rfsupplements.com and rfsrx.com. `systemctl is-enabled` → `enabled`, and SIGKILL of the main PID was recovered automatically (`NRestarts=1`, site back to 200) |
| 6 | rfsupplements.com response time and error log unchanged | ✅ ~0.34–0.41 s before and after; error log 47 lines before and after; rfsrx.com still 200 |

## What was built

- **Database** — `rfs_crm` on the shared MariaDB, 17 tables from §8, all money `DECIMAL(12,2)`.
  The `rfs_crm` user has `USAGE` globally and privileges on its own schema only;
  `SELECT` against `rfs_wp` and `rfsrx_wp` both return `ERROR 1142`.
- **Timezone** — MariaDB tz tables loaded (1196 zones). `CONVERT_TZ` to
  `America/Los_Angeles` returns −7 in July and −8 in January, which is the A2
  precondition for business-correct reporting.
- **Auth** — Auth.js v5 / Credentials / JWT, 8 h. argon2id (verified as
  `$argon2id$` by `scripts/check-argon2.ts`), 12-character minimum. TOTP is
  mandatory and is enrolled on the invite link, so no account can exist without
  it. Eight recovery codes, hashed, single-use. Lockout at 5 attempts for
  15 minutes, plus `limit_req` on `/api/auth/`.
- **Authorization** — `requireUser(role?)` reloads from the database on every
  call and interrupts with `redirect()` or `forbidden()`. `/settings/*` is
  ADMIN-only at the layout, so no settings page can forget the check.
- **Deployment** — standalone build on `127.0.0.1:3100`, systemd `rfs-crm`
  (enabled, hardened), nginx vhost with HSTS, noindex, CSP and the auth rate
  limit, `deploy.sh` proven end to end.

## Decisions taken during the phase

1. **Security headers live in nginx only.** The app was setting them too, which
   duplicated every header. Spec §9 assigns them to nginx, so `next.config.ts`
   no longer sets any.
2. **CSP allows `'unsafe-inline'` for `script-src`.** Next injects inline
   hydration scripts and this build does not mint per-request nonces. This is
   the one relaxation from "strict"; tightening it to a nonce belongs in
   Phase 6. `img-src` allows `data:` for the enrolment QR code.
3. **`Invite.createdBy` is `Restrict`.** Production deactivates users, it never
   deletes them, so the constraint is correct; test fixtures clear their own
   invites.
4. **Two dependency overrides, both declared in `package.json`** so `npm ci`
   reproduces them without install flags: nodemailer is held at the patched 10.x
   against `next-auth`'s optional `^7||^8` peer (the Email provider is unused —
   this app is Credentials-only), and `mysql2` is pulled forward to 3.24, which
   arrives through `@prisma/client`'s `prisma` peer. `npm audit` is clean.
5. **Project is ESM** (`"type": "module"`). The Prisma 7 generated client uses
   `import.meta`, which CJS tooling cannot load.
6. **`npm run user:invite`** was added. The in-app resend needs an admin to be
   signed in, so without it an expired seed invite would lock everyone out.

## Outstanding

- SMTP App Password and `ALERT_EMAIL` — the only untested link in the invite
  chain, and the last Gate 1 item.
- A window to run the actual reboot test.
- Darrin's own TOTP enrolment, via the invite link handed over separately.

---

## Amendment — 2026-09-17: 2FA cancelled

Darrin cancelled the §9 TOTP requirement after Gate 1. Sign-in is now email and
password only.

Removed rather than disabled, per engineering rules 3 and 4: the `totpSecret`
and `totpEnrolledAt` columns and the whole `RecoveryCode` table are dropped by
migration `20260917213215_remove_2fa`, and `src/lib/totp.ts`, `src/lib/crypto.ts`,
`APP_ENCRYPTION_KEY`, `otplib` and `qrcode` are gone. The invite link now sets a
password and finishes.

**What now stands between a guessed password and full access:** the 5-attempt /
15-minute account lockout, and the nginx `limit_req` of 10/min on `/api/auth/`.
There is no second factor. This system holds customer PII and revenue data and
is reachable from the internet.

**A bug this surfaced, now fixed.** A deactivated user's JWT stayed valid, so
`requireUser()` sent them to `/login`, which saw the session and sent them back
to `/` — an infinite redirect rather than a sign-out. Both paths now share
`getCurrentUser()`, which resolves the session against the database. Covered by
"a deactivated user is signed out on their next request". The bug predated the
2FA change; it simply had no test.
