# Wrela Ultimate World-Class Compiler Review

**Date:** 2026-07-04  
**Scope:** Full-codebase technical audit of `src/` (~235k lines, 1,038 files), `tests/` (~182k lines, 804 files), `stdlib/`, and `proof-model/`.  
**Goal:** Identify critical bugs, stubs, architectural bottlenecks, and optimization opportunities required to transform Wrela from a high-quality prototype into a production-grade, world-class optimizing and formally verified compiler.

---

## 1. Executive Summary & Architectural Philosophy

Wrela is a highly sophisticated, proof-carrying compiler compiling a resource-aware systems programming language to freestanding UEFI AArch64 PE/COFF images. Its design boasts advanced concepts such as:

- A Roslyn-style **Red/Green Syntax Tree** for high-fidelity source representation and trivia preservation.
- A **dominance-based static entailment proof-carrying pipeline** (`proof-mir` and `proof-check`) verifying linear resource obligations, terminal exits, and platform safety contracts.
- An **E-Graph-driven optimizer** (`opt-ir`) supporting whole-program monomorphization and SSA-based optimization passes.
- An **explicit fact-propagation cascade** in the AArch64 backend, ensuring security properties (no-spill, wipe-on-spill) are co-designed with physical register allocation.

However, against the standard of a **world-class, production-grade compiler**, several major technical debts, latent bugs, and incomplete subsystems remain. This review systematically exposes these gaps and provides a concrete engineering blueprint to resolve them.

---

## 2. High-Priority Correctness Hazards & Bugs

### 2.1 The Post-RA Pair-Load Peephole Facade

- **Location:** `src/target/aarch64/backend/finalization/peepholes.ts:15-40`
- **Severity:** P0 (Latent Miscompile)
- **Analysis:** The function `formAArch64PairLoadPeepholes` is an outright facade. It fires if and only if the schedulable instruction list has a length of exactly 2, and both opcodes are `"ldr"`. It performs **zero checks** on base registers, offsets, adjacency, or destination registers. Furthermore, the merged instruction simply clones the first instruction and sets the opcode to `"ldp"`, completely discarding the destination register and memory address of the second load.
- **Impact:** If this peephole pass were ever enabled in the production pipeline (currently it is only enabled in `tests/unit/target/aarch64/backend/post-ra-scheduler.test.ts`), any two consecutive loads would be merged into an invalid `ldp` instruction, silently dropping the second load's destination and causing immediate register corruption or wrong-code generation.
- **Production Remedy:** Delete `src/target/aarch64/backend/finalization/peepholes.ts:15-40` entirely. Real load/store pairing must be handled upstream by the dedicated, robust planner in `src/target/aarch64/plan/pair-load-store-planning.ts:1-371`, which correctly validates offset adjacency, alignment, and register compatibility.

### 2.2 LICM Preheader Hoisting Ignores Dependency Order

- **Location:** `src/opt-ir/passes/licm.ts:335-337` and `src/opt-ir/passes/licm.ts:402`
- **Severity:** P1 (SSA Def-Use Violation)
- **Analysis:** When Loop Invariant Code Motion (LICM) hoists invariant operations out of a loop, it filters the invariant operations and appends them to the preheader block in the order they appear in `loopOperationIds`. However, `loopOperationIds` is ordered by the program's basic block list order. If an invariant operation $A$ depends on the result of another invariant operation $B$, but $B$'s producer block is listed _after_ $A$'s block in the function's block list, the operations will be appended to the preheader in the order $[A, B]$.
- **Impact:** This creates an immediate SSA violation where a value is used ($A$) before it is defined ($B$). Although structured lowering might currently mask this by emitting dominators first, any future scheduler or inliner change that alters block layout will trigger catastrophic compiler crashes or silent miscompilations.
- **Production Remedy:** Prior to appending hoisted operations in `src/opt-ir/passes/licm.ts:402`, perform a topological sort on the hoistable operation set based on their intra-set def-use dependencies. This guarantees that definition operations always precede their uses in the preheader block.

