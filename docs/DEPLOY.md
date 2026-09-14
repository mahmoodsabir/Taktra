# Deploying

Taktra runs as a systemd service on a VPS. Updating is a pull, a build, and a restart.
This is deliberately a stopgap until CI/CD exists.

## Update an existing deployment

```bash
cd /srv/taktra                  # wherever the checkout lives
git pull origin main
npm ci                          # only strictly needed when the lockfile changed
npm run build
sudo systemctl restart taktra   # check the unit name with: systemctl list-units | grep -i taktra
```

Then confirm it actually came back, rather than assuming:

```bash
systemctl status taktra --no-pager
journalctl -u taktra -n 50 --no-pager | grep -E "ready in|polling started|Error"
```

You are looking for `ready in` and `Telegram polling started`. A unit that is `active
(running)` but never logged those is up without being usable.

## Rules that are easy to get wrong

**Only one instance may run at a time.** Two processes both long-poll Telegram — one gets
HTTP 409 and stops receiving messages — and both run the cron check-ins, so reminders
arrive twice. Stop any local `npm run dev` before the VPS is serving, and never run two
VPS instances against one database.

**Run `npm ci`, not `npm install`, after a lockfile change.** A stale `node_modules` keeps
packages the lockfile has dropped.

**Check `.env` after a deploy that added variables.** Missing model variables fall back to
their defaults silently; a missing `TELEGRAM_BOT_TOKEN` or `TELEGRAM_OWNER_CHAT_ID` does
not. `.env.example` is the reference.

**`TELEGRAM_ALLOWED_USER_IDS` must never be blank in a deployed instance.** Empty means
every Telegram user is allowed, and a bot username is discoverable.

## Migrations

Schema changes apply themselves on boot and are written to be no-ops once applied, so an
update needs no migration step. They are not reversible, though — **back up the database
before deploying a release that changes the schema**:

```bash
systemctl stop taktra
cp mastra.db mastra.db.$(date +%F)          # copy the -wal file too, or recent writes are lost
cp mastra.db-wal mastra.db-wal.$(date +%F) 2>/dev/null || true
systemctl start taktra
```

Copying `mastra.db` alone is not a backup: SQLite keeps recent writes in the `-wal` file
until a checkpoint, so a copy taken without it can be missing the newest data.

## Rolling back

```bash
git log --oneline -5
git checkout <previous-sha>
npm ci && npm run build && sudo systemctl restart taktra
```

Code rolls back cleanly. A schema change does not — restore the database backup taken
before that deploy.

## What is missing

No CI, no health check, no alerting on the polling loop dying, and no automated backups.
Losing `mastra.db` loses every commitment and all memory. See
[PRODUCTION_READINESS.md](PRODUCTION_READINESS.md).
