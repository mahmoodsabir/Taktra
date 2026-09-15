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

## Reconnecting Google Calendar

The refresh token expires every 7 days while the consent screen is unverified, so this is
a weekly chore. The callback is `http://localhost:5858/oauth2callback`, which needs a
browser — so forward the port rather than trying to run one on the server:

```bash
ssh -L 5858:localhost:5858 root@<vps>
cd /root/Taktra && npm run google:auth      # open the printed URL in your own browser
# paste the new GOOGLE_REFRESH_TOKEN into /root/Taktra/.env
systemctl restart taktra
```

**Mint the token on the machine that will use it.** A refresh token only works with the
exact client id and secret that issued it, so one generated on a laptop against different
credentials fails on the server with `invalid_grant`.

Verify the token itself before suspecting the app:

```bash
set -a; . /root/Taktra/.env; set +a
curl -s https://oauth2.googleapis.com/token \
  -d client_id="$GOOGLE_CLIENT_ID" -d client_secret="$GOOGLE_CLIENT_SECRET" \
  -d refresh_token="$GOOGLE_REFRESH_TOKEN" -d grant_type=refresh_token
```

`access_token` means the credentials are good and the fault is elsewhere. `invalid_grant`
means the token is dead or was minted against a different client.

### If it still claims to be disconnected after a good token

Check working memory, not the token:

```bash
sqlite3 /root/Taktra/mastra.db \
  "SELECT workingMemory FROM mastra_resources WHERE id='agent';" | grep -i "calendar authoriz"
```

The agent has previously written an outage into working memory, which is replayed into
every later prompt — so it kept reporting a disconnected calendar long after the token was
replaced. The instructions now forbid recording integration state there, but an existing
entry has to be removed by hand:

```bash
systemctl stop taktra
sqlite3 /root/Taktra/mastra.db \
  "UPDATE mastra_resources SET workingMemory = replace(workingMemory, '<the stale sentence>', '') WHERE id='agent';"
systemctl start taktra
```

Or simply tell the bot that the calendar is reconnected and to correct its working memory.

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
