# Deploying

Taktra runs as a Docker container. The image is built from source, so the host needs only
Docker — no Node version to match, no native modules to rebuild, and no difference between
a laptop and the server.

## Update an existing deployment

```bash
cd /root/Taktra
git pull origin main
docker compose up -d --build
```

Then confirm it actually came back, rather than assuming:

```bash
docker compose ps                     # State should be running (healthy)
docker compose logs --tail=50 taktra | grep -E "ready in|polling started|Error"
```

You are looking for `ready in` and `Telegram polling started`. A container that is running
but never logged those is up without being usable.

## First run, or moving off a git checkout

```bash
cp .env.example .env && $EDITOR .env      # real values; never commit this
docker compose up -d --build
```

**Bring existing data with you.** The volume starts empty, and an agent with an empty
database wakes up with no tasks, no schedules and no memory of its owner:

```bash
docker compose cp mastra.db     taktra:/data/mastra.db
docker compose cp mastra.db-wal taktra:/data/mastra.db-wal   # both files, see below
docker compose restart taktra
```

Copy the `-wal` too. SQLite holds recent writes there until a checkpoint, so copying the
`.db` alone loses the newest data — including anything written in the last session.

## Reaching Studio

The port is published on loopback only, because Studio and the API are unauthenticated and
expose full read and write access to the owner's commitments and memory. Tunnel in:

```bash
ssh -L 4111:localhost:4111 root@<vps>    # then open http://localhost:4111
```

## Rules that are easy to get wrong

**Only one instance may run at a time.** Telegram allows one long-polling consumer per
bot: a second takes turns being disconnected with 409s, and both run the cron check-ins, so
every reminder arrives twice. Never `docker compose up --scale`, and stop any local
`npm run dev` before the server is serving.

**Database paths must be absolute.** Compose pins them to `/data` on the volume and
overrides `.env`. A relative `file:./mastra.db` resolves against the bundle directory,
which a rebuild empties — that is how state used to disappear on deploy.

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
cd /root/Taktra && npm run google:auth      # needs Node on the host, or run it locally
# paste the new GOOGLE_REFRESH_TOKEN into /root/Taktra/.env
docker compose up -d                        # picks up the changed env_file
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
docker compose exec taktra node -e "1" >/dev/null && docker run --rm -v taktra-data:/data alpine \
  sh -c "apk add -q sqlite && sqlite3 /data/mastra.db \"SELECT workingMemory FROM mastra_resources WHERE id='agent';\"" | grep -i "calendar authoriz"
```

The agent has previously written an outage into working memory, which is replayed into
every later prompt — so it kept reporting a disconnected calendar long after the token was
replaced. The instructions now forbid recording integration state there, but an existing
entry has to be removed by hand:

```bash
docker compose exec taktra node -e "1" >/dev/null   # container must be running
docker compose stop taktra
docker run --rm -v taktra-data:/data alpine sh -c "apk add -q sqlite && sqlite3 /data/mastra.db \
  \"UPDATE mastra_resources SET workingMemory = replace(workingMemory, '<the stale sentence>', '') WHERE id='agent';\""
docker compose start taktra
```

Or simply tell the bot that the calendar is reconnected and to correct its working memory.

## Backups

Everything the product knows lives in one volume: commitments, schedules, and months of
accumulated memory about its owner. Losing it loses the product.

```bash
scripts/backup.sh /var/backups/taktra
```

Nightly, via the host's crontab:

```cron
15 3 * * *  /root/Taktra/scripts/backup.sh /var/backups/taktra >> /var/log/taktra-backup.log 2>&1
```

It archives the whole `/data` directory rather than just `mastra.db`, because SQLite holds
recent writes in the `-wal` until a checkpoint. The container keeps running — this is a
crash-consistent copy, which the WAL is designed to recover from, and stopping the service
nightly would cost missed reminders for nothing. Archives older than 14 days are pruned
(`TAKTRA_BACKUP_KEEP_DAYS`).

To restore:

```bash
docker compose stop taktra
docker run --rm -v taktra-data:/data -v /var/backups/taktra:/backup alpine:3 \
  sh -c 'rm -rf /data/* && tar xzf /backup/taktra-<stamp>.tar.gz -C /data'
docker compose start taktra
```

**A backup nobody has restored is a hope, not a backup.** Run the restore into a throwaway
volume once, and confirm the agent still knows who you are.

## Migrations

Schema changes apply themselves on boot and are written to be no-ops once applied, so an
update needs no migration step. They are not reversible, though — **back up the database
before deploying a release that changes the schema**:

```bash
docker compose stop taktra
docker run --rm -v taktra-data:/data -v "$PWD:/backup" alpine \
  sh -c 'cp /data/mastra.db /data/mastra.db-wal /backup/ 2>/dev/null; true'
mv mastra.db mastra.db.$(date +%F); mv mastra.db-wal mastra.db-wal.$(date +%F) 2>/dev/null || true
docker compose start taktra
```

Copying `mastra.db` alone is not a backup: SQLite keeps recent writes in the `-wal` file
until a checkpoint, so a copy taken without it can be missing the newest data.

## Rolling back

```bash
git log --oneline -5
git checkout <previous-sha>
docker compose up -d --build
```

Code rolls back cleanly. A schema change does not — restore the database backup taken
before that deploy.

## What is missing

The image is around 2 GB, of which `googleapis` alone is 209 MB — it ships every Google
API surface for the one Calendar client this uses. Swapping it for `@googleapis/calendar`
would remove most of that. Deliberately not done while the calendar integration is still
being stabilised.

No CI, no alerting, and no automated backups. The container has a health check, but it
only confirms the HTTP server is accepting connections — it does not know whether Telegram
polling is alive, so a silently disconnected bot still reads as healthy. Losing the
`taktra-data` volume loses every commitment and all memory. See
[PRODUCTION_READINESS.md](PRODUCTION_READINESS.md).
