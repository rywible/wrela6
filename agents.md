# Agent Notes

- Run `bun run agent:check` before handing work back.
- Use narrower commands like `bun test ./tests/unit/cursor.test.ts` while iterating.
- Keep runtime source dependency-free; `fast-check` is for tests only.
- Use fakes through dependency injection. Do not use mocks.
- Keep filesystem access at compiler edges.
- Run `bun run format` before large handoffs when formatting changed.
- Keep names descriptive. Prefer `source`, `diagnostics`, `token`, `result`, and `context` over shortened names.
