# The event log is the source of truth

Every change to a commitment is appended to `todo_events` and never edited or deleted.
Rollups and narrative summaries are derived from it, and can be thrown away and recomputed.

`todos` holds current state, so transitions were being overwritten: a commitment that went
open, stalled, was rescheduled twice and eventually finished was stored as "done". The path
is the part that reveals a habit, and it was the part being discarded. Unlike storage cost,
this is not recoverable — history not written down at the time cannot be reconstructed
later, which is why the log went in before the rollups and summaries that will read it.

## Consequences

Insight cost does not grow with history, because the model never reads the log. A year of
events is on the order of 360,000 tokens; the monthly aggregates derived from them are a
few hundred. Aggregation happens in SQL — exactly, for free, and identically every time —
and the model is given only the resulting numbers to narrate.

Derived artifacts are never the only copy. When the definition of "stalled" changes, every
rollup can be recomputed from the log. A summary that replaced its own inputs could not be.

Writes are best-effort: a failed event insert is swallowed rather than failing the
operation the owner asked for. Losing one audit row is a smaller harm than losing the
commitment it describes.

Nothing prunes this table. That is deliberate — it is the asset, and it is small. A year of
one user's events is roughly nine thousand rows.