### 2.3 CFG Simplification Silently Stops at Fuel Exhaustion

- **Location:** `src/opt-ir/passes/cfg-simplification.ts:40-48` and `src/opt-ir/passes/cfg-simplification.ts:107-108`
- **Severity:** P1 (Performance Cliff & Incomplete Optimization)
- **Analysis:** The `runCfgSimplification` pass runs for a maximum number of iterations defined by `fuel` (defaulting to 8). In each round, `simplifyOnce` invokes `coalesceOneLinearJumpBlock` and `mergeOneTrivialBlock`. As their names imply, these helper functions find and simplify **exactly one** block transition per call.
- **Impact:** If heavy inlining produces a chain of 10 or more linear jump blocks, the simplifier will exhaust its fuel of 8 and return a partially simplified CFG without raising any warning, logging any diagnostic, or signaling to the pipeline that optimization was incomplete. Furthermore, rebuilding the entire CFG edge and block maps on every single iteration to perform a single block merge results in $O(N^2)$ compilation complexity.
- **Production Remedy:** Redesign `coalesceOneLinearJumpBlock` and `mergeOneTrivialBlock` to perform a single, full-CFG sweep that collects all non-overlapping simplification candidates and applies them in a single pass. If fuel is exhausted, return an explicit `fuelExhausted` flag in `CfgSimplificationResult` so the pipeline can emit a diagnostic or dynamically adjust optimization budgets.

### 2.4 HIR Lowerer Synthesizes Neutral Values for Malformed AST Nodes

- **Location:** `src/hir/expression-lowerer.ts:156` (and lines `120`, `229`, `418`, `569`, `639`, `742`)
- **Severity:** P1 (Fail-Open Vulnerability)
- **Analysis:** During HIR lowering, the expression lowerer uses fallback nullish coalescing operators to synthesize neutral values when AST views return `undefined` for malformed nodes. For example:
  - `parseWrIntegerLiteral(text) ?? 0n` in `src/hir/expression-lowerer.ts:156`
  - `view.literalText() ?? ""` in `src/hir/expression-lowerer.ts:120`
  - `view.nameText() ?? ""` in `src/hir/expression-lowerer.ts:229`
- **Impact:** If a syntax recovery error allows a malformed or incomplete AST node to slip through to the HIR lowering phase, the compiler will silently synthesize constants like `0n` or empty strings `""` and proceed with compilation. This violates the "fail-closed" principle, leading to silent wrong-code generation instead of a hard compilation failure.
- **Production Remedy:** In all lowering paths within `src/hir/expression-lowerer.ts`, replace neutral value fallbacks with explicit generation of an `error` HIR expression kind (e.g., `errorExpression(context, origin, "malformed-node")`). Add a static analysis rule to `tests/audit/subsystem-maintainability-audit.test.ts` that bans the use of default literal fallbacks (`?? 0n`, `?? ""`) in the HIR lowering directory.

### 2.5 Fabricated ID Fallbacks (`0 as never`)

- **Location:** `src/mono/mono-external-roots.ts:22` (and `src/opt-ir/passes/sccp.ts:294`, `src/opt-ir/passes/sccp.ts:310`, `src/opt-ir/passes/sccp.ts:316`)
- **Severity:** P2 (Type Safety Violation & Phantom Entities)
- **Analysis:** The codebase contains several occurrences of `0 as never` or similar type-cast fabrications to manufacture IDs when expected data is missing. For example, in `src/mono/mono-external-roots.ts:22`, if origin records are empty, it falls back to `0 as never` for the `sourceOrigin`.
- **Impact:** This bypasses TypeScript's static analysis. If these paths are ever triggered, downstream compiler passes will consume a phantom entity with ID `0`, resulting in extremely subtle, non-deterministic, or completely silent failures in later stages (such as the linker or code generator).
- **Production Remedy:** Replace all `as never` value fabrications with explicit invariant throws or compiler-diagnostic emissions. Update the scar-tissue audit in `tests/audit/subsystem-maintainability-audit.test.ts` to ban the `as never` pattern across the entire `src/` directory.

