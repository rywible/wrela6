# OptIR Test Support

Shared helpers under `tests/support/opt-ir/` may only be added by the owning task listed in the OptIR implementation plan.

If a task needs a helper that is not listed there, keep it local to that task's test file or update the helper ownership list in the same task that introduces the helper.

Do not add early barrel files for OptIR helpers or production OptIR modules. Until the implementation plan assigns a public export task, tests should import helper and production symbols from direct files owned by their task.
