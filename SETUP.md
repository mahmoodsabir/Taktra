# Taktra — setup

A personal chief of staff that lives in Telegram. It captures tasks from ordinary
conversation, manages Google Calendar, and follows up on a schedule until things
are actually closed out.

## 1. Telegram

Create a bot with [@BotFather](https://t.me/BotFather) (`/newbot`) and copy the token.

A bot can message you first with no template approval and no 24-hour window, so
unprompted reminders work out of the box. It also only ever sees messages sent to it —
unlike a linked-device pairing, it has no visibility into the rest of your account.

```bash
TELEGRAM_BOT_TOKEN=123456:ABC...
TIMEZONE=Asia/Baghdad
```

The adapter runs in **long-polling** mode, not webhook mode. Polling only makes outbound
requests, so it needs no public URL, no tunnel, and nothing forwarded through a router.
Telegram refuses `getUpdates` while a webhook is registered, so the adapter clears any
stale webhook on startup.

### Who the agent will talk to

Message your bot once, then get your numeric user ID from
[@userinfobot](https://t.me/userinfobot) (or read it off the `from.id` field in
`getUpdates`). For a private chat, your user ID and your chat ID are the same number.

```bash
TELEGRAM_ALLOWED_USER_IDS=123456789
TELEGRAM_OWNER_CHAT_ID=123456789
```

- `TELEGRAM_ALLOWED_USER_IDS` — comma-separated allowlist. The adapter reads this itself
  and drops messages from everyone else before they reach the agent.
- `TELEGRAM_OWNER_CHAT_ID` — where scheduled reminders are pushed.

> **Leave the allowlist empty and every user is allowed.** A bot's username is
> discoverable, so anyone who finds it could talk to your agent. Always set it.

To let other people talk to it, add their IDs to the same list.

## 2. Google Calendar

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project and
   enable the **Google Calendar API**.
2. Under **APIs & Services → Credentials**, create an **OAuth client ID** of type
   **Desktop app**. Copy the client ID and secret into `.env`.
3. If the consent screen is in "Testing", add your own Google account under
   **Audience → Test users**, or the token exchange will be refused.
4. Run the one-time consent flow and paste the printed token into `.env`:

```bash
npm run google:auth
```

A refresh token is used rather than a service account because a personal Gmail calendar
cannot be shared with a service account without a Workspace domain.

## 3. Check-ins

Four standing schedules are defined in [`src/mastra/index.ts`](src/mastra/index.ts) and
reconciled on every boot, so editing the cron there is enough to change them:

| Schedule | Default | What it does |
| --- | --- | --- |
| `morning-brief` | 08:00 | Today's calendar plus anything open or overdue |
| `midday-sweep` | 14:00 | Flags what is about to slip |
| `due-sweep` | every 15 min | Catches tasks the moment they come due |
| `evening-closeout` | 21:00 | Forces open items to done, dropped, or rescheduled |

`due-sweep` runs often but is cheap: a `prepare` hook checks the task store first and
returns `null` when nothing is due, which skips the fire entirely — no agent run, no
model call, no cost.

Each fire is an isolated run with no inbound message, so the agent reaches you through the
`send_telegram` tool. It is instructed to stay silent when nothing is genuinely due —
an empty run is the expected outcome most of the time.

You can also ask the agent in chat for one-off schedules; it has `start_schedule` and
`stop_schedule` for that.

## 4. Running it for real

The agent long-polls Telegram and runs cron in-process, so it needs an always-on host —
a small VM or container, not a serverless platform. `LocalSandbox` and `LocalFilesystem`
also assume a real, persistent disk.

Keep `mastra.db` and `.env` on persistent storage; losing `mastra.db` means losing every
task and memory.

## Where things live

| Path | Purpose |
| --- | --- |
| [`src/mastra/agents/agent.ts`](src/mastra/agents/agent.ts) | Instructions, memory, channel wiring |
| [`src/mastra/lib/telegram.ts`](src/mastra/lib/telegram.ts) | Adapter, polling loop, owner chat |
| [`src/mastra/lib/notify.ts`](src/mastra/lib/notify.ts) | Unprompted outbound push |
| [`src/mastra/lib/todos.ts`](src/mastra/lib/todos.ts) | Task store (SQLite via libSQL) |
| [`src/mastra/lib/google.ts`](src/mastra/lib/google.ts) | Authorized Calendar client |
| [`src/mastra/tools/`](src/mastra/tools/) | Tools the agent calls |
| [`scripts/google-auth.mjs`](scripts/google-auth.mjs) | One-time OAuth consent |
