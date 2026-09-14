# Taktra

A personal accountability partner. One person talks to it over Telegram about their whole
life — work, health, family, admin, growth — and it makes sure nothing they commit to
quietly disappears.

## Language

### What gets tracked

**Commitment**:
Something the owner has said they will do. The unit this product exists to protect.
_Avoid_: todo, item, ticket

**Note**:
A fact worth keeping that carries no obligation — a decision, a number, a name, an idea.
Kept and searchable, never chased.
_Avoid_: memo, snippet

**Area**:
The part of the owner's life a commitment belongs to: personal, work, health, family,
growth, or admin. Deliberately not called "context", which already means two other things
in this project.
_Avoid_: context, category, tag, project

**Minimum viable action**:
A reduced version of a commitment that still moves it forward when the owner is
overloaded or avoiding it. What the agent offers instead of the whole task.
_Avoid_: subtask, next step, quick win

### Why something is not moving

**Blocked**:
Waiting on someone other than the owner. They cannot move it alone, so chasing them
achieves nothing.
_Avoid_: waiting, on hold, pending

**Stalled**:
Stuck on the owner themselves, through overwhelm, avoidance, or drift. The state this
product is built to push against.
_Avoid_: blocked, stuck, procrastinating

**Dropped**:
Abandoned on purpose. A closed outcome, not a failure — distinct from a commitment that
simply rotted.
_Avoid_: cancelled, deleted, abandoned

### Following up

**Nudge**:
One unprompted message about a specific commitment. The agent's only way to interrupt.
_Avoid_: reminder, ping, notification, alert

**Escalation**:
How hard the agent is pushing on a commitment, rising as it goes unanswered. Only ever
applies to what the owner can actually act on — a blocked commitment is surfaced but
never escalated.
_Avoid_: priority, severity, urgency

**Cooldown**:
The quiet period a commitment earns after being nudged, so the same one cannot be raised
twice in a row.
_Avoid_: debounce, throttle, snooze

**Snooze**:
The owner explicitly asking for silence on a commitment until a chosen time. Distinct
from a cooldown, which the agent applies to itself.
_Avoid_: defer, postpone

**Check-in**:
A scheduled wake-up with no message in front of the agent, where it decides whether the
owner is worth interrupting at all. Sending nothing is the normal outcome.
_Avoid_: cron job, sweep, digest

**Owner**:
The single person this instance belongs to. Taktra is deliberately single-user.
_Avoid_: user, customer, account
