# Accounts, and the channels that reach them

A user is an account with an internal id. How they are reached — a Telegram chat, a
WhatsApp number, later a device token — is a row in `user_channels`, not a property of the
user and never an environment variable. Commitments carry a `user_id`, and every read is
scoped by it.

This is built before there is a second user. Each single-owner assumption — one chat id in
the environment, one shared memory resource, a task table with no owner — is cheap to
generalise now and expensive to unpick once other people's commitments are in the database.
The existing installation is seeded as one account so nothing is stranded.

Identity is separated from address because addresses change and are recycled. Someone may
arrive on Telegram, prefer WhatsApp later, and install an app after that, without becoming
three accounts or losing their history. `(channel, external_id)` is unique, so a reassigned
phone number moves to its new owner rather than delivering a stranger's commitments.

## Consequences

Sending is routed through `deliver()`, which resolves a user's channel and dispatches.
Adding WhatsApp is a sender plus a row, not a change to the agent, the tools, or the nudge
logic. A user with no channel, or one this deployment cannot send on, is a loud failure —
silence would mark a commitment as chased that nobody was told about.

Timezone moves onto the user. The global `TIMEZONE` remains only as the default for the
seeded owner, and anything reasoning about a user's time must read it from their account.

Memory is scoped the same way. A channel resolves the sender's account and files their
working memory and observations under it, so one person's profile is never another's. The
owner keeps the literal `agent` resource id the installation has always used — their
profile and observations sit under it across several Mastra-internal tables, and renaming
it would strand all of that to gain nothing. A sender with no account falls through to the
per-platform default, which isolates them; the allowlist should already have stopped them,
so that is the second lock rather than the first.

The scheduled check-ins remain the owner's alone, and are scoped explicitly rather than
sweeping every account. They are one global schedule delivering to one chat, so an unscoped
sweep would read every user's commitments out to a single person. **Sign-up must create a
schedule per user**, bound to that user's thread and resource, rather than widening this
one. That is the next structural piece.

`OWNER_USER_ID` is still the default for writes that have no user in hand. Those are the
call sites that sign-up has to revisit; they are deliberately explicit rather than implicit
so they can be found.
