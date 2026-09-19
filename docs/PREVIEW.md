# preview.rfsupplements.com

A scrubbed staging copy of the live store, for making changes, showing them to
the client, and then applying the approved ones to production.

Built 2026-09-19. Files in `ops/preview/` are copies of what is deployed.

## What it is

| | |
|---|---|
| Files | `/var/www/preview.rfsupplements.com` (owner `rfspv`, group `www-data`) |
| Database | `rfs_preview`, user `rfs_preview` — no grants on `rfs_wp` or `rfsrx_wp` |
| PHP | its own pool, socket `/run/php/php8.3-fpm-preview.sock`, `ondemand`, 4 workers |
| Web | nginx vhost, HTTP basic auth, never indexed |
| Passwords | web: `/root/.rfs-preview-web-password` · database: `/root/.rfs-preview-db-password` |

Smaller worker pool than production on purpose: two vCPUs are shared with the
live store, which must win under contention.

## Why the guardrails exist

A copy of a live WooCommerce store is not a copy of a website. Left alone it is
a second, fully armed instance of the business — able to charge real cards on
the production Authorize.Net credentials, email real customers through the
store's Gmail relay, and buy real shipping labels on live carrier accounts.

`preview-guardrails.php` is an mu-plugin, so it cannot be deactivated from
wp-admin, which is the whole point: this site exists for people to click around
in. It enforces, in code rather than settings:

1. **No outbound mail.** `pre_wp_mail` short-circuits before the SMTP relay.
2. **No payment gateways.** `woocommerce_available_payment_gateways` returns empty.
3. **No calls to live accounts.** Requests to Shippo, ShipStation, WooCommerce
   Shipping and Authorize.Net are refused at `pre_http_request`.
4. **Never indexed**, plus a red banner in the admin bar so nobody edits the
   wrong site.

Settings-level belt and braces: the gateway is disabled, `blog_public` is 0, and
ShipStation, Shippo, Mailchimp, Solid Affiliate, OptinMonster, RafflePress and
MonsterInsights are deactivated.

Verified after build: `wp_mail` sends nothing, 0 gateways available at checkout,
a call to `api.shippo.com` is refused, `blog_public = 0`.

## What was scrubbed

Order history and the affiliate program are **dropped entirely** — every order
carries a real person's name, address and purchase history, and referrals carry
payment emails and commission owed. Non-administrator users are anonymised to
`customerN@example.invalid` with names, addresses and phone numbers cleared.
Administrators keep their logins so the team and client can sign in.

The CRM bridge (`rfs-crm-bridge.php`) is deliberately **not** copied, so the
preview can never feed form submissions into the Ops CRM.

Two things live *outside* the tables the scrub touches and were missed on the
first pass. Both are part of the scrub now:

- **`wp-content/uploads/wc-logs/`** — WooCommerce debug and webhook logs, 140
  files, containing real order payloads. The database scrub does not reach
  them because they are files. Delete them.
- **`wp-content/uploads/woo-feed/`** — generated product feeds carrying
  production URLs. A preview must not publish a live product feed. Delete them.

## The URL replacement is two passes, not one

`search-replace` unserialises PHP, so it finds `https://rfsupplements.com`
wherever PHP put it. It does **not** decode JSON, and Elementor stores its
widget data as JSON *inside* the serialised meta, with forward slashes escaped.
Those rows read `https:\/\/rfsupplements.com` and the ordinary pass reports
zero replacements while leaving live URLs in the page.

Run both, second form quoted so the shell keeps the backslashes:

```sh
wp search-replace 'https://rfsupplements.com'   'https://preview.rfsupplements.com'   --all-tables --skip-columns=guid
wp search-replace 'https:\/\/rfsupplements.com' 'https:\/\/preview.rfsupplements.com' --all-tables --skip-columns=guid
```

The second pass caught 58 rows the first declared clean, including a hero
button whose `onclick` sent visitors to the production product page.

Theme-generated CSS is a third place: `uploads/molla_css/dynamic_style*.css` is
written to disk and holds the logo and background URLs. `sed` it directly.

Afterwards `wp cache flush` and `wp elementor flush-css`, then confirm:

```sh
curl -su "preview:$(sudo cat /root/.rfs-preview-web-password)" \
  https://preview.rfsupplements.com/ | grep -c 'https://rfsupplements\.com'   # want 0
```

## Promoting changes to production

**Never push the preview database to production.** The live store takes orders
continuously; any copy is stale the moment it is taken, and pushing it back
would destroy every order, customer and stock change since. There is no
one-click promotion for a live store, and anything that offers one is offering
a way to lose orders.

Promotion is selective, by change type:

| Change | How it is promoted |
|---|---|
| Theme, CSS, template files | `rsync` the specific files; safe and reversible |
| Plugin add / update / removal | repeat the action on production |
| Elementor pages | export the page from preview, import on production |
| Widgets, menus, theme options | repeat manually — they are scattered through `wp_options` |
| WooCommerce settings | repeat manually, one screen at a time |
| Product content and prices | repeat manually, or a targeted product export |
| **Orders, customers, stock** | **never** — production is the source of truth |

Before promoting anything: take a snapshot
(`sudo /usr/local/sbin/rfs-snapshot.sh run`), make the change, then check the
store, cart and checkout still load.

### Page content promotes as a surgical edit, not a copy

Diff the two before assuming what changed. `wp post update <file>` reads the
file as bytes, but anything that reads and rewrites the content in Python's
text mode silently converts CRLF to LF — and page 1849 is stored with 143
carriage returns. That made a one-character fix look like a 143-line rewrite,
and copying preview's version to production would have quietly stripped every
line ending.

Diff with `--strip-trailing-cr` to see the real change, then patch production's
own bytes rather than overwriting them:

```sh
diff --strip-trailing-cr prod.html preview.html     # the actual difference
```

Read and write in **binary** mode, assert the length and the carriage-return
count are unchanged, and only then `wp post update`.

### Promoted so far

| Date | Change | How |
|---|---|---|
| 2026-09-19 | Athlete Program contrast: headings and body copy were built for a dark background and rendered on white at 1:1 and 1.6:1 | `custom.css` + `custom.scss` copied; page 1849's malformed `</h3>` patched in place |

## Refreshing the preview from production

The preview drifts as production changes. To rebuild it, repeat the build:
copy files (excluding `rfs-crm-bridge.php`), copy the database, run the scrub,
delete `wc-logs/` and `woo-feed/`, search-replace the URLs in **both** forms,
`sed` the theme CSS, and re-deactivate the integrations. Keep
`wp-config.php` and `preview-guardrails.php` — they are preview-specific and
must not be overwritten by the copy.

**Any refresh re-imports real customer data and must be re-scrubbed.** That is
the step to get wrong at 2am, so treat the scrub as part of the copy, not a
follow-up.
