# Containerised deployment

Taktra ships as a Docker image built from a multi-stage Dockerfile and run through Docker
Compose, replacing a systemd unit that ran `npm start` against a git checkout.

The checkout approach drifted in ways that were expensive to diagnose. `@duckdb/node-bindings`
is a platform-specific native module, so a laptop's `node_modules` is unusable on a Linux
server. More damaging, `TURSO_DATABASE_URL` was set to a relative `file:./mastra.db`, which
resolves against the bundle's working directory rather than the project root — so the
database lived inside `.mastra/output`, the directory `npm run build` empties. State was
being destroyed on deploy, and it took a round of confused debugging to notice, because the
symptom was an agent with no memory rather than an error.

The image fixes both structurally. Dependencies are installed inside the image for the
platform that will run them, and Compose pins both database paths to `/data` on a named
volume, overriding whatever `.env` says, so the data cannot end up somewhere a rebuild will
delete.

## Consequences

The service must never be scaled past one replica. Telegram permits a single long-polling
consumer per bot, so a second instance would take turns being disconnected with 409s, and
both would run the cron check-ins — every reminder twice.

Studio and the API are unauthenticated, so the port is published on loopback only and is
reached through an SSH tunnel. Publishing it on `0.0.0.0` would expose full read and write
access to the owner's commitments and memory to anyone who found the host.

Moving from an existing checkout means copying `mastra.db` **and** its `-wal` file into the
volume. SQLite keeps recent writes in the `-wal` until a checkpoint, so copying the `.db`
alone silently loses the newest data.
