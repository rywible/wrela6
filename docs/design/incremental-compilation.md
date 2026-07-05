# Incremental Compilation Design

## Scope

This W7-06b design specifies cache keys only. It does not implement an
incremental compiler and does not change the closed-image build described in
`docs/design/compiler-pipeline-design.md`.

## Fingerprint Lattice

The repo already treats fingerprints as compiler authority boundaries:
`src/semantic/surface/deterministic-sort.ts` provides stable ordering,
`src/target/uefi-aarch64/target-driver-surface.ts` fingerprints target
surfaces, and backend/linker tests assert fingerprint stability. Incremental
keys should compose those existing fingerprints instead of inventing
mtime-based invalidation.

| Cache              | Key                                                                                             | Value                                                  | Invalidated by                                         |
| ------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------ |
| Parse cache        | module content hash -> parse cache                                                              | lexer tokens, CST, parse diagnostics                   | source text, lexer version, parser version             |
| Module graph cache | package root fingerprint + module request map                                                   | resolved graph, cycle diagnostics                      | source imports, resolver policy, stdlib root           |
| Semantic cache     | parse fingerprint + imported semantic surface fingerprints + target semantic fingerprint        | checked declarations, semantic diagnostics             | source shape, imports, target surface                  |
| Proof cache        | checked MIR fingerprint + proof-MIR fingerprint + proof resource policy fingerprint             | proof verdicts, certified fact packet                  | MIR/proof lowering, resource limits, trusted contracts |
| OptIR cache        | certified fact packet fingerprint + target driver surface fingerprint                           | unoptimized OptIR program and construction diagnostics | proof facts, target lowering contracts                 |
| Backend cache      | OptIR function fingerprint + backend target surface fingerprint + allocation policy fingerprint | object contribution, backend diagnostics               | OptIR, register model, ABI/frame catalogs              |
| Link cache         | sorted object contribution fingerprints + linker/PE policy fingerprints                         | linked layout and PE/COFF bytes                        | object bytes, section policy, PE writer policy         |

## Rules

Cache keys must include:

- the source or artifact content fingerprint
- the compiler stage version or policy fingerprint
- every imported authority fingerprint used by the stage
- the target surface fingerprint when target-specific lowering is involved

Cache keys must not include:

- file modification time
- worker completion order
- unsorted JSON
- process ID, temp path, or wall-clock time

## First Implementation Lane

Start with parse cache only. The acceptance test should parse the same module
twice, assert identical `SyntaxTree.reconstruct()` and diagnostics, then change
one byte and assert a different module content hash. Semantic, proof, backend,
and link caches should remain separate follow-on tasks because each crosses a
different authority boundary.
