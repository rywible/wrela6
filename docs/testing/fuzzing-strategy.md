# Lexer Fuzzing Strategy

## Confidence Model

The lexer fuzz suite should prove invariants across broad input classes, not just sample happy paths. Every fuzz family must check lossless reconstruction, exactly one EOF token, bounded spans, balanced layout, bounded diagnostics, and deterministic snapshots for repeated runs.

## Fuzz Families

- Arbitrary text: full source-preservation and recovery checks over unconstrained strings.
- Grammar-shaped valid snippets: keywords, identifiers, literals, operators, indentation, comments, and mixed newline styles.
- Hostile text: control codes, NUL, Unicode separators, emoji, invalid punctuation, tabs, quotes, and backslashes.
- Layout stress: deep indentation, uneven spaces, tabs in indentation, repeated dedents, blank lines, and comment-only lines.
- Import discovery: valid `use ... from ...` statements, malformed variants, mixed ordinary code, exact module spans, and deterministic diagnostics.
- Module graph traversal: cycles, shared dependencies, duplicate imports, missing modules, unresolved modules, unreadable modules, and stable depth-first order.

## Snapshot Determinism

For deterministic checks, compare normalized snapshots instead of object identity:

- token kind, lexeme, span, leading trivia, and trailing trivia
- diagnostic code, severity, message, and span
- import module name and module span
- module graph path order and per-module reconstructed source

## Regression Seeds

Every fuzz family should use a committed seed. When a failure is found, keep the minimized case as a named unit or integration test and preserve the seed in the fuzz case so the broader generator remains reproducible.

## Future Additions

- Parser-aware token sequence generators once grammar work begins.
- Corpus replay from `docs/language` examples and minimized historical failures.
- Cross-layer fuzzing that lexes, parses, and typechecks generated modules once those layers exist.
