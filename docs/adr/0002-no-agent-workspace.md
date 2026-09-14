# No agent workspace

Taktra does not give its agent a filesystem or a shell, even though the Mastra starter it
grew from ships both. The `Workspace`, `LocalFilesystem`, and `LocalSandbox` were removed
along with the eleven tools they register.

The capability was never used: no `workspace/` directory ever existed, and the only
instruction referencing it was a single clause offering it as somewhere to put a note.
Meanwhile its tool schemas were roughly half of every prompt the agent sent, on every
call, forever — `grep`, `execute_command`, `edit_file` and `get_process_output` are not
things a task-and-calendar agent has any reason to do.

Notes now have a first-class `note` status in the commitment store instead, which is
durable and searchable where a loose file was neither.

## Consequences

This is a deliberate deviation from the starter template, so it will look like something
is missing. It is not. Re-adding a workspace means re-adding the prompt cost and a shell
execution surface to a single-user agent reachable from a chat app.
