# RF Supplements Ops CRM

Private operations CRM for the RF Supplements WooCommerce store.

**Live:** https://ops.rfsupplements.com — staff only, never indexed.

WooCommerce is the system of record for store data. This app is the system of
record only for CRM data: notes, tasks, tags, inquiries and assignments. It
reads the store over the REST API every 60 seconds and writes back only three
things: order status, order notes, and customer contact fields.

For how the code is laid out and the traps it contains, read `CLAUDE.md`.
For why it was built this way, read the spec in `/home/ubuntu/incoming/` and the
Phase 0 findings in `/home/ubuntu/rfs-discovery/DISCOVERY.md`.

---

## Runbook

### Deploy

```bash
cd /opt/rfs-crm
./deploy.sh
```

Installs dependencies, applies migrations, regenerates the Prisma client,
builds, fixes ownership for the service account, and restarts. It fails loudly
if the service does not come back.

Run it off-hours where you can: the box is shared with WooCommerce and has two
vCPUs.

### Add a user

Anyone with an `ADMIN` account can do this from **Settings → Users** — enter a
name, email and role and the invite is emailed automatically.

From the command line, when nobody can sign in yet:

```bash
npm run user:create -- --email someone@rfsupplements.com --name "Their Name" --role STAFF
```

It prints a single-use invite link valid for 24 hours. The new user sets their
own password on that link; there is no way to set a password for someone else.

If an invite expires before it is used:

```bash
npm run user:invite -- --email someone@rfsupplements.com
```

That is also the way back in if every admin is locked out.

**Locked out after five bad passwords?** The lock clears itself in 15 minutes.
To clear it immediately:

```bash
mariadb -u rfs_crm -p rfs_crm -e \
  "UPDATE User SET failedLogins=0, lockedUntil=NULL WHERE email='someone@rfsupplements.com';"
```

### Rotate the WooCommerce application password

1. In wp-admin, go to **Users → crm-sync → Application Passwords**, revoke
   `rfs-ops-crm` and create a new one with the same name.
2. Put the new value in `/etc/rfs-crm/env` as `WOO_APP_PASSWORD`.
3. `sudo systemctl restart rfs-crm`
4. Verify: `npm run sync -- --mode=incremental` should end with `sync complete`.

The same credential authenticates both `wc/v3` and the `rfs-crm/v1` bridge, so
there is only ever one to rotate.

### Run a sync by hand

```bash
npm run sync -- --mode=incremental   # what the 60-second timer runs
npm run sync -- --mode=full          # what runs nightly at 11:30 UTC (04:30 Pacific)
```

A full run also marks anything missing from WooCommerce as `deletedInWoo`. It
never deletes a row.

**Settings → Sync** shows the cursor and last success for each resource and
turns red if any has not succeeded in 15 minutes. A run that crashes before it
starts leaves no record in the run table, so that staleness warning is the
signal that catches it — check `journalctl -u rfs-crm-sync.service`.

### Check the numbers against WooCommerce

```bash
npm run verify:metrics          # five windows, compared to Woo Analytics to the cent
npm run verify:orders -- --count=20
```

If `verify:metrics` reports a mismatch it names the offending orders. Before
changing any code, check whether WooCommerce's own report tables have drifted —
**WooCommerce → Status → Tools → Regenerate reports data** — because they have
before. Do not adjust `src/lib/metrics/` to match stale tables.

### Backup and restore

Nightly at 04:10 UTC, `rfs-crm-backup.timer` dumps the database to
`s3://rfs-backups-304b1a79/db/rfs-crm/`, encrypted, where the bucket's existing
lifecycle rule keeps it 30 days in standard storage, moves it to Glacier IR, and
expires it at 90.

```bash
sudo /usr/local/sbin/rfs-crm-backup.sh run            # back up now
sudo /usr/local/sbin/rfs-crm-backup.sh latest         # newest dump's S3 key
sudo /usr/local/sbin/rfs-crm-backup.sh restore-test   # prove a backup restores
```

`restore-test` takes a fresh dump, restores it into a scratch database, compares
every table's row count against the live one, drops the scratch database and
reports. It pauses the sync timer while it runs and always restarts it.

**To restore for real:**

```bash
KEY=$(sudo /usr/local/sbin/rfs-crm-backup.sh latest)
aws s3 cp "s3://rfs-backups-304b1a79/$KEY" /tmp/restore.sql.gz
sudo systemctl stop rfs-crm rfs-crm-sync.timer
sudo mariadb -e "DROP DATABASE rfs_crm; CREATE DATABASE rfs_crm CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
gunzip -c /tmp/restore.sql.gz | sudo mariadb rfs_crm
sudo systemctl start rfs-crm rfs-crm-sync.timer
```

Losing this database costs CRM data only — notes, tasks, tags, inquiries and
assignments. Every order, product and customer is re-pulled from WooCommerce by
the next full sync.

### Test fixtures in the store

The outbound test suite writes to a clearly-named test order, product and
customer so it never touches live data.

```bash
npm run fixtures:store -- --create   # before running tests/e2e/outbound.spec.ts
npm run fixtures:store -- --remove   # cancels and trashes them
```

The suite skips itself with that instruction if they are absent.

### Tests

```bash
npm test          # unit: mappers and metrics against captured fixtures
npm run test:e2e  # browser: auth, every screen, outbound writes, security headers
npm run lint && npm run typecheck
```

The end-to-end suite runs against the live deployment and pauses the sync timer
for the duration, because the stale-write tests need a quiescent sync. It always
restarts the timer, including after a failure.

---

## Services

| Unit | What it does |
|---|---|
| `rfs-crm.service` | The app, on 127.0.0.1:3100, as the `rfs-crm` system account |
| `rfs-crm-sync.timer` | Incremental sync, every 60 seconds |
| `rfs-crm-sync-full.timer` | Full sync, 11:30 UTC (04:30 Pacific) |
| `rfs-crm-backup.timer` | Database backup to S3, 04:10 UTC |

Secrets live in `/etc/rfs-crm/env` (0600, owned by `rfs-crm`). The app refuses to
start if any variable is missing or malformed, rather than starting and failing
later in a way nobody notices.

nginx terminates TLS for `ops.rfsupplements.com` and proxies to the app. It sets
HSTS, a CSP, `noindex`, and a 10/minute rate limit on `/api/auth/`. The
rfsupplements.com and rfsrx.com vhosts are untouched by this project.

---

## Who can see what

| | ADMIN | STAFF |
|---|---|---|
| Revenue, charts, customer lifetime value | ✓ | – |
| Orders, contacts, inquiries, tasks, products | ✓ | ✓ |
| Changing order status, notes, customer details | ✓ | ✓ |
| Settings, users, sync, audit log | ✓ | – |

Revenue is withheld on the server, not hidden in the page, and there is a test
asserting it never reaches a STAFF browser.
