# Split `blocked` from `stalled`

A commitment that is not moving is either waiting on someone else or stuck on the owner,
and the two deserve opposite follow-ups: chasing the owner about a third party's delay is
noise, while chasing them about their own avoidance is the entire product. We made these
two separate statuses rather than one `blocked` status discriminated by a free-text
`statusReason`.

## Considered Options

`statusReason` already existed and could have carried the distinction. We rejected it
because it was empty on every row after eleven days of real use — the agent had never
populated it once, while it filled `minimumViableAction` on five of six. A model that
depends on an optional free-text field the agent ignores will stay empty. Two statuses
are self-enforcing: the agent must choose one, and each maps to its own cooldown and
escalation rule.

## Consequences

`blocked` is surfaced but never escalated, and its nudge offers to draft the chase
message to the other party rather than asking whether the owner has done it. Existing
`blocked` rows keep their status and simply take the slower cadence, which is the safe
direction to be wrong in.
