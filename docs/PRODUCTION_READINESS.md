# Production readiness

An honest assessment of what stands between Taktra today — a single-user agent — and a
product other people can sign up for.

Written 2026-09-14. Update it as items land.

## Decided

These are settled. Design against them now, even while building for one user.

- **Invite-only first, SaaS later.** The end state is open registration with email
  verification and payment. Nothing built now should assume the owner is the only user, or
  that accounts are created by hand forever.
- **The product absorbs model cost and charges the user.** Users do not bring their own API
  key. Per-user spend is therefore a margin problem, not just a bill: a heavy user has to
  cost less than they pay. Every design choice that multiplies tokens per user is a
  commercial decision, not only a technical one.
- **Deployment today is a systemd service on a VPS**, updated by pulling and restarting.
  Deliberately temporary, pending CI/CD. See `docs/DEPLOY.md`.

**The near-term focus is correctness of the core loop — capture, schedule, nudge, close
out — not any of the phases below.** The phases are recorded so today's work does not
paint them into a corner.

## Where the single-user assumptions live

These are not configuration. Each is a code or schema change.

| Assumption | Location | What multi-user needs |
| --- | --- | --- |
| One Google account | `GOOGLE_REFRESH_TOKEN` in env, `lib/google.ts` | Per-user tokens in the database, obtained through a web OAuth callback |
| One Telegram chat | `TELEGRAM_OWNER_CHAT_ID`, `lib/notify.ts` | Resolve the chat from the task's owner |
| One shared memory | `resolveResourceId: () => 'agent'` | Resource id derived from the authenticated user |
| Allowlist, not signup | `TELEGRAM_ALLOWED_USER_IDS` | A users table and an onboarding flow |
| No owner on a commitment | `todos` table | `user_id` column, and every query scoped by it |
| One notification target | `notifyOwner()` | `notify(userId, message)` |

**The sharpest edge: `todos` has no `user_id`.** Until it does, a second user's commitments
land in the first user's list. Nothing else on this page matters until that is fixed.

## Google OAuth

The current design predates any of this: `scripts/google-auth.mjs` runs a consent flow on
localhost and prints a refresh token to paste into `.env`. That is a developer tool, not a
product flow, and it cannot work for a user who does not have the repo.

What production needs instead:

1. A **Web application** OAuth client (not "Desktop app"), with the deployed callback URL
   registered as an authorized redirect URI.
2. An HTTP route — `/auth/google/callback` — that exchanges the code for tokens.
3. Tokens stored **per user, encrypted at rest**, not in environment variables.
4. The agent detecting "not connected" and sending a connect link, instead of throwing.
5. `invalid_grant` treated as "reconnect required" and surfaced to that user, rather than
   failing the run silently.

### Publish the consent screen

A consent screen left in **Testing** issues refresh tokens that expire after **exactly 7
days**, after which every call returns `invalid_grant`. This is the cause of the repeated
re-authorisation during single-user development, and it is fixed in the Cloud Console, not
in code: set the publishing status to **In Production**.

Verification (including a security review) is required above 100 users on sensitive scopes
such as Calendar. Start that process early — it is measured in weeks, not days.

## Everything else, roughly in order

**Blocking for a first external user**

- `user_id` on `todos`, with every read and write scoped by it.
- A users table: Telegram id, timezone, Google tokens, created/deleted timestamps.
- Per-user memory resource ids, so one person's working memory is not another's.
- Onboarding: what happens the first time a stranger messages the bot.
- Secrets out of a `.env` file on disk and into the platform's secret store.

**Blocking for a product you charge for**

- Deployment that survives a reboot. There is no Dockerfile, unit file, or CI in this repo
  today; it runs under `npm run dev` on a laptop.
- Backups of the database. Every commitment and all memory lives in one SQLite file.
- Per-user cost controls. Since the product absorbs model cost, spend per user is a margin
  line. Needs per-user attribution before pricing can be set honestly, and a ceiling before
  a single user can run up an unbounded bill.
- Rate limiting and abuse handling on the inbound channel.
- Data deletion on request, and a clear answer to what is retained. This product stores
  people's calendars, commitments, and a behavioural profile of them.

**Quality of life**

- Health checks and alerting on the polling loop dying.
- Structured per-user observability, so "it did not remind me" is answerable.
- A staging environment, so schema changes are not first tried in production.

## Not decided yet

- Whether Telegram stays the only channel.
- Which payment provider, and what the plan boundaries are.
- Whether per-user model spend is capped, throttled, or simply priced in.