### 2.6 Dual Module Import Discovery Ownership

- **Location:** `src/frontend/lexer/module-graph-lexer.ts:73` and `src/frontend/module-import-discovery.ts:1`
- **Severity:** P2 (Divergent Phase Invariants)
- **Analysis:** Wrela has two independent implementations for discovering module imports. The module loader uses a lightweight token-scanning approach (`ModuleGraphLexer`) that re-implements block structure approximation to find top-level `use` statements. The semantic analysis phase uses the formal AST-based parser (`module-import-discovery.ts`).
- **Impact:** Any divergence between how the token-scanner and the parser interpret block nesting or syntax recovery will cause the module loader to load a different set of files than the semantic analysis phase expects, resulting in confusing downstream diagnostics or missing dependency loads.
- **Production Remedy:** Unify module discovery. Since the compiler eventually parses every file, the module loader should lex and parse discovered files into CSTs immediately, extracting imports directly from the formal CST representation. This eliminates the duplicate token-scanning approximation entirely.

---

## 3. Stubs, Facades, and Incomplete Implementations

### 3.1 Greedy Linear Scan Allocator Gaps

- **Location:** `src/target/aarch64/backend/allocation/allocator.ts:30-223`
- **Severity:** High (Performance & Code Quality Debt)
- **Analysis:** The register allocator is a minimal greedy linear scan implementation. It lacks critical features of a production-grade allocator:
  1. **No Eviction:** It does not support evicting lower-weight active intervals to resolve register pressure; it relies entirely on a simple priority-based greedy assignment.
  2. **No Preferred-Register Hints:** It has no mechanism to bias register assignment toward caller/callee-saved registers or ABI-defined argument registers.
  3. **No Copy Coalescing:** It does not perform register coalescing to eliminate redundant move instructions.
- **Impact:** This results in massive, unnecessary move traffic (spill/reload and register-to-register moves) around function call boundaries, inflating the final binary size and significantly degrading runtime execution performance.
- **Production Remedy:** Upgrade the register allocator to support:
  - An active interval eviction mechanism based on spill-weight calculations.
  - Register-coalescing during liveness analysis to merge source and destination registers of move operations.
  - Allocation hinting to prefer assigning physical registers that match the ABI requirements of the use sites.

### 3.2 Skeletal Standard Library

- **Location:** `stdlib/wrela-std/`
- **Severity:** Medium (Usability & Feature Completeness)
- **Analysis:** The standard library consists of only 146 lines of code across 10 files. Core types like `Result` and `Validation` are represented as empty marker classes. `Option` is implemented as a flat struct with a boolean flag rather than a formal sum type.
- **Impact:** The toolchain cannot be used to write real-world, non-trivial applications or OS-level components because it lacks basic collections, string manipulation utilities, memory management primitives, or robust UEFI boot/runtime service bindings.
- **Production Remedy:** Implement proper sum-type representations in the frontend to support elegant algebraic data types (like `Option` and `Result`). Expand `stdlib/wrela-std` to include robust wrappers for UEFI boot services, memory allocation, and basic input/output.

### 3.3 Naive Move-Wide Immediate Range Check

- **Location:** `src/target/aarch64/backend/allocation/spill-remat.ts:176-178`
- **Severity:** Medium (Suboptimal Codegen)
- **Analysis:** The function `isMoveWideImmediate` is defined as `return value >= 0n && value <= 0xffffn;`. This restricts constant rematerialization during register pressure to values that fit within a bare 16-bit unsigned integer.
- **Impact:** AArch64 natively supports loading any 16-bit immediate shifted by 0, 16, 32, or 48 bits using `MOVZ`/`MOVK` instructions, as well as loading negative values via bitwise NOT using `MOVN`. By restricting rematerialization to `0..0xffff`, the compiler is forced to spill and reload larger constants from memory instead of rematerializing them in-place, increasing memory traffic and register pressure.
- **Production Remedy:** Implement a comprehensive immediate encoder check in `isMoveWideImmediate` that returns `true` for any 64-bit constant that can be represented via a single AArch64 `MOVZ`, `MOVN`, or shifted 16-bit immediate instruction.

