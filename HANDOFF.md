# Handoff — Taktra

Personal chief-of-staff agent for Mahmood. He talks to it over Telegram; it captures
tasks from ordinary conversation, manages his Google Calendar, and nudges him until
things are closed out. Built on the Mastra starter template, rebuilt 2026-08-31.
Named **Taktra** — task + traction.

**Status: working end to end.** Telegram in/out, tasks, calendar, and scheduled
reminders are all verified live.

## Read this first: the channel decision

**Telegram bot, not WhatsApp.** The project originally ran on
[Baileys](https://github.com/WhiskeySockets/Baileys), pairing against his personal
WhatsApp over WhatsApp Web. That was chosen over Meta's WhatsApp Cloud API because the
Cloud API blocks business-initiated messages outside a 24-hour customer-service window,
so unprompted reminders would have needed Meta-approved templates.

Baileys worked, but had one fatal flaw for this product: **it sent as his own account,
and WhatsApp never notifies you about your own messages.** An accountability agent that
cannot make the phone buzz is not an accountability agent. A solo group behaves the same
way, because the sender is still him.

A Telegram bot has its own identity, so notifications simply work. It can also message
first with no template approval and no 24-hour window. Earlier notes in this file claimed
Telegram was unusable on Iraqi ISPs — that concern applied to *inbound webhooks*. The
adapter runs in **long-polling** mode, which only makes outbound requests, so there is no
public URL, no tunnel, and nothing to forward through a router.

**Do not re-propose Meta's WhatsApp Cloud API.** The 24-hour window still rules it out.

## Architecture

```
Telegram bot (own identity, long polling)
  └─ @chat-adapter/telegram ──> Mastra channels ──> agent "agent"
                                                     ├─ todo_* tools     → todos table (libSQL)
                                                     ├─ calendar_* tools → Google Calendar API
                                                     └─ send_telegram    → outbound push
Cron schedules (in-process) ──> threadless agent runs ──> send_telegram
```

| Path | File |
| --- | --- |
| Agent: instructions, memory, channel wiring | `src/mastra/agents/agent.ts` |
| Mastra instance, schedules, `prepare` hook | `src/mastra/index.ts` |
| Telegram adapter, polling loop, owner chat | `src/mastra/lib/telegram.ts` |
| Unprompted outbound push | `src/mastra/lib/notify.ts` |
| Task store (libSQL) | `src/mastra/lib/todos.ts` |
| Authorized Calendar client | `src/mastra/lib/google.ts` |
| Tools | `src/mastra/tools/` |
| One-time Google consent | `scripts/google-auth.mjs` |
| User-facing setup guide | `SETUP.md` |

Dependencies: `@chat-adapter/telegram`, `googleapis`. The Baileys-era packages
(`chat-adapter-baileys`, `@chat-adapter/whatsapp`, `qrcode`, `@types/qrcode`) have been
removed.

## Four non-obvious things that will cost you hours

These were each found the hard way. They are all fixed; do not undo them.

**1. The adapter needs an explicit `startPolling()`.** Mastra's channel layer calls
`initialize()` and then waits for an inbound webhook, which never comes in polling mode.
Without the `connectTelegram()` call at the bottom of `index.ts`, the agent registers
perfectly and then never hears a thing. It is deliberately not awaited, so a Telegram
outage can't block server boot.

**2. Telegram refuses `getUpdates` while a webhook is registered.** The adapter is
constructed with `longPolling.deleteWebhook: true` so a stale webhook from an earlier
experiment cannot silently kill inbound messages.

**3. Observational memory must be resource-scoped.** Thread scope is the default and
*throws* when a run has no thread — which is every scheduled check-in, since they fire
threadless. This silently killed the entire reminder system: all four schedules crashed
before reaching the model. Fixed via `observationalMemory.scope: 'resource'`.

Channel threads also default to a per-platform `resourceId`, which files Telegram
conversations under a different owner than the ones started in Studio. Both are pinned to
one shared resource so working memory is not split in two.

**4. Relative paths resolve against the wrong directory.** `mastra dev` runs the bundled
output from a different cwd, so `file:./mastra.db` landed in `src/mastra/public/`. It is
now pinned to an absolute path in `.env`. Keep it absolute.

## The allowlist — do not weaken this

A bot's username is discoverable, so anyone who finds it can start a chat. The
`@chat-adapter/telegram` adapter reads `TELEGRAM_ALLOWED_USER_IDS` from the environment
itself and drops non-matching users **before** a message reaches Mastra — so blocked
messages cost zero tokens, and there is no separate gate in `agent.ts` any more.

**An empty or unset `TELEGRAM_ALLOWED_USER_IDS` allows every user.** This is the one
setting that must never be blank in a deployed instance.

`onMention` is `false`, so group mentions are ignored entirely; this agent is single-user.

Note there is no per-person permission layer: anyone allowlisted can read and change his
calendar, tasks, and memory.

## Schedules

Defined in `index.ts`, **reconciled on every boot** — edit the cron there and it updates
in place rather than keeping whatever the first boot stored.

| id | cron (Asia/Baghdad) | purpose |
| --- | --- | --- |
| `morning-brief` | `0 8 * * *` | today's calendar + anything open or overdue |
| `midday-sweep` | `0 14 * * *` | flags what is about to slip |
| `evening-closeout` | `0 21 * * *` | forces open items to done / dropped / rescheduled |
| `due-sweep` | `*/15 * * * *` | pings at a task's actual due time |

`due-sweep` runs every 15 minutes but is nearly free: the `schedules.prepare` hook in
`index.ts` queries `todosDueForNudge()` first and returns `null` when nothing is due,
which **skips the fire entirely — no agent run, no model call, no cost.** Only build new
high-frequency schedules this way.

One-nudge-per-due-time is enforced by the `nudged_for_due_at` column, not by
`last_nudged_at`. Comparing against `last_nudged_at` is wrong: a task nudged *before* it
comes due would re-fire forever.

## Notifications

Solved by the move to Telegram: the bot has its own identity, so its messages arrive as
normal push notifications on his phone.

Calendar events with popup reminders are still created for anything time-specific. They
are no longer the *only* alert channel, but they remain useful — a Google Calendar
reminder fires with lead time and survives the agent being down.

## Environment

Real credentials are in `.env` (gitignored); `.env.example` documents the shape.

| Variable | Notes |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | from @BotFather |
| `TELEGRAM_ALLOWED_USER_IDS` | comma-separated numeric user IDs — **never leave blank** |
| `TELEGRAM_OWNER_CHAT_ID` | private chat for scheduled pushes; same number as his user ID |
| `TIMEZONE` | `Asia/Baghdad` |
| `TURSO_DATABASE_URL` | absolute `file:` URL to `mastra.db` — **keep absolute** |
| `GOOGLE_CLIENT_ID` / `_SECRET` / `_REFRESH_TOKEN` | Desktop-app OAuth |

Known cosmetic mismatch: his Google Calendar is `Asia/Amman`, `TIMEZONE` is
`Asia/Baghdad`. Both are permanently UTC+3, so nothing is wrong today.

## Verified working

Telegram inbound and outbound · task capture from natural language · Google Calendar
read/write against his real calendar · threads visible in Studio · allowlist ·
due-sweep pings once at due time, respects snooze, re-arms on reschedule · schedule
reconcile · zero-cost skip · production build (`npm run build`) · typecheck clean.

## Not done

- **Deployment.** Runs on his Mac via `npm run dev`. Needs an always-on host: it
  long-polls Telegram, runs cron in-process, and uses `LocalSandbox` /
  `LocalFilesystem` against a real disk. Not serverless.
- Test coverage is thin — `src/mastra/lib/todos.test.ts` only. Everything else has been
  verified by live smoke tests.

## Working notes

- He has ADHD — keep answers short and scannable. Lead with the answer.
- `npm run dev` on port 4111; Studio at http://localhost:4111.
- Only one dev server per project. Kill stale ones (`pkill -f "mastra dev"`) before
  starting or building, and check the port isn't held by something unrelated.
