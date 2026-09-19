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

## Refreshing the preview from production

The preview drifts as production changes. To rebuild it, repeat the build:
copy files (excluding `rfs-crm-bridge.php`), copy the database, run the scrub,
search-replace the URLs, and re-deactivate the integrations. Keep
`wp-config.php` and `preview-guardrails.php` — they are preview-specific and
must not be overwritten by the copy.

**Any refresh re-imports real customer data and must be re-scrubbed.** That is
the step to get wrong at 2am, so treat the scrub as part of the copy, not a
follow-up.