---

## 4. Path to a World-Class Compiler Architecture

To elevate Wrela from a prototype to a world-class, production-ready compiler, the following architectural improvements must be implemented:

### 4.1 Transition to a Flat, Index-Based CST

- **Problem:** Currently, Red and Green syntax nodes are represented as individual heap-allocated JavaScript class instances (`GreenNode`, `RedNode`). For large-scale codebases, this creates millions of objects, causing massive memory overhead and garbage collection pauses.
- **Solution:** Transition to an index-based, flat-array CST representation (similar to modern production compilers like `rust-analyzer` or `swc`). Store all tokens, spans, and syntax kinds in contiguous `Uint32Array` buffers. Implement the Red tree as a transient, virtual view allocated on-the-fly only during active traversals.

### 4.2 Decouple Type-Checking from HIR Lowering

- **Problem:** Expression type-checking currently lives directly inside the HIR lowering pass (`src/hir/expression-lowerer.ts`). This couples AST-to-HIR translation with type inference and constraint resolution, making the lowerer extremely complex and difficult to maintain.
- **Solution:** Separate these concerns into discrete phases. Implement a dedicated type-inference and checking pass that operates on the AST or a lightweight untyped HIR, decorating the nodes with resolved types before proceeding to formal typed-HIR lowering.

### 4.3 Implement Parallel Compilation Pipeline

- **Problem:** The entire compiler pipeline (lexing, parsing, semantic checking, optimization, and codegen) runs sequentially on a single thread.
- **Solution:** Leverage Bun's worker pool capabilities to parallelize independent compilation units. Lexing and parsing of individual modules can be performed concurrently, as well as code generation and register allocation for individual functions once monomorphization is complete.

---

## 5. Test Suite and Release Infrastructure Audit

### 5.1 Expand Program-Level Integration Testing

- **Problem:** The test suite is highly comprehensive at the unit level (~5,000 passing unit tests), but extremely sparse at the integration and program level. There are only 9 end-to-end integration programs in the test corpus.
- **Solution:** Build a differential testing harness that feeds a large, synthetically generated corpus of valid Wrela programs into both the Wrela compiler and a reference interpreter, comparing their runtime execution results.

### 5.2 Mandatory CI and Release Gates

- **Problem:** While validation scripts like `verify:qemu` and `verify:lean` exist, they are not strictly gated or integrated into a mandatory CI pipeline.
- **Solution:** Establish a strict pull-request gate that runs:
  1. Full static type-checking (`tsc --noEmit`).
  2. Code formatting and linting checks (`oxfmt` and `oxlint`).
  3. The complete unit test suite (`bun test`).
  4. Full-image validation and QEMU boot smoke tests.
  5. Lean proof verification (`lake build Wrela`).

---

## 6. Conclusion & Prioritized Action Plan

To transition Wrela to a world-class compiler, we recommend executing the following phased remediation roadmap:

1. **Phase 1 (Immediate Correctness):**
   - Delete the buggy peephole facade in `src/target/aarch64/backend/finalization/peepholes.ts:15-40`.
   - Implement topological sorting for hoisted operations in `src/opt-ir/passes/licm.ts:402`.
   - Replace neutral fallback values in `src/hir/expression-lowerer.ts` with formal `error` HIR nodes.
   - Ban `as never` value fabrications across the codebase.

2. **Phase 2 (Performance & Optimization):**
   - Redesign CFG simplification to perform batch coalescing and merging in a single pass.
   - Expand `isMoveWideImmediate` in `src/target/aarch64/backend/allocation/spill-remat.ts:176-178` to support shifted 16-bit immediates.
   - Implement register eviction and copy coalescing in the register allocator.

3. **Phase 3 (Architecture & Usability):**
   - Transition the CST to a flat, index-based representation.
   - Decouple type-checking from HIR lowering.
   - Expand the standard library with proper sum types and robust UEFI service bindings.
