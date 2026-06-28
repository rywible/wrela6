# Proof-Check Test Support

Shared helpers under `tests/support/proof-check/` may only be added by the owning task listed in the shared helper registry in `docs/implementation/2026-06-27-proof-resource-checking.md`.

If a task needs a helper that is not listed there, keep it local to that task's test file or update the helper registry in the same task that introduces the helper.

`src/proof-check/index.ts` and the top-level `src/index.ts` are owned only by Task 36. Earlier tasks import production symbols from direct implementation files.
