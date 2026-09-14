# A separate agent for scheduled check-ins

Scheduled check-ins run on `nudger`, a second agent with its own cheaper model, four tools
instead of twelve, and a shorter prompt. It shares one `Memory` instance with the main
agent so both read and write the same working memory and observations.

We wanted the cron path priced differently from interactive chat: nudges are formulaic and
nobody is waiting on the reply, while conversational capture is where a weak model silently
losing a tool call would cost the owner a real commitment. Mastra cannot vary the model per
schedule fire — `ScheduleEffective` carries a prompt and `providerOptions` but no `model` —
so a second agent is the only way to express that split.

## Consequences

Two agents now describe overlapping behaviour, and instruction changes about follow-up tone
need making in both places. The nudger deliberately cannot create commitments or calendar
events: a threadless run has no one in front of it, so anything it invented would go
unreviewed. Schedules are bound to `nudger`, and `src/mastra/index.ts` deletes any left on
the old agent at boot so the check-ins cannot fire twice.
