# Flat CST Spike

## Scope

W7-05b is a measurement spike only. It does not migrate production parsing away
from the existing red/green CST in `src/frontend/syntax` or the `Parser` in
`src/frontend/parser/parser.ts`.

The local harness is `scripts/benchmark-flat-cst-spike.ts`. It generates one
deterministic 100,000-line `.wr` module, measures the current lexer+parser path,
then measures a flat-array prototype that stores token kind and source offsets
from the same lexer token stream. Run it with:

```sh
PATH="$HOME/.bun/bin:$PATH" bun scripts/benchmark-flat-cst-spike.ts
```

## Local Sample

Sample captured on 2026-07-04 in this workspace. These numbers are
environment-sensitive; rerun the script before making any architecture decision.

| Representation       | Measurement |   Value |
| -------------------- | ----------- | ------: |
| current CST          | parse ms    | 707.792 |
| current CST          | heap MB     | 145.828 |
| flat-array prototype | parse ms    | 734.763 |
| flat-array prototype | heap MB     | 506.760 |

The generated source has exactly 100,000 lines and both measured paths reported
zero diagnostics. The current CST sample includes lexer diagnostics, parser
construction, `SyntaxTree.root()` red wrapping, and a red-node count. The flat
prototype only maps tokens to `{ kind, start, end }`; it does not provide
recovery nodes, diagnostics attached to green nodes, AST views, red
parent/offset context, or lossless edit operations. Heap MB is a process heap
delta, so it is useful for local trend checks but not a cross-machine or
cross-run absolute.

## Recommendation

No production flat-CST migration should land from this spike. In this local run
the prototype was not faster, and it also omits the parser contract that
`parser-design.md` requires: lossless green nodes, red views, deterministic
diagnostics, and recovery structure. The measured direction is still worth
preserving as future design input for incremental parsing storage, but W7-05b
should remain artifact-only until a follow-on task proves that a flat
representation can preserve `SyntaxTree.reconstruct()`, parser diagnostics, AST
views, and existing parser fuzz tests.
