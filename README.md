# Taktra

**Taktra = task + traction.** A personal accountability partner built on Mastra, reachable over Telegram.

It is designed to manage the user’s life in one place: work, personal admin, family matters, health, fitness, learning, and long-term goals.

The product is not just a task list. It captures commitments, tracks what is slipping, follows up at the right moment, and nudges the user toward a clear next step without turning into spam.

## Product docs

- [CONTEXT.md](CONTEXT.md) — the domain glossary: what a commitment, a nudge, and `blocked` vs `stalled` actually mean
- [docs/adr/](docs/adr/) — architecture decisions and why they were made
- [docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md) — what stands between this and a multi-user product
- [docs/DEPLOY.md](docs/DEPLOY.md) — updating the VPS deployment
- [docs/LIVING_PRODUCT_GUIDE.md](docs/LIVING_PRODUCT_GUIDE.md) — source-of-truth product guide
- [docs/FEATURES_AND_USAGE.md](docs/FEATURES_AND_USAGE.md) — living feature overview and usage guide
- [docs/FEATURES_LANDING_PAGE.html](docs/FEATURES_LANDING_PAGE.html) — polished landing page overview

## Product summary

- captures tasks and commitments from ordinary conversation
- tracks life areas beyond work, including health, family, and growth
- follows up when something is at risk of slipping
- supports blocked, overloaded, and lazy states without shame
- asks for the smallest meaningful next step when the user is overwhelmed
- keeps important tasks from disappearing silently

## Core architecture

- [src/mastra/agents/agent.ts](src/mastra/agents/agent.ts) defines the accountability agent behavior
- [src/mastra/index.ts](src/mastra/index.ts) wires recurring check-ins and follow-up scheduling
- [src/mastra/tools/todo-tools.ts](src/mastra/tools/todo-tools.ts) handles task creation and updates
- [src/mastra/lib/todos.ts](src/mastra/lib/todos.ts) represents the task data lifecycle

## Living product documentation

The product guide is here:

- [docs/LIVING_PRODUCT_GUIDE.md](docs/LIVING_PRODUCT_GUIDE.md)

This guide should be updated whenever the product, reminder policy, or task model changes.

## Features

- A project-level `workspace/` for files and command execution
- Approval gates for file changes, deletions, and shell commands
- Conversation memory, generated thread titles, and task tracking
- Built-in web search and direct web page fetching
- Recurring schedules that persist across restarts
- Local libSQL storage and DuckDB observability, with optional Turso storage
- A bundled Mastra skill that helps coding agents use current Mastra APIs

## Get started

Full setup — Telegram bot, Google Calendar, allowlist — is in [SETUP.md](SETUP.md).

The short version: copy `.env.example` to `.env`, fill in `OPENAI_API_KEY`,
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_IDS`, and `TELEGRAM_OWNER_CHAT_ID`, then run:

```shell
npm run dev
```

Open [http://localhost:4111](http://localhost:4111) for [Mastra Studio](https://mastra.ai/docs/studio/overview),
or just message the bot on Telegram. Try:

- `Remind me to call the accountant tomorrow at 11.`
- `What's on today?`
- `I'm overloaded — what's the one thing I should actually do?`

The agent asks for approval before it changes files or runs commands. When it creates a schedule, it returns an ID that you can use to pause the schedule.

## Workspace safety

The local filesystem tools stay inside the project-level `workspace/` directory. Shell commands start in that directory, but `LocalSandbox` does not provide operating-system isolation by default. Review command approvals carefully, and do not expose this template through an unauthenticated public server.

## Storage

The default `file:./mastra.db` database stores agent memory, tasks, and schedules locally. To use Turso, set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` in `.env`.

Recurring schedules continue to use model tokens until you pause them. Ask the agent to pause a schedule with the ID returned by `start_schedule`.

## Making it yours

- Edit `src/mastra/agents/agent.ts` to change the model, instructions, memory, workspace, or approval policy.
- Edit `src/mastra/tools/` to customize scheduling.
- Edit `src/mastra/index.ts` to change storage and observability.
- Add files or reusable skills under `workspace/` for the agent to use.

## Learn more

To learn more about Mastra, visit our [documentation](https://mastra.ai/docs/). If you're new to AI agents, check out our [course](https://mastra.ai/learn) and [YouTube videos](https://youtube.com/@mastra-ai). You can also join our [Discord](https://discord.gg/BTYqqHKUrf) community to get help and share your projects.

## Deploy to the Mastra platform

The [Mastra platform](https://projects.mastra.ai) provides two products for deploying and managing AI applications built with the Mastra framework. Learn more in the [Mastra platform documentation](https://mastra.ai/docs/mastra-platform/overview).
