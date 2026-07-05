# Parallel Compilation Design

## Scope

This W7-06a design is for a future implementation. It does not change the
current single-process package pipeline in `src/target/uefi-aarch64` or the
local gates in `package.json`.

## Worker Boundaries

Bun workers may own coarse deterministic units:

| Boundary         | Worker input                                    | Worker output                               | Shared authority                            |
| ---------------- | ----------------------------------------------- | ------------------------------------------- | ------------------------------------------- |
| Parse module     | module key, source text, source fingerprint     | CST artifact, parse diagnostics             | `src/frontend/lexer`, `src/frontend/parser` |
| Semantic module  | parsed module artifact, import graph snapshot   | checked semantic artifact, diagnostics      | semantic target surface fingerprints        |
| Proof function   | checked MIR/proof-MIR function key, fact packet | proof verdict, certified facts, diagnostics | proof resource limits and target contracts  |
| Backend function | OptIR function key, backend target fingerprints | machine/object contribution, diagnostics    | AArch64 backend target surface              |
| Link/package     | sorted object contributions                     | final image artifact, diagnostics           | linker and PE/COFF target policies          |

Workers must receive immutable serialized inputs with explicit fingerprints.
They must not read project files directly; filesystem access stays at compiler
edges, matching the existing full-image validation source-authority split in
`src/validation/full-image/source-authority.ts`.

## Deterministic Diagnostic Merge

Each worker returns diagnostics with the existing stable fields: `code`,
`ownerKey`, `stableDetail`, and source/order metadata where available. The main
thread is the only place that merges diagnostics:

```ts
function mergeDiagnostics(workers: readonly WorkerResult[]): readonly Diagnostic[] {
  return workers.flatMap((worker) => worker.diagnostics).sort(compareDiagnosticsDeterministically);
}
```

`compareDiagnosticsDeterministically` must sort by source/module key, span
start, span end, diagnostic code, owner key, root cause key, and stable detail.
This mirrors the deterministic sorting already used by parser diagnostics in
`src/frontend/syntax/syntax-tree.ts` and OptIR diagnostics in
`src/opt-ir/diagnostics.ts`.

## Artifact Ordering

Parallel workers may finish in any order, but artifacts enter the next stage in
canonical order:

| Artifact             | Canonical order                                        |
| -------------------- | ------------------------------------------------------ |
| Modules              | module graph topological order, then module key        |
| Functions            | monomorphized function instance ID order               |
| Proof facts          | certified fact subject key, fact kind, stable detail   |
| Object contributions | section order, alignment, symbol key, contribution key |
| Final diagnostics    | deterministic diagnostic comparator                    |

No worker may allocate globally visible IDs from wall-clock or completion
order. ID allocation must happen before dispatch from stable traversal lists or
after merge from sorted artifact keys.

## Follow-On Work

The first implementation task should parallelize parse-only module work behind
a feature flag and prove byte-identical diagnostics and artifact ordering
against the current serial path. Backend and proof workers should wait until the
miscompile-confidence fixture differential and callee-saved preservation lanes
are stable.
