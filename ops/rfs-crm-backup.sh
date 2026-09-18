#!/bin/bash
# =============================================================================
#  RF Supplements Ops CRM — nightly database backup to S3
#
#  Deliberately separate from /usr/local/sbin/rfs-backup.sh, which also protects
#  rfsrx.com. Editing that script to add one more database would put an
#  unrelated site's backups at risk for no benefit. Same bucket, same layout,
#  its own file.
#
#  Dumps land under db/rfs-crm/ so the bucket's existing lifecycle rule governs
#  them: 30 days standard, then Glacier IR, expiring at 90.
#
#  Usage: rfs-crm-backup.sh [run|restore-test|latest]
# =============================================================================
set -uo pipefail

ENV_FILE=/etc/rfs-crm/env
BUCKET=rfs-backups-304b1a79
PREFIX=db/rfs-crm
LOG=/var/log/rfs-crm-backup.log
STAGE=/var/backups/rfs-crm
SCRATCH_DB=rfs_crm_restore_test

export AWS_DEFAULT_REGION=${AWS_DEFAULT_REGION:-us-east-2}

log()  { printf '%s  %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" | tee -a "$LOG"; }
die()  { log "FATAL: $*"; exit 1; }

[ -r "$ENV_FILE" ] || die "cannot read $ENV_FILE"

# DATABASE_URL is the single source for the credentials, so there is no second
# copy of the password to drift.
DB_URL=$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"')
[ -n "$DB_URL" ] || die "DATABASE_URL missing from $ENV_FILE"

DB_USER=$(sed -E 's#^mysql://([^:]+):.*#\1#' <<<"$DB_URL")
DB_PASS=$(sed -E 's#^mysql://[^:]+:([^@]+)@.*#\1#' <<<"$DB_URL")
DB_HOST=$(sed -E 's#^mysql://[^@]+@([^:/]+).*#\1#' <<<"$DB_URL")
DB_NAME=$(sed -E 's#.*/([^/?]+)(\?.*)?$#\1#' <<<"$DB_URL")
export MYSQL_PWD="$DB_PASS"

cmd_run() {
  mkdir -p "$STAGE"
  local stamp dump key
  stamp=$(date -u '+%Y/%m/%d/%H%M')
  dump="$STAGE/$(date -u '+%Y%m%d-%H%M').sql.gz"
  key="s3://$BUCKET/$PREFIX/$stamp.sql.gz"

  log "dumping $DB_NAME"
  # --single-transaction keeps it consistent without locking the CRM out.
  if ! mariadb-dump --single-transaction --quick --routines --events \
        -h "$DB_HOST" -u "$DB_USER" "$DB_NAME" | gzip -9 > "$dump"; then
    rm -f "$dump"
    die "mariadb-dump failed"
  fi

  # A dump that is suspiciously small means something went wrong upstream.
  local size
  size=$(stat -c%s "$dump")
  [ "$size" -gt 10240 ] || die "dump is only ${size} bytes — refusing to upload"

  log "uploading $(numfmt --to=iec "$size") to $key"
  aws s3 cp "$dump" "$key" --sse AES256 --only-show-errors \
    || die "upload failed"

  # Keep three nights locally as a fast restore path; S3 holds the real history.
  find "$STAGE" -name '*.sql.gz' -mtime +3 -delete
  log "backup complete"
}

cmd_latest() {
  aws s3 ls "s3://$BUCKET/$PREFIX/" --recursive \
    | sort | tail -1 | awk '{print $4}'
}

# MariaDB's root uses unix_socket auth, so the admin calls must go over the
# socket. Passing -h forces TCP and the socket plugin never gets a look in.
admin() { mariadb -u root "$@"; }

# Gate 6: proves the whole path — dump, upload, download, restore — and that the
# restored row counts match the live database exactly.
#
# The incremental sync appends a SyncRun row every 60 seconds, so comparing a
# live table against an older dump can never match. The timer is therefore
# paused for the duration and a fresh dump is taken, which makes the comparison
# exact rather than approximate. The timer is always restored, including on
# failure.
# Global, not local: the EXIT trap fires after the function has returned, and a
# function-scoped variable is gone by then (which under set -u is a hard error).
TIMER_WAS_ACTIVE=no

cmd_restore_test() {
  systemctl is-active --quiet rfs-crm-sync.timer && TIMER_WAS_ACTIVE=yes

  resume_timer() {
    if [ "$TIMER_WAS_ACTIVE" = yes ]; then
      systemctl start rfs-crm-sync.timer
      log "sync timer resumed"
    fi
  }
  trap resume_timer EXIT

  if [ "$TIMER_WAS_ACTIVE" = yes ]; then
    systemctl stop rfs-crm-sync.timer
    log "sync timer paused for the restore test"
  fi

  # Stopping the timer does not stop a run already in flight, and each run
  # writes one SyncRun row per resource. Wait for it, or the comparison races
  # a sync that finishes mid-restore.
  local waited=0
  while systemctl is-active --quiet rfs-crm-sync.service; do
    [ "$waited" -lt 120 ] || die "a sync run has been going for ${waited}s — aborting"
    sleep 2
    waited=$((waited + 2))
  done
  [ "$waited" -eq 0 ] || log "waited ${waited}s for an in-flight sync to finish"

  cmd_run || die "backup run failed"

  local key local_dump
  key=$(cmd_latest)
  [ -n "$key" ] || die "no backup found under $PREFIX/"

  mkdir -p "$STAGE"
  local_dump="$STAGE/restore-test.sql.gz"
  log "restoring s3://$BUCKET/$key into $SCRATCH_DB"
  aws s3 cp "s3://$BUCKET/$key" "$local_dump" --only-show-errors || die "download failed"

  admin -e "DROP DATABASE IF EXISTS \`$SCRATCH_DB\`; CREATE DATABASE \`$SCRATCH_DB\`;" \
    || die "could not create $SCRATCH_DB"
  gunzip -c "$local_dump" | admin "$SCRATCH_DB" \
    || die "restore failed"

  local mismatches=0
  while read -r table; do
    local live restored
    live=$(admin -N -B -e "SELECT COUNT(*) FROM \`$DB_NAME\`.\`$table\`")
    restored=$(admin -N -B -e "SELECT COUNT(*) FROM \`$SCRATCH_DB\`.\`$table\`")
    if [ "$live" = "$restored" ]; then
      printf '  %-18s %8s  ok\n' "$table" "$live"
    else
      printf '  %-18s live=%s restored=%s  MISMATCH\n' "$table" "$live" "$restored"
      mismatches=$((mismatches + 1))
    fi
  done < <(admin -N -B -e \
      "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='$DB_NAME' ORDER BY TABLE_NAME")

  admin -e "DROP DATABASE \`$SCRATCH_DB\`;"
  rm -f "$local_dump"

  [ "$mismatches" -eq 0 ] || die "$mismatches table(s) did not match"
  log "restore test passed: every table matched"
}

case "${1:-run}" in
  run)          cmd_run ;;
  latest)       cmd_latest ;;
  restore-test) cmd_restore_test ;;
  *)            die "usage: $0 [run|restore-test|latest]" ;;
esac
