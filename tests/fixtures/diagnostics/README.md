# Diagnostic Fixtures

Diagnostic fixtures describe compiler inputs and the diagnostics expected from
one compiler phase. Each fixture directory contains:

- `input.wr`: the source text to compile.
- `expected.json`: the deterministic expectation for that source.

`expected.json` uses this schema:

```json
{
  "phase": "parse",
  "diagnostics": [],
  "trackedBy": "W1-02"
}
```

`phase` is the phase that owns the diagnostic expectation. Valid values are
`parse`, `semantic`, and `pipeline`.

`diagnostics` is an array of expected diagnostics. A diagnostic entry may use:

- `code`: the stable diagnostic code emitted by the compiler.
- `spanText`: the exact source text covered by the diagnostic span.
- `count`: the number of diagnostics matching the entry when the same
  diagnostic shape is expected more than once.

`trackedBy` is optional for most fixtures. When present, it must be a plan owner
workstream or task ID matching `^W[0-8]-[0-9]{2}[a-z]?$`, such as `W1-02` or
`W0-02c`.

Fixture directories whose names start with `ok-` are negative-diagnostic
fixtures. They document source inputs that should complete the selected phase
without diagnostics, so their expectation uses an empty `diagnostics` array and
must not include `trackedBy`.

Non-`ok-*` fixtures with an empty `diagnostics` array are tracked wrong-behavior
fixtures. They document known diagnostic debt where malformed source currently
passes without the expected diagnostic. These fixtures must include `trackedBy`
so the missing diagnostic is tied to an owner workstream or task instead of
looking like an intentional negative fixture.
