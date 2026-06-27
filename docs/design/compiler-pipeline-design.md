# Compiler Pipeline Design

## Purpose

The compiler should turn a `uefi image` declaration and its reachable modules
into one self-contained AArch64 `.efi` file. The final artifact contains the
whole image: project source, any reachable vendored or replacement standard
library source, compiler-owned runtime support, generated sections,
relocations, and PE/COFF headers. No external C runtime, C object files, system
linker, or foreign startup code participates in the build.

The compiler is still allowed to call UEFI firmware services. Those calls are
not outside C calls; they are direct ABI calls through firmware-provided
function pointers such as fields reached from the UEFI system table and boot
services. The compiler owns the entry thunk, ABI lowering, call instruction
selection, linking, relocation emission, and final PE/COFF image writing.

## Goals

- Compile a closed `uefi image` into one AArch64 PE/COFF `.efi` application.
- Keep parsing, semantic checks, proof checks, lowering, code generation,
  linking, and binary emission as separate modules with clear contracts.
- Preserve source spans and origin IDs through every semantic and proof layer so
  diagnostics remain source-level even when checks run on MIR/SSA.
- Use HIR for source-shaped meaning and MIR/SSA for path-sensitive checks where
  CFG and dominance make proofs easier.
- Treat the standard library as ordinary, replaceable source with no semantic
  privilege over project code.
- Keep compiler-owned authority narrow: explicit platform primitive contracts,
  target ABI lowering, generated entry thunks, code generation, linking, and
  image writing.
- Keep compiler back-end layers independent from language concepts such as
  `take`, `requires`, unique edge roots, or validated-buffer syntax.
- Use proof acceptance to create optimization authority: checked MIR plus a
  certified fact packet should lower into a separate OptIR designed for
  aggressive whole-image optimization.
- Use bounded, fact-aware local optimization policies in the production
  compiler instead of a global compile-time cost oracle.
- Keep optimization scoring as an opt-in test/development scorecard that audits
  OptIR and register-selection policy quality without participating in ordinary
  compile-time accept/reject decisions.
- Keep the binary spine independently testable while requiring the production
  compiler to pass the full semantic and proof pipeline before emitting trusted
  artifacts.

## Non-Goals

- The compiler does not call a platform C compiler, C linker, libc, CRT, or
  GNU-EFI-style support library.
- Incremental compilation is outside this design.
- Reusable object-file emission is outside the required `.efi` pipeline,
  although the compiler should have an internal object model.
- The compiler does not give its shipped standard library private capabilities,
  hidden lowerings, or bypasses around ordinary checks.
- The AArch64 backend does not treat aggressive optimization as a correctness
  boundary.
- The compiler does not lower the whole image for every optimization candidate
  and use a global score as the normal accept/reject rule.
- The optimization scorecard is not public runtime gas, not an exact cycle
  predictor, and not a production compile-time decision engine.
- The compiler does not require a generic target-independent LIR while AArch64
  is the only backend. OptIR is the optimization workbench; AArch64 machine IR
  is the target-lowering workbench.
- The proof engine should use a deterministic, bounded entailment model.
  Structural facts and interval/comparison reasoning are required; any solver
  extension must preserve deterministic certificates and diagnostics.

## Risk Register

The overall pipeline is conventional around an intentionally unconventional
middle. The back-end and binary plan is hard engineering, but it is known hard
engineering. The proof/resource system is the highest-risk and least-settled
part of the compiler.

Load-bearing risks:

- proof semantics are not yet specified as judgments, states, and entailment
  rules
- obligation/resource flow needs a sound story for moves, consumes, sessions,
  terminal discharge, private state threading, and every exit path
- uniqueness and borrowing need an explicit place/loan/session discipline,
  especially for `UniqueEdgeRoot`, `EdgePath`, and field-sensitive receiver
  access
- trusted primitives need an axiom boundary with preconditions and
  postconditions
- proof failures need user-facing diagnostics that explain a counterexample path
- validated-buffer proofs depend on representation and layout facts, which
  means serious proof checking should happen after monomorphization and layout
  facts exist
- the platform primitive boundary must be small and explicit enough that a
  replacement standard library cannot accidentally rely on compiler magic
- OptIR optimizations must preserve the authority of the checked fact packet;
  an optimization pass must not silently assume proof facts that were not
  certified or derived from certified facts by a checked pass invariant
- compile-time optimization policies must stay local and bounded; they must not
  grow into hidden whole-pipeline search
- local optimization heuristics can drift away from the offline scorecard unless
  debug/scorecard runs record decision logs and score bucket movement
- scorecard metrics can be overfit by pass-order search, threshold search, or
  ML-guided proposals unless reports include held-out cases, worst-regression
  gates, benchmark anchors when available, and human review

This document is the pipeline roadmap. It does not fully define the proof
calculus. A companion proof-semantics design should define the core resource
state, checking judgments, fact language, trusted axioms, and failure diagnostic
model before the production checker is treated as settled.

The optimization scorecard is defined separately in
`docs/design/opt-ir-cost-semantics-design.md`. This pipeline design treats that
scorecard as a development and test subsystem, not as part of production
compilation authority.

## End-To-End Shape

```text
Source files and package roots
  -> module graph lexer
  -> parser / CST
  -> AST views
  -> item index
  -> name resolution
  -> semantic surface checking
  -> typed HIR and proof-relevant surface
  -> monomorphized whole-image program
  -> representation and layout facts
  -> proof MIR / SSA
  -> proof and resource checks
  -> checked MIR with certified facts
  -> OptIR construction
  -> OptIR optimization
  -> AArch64 machine IR
  -> AArch64 machine code
  -> internal object model
  -> internal linker
  -> PE/COFF EFI writer
  -> one .efi file
```

Opt-in development tooling observes selected pipeline boundaries:

```text
representative optimization fixtures
  -> capture pre/post OptIR or register-selection artifacts
  -> OptimizationScorecard
  -> score reports, baselines, ablations, and policy-search recommendations
```

The scorecard is deliberately not in the production artifact path.

The important design rule is that checks should run at the layer where the
required information is clearest. HIR keeps source intent. Monomorphization and
layout make image-specific types and representation facts concrete. Proof MIR
gives a CFG, dominance, explicit values, and explicit exits. Later codegen
layers should see only already-proven executable behavior.

Checked MIR is the important proof boundary, not the optimizer's ideal working
format. After proof acceptance, the compiler lowers checked MIR plus its
certified fact packet into OptIR: a separate, rewrite-friendly representation
for whole-image optimization. OptIR may be target-selected and layout-aware, but
it should remain above physical registers, stack slots, instruction encodings,
and AArch64 calling-convention placement. For an AArch64-only compiler, OptIR
can lower directly to an AArch64-owned machine IR. A generic LIR should exist
only when multiple backends need a shared target-independent lowering point
below OptIR.

The standard library participates in this shape as source. The module graph may
load a default vendored stdlib, a user fork, or no stdlib at all. After module
loading, stdlib modules and project modules follow the same frontend, semantic,
HIR, proof, and codegen path.

Production optimization is driven by approved local policies. Those policies
may use certified bounds, noalias, layout, branch, effect, hotness, and local
register-pressure facts to choose among bounded alternatives. They must not
consult the offline scorecard, scorecard baselines, or benchmark data during
ordinary compilation. In debug and scorecard runs, policies should emit
decision logs so the scorecard can audit whether policy choices and score
bucket movement agree.

## Repository Shape

```text
src/
  frontend/
    lexer/
    syntax/
    parser/
    ast/
      index.ts
      ast-view.ts
      syntax-query.ts
      declaration-views.ts
      expression-views.ts
      statement-views.ts
      pattern-views.ts
      type-views.ts
    module-graph-parser.ts

  package/
    package-map.ts
    package-root.ts
    standard-library.ts

  semantic/
    index.ts
    ids.ts
    item-index/
      index.ts
      diagnostics.ts
      item-index.ts
      item-index-builder.ts
      item-records.ts
    names/
    types/
    image/
    kinds/
    diagnostics.ts

  hir/
    index.ts
    hir.ts
    hir-builder.ts
    hir-diagnostics.ts

  mir/
    index.ts
    mir.ts
    mir-builder.ts
    ssa.ts
    cfg.ts
    dominators.ts
    diagnostics.ts

  proof/
    facts.ts
    obligations.ts
    resource-flow.ts
    requirements.ts
    validation.ts
    terminal.ts

  checked-mir/
    index.ts
    checked-mir.ts
    certified-facts.ts
    checker-output.ts

  layout/
    type-layout.ts
    abi-layout.ts
    data-layout.ts

  mono/
    reachable-program.ts
    monomorphizer.ts

  opt-ir/
    index.ts
    program.ts
    cfg.ts
    values.ts
    regions.ts
    effects.ts
    certified-facts.ts
    vector-types.ts
    lower-checked-mir.ts
    passes/
      pipeline.ts
      proof-erasure.ts
      inlining.ts
      scalar-simplification.ts
      memory-optimization.ts
      vectorization.ts

  codegen/
    aarch64/
      machine-ir.ts
      lower-opt-ir.ts
      abi.ts
      instruction.ts
      instruction-selector.ts
      register-allocator.ts
      frame-layout.ts
      encoder.ts
      relocations.ts

  object/
    section.ts
    symbol.ts
    relocation.ts
    object-file.ts

  linker/
    linker.ts
    layout.ts
    relocation-application.ts

  binary/
    pecoff/
      pe-writer.ts
      coff-header.ts
      optional-header.ts
      section-table.ts
      base-relocations.ts

  runtime/
    support.ts
    memory.ts
    arithmetic.ts
    panic.ts

  target/
    uefi-aarch64/
      target.ts
      platform-primitives.ts
      entry-thunk.ts
      firmware-abi.ts
      image-writer.ts

  compiler/
    compile-image.ts
    pipeline.ts

scripts/
  optimization-score.ts

stdlib/
  wrela-std/
    core/
    target/
      aarch64/
      uefi/

tests/
  support/
    reference/
      reference-facts.ts
      reference-resource-flow.ts
      reference-layout.ts
      reference-linker.ts
      reference-mir-interpreter.ts
      reference-pe-reader.ts
  optimization/
    scorecard/
      optimization-score-runner.ts
      optimization-score-profile.ts
      score-number.ts
      score-report.ts
      opt-ir/
      register/
      fixtures/
      baselines/
```

## Standard Library And Platform Primitive Boundary

The standard library is replaceable source. The compiler may ship a convenient
default stdlib, and the CLI may vendor it into new projects, but the language
model must not depend on that stdlib having special authority.

Design rule:

```text
The standard library is ordinary Wrela source.

It may declare and wrap `platform fn` source declarations that match selected
target primitives, but it receives no private capabilities, no hidden lowering
behavior, no bypass of proof checks, and no privileged access to layout,
memory, target, firmware, or image operations.

Any operation the stdlib can perform must be expressible as:
  ordinary Wrela code
  plus calls to source-declared platform functions
  plus proof/type obligations checked against target primitive contracts.
```

That makes the shipped stdlib one library distribution rather than a trusted
compiler extension. If the Wrela language model and platform primitive
contracts are sound, users can build different stdlibs for different domains
without changing the compiler.

Examples:

```text
wrela-std-default
  ergonomic general-purpose library

wrela-std-uefi-minimal
  tiny boot/image library with little or no allocation

wrela-std-verified
  proof-first library with stronger APIs and heavier specifications

wrela-std-embedded
  device-specific memory, interrupt, and resource wrappers

company-internal-std
  domain-specific protocols, allocators, and platform policies
```

### Project Shape

`wrela init --target uefi-aarch64` can create a project that vendors the default
stdlib as source:

```text
project/
  wrela.toml
  src/
    image.wrela
  vendor/
    wrela-std/
      core/
      target/
        aarch64/
        uefi/
```

The first module resolver can keep stdlib pathing simple: vendored stdlib source
lives at ordinary source paths such as `std/...`, and imports resolve through
the same path-based module rules as project modules.

```text
source roots:
  project root containing app/ and std/

target:
  uefi-aarch64
```

The exact manifest syntax can evolve. The important contract is that source
path resolution is explicit compiler-edge configuration. It is not a semantic
privilege granted to a particular source tree.

### Resolver Contract

The module graph resolver sees source roots:

```text
project roots
  ordinary source files owned by the user's project

vendored stdlib paths
  ordinary source files checked into the project tree
```

Name resolution must not ask whether a module is "the real stdlib" to decide
whether an operation is allowed. A stdlib module, project module, or replacement
stdlib module may call the same platform function only by resolving the same
source declaration and satisfying the same type and proof obligations. The
platform function itself must match a selected target primitive by simple name.

```text
project module
  imports std.memory

default std module
  declares platform fn volatile_load_u32

replacement std module
  declares platform fn volatile_load_u32

all three callers:
  certify the source platform function signature and visible requirements
  prove the target primitive preconditions from the catalog
  receive the same target primitive lowering behavior
```

This makes authority capability-shaped rather than package-shaped. If a raw
firmware operation requires a firmware table handle, boot-services token, unique
device root, or validated memory fact, the caller must have that value and prove
the obligation. The compiler should not special-case the caller's package path.

### Platform Primitive Contracts

Platform primitives are the narrow trusted boundary. They are compiler-known
target entries with explicit signatures, proof obligations, and lowering rules.
Source reaches a primitive only through a freestanding `platform fn` declaration
whose simple name matches one primitive in the selected target catalog.

```text
PlatformPrimitive
  stable primitive ID
  simple name
  signature
  required facts
  consumed capabilities
  produced capabilities
  lowering contract
```

The compiler trusts the primitive contract and lowering, not the caller, not
the stdlib wrapper, and not the source `platform fn` declaration by itself. A
source platform function is an untrusted handle until a semantic certification
step proves that it exactly mirrors the selected target primitive's signature
and proof contract. Every call to a certified platform function should be
checked as a normal call with an explicit obligation edge into Proof MIR, using
the catalog contract as the authority.

Platform primitive certification is exact by default:

```text
source platform function
  simple name matches exactly one target primitive
  signature matches the catalog signature
  required facts match the catalog proof contract
  consumed and produced capabilities match the catalog proof contract
```

Source may state a provably stronger contract only if certification can prove
the stronger contract implies the target catalog contract. Source must never
weaken a primitive precondition, hide a consumed capability, invent a produced
capability, or override the lowering contract. If a source declaration is
wrong, the compiler rejects that declaration before HIR construction; it does
not reinterpret source text as the authority.

Freestanding platform declarations may appear in any source module, including a
replacement stdlib or a no-stdlib project module. Multiple source declarations
may bind the same primitive if each independently certifies against the same
catalog entry. Methods do not bind directly to target primitives; they wrap
freestanding platform functions as ordinary checked source:

```wr
class Register32:
    address: Address[u32]

    fn load(self) -> u32
        requires self.address.valid_for_read_u32
        requires self.address.aligned_for_u32:
            volatile_load_u32(self.address)
```

Future method-shaped platform declarations may be considered only as syntax for
a freestanding primitive call with `self` as the first argument. Target
primitive names remain globally unique simple identifiers, not dotted names and
not method-local names.

Target platform primitive families:

```text
memory
  volatile_load_u8/u16/u32/u64/usize
  volatile_store_u8/u16/u32/u64/usize
  raw_copy/raw_set if not inlined
  pointer_offset with bounds/layout obligations

arithmetic
  checked_add/sub/mul for concrete integer widths
  widening/narrowing conversions with explicit range obligations

target_aarch64
  barriers such as dmb_ish, dmb_ishst, dsb_sy, isb
  register or system operations that are valid in the target profile

target_uefi
  firmware call ABI helpers over explicit firmware function pointers
  status conversion primitives

image_runtime
  compiler-known entry capability initialization
  panic/abort lowering policy
```

The default stdlib should mostly wrap these families in safer, domain-shaped
APIs. Replacement stdlibs can choose very different wrappers or expose the
platform functions more directly.

## Typed HIR And Proof-Relevant Surface

HIR is the source-shaped, typed representation. It should still know language
constructs such as `take`, `requires`, `validated buffer`, `terminal fn`, and
`uefi image`, but it should be simpler and more regular than CST/AST views.

For Wrela, HIR is also the last source-shaped layer that fully understands the
language's proof-relevant surface. It does not prove path-sensitive resource
properties, but it must retain the semantic evidence that later whole-image
monomorphization and Proof MIR need. If HIR erases a `take` session, a
validated-buffer source relationship, a private-state transition, a consumed
receiver, or a platform primitive contract edge, no later phase should have to
recover that meaning from ordinary calls and blocks.

Semantic surface checking owns declaration-level checks that depend on resolved
names, target catalogs, source declaration shape, and early proof-surface seeds:

- item legality, such as where `platform`, `terminal`, `private`, and
  `predicate` functions may appear
- image declaration shape and device-section shape
- declared function parameter modes and receiver modes
- generic bounds and interface constraints before monomorphization
- type-reference validity and type-kind assignment
- validated-buffer section shape
- platform surface declaration rules, including freestanding-only primitive
  bindings
- platform binding certification before HIR accepts primitive contract edges
- source-level diagnostics that benefit from CST child identity

HIR consumes the checked semantic surface. It should not repeat those checks,
but it should assign proof IDs, lower source-shaped bodies, and preserve the
proof-relevant constructs that semantic surface checking identified.

HIR should not try to solve every path-sensitive property. It should instead
label the program with stable IDs and obligations that MIR can prove.

HIR should make these proof-relevant concepts explicit:

- resource-bearing places, including field-sensitive receiver places such as
  `self.rx` and `self.tx`
- resource kinds on values and types
- consume/observe/terminal parameter modes and receiver modes
- obligation IDs for opened `take` sessions, live buffers, validation/attempt
  inputs, terminal discharge obligations, and private-state transitions
- session and brand IDs for stream membership, edge/path provenance, validated
  buffers, and tokens minted from platform primitive operations
- call-site requirement IDs for `requires` clauses and platform primitive
  preconditions
- certified platform primitive binding IDs for calls that lower through target
  primitive contracts
- predicate and `ensure` fact origins, without attempting full dominance checks
- source spans and HIR origin IDs for every proof-relevant node

This makes HIR a proof-aware semantic surface, not a proof checker. Whole-image
monomorphization instantiates this metadata, layout adds representation facts,
and the Proof MIR checker performs the path-sensitive checks on explicit
control flow.

```text
HirFunction
  id
  signature
  body
  sourceSpan
  declaredEffects
  declaredRequirements

HirTake
  streamOrBufferExpression
  optionalBinding
  body
  openedObligationId

HirCall
  callee
  arguments
  callObligations
  consumes
  produces
```

## Why Some Checks Move To Proof MIR

Many of the language's hardest checks are control-flow questions:

- Was a value consumed before this use?
- Is every live linear obligation discharged on every exit path?
- Does `return`, `yield`, `continue`, or `?` cross a live obligation?
- Do predicate facts dominate the call site that relies on them?
- Does each `match` arm discharge or preserve obligations correctly?
- Does a private state token advance exactly along all paths?
- Does a terminal function reach a terminal discharge on every path?

These questions are awkward on HIR because HIR is nested syntax. They are easier
on Proof MIR because Proof MIR has basic blocks, explicit edges, explicit
temporaries, and explicit exits. SSA helps scalar facts by giving each value
one definition, but the deeper win is the CFG: resource and obligation checks
are mostly dataflow over explicit paths.

Example:

```text
block entry:
  source_len = field source.len
  has_two_bytes = ge source_len, 2
  branch has_two_bytes, ok, reject

block ok:
  facts:
    source.len >= 2
  call Packet.validate(source, limits)
```

The checker can ask whether the required fact dominates the call site. That is
cleaner than repeatedly walking nested `if` syntax.

## Monomorphized Proof MIR

The compiler should not wait until low-level codegen MIR to run proof checks.
It should build a typed, source-origin-preserving Proof MIR after the reachable
image program has been monomorphized and representation/layout facts are
available, but before destructive lowering.

```text
Typed HIR and proof-relevant surface
  -> image reachability
  -> monomorphized whole-image HIR
  -> representation and layout facts
  -> Proof MIR / SSA
  -> proof and resource checks
  -> Checked MIR with certified facts
  -> OptIR
  -> optimized OptIR
  -> AArch64 target lowering
```

Proof MIR keeps:

- source spans
- HIR origin IDs
- type IDs
- resource kind IDs
- obligation IDs
- borrow/session IDs
- call-site requirement IDs
- branch facts
- representation and layout facts needed by proof checks
- explicit exit edges

Proof MIR is in SSA form for scalar runtime values where dominance and def-use
matter, while memory, resources, loans, and obligations remain explicit flow
facts. Full memory SSA is a derived optimization analysis, not the semantic
proof representation.

Checked MIR should preserve scalar SSA where it helps optimization and codegen,
but it should not require full SSA for memory, resources, loans, or obligations
as a condition of correctness. Proof checking turns those proof-rich flows into
certified fact tables and executable effects. The target lowering can consume
the facts without carrying the full proof calculus forward as SSA.

Proof MIR should also be designed to produce post-check optimization facts, not
only an accept/reject answer. After proof checking, proof-only operations may be
erased, but the compiler should keep a checked fact packet for later lowering
and optimization. That packet should include ownership and alias facts, erased
proof-value facts, validated-buffer bounds and packet/source relationships,
private-state generation facts, platform primitive effect and capability facts,
terminal/exit closure facts, concrete layout and ABI facts, and origin maps back
to source/HIR/proof nodes. These facts are the main place where Wrela-specific
optimizations become available without making the back end understand the full
proof language.

Checked MIR and the certified fact packet are still not the optimization data
structure. Checked MIR is the certificate-carrying source of truth: it preserves
the accepted executable graph, proof-derived IDs, origins, and fact authority.
The optimizer should work on OptIR, a separate data structure derived from
checked MIR plus the fact packet. OptIR may discard proof-only operations,
normalize operations, choose explicit regions, introduce memory/effect SSA, and
reshape the graph aggressively, but every fact it exploits must be certified or
derived from certified facts by a checked pass invariant.

```text
MirFunction
  id
  parameters
  locals
  blocks
  edges
  sourceOrigin

MirBlock
  id
  parameters
  statements
  terminator
  incomingEdges

MirStatement
  Store
  Load
  Move
  Consume
  Call
  OpenObligation
  DischargeObligation
  RecordFactEvidence
  RequireFact
  BindLayoutTerm

MirTerminator
  Branch
  Match
  Return
  Yield
  Continue
  Unreachable

MirControlEdge
  fromBlock
  toBlock
  facts
  effects
  crossedScopes
```

## Check Placement

The split should stay flexible. A check belongs at the layer where it is easiest
to make correct and easiest to diagnose.

| Check                                     | Preferred Layer             | Reason                                           |
| ----------------------------------------- | --------------------------- | ------------------------------------------------ |
| package root selection                    | compiler edge               | filesystem/package config concern                |
| tokenization, grammar, recovery           | frontend                    | source preservation                              |
| declaration legality                      | HIR / semantic              | depends on source declarations                   |
| name resolution                           | semantic                    | builds stable references                         |
| type references and generic bounds        | semantic surface            | source-level types and declarations              |
| platform primitive signature availability | semantic surface            | compiler-owned target contracts                  |
| platform binding certification            | semantic surface            | source handles must exactly match target catalog |
| image device section shape                | semantic surface            | image-specific language meaning                  |
| ABI shape of public/platform functions    | layout / target             | target-specific representation                   |
| monomorphization completeness             | mono                        | whole-image reachability                         |
| validated-buffer layout shape             | HIR / layout                | declaration structure and concrete offsets       |
| layout-derived proof facts                | layout -> Proof MIR checker | proof checks need concrete representation facts  |
| use after move                            | Proof MIR checker           | path-sensitive resource flow                     |
| consume exactly once                      | Proof MIR checker           | path-sensitive resource flow                     |
| take-session closure                      | Proof MIR checker           | all exit paths are explicit                      |
| `?` crossing obligations                  | Proof MIR checker           | exceptional/control exits are explicit           |
| predicate fact availability               | Proof MIR checker / SSA     | dominance and fact propagation                   |
| `requires` call-site discharge            | Proof MIR checker           | facts are attached to values and CFG edges       |
| platform primitive call preconditions     | Proof MIR checker           | checked like ordinary call obligations           |
| terminal function closure                 | Proof MIR checker           | graph reachability over exits/calls              |
| validated-buffer requirement proofs       | Proof MIR checker           | path facts plus layout-derived facts             |
| stack frame correctness                   | codegen/layout              | target ABI                                       |
| relocation correctness                    | object/linker               | binary layout                                    |

If a HIR check starts building its own CFG, it probably belongs in MIR. If a MIR
check starts asking "what syntax form was this," HIR probably needs to attach a
better origin or obligation label.

## Proof Semantics Companion

This roadmap intentionally does not pretend the proof system is already solved.
The HIR, monomorphization, Proof MIR, and production checker should share a
companion design that specifies:

- the core resource state
- place and field-sensitivity rules
- move, consume, loan, transfer, and discharge judgments
- the fact language and entailment rules
- trusted axioms for platform primitive contracts, runtime support operations,
  raw memory, and generated validated-buffer operations
- small-step operational semantics for the proof-relevant core
- proof-failure diagnostics, including counterexample path reporting

That companion design is not a pipeline phase with its own compiler artifact.
It does not have to be fully mechanized as a prerequisite for implementation,
but HIR and Proof MIR should not be treated as settled until it is precise
enough that a reference checker and a production checker can disagree
meaningfully in tests.

The current Lean-derived compiler invariants are captured in
`docs/design/proof-derived-compiler-invariants.md`. Treat that document as the
minimum proof-relevant contract for future HIR, layout, Proof MIR, checker, and
diagnostic work.

The detailed Proof MIR builder contract is in
`docs/design/proof-mir-builder-design.md`.

Core scalar/control-flow type names such as `bool`, `u8`, `u16`, `u32`, `u64`,
`usize`, and `Never` are language builtins. They are resolved from a small core
type catalog in type position, not imported from stdlib and not supplied by a
prelude.

## Semantic Modules

### Source Modules And Platform Primitives

Source path selection happens at the compiler edge before the module graph is
loaded. Target selection also happens at the edge. The semantic layers receive
stable source module identities, the core type catalog, and the selected target
primitive catalog; they should not perform filesystem discovery.

```text
Compiler edge
  source root
  vendored stdlib source paths
  core type catalog
  selected target
  platform primitive catalog for selected target
```

The target primitive catalog does not contribute modules or item records. Source
`platform fn` declarations remain ordinary source items; name resolution sees
only the names-and-IDs projection of the selected target primitive catalog and
binds freestanding declarations to target primitives by matching simple
function names. Semantic surface checking consumes the full target primitive
catalog and certifies that the source declaration exactly matches the selected
target primitive contract before HIR may use the binding.

### AST Views

Typed AST views wrap red CST nodes. They do not copy source data or become the
compiler's source of truth. Their job is ergonomic access for semantic passes.

```text
ImageDeclarationView
FunctionDeclarationView
ClassDeclarationView
ExpressionView
TypeReferenceView
```

### Item Index

The item index assigns stable IDs to declarations across the module graph:

```text
ModuleId
ItemId
TypeId
FunctionId
ImageId
FieldId
ParameterId
```

This pass records declarations but does not resolve every reference.

### Name Resolution

Name resolution maps syntactic references to item IDs and binds platform
functions to target primitive IDs:

- imports
- source module paths
- module-qualified names
- type names
- function names
- fields and member names
- enum cases
- image devices
- core builtin type names in type position
- freestanding `platform fn` declarations backed by the selected target
  primitive name catalog

It should produce deterministic diagnostics and should not typecheck. It also
should not decide whether a caller or source declaration is trusted. A platform
binding is just a name-level source function to target primitive ID edge that
later passes must certify against the full target catalog and check.

### Semantic Surface Checking

Semantic surface checking groups type/resource checks, platform primitive
certification, and image-root checks into one semantic subsystem. The internal
subpasses should remain separately testable, but HIR should consume one checked
surface rather than independently revalidating declarations, platform
contracts, and image roots.

The type layer assigns types and resource kinds:

```text
Copy
Affine
Linear
UniqueEdgeRoot
EdgePath
Stream
ValidatedBuffer
PrivateState
SealedPlatformToken
Never
```

The exact lattice can evolve, but the compiler should represent resource kind
explicitly before flow checks begin.

The platform subpass certifies name-only platform bindings from name resolution
against the selected target's full primitive catalog before HIR may preserve a
platform primitive contract edge.

The image subpass starts from a `uefi image` declaration:

- find the image entry
- validate `devices:` entries
- mint unique edge root capabilities
- bind platform types such as firmware handles and machine devices
- build the closed image root for reachability

The output is a typed image root, not yet code.

The detailed design is in
`docs/design/semantic-surface-checking-design.md`.

## Monomorphization And Layout Before Proof

The compiler should monomorphize from the image root before serious proof
checking. Generic well-formedness and bounds can be checked earlier, but
path-sensitive resource proofs should run on the closed whole-image program.

```text
Image root
  -> entry functions
  -> reachable project and package modules
  -> reachable calls
  -> reachable types
  -> generic instantiations
  -> reachable platform primitive bindings
  -> closed monomorphized HIR
```

The result is a closed program with no unresolved polymorphism at the codegen or
proof boundary. Any unresolved polymorphism or unresolved source package here is
a compiler diagnostic. Platform functions remain source declarations, while
their certified target primitive bindings carry compiler-owned lowering IDs and
catalog-owned proof contracts.

Representation and layout facts are then computed for the monomorphized
program:

```text
type sizes
field offsets
enum representations
validated-buffer layout offsets
ABI parameter and return shapes
target pointer width and alignment
```

Validated-buffer wire layout also depends on source-level `le` and `be`
markers on multi-byte layout fields, for example `size: le U16 @ 0`. Parser,
AST, semantic surface, HIR, and monomorphization must preserve the checked wire
encoding before this phase computes layout facts.

Proof MIR consumes these facts. This ordering is important for validated-buffer
requirements such as `layout.fits`, derived field offsets, and ABI-sensitive
platform calls. A proof that depends on concrete representation should not run
before representation exists.

## MIR And Proof Modules

### CFG Builder

Lower each monomorphized HIR function into blocks. Structured HIR becomes
explicit branches, joins, and exits.

### SSA Builder

SSA covers scalar runtime values and proof facts where dominance and def-use
matter. Memory-cell SSA is not the semantic form. Resource tokens remain
explicit values or place operations with move/consume records.

### Fact Engine

Facts should have explicit roles and provenance:

- evidence facts produced by structural splits, match arms, validation results,
  and checker-accepted source constructs
- requirement facts demanded by calls, validation, terminal discharge, and
  target contracts
- trusted axioms imported only from certified platform or runtime catalogs
- candidate facts from source assertions, predicate calls, and syntactic
  comparisons awaiting proof-checker acceptance
- layout-backed facts such as validated-buffer bounds and `layout.fits`

Facts are scoped by dominance and invalidated by state-token advancement when
needed.

### Obligation Engine

Obligations model live resources:

- opened `take` sessions
- live readable/writable buffers
- validation/attempt inputs
- terminal discharge obligations
- private state transitions

The engine checks every exit edge from a block/function.

### Requirement Checker

Requirement checking runs at call sites. It asks whether facts available at the
call imply the callee's `requires` clauses. The production checker should prefer
structural matching and interval facts; any general solver must extend the same
certificate model rather than replace it.

## OptIR After Checks

Once Proof MIR is checked, lower checked MIR plus the certified fact packet into
OptIR. OptIR is the optimization workbench. It is not proof MIR, checked MIR, or
machine IR. Its job is to make both ordinary compiler optimizations and
Wrela-specific proof-powered optimizations easy to express and validate.

OptIR should contain:

- SSA runtime values with block arguments for scalar joins
- explicit memory regions, such as packet source, validated packet payload,
  stack local, image device, firmware table, runtime-owned memory, and constant
  data
- per-region memory SSA or effect tokens where they make reordering, forwarding,
  and dead-store elimination precise
- structured certified fact attachments imported from the checked fact packet
- canonical low-level operations: load, store, address arithmetic, field
  extraction/insertion, integer arithmetic, comparisons, calls, branches,
  switches, returns, panics, and traps
- layout-aware addresses with concrete offsets, sizes, alignments, endian
  conversions, ABI classifications, and field paths
- call effect summaries for source, runtime, and certified platform calls
- first-class vector types and vector operations, even before the vectorizer is
  implemented
- provenance links back to checked MIR, Proof MIR, HIR origins, layout facts,
  and source spans

Certified facts should be exposed through queryable pass APIs, not scattered as
opaque comments on operations. A pass should be able to ask whether two regions
alias, whether a byte range is proven in bounds, whether a load is volatile,
whether a platform call can write a region, whether a function is terminal, or
whether a proof-only value has no runtime representation.

The first OptIR lowering should erase proof-only operations only after proof
acceptance. It should preserve the facts that make erasure and optimization
valid:

- ownership, noalias, and field-disjointness
- zero-sized proof/resource values
- validated-buffer bounds and packet/source relationships
- concrete layout offsets, sizes, alignments, and endian markers
- private-state generation facts
- platform primitive preconditions, postconditions, and effect summaries
- terminal and `Never` reachability facts
- ABI classifications and call lowering constraints
- origin mappings for diagnostics, debug info, and optimization explanations

This gives later passes unusual authority. For example, a validated-buffer read
can lower to an ordinary load from a packet-source region with a certified
byte-range fact. A platform abstraction wrapper can inline away when its
contract says the effect boundary is unchanged. A move/copy helper can vanish
when ownership facts prove the transfer has no runtime work.

OptIR passes may contain local compile-time policies. A policy is allowed to
choose among a finite set of alternatives the pass already produced, such as:

- inline or keep a known call
- choose one unroll factor from a small set
- retain a branch or lower it to conditional dataflow
- hoist, remove, or retain a runtime check
- materialize a derived value or recompute it later

Those decisions may use certified facts and local estimates, but they are not a
global score search. They must not run the whole optimizer recursively, consult
scorecard baselines, or use host benchmark data during production compilation.
In debug or scorecard runs, an OptIR policy should emit a compact decision log:

```text
decision kind
chosen alternative
rejected alternatives
certified facts used
local feature vector
short explanation
```

The scorecard consumes those logs offline to audit whether policy choices
actually move the expected score buckets.

### OptIR Pass Pipeline

The initial pass order should be staged rather than all-at-once:

```text
Checked MIR + certified fact packet
  -> OptIR construction
  -> proof erasure and canonicalization
  -> mandatory semantic inlining
  -> cleanup
  -> budgeted whole-program inlining
  -> scalar simplification
  -> memory and region optimization
  -> vectorization and idiom lowering
  -> final cleanup
  -> AArch64 machine IR lowering
```

Mandatory semantic inlining should run early for abstractions that are expected
to disappear after proof acceptance:

- proof-only wrappers after obligations are discharged
- tiny validation and accessor helpers
- monomorphized generic wrappers
- newtype and resource wrapper shims
- functions whose only runtime purpose was to carry proof contracts
- single-call internal thunks
- platform abstraction wrappers whose certified effects match the wrapped
  primitive

Budgeted whole-program inlining should run after that cleanup. The image is
closed and monomorphized, so the inliner can use the whole call graph, but it
must still respect code size, recursive SCCs, loop nesting, cold paths, external
entry roots, device handlers, hardware callbacks, and platform/runtime effect
boundaries.

Inlining, vectorization, unrolling, and branch-lowering thresholds are ordinary
local policy inputs. Their values are reviewed compiler policy, not derived
from scorecard state during production compilation. Scorecard ablation and
search runs may recommend changes to those policies for human review.

Well-trod OptIR optimizations should include:

- constant folding and algebraic simplification
- sparse conditional constant propagation
- dead code and dead block elimination
- copy propagation
- global value numbering and common subexpression elimination
- branch and switch simplification
- loop invariant code motion
- dead store elimination
- load/store forwarding
- scalar replacement of aggregates
- stack promotion and mem2reg-style promotion
- escape analysis
- tail-position cleanup where ABI lowering permits it

Wrela-specific OptIR optimizations should include:

- proof erasure with no runtime trace
- bounds-check elimination from certified validated-buffer facts
- zero-copy packet and validated-buffer field views
- endian-aware field-load folding
- field-disjoint noalias from structured places
- ownership-proven move and copy elimination
- wrapper elimination after proof obligation discharge
- platform call specialization from certified preconditions
- terminal and `Never` reachability pruning
- private-state, session, and borrow artifacts erased into region facts
- firmware table access optimized through certified layout and provenance
- validated parser pipelines collapsed into direct loads, comparisons, and
  branches
- noalias-driven load/store motion across calls that ordinary C-style compilers
  would need to treat conservatively

### Auto-Vectorization

OptIR should be vectorization-ready from the start, but vectorization should be
a later optimization pass after scalar OptIR is stable. The first useful
vectorizer is likely SLP vectorization over straight-line packet and layout
code. Loop vectorization can come later.

Vectorization requires:

- vector value types such as `vector<u8, 16>` and `vector<u32, 4>`
- canonical loops with induction variables, trip counts, exits, and loop-carried
  values
- region-aware loads and stores
- per-load facts for bounds, alignment, aliasing, endian conversion, volatility,
  and provenance
- call and platform effect summaries
- target feature gates such as `aarch64.neon`, and later SVE only if the target
  profile supports it
- scalar epilogues, masked operations, or exact-multiple facts for tails

Vectorization must never rewrite volatile, MMIO, image-device, or firmware-table
access unless a platform contract explicitly permits that access pattern. It is
most natural for packet-source memory, validated-buffer payloads, stack regions,
runtime-owned memory, constants, checksums, byte scans, fixed-width arrays,
record validation, signature comparisons, and repeated scalar layout checks.

### AArch64 Lowering Boundary

OptIR lowers directly to AArch64 machine IR while AArch64 is the only backend.
The AArch64 backend owns physical target choices:

- register classes and virtual registers
- ABI argument and return locations
- stack frame objects
- instruction selection
- target-specific addressing modes
- vector instruction selection
- relocation references

Back-end layers should not need to know why a move was legal or why a bounds
check disappeared. They consume optimized OptIR plus preserved certified facts
and emit target-owned machine IR. A shared target-independent LIR should be
introduced only if a second backend creates repeated lowering logic below OptIR.

## Runtime Support

Runtime support operations are compiler-owned. They are not source-facing
intrinsic functions, an implicit standard library, or source modules with
special privileges. They may be emitted as:

- inline OptIR or AArch64 machine-IR expansions
- compiler-generated functions
- target-specific instruction sequences
- generated data or symbol references owned by the compiler

Runtime support operation families:

- memory copy / memory set if not inlined
- checked arithmetic helpers
- panic or abort policy
- UEFI status conversion
- UTF-16 string constants for firmware output
- small integer conversion helpers

The default stdlib may wrap these candidates in ordinary Wrela APIs, but the
wrapper is not trusted by the compiler. No runtime support operation may depend
on libc, compiler-rt, or external object files.

## AArch64 Backend

The AArch64 backend owns:

- target register set
- ABI classification for parameters and returns
- instruction selection
- register allocation
- stack frame layout
- prologue and epilogue generation
- branch relaxation if needed
- instruction encoding
- relocation generation

The AArch64 backend can be deliberately conservative:

- no global optimization in the backend; whole-image optimization belongs in
  OptIR
- simple linear-scan or local register allocation
- conservative stack slots
- direct calls and indirect calls
- integer/pointer operations before richer target-specific selection

UEFI firmware calls are indirect calls through loaded function pointers. The
compiler emits the call sequence according to the target ABI.

Register selection still needs local policy decisions. Examples include:

- coalesce or preserve a copy boundary
- split a live range at a local boundary
- spill, rematerialize, or keep a value live
- prefer caller-save or callee-save pressure near a call-heavy region
- choose one legal instruction form among a few AArch64 encodings

These are bounded production decisions, not scorecard queries. The register
pipeline should be deterministic, use stable tie-breakers, and expose
debug/scorecard logs for physical-register assignments, spill slots, live-range
split points, callee-save choices, copies, rematerializations, and allocation
churn. The optimization scorecard uses those logs to compare register-policy
variants offline and to flag fragile wins caused by allocation instability.

## Internal Object Model

Codegen should not write PE/COFF directly. It should emit an internal object:

```text
ObjectFile
  sections
  symbols
  relocations
  entrySymbol

Section
  name
  flags
  alignment
  bytes

Symbol
  name
  section
  offset
  linkage

Relocation
  kind
  section
  offset
  symbol
  addend
```

This keeps instruction encoding, linking, and binary writing independently
testable.

## Internal Linker

The linker owns:

- section ordering
- virtual addresses
- file offsets
- symbol resolution
- relocation application or relocation table creation
- dead code/data removal if monomorphization leaves anything unused
- entry symbol resolution

It produces a linked image layout that the PE writer can serialize.

## PE/COFF EFI Writer

The PE writer emits a PE32+ image suitable for AArch64 UEFI:

- DOS stub and PE signature
- COFF file header with AArch64 machine type
- PE32+ optional header
- EFI application subsystem
- section table
- `.text`, `.rdata`, `.data`, and `.reloc` as needed
- base relocation directory when the image contains relocations
- entry point RVA

The writer should be byte-level and deterministic. Tests should parse the
result back enough to validate header fields, section offsets, entry RVA, and
relocation table shape.

## UEFI AArch64 Target

The target module owns all UEFI/AArch64-specific constants and shims.

```text
target/uefi-aarch64
  image handle parameter
  system table parameter
  entry thunk
  firmware pointer types
  PE subsystem choice
  page/file alignment defaults
  relocation kinds
```

The language image entry should not have to manually spell the raw firmware
entry ABI. The target emits a compiler-owned entry thunk:

```text
efi_entry(image_handle, system_table)
  initialize compiler-known firmware value
  call image boot function
  convert result to EFI_STATUS
  return
```

## Implementation Sequence

Build the compiler in dependency order, following the same direction as the
pipeline. Each subsystem should leave behind a public contract and tests that
the next subsystem can consume.

The proof-semantics companion can be drafted in parallel with earlier
subsystems. It is supporting design for HIR, monomorphization, Proof MIR, and
the checker rather than a standalone implementation phase.

### 1. Source Frontend And Source Paths

- shared source text, spans, and diagnostics
- project manifest and explicit source path loading at the compiler edge
- vendored `std` source pathing for new projects and support for replacement
  source files
- core builtin type catalog
- selected-target platform primitive catalog
- lexer and module graph lexer
- parser and lossless CST
- module graph parser across loaded source paths

Output: parsed module graph with source-preserving CSTs for project, vendored,
and replacement stdlib source modules, plus combined frontend diagnostics.

### 2. AST Views And Item Index

- typed CST views for declarations, expressions, statements, and type syntax
- module IDs and item IDs
- declaration collection across the parsed module graph
- duplicate declaration diagnostics

Output: stable IDs for modules, declarations, functions, types, images, fields,
and parameters.

### 3. Name Resolution

- imports and module-qualified names
- source module paths, including vendored `std` source
- declaration scopes
- type names, function names, fields, enum cases, and image devices
- core builtin type names in type position
- freestanding `platform fn` declarations bound to selected target primitives
  by simple name as name-only platform bindings
- deterministic unresolved/ambiguous-name diagnostics

Output: CST/HIR-facing references resolved to item IDs, with no trust
distinction between project modules and stdlib modules, plus platform primitive
name-only bindings for source `platform fn` declarations.

### 4. Semantic Surface Checking

- type-reference validation
- generic parameters and bounds
- interface constraints
- resource kind assignment
- signature checking for parameters, receivers, returns, function modifiers, and
  platform declarations
- platform primitive signature checking and target-availability diagnostics
- platform binding certification that rejects missing, mismatched, non-exact, or
  non-freestanding target-bound platform declarations
- `uefi image` root selection
- `devices:` section validation
- unique edge root binding
- platform surface availability
- image entry shape

Output: typed declarations and signatures with resource kinds, proof-surface
seeds, certified platform primitive bindings, and a typed image
root/reachability seed.

### 5. Typed HIR And Proof-Relevant Surface

- lower AST views to typed, source-origin-preserving HIR
- preserve proof-relevant constructs such as `take`, `requires`, validation,
  attempt, terminal calls, private state transitions, and image/device origins
- preserve external entry roots with root reason, owner/function type arguments,
  and HIR origin
- assign stable obligation, session, brand, resource-place, and call-site
  requirement IDs
- retain resource kinds, parameter modes, receiver modes, certified platform
  primitive contract edges, predicate fact origins, and `ensure` fact origins
- make field-sensitive receiver access explicit enough for later place and loan
  tracking
- keep diagnostics source-level

Output: typed HIR for the reachable source program with proof-relevant metadata
that later phases instantiate and check.

### 6. Whole-Image Monomorphization

- start from the image root
- collect reachable functions and types
- include reachable project, vendored, replacement stdlib, and package modules
- instantiate generics
- instantiate proof-relevant HIR metadata such as resource kinds, obligation
  IDs, session/brand IDs, call-site requirements, and platform primitive contract
  edges
- retain instantiated external roots as `MonomorphizedHirProgram.externalRoots`
  with function instance ID, reason, and origin
- retain concrete resolved call targets on mono call expressions
- retain instantiated owner/function type arguments, or a canonical monomorphic
  edge key, on platform contract edges
- retain concurrency/cross-core proof metadata before exposing reachable
  cross-core constructs to Proof MIR
- retain reachable platform primitive IDs through platform function bindings
- reject unresolved polymorphism at the whole-image boundary

Output: closed monomorphized HIR plus reachable platform primitive IDs,
instantiated external roots, concrete call targets, and proof metadata needed by
Proof MIR.

### 7. Representation And Layout Facts

- type sizes and alignments
- field offsets
- enum representations
- validated-buffer layout offsets
- validated-buffer wire scalar encodings from `le` and `be` layout markers
- deterministic `readRequires`, derived-field case order, and layout-term arrays
- ABI parameter and return shapes
- target pointer width and alignment facts

Output: concrete layout and ABI facts for the closed program.

### 8. Proof MIR Builder

- lower monomorphized HIR to CFG blocks
- represent scalar values in SSA where useful
- lower into canonical-keyed draft records, then assign dense IDs in a final
  canonicalization pass
- preserve source origins, HIR origins, type IDs, resource kind IDs, obligation
  IDs, borrow/session IDs, and layout facts
- consume the selected target feature set and closed compiler-runtime catalog as
  explicit input, not host environment state
- make all exits explicit
- record explicit regions, edge effects, operand roles, and boundary-resource
  sets without running checker-owned resource-flow analysis
- keep enough value, place, block, and origin identity for proof checking to
  emit checked optimization facts after acceptance
- reject semantics-gated constructs when their proof-semantics rules or mono
  metadata are not yet available; gated yield, stream, and cross-core records are
  extension contracts, not always-on core unions

Output: Proof MIR for each monomorphized function.

### 9. Proof And Resource Checking

- fact propagation
- requirement entailment
- platform primitive precondition and postcondition checking from catalog-owned
  contracts
- move/use/consume checking
- take-session and validation/attempt obligations
- terminal closure
- private state threading
- field-sensitive place and loan tracking
- deterministic loop convergence, enabled-extension safety, fact entailment,
  terminal closure, and cross-core ownership judgments from the proof-semantics
  companion
- proof-failure diagnostics with counterexample paths
- emit a checked fact packet on success, including ownership/noalias facts,
  field-disjointness, erased proof/resource values, validated-buffer bounds,
  packet/source relationships, private-state generation facts, platform
  primitive effects and capability flow, terminal/exit closure facts, concrete
  layout/ABI facts, and origin mappings

Output: checked MIR with certified optimization facts, or proof diagnostics.

### 10. OptIR Construction And Optimization

- lower checked MIR plus the certified fact packet into a separate OptIR data
  structure designed for rewrites
- erase proof-only operations only after preserving the certified facts that
  make erasure safe
- normalize field access, enum cases, calls, branches, constants, layout terms,
  and validated-buffer reads into canonical OptIR operations
- model runtime values in SSA with block arguments
- model memory through explicit regions and, where useful, memory SSA or
  per-region effect tokens
- expose ownership/noalias, field-disjointness, bounds, layout, endian,
  volatility, terminal, platform-effect, and ABI facts through pass APIs
- preserve source, HIR, Proof MIR, checked MIR, and layout provenance for
  diagnostics, debugging, and optimization explanations
- run mandatory semantic inlining for proof wrappers, validation helpers,
  monomorphized generic shims, resource wrappers, single-call thunks, and
  contract-preserving platform wrappers
- run budgeted whole-program inlining over the closed monomorphized call graph,
  with special handling for recursive SCCs, code size, cold paths, loop nesting,
  external roots, callbacks, and platform/runtime effect boundaries
- run ordinary scalar and memory optimizations: constant folding, SCCP, DCE,
  GVN/CSE, copy propagation, branch simplification, LICM, dead-store
  elimination, load/store forwarding, scalar replacement, stack promotion, and
  escape analysis
- run Wrela-specific optimizations: move/copy elision from ownership facts,
  zero-copy validated-buffer reads, bounds-check elimination, endian-aware field
  load folding, parser pipeline collapse, terminal cleanup pruning, wrapper
  elimination, and platform call specialization
- keep vector-capable types and operations in OptIR, with SLP vectorization as
  the first likely vector pass and loop vectorization later

Output: optimized OptIR plus preserved certified facts and provenance.

### 11. OptIR To AArch64 Machine IR

- lower optimized OptIR operations to target-owned AArch64 machine IR
- select AArch64 scalar and vector instruction patterns from optimized OptIR
- lower ABI parameter and return handling into target-owned ABI locations
- lower optimized memory regions to stack frame objects, global symbols,
  firmware-table accesses, runtime-owned memory, or packet/source addresses
- preserve relocation references, symbol references, debug/source origins, and
  any certified facts still needed by late target passes
- defer a shared target-independent LIR until there is a second backend or a
  clear repeated lowering abstraction below OptIR

Output: AArch64 machine IR with virtual registers, symbols, frame objects, ABI
locations, concrete calls, branches, constants, and relocation references.

### Proof MIR Pipeline Extension Gates

The Proof MIR builder should not be implemented against guessed upstream data.
Before a production Proof MIR builder can accept the full language surface, the
existing pipeline must expose these contracts:

| Pipeline area             | Required extension                                                                                          |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| HIR mono-closure surface  | External entry roots preserve reason, type arguments, and origin                                            |
| Whole-image mono output   | `externalRoots` table with instantiated function instance IDs and root reasons                              |
| Whole-image mono output   | Concrete resolved call targets on every mono call expression                                                |
| Platform contract edges   | Instantiated owner/function type arguments or canonical monomorphic edge keys                               |
| Mono proof metadata       | Concurrency/cross-core operation metadata before cross-core constructs are accepted                         |
| Layout facts              | Deterministic `readRequires`, derived case order, and canonical layout-term arrays                          |
| Target/runtime selection  | Explicit target feature set plus closed runtime catalog from target/runtime authority passed into Proof MIR |
| Proof-semantics companion | Loop convergence, yield safety, fact entailment, terminal closure, and cross-core ownership rules           |
| Checked MIR fact packet   | Certified facts schema consumed by OptIR and AArch64 lowering                                               |

If any row is missing for a reachable construct, the owning earlier phase
should reject before Proof MIR when possible. If the missing contract is only
observable at the Proof MIR boundary, the builder emits a construction
diagnostic and returns `kind: "error"`.

### 12. AArch64 Backend

- ABI classification
- instruction selection
- register allocation
- stack frame layout
- AArch64 instruction encoding
- relocation generation

Output: internal object code for AArch64.

### 13. Internal Object Model And Linker

- sections
- symbols
- relocations
- section layout
- symbol resolution
- relocation application or relocation table creation
- entry symbol resolution

Output: linked image layout.

### 14. PE/COFF EFI Writer

- PE32+ headers
- AArch64 COFF machine type
- EFI application subsystem
- section table
- data directories
- base relocation directory
- entry point RVA

Output: one `.efi` file.

### 15. UEFI AArch64 Target Driver

- compiler-owned UEFI entry thunk
- firmware ABI lowering
- image handle and system table handling
- UEFI status conversion
- QEMU/OVMF smoke tests

Output: a UEFI AArch64 image that can be run under firmware.

### 16. Optimization Scorecard And Policy Auditing

- add opt-in `optimization:score` development command outside the default
  `agent:check` path
- capture representative pre/post OptIR artifacts and pre/post register
  selection artifacts
- implement deterministic `OptIrScore` and `RegisterScore` vectors in the test
  and development suite
- record local policy decision logs in debug and scorecard runs, including
  alternatives, certified facts used, local features, and explanations
- define representative input shapes for input-sensitive fixtures instead of
  hiding all behavior inside one averaged case
- compare score buckets against local policy concordance declarations so policy
  internals and scorecard vocabulary do not drift
- track allocation churn and register-score stability for register-policy
  comparisons
- keep score baselines versioned by score schema, feature extractor, and score
  profile
- support ablation, threshold sweep, pairwise interaction, and pass-order
  comparison runs as offline recommendations only
- report worst-case regressions, expectation failures, code-size movement,
  compile-time movement, and benchmark anchors when available

Output: opt-in optimization score reports, baselines, and policy-audit data
that inform human-reviewed compiler policy changes without becoming production
compile-time authority.

### 17. Full Image Validation

- compile representative `uefi image` programs
- compile with the default vendored stdlib
- compile with a tiny replacement stdlib that declares and wraps the same
  platform primitives
- compile a no-stdlib program that declares required `platform fn` boundaries
  directly where allowed
- run parser/semantic/proof/OptIR/codegen integration tests
- run binary structure checks
- run QEMU/OVMF smoke tests
- compare selected high-risk subsystems against reference checkers

Output: confidence that a `PacketCounterImage`-style program compiles into one
self-contained `.efi`.

## Differential Testing Strategy

A robust test suite is the main correctness tool. The compiler should not grow a
second full implementation. Instead, selected high-risk algorithmic modules
should have boring, correct, and slow reference checkers used by tests to
amplify coverage.

The rule of thumb:

```text
normal unit/integration/property tests everywhere
+ small reference checkers only where expected-output tests are weakest
```

This keeps the design honest. Parser shape, AST views, simple declaration
legality, and public API plumbing should be tested directly. They do not need
reference implementations. Differential tests are most valuable where many
small generated cases can expose subtle algorithmic mistakes.

Reference mismatches are not user diagnostics. They are compiler bugs found by
the test suite or by an optional debug-check mode.

### Selected Reference Boundaries

| Boundary                             | Optimized Implementation     | Reference Checker                                          | Why It Is Worth It                                |
| ------------------------------------ | ---------------------------- | ---------------------------------------------------------- | ------------------------------------------------- |
| Proof MIR facts                      | SSA/dominance fact engine    | monotone worklist over blocks until fixed point            | fact propagation bugs are subtle                  |
| resource flow                        | optimized obligation checker | small-state path interpreter with widening limits          | catches use-after-move and missing discharge bugs |
| requirement checks                   | fact entailment engine       | structural matcher over available facts and intervals      | expected-output tests are too sparse              |
| layout                               | cached layout engine         | direct recursive size/alignment calculator                 | catches ABI/layout drift                          |
| MIR lowering for small pure programs | lowering pass                | HIR/MIR interpreter comparison                             | catches semantic-preservation bugs                |
| OptIR lowering and optimization      | OptIR pass pipeline          | checked-MIR/OptIR interpreter comparison on small programs | catches invalid proof-powered rewrites            |
| AArch64 encoding                     | encoder                      | golden tables and decode/round-trip checks where practical | byte encoding mistakes are easy to miss           |
| linker layout                        | linker                       | slow section/symbol/relocation validator                   | catches address and relocation bugs               |
| PE writer                            | PE writer                    | independent PE reader and structural validator             | catches malformed `.efi` headers                  |

This list should stay short. If a reference checker becomes as complex as the
optimized implementation, shrink it, delete it, or replace it with more direct
tests.

### Proof MIR Reference Checker

The Proof MIR resource-flow checker is the strongest candidate for a reference
implementation. It should intentionally be simple:

```text
for each function:
  start with initial resource state at entry
  walk every feasible edge up to a widening limit
  clone state at branches
  merge states at joins only when they agree or can be widened
  report a differential-test failure if optimized checker accepts a path the reference rejects
  report a differential-test failure if optimized checker rejects a path the reference accepts
```

For small generated programs, the reference checker can enumerate paths exactly.
For real programs, it may use a conservative widening limit and only check
functions under a size threshold. That is still valuable because most checker
bugs appear in small control-flow shapes first.

Resource state should be explicit and boring:

```text
ReferenceResourceState
  valueStates: Map<ValueId, Available | Moved | Consumed>
  obligations: Map<ObligationId, Open | Discharged | Transferred>
  facts: Set<ReferenceFact>
  privateStates: Map<StateTokenId, CurrentGeneration>
```

This checker should be direct and deterministic. It validates reference
semantics over small programs rather than reusing optimizer-oriented SSA
machinery.

### Interpreter Differential Tests

The compiler should eventually have interpreters for small programs at two
levels:

- HIR or typed HIR interpreter for pure/source-shaped fragments
- MIR interpreter for checked MIR
- OptIR interpreter for optimized pure fragments and fakeable runtime effects

For snippets without firmware effects, both interpreters should produce the
same result. For UEFI-oriented snippets, tests can provide a fake firmware table
with deterministic function pointers and observable calls.

```text
source snippet
  -> typed HIR interpreter result
  -> MIR interpreter result
  -> optimized OptIR interpreter result
  -> compare value result and observable effects
```

This is especially useful before the AArch64 backend is mature. Later, tiny
programs can also be compared against an AArch64 emulator or instruction-level
simulator, but that should be a later testing layer.

### Binary Reference Validators

The binary spine should use structural reference validators:

- AArch64 instruction encoders get table-driven golden tests and decode/round
  trips where practical.
- The linker gets a slow validator that recomputes symbol addresses, section
  ranges, and relocation targets from first principles.
- The PE writer gets an independent PE reader that parses emitted bytes and
  validates all header offsets, RVAs, alignments, section ranges, and relocation
  blocks.

These validators should not rely on the writer's own internal data structures
after serialization. Parse the bytes back.

### Optimization Scorecard Tests

The optimization scorecard is a development score suite, not a correctness
oracle and not a default compile phase. Its infrastructure should still have
ordinary unit tests:

- fixed-point score arithmetic is deterministic
- score bucket aggregation is canonical
- lower scores compare as improvements
- positive score credits are capped more aggressively than regressions
- worst-case regressions remain visible in suite summaries
- local policy decision logs preserve alternatives, certified facts, feature
  vectors, and explanations
- input shapes are reported separately before aggregation
- register allocation churn and stability probes are reported for register
  policy comparisons
- score schema, feature extractor, and profile changes invalidate or explicitly
  rebaseline score baselines

The expensive representative corpus should run through an opt-in command such
as `bun run optimization:score`, not as part of ordinary `agent:check`.

### Certificates And Traces

Optimized checkers should be able to emit a small proof trace or certificate in
test/debug mode. A reference validator can validate the trace instead of
reverse-engineering all internal decisions.

Examples:

```text
RequirementCheckTrace
  callSite
  requiredFact
  factsUsed
  entailmentRule

ResourceFlowTrace
  function
  exitBlock
  liveObligationsBeforeExit
  dischargeActions

LayoutTrace
  typeId
  fields
  offsets
  size
  alignment
```

Trace validation is optional and test-only. The production compiler must not
depend on trace generation for correctness.

### Reference Checker Placement Rules

- Put a reference checker at a stable representation boundary, not inside every
  helper.
- Prefer Proof MIR for path-sensitive language checks.
- Use direct tests for source-shaped HIR checks unless a real algorithmic risk
  appears.
- Keep binary validators byte-oriented after serialization.
- Use fake firmware tables for interpreter tests instead of host calls.
- Keep reference checker code dependency-free and deterministic. Property
  generators may use test-only dependencies, but reference checkers must not.
- Never use a differential-test mismatch as a user-facing semantic diagnostic.

The structure should make it safe to improve optimized implementations later.
If a fast dominance-based proof checker, layout cache, register allocator, or
linker optimization changes behavior, targeted differential tests should catch
it before a bad `.efi` is emitted.

## Testing Strategy

- Unit tests for every value object, IR builder, fact engine, layout algorithm,
  OptIR pass, encoder, relocation, linker, and PE writer.
- Integration tests at each pipeline boundary.
- Golden byte tests for tiny AArch64 instruction sequences.
- PE header round-trip tests that parse emitted bytes.
- QEMU/UEFI smoke tests once binary emission exists.
- Property tests for CFG invariants, SSA dominance, relocation bounds, and
  deterministic output.
- Unit tests for optimization score arithmetic, reports, baseline schema
  handling, and policy-decision log extraction.
- Integration tests that compile equivalent programs through default stdlib,
  replacement stdlib, and direct platform-function wrappers where the language
  permits.
- Opt-in optimization scorecard runs over representative OptIR and register
  selection fixtures.
- Negative tests proving stdlib modules cannot bypass platform primitive
  preconditions, resource checks, target availability, or layout obligations.
- Negative tests proving source `platform fn` declarations cannot weaken target
  primitive contracts or bind as methods.
- Targeted differential tests for Proof MIR facts/resource flow, requirement
  entailment, layout, MIR lowering on small pure programs, OptIR lowering and
  optimization, linker layout, and PE validation.

Required invariants:

```text
CST reconstructs source exactly.
HIR nodes keep source origins.
Project modules and stdlib modules follow the same semantic rules.
Replacement stdlibs can declare and wrap the same platform primitives as the
default stdlib.
No source module can redefine a target primitive contract; it can only declare a
matching `platform fn` binding.
Source `platform fn` declarations are untrusted handles until certified against
the selected target primitive catalog.
Methods wrap certified freestanding platform functions; they do not bind
directly to target primitives.
MIR blocks have valid terminators.
SSA values have one definition.
OptIR preserves checked MIR observable behavior and consumes only certified or
pass-derived facts.
OptIR never vectorizes volatile, MMIO, image-device, or firmware-table access
without an explicit platform contract allowing that access pattern.
Local optimization policies choose only among bounded alternatives already
produced by a pass.
Production compilation never consults optimization scorecard baselines or
benchmark data while deciding ordinary optimization alternatives.
Scorecard runs are opt-in and emit evidence for human-reviewed policy changes;
they do not automatically enable, disable, or reorder production optimizations.
Register-policy scorecard comparisons report allocation churn and worst-case
regressions, not only average score movement.
Every live obligation is discharged or intentionally transferred on each exit.
Linked symbols resolve exactly once.
Relocations point inside valid sections.
PE headers point to valid file ranges.
Repeated builds produce identical bytes for identical inputs.
```

## Design Defaults

- Keep HIR checks when source-level meaning is clearer.
- Move checks to Proof MIR when control flow, dominance, or path sensitivity is
  the core problem.
- Keep proof MIR before destructive lowering.
- Preserve checked proof-derived facts after proof-only operations are erased.
- Treat checked MIR as the proof boundary and OptIR as the optimization
  workbench derived from checked MIR plus certified facts.
- Keep OptIR above physical target choices such as registers, stack slots,
  instruction encodings, and ABI location assignment.
- Skip a generic LIR while AArch64 is the only backend; introduce one only when
  repeated target-independent lowering below OptIR appears.
- Prefer staged whole-program inlining: mandatory semantic inlining first,
  budgeted call-graph inlining after cleanup.
- Make OptIR vectorization fact-gated and target-feature-gated, with SLP before
  general loop vectorization.
- Use bounded, fact-aware local policies for compile-time optimization choices.
- Keep the optimization scorecard outside production compile-time authority.
- Use scorecard runs to audit and tune OptIR and register-selection policies
  through human-reviewed changes.
- Keep scorecard baselines versioned by schema, extractor, and profile so
  optimizer movement is distinguishable from measurement movement.
- Report input-sensitive optimization behavior through separate scorecard input
  shapes.
- Treat scorecard search and ML recommendations as offline evidence that needs
  benchmark anchors or explicit score-only labeling.
- Keep the back end ignorant of language obligations.
- Treat the standard library as source, not compiler authority.
- Make platform primitive contracts explicit, target-gated, certified before
  HIR, and checked at every call site.
- Keep target-bound `platform fn` declarations freestanding; use ordinary
  source methods as wrappers.
- Resolve source paths at compiler edges and keep filesystem access out of
  semantic layers.
- Keep the binary spine independently testable, while production artifact
  emission remains gated on the full semantic and proof pipeline.
- Prefer small target-owned ABI abstractions over scattered target constants.
- Treat the robust test suite as the main correctness mechanism.
- Add reference checkers only for high-risk algorithmic boundaries where they
  make tests stronger without becoming a second compiler.
- Keep external specifications as tests and constants near the target and PE
  writer, not embedded throughout semantic layers.

## References

- Optimization scorecard details:
  `docs/design/opt-ir-cost-semantics-design.md`
- UEFI Specification: image loading, image entry, system table, and AArch64 UEFI
  behavior: <https://uefi.org/specs/UEFI/2.10/02_Overview.html> and
  <https://uefi.org/specs/UEFI/2.10/04_EFI_System_Table.html>
- PE/COFF format reference:
  <https://learn.microsoft.com/en-us/windows/win32/debug/pe-format>
- Arm AArch64 procedure call standard:
  <https://github.com/ARM-software/abi-aa/blob/main/aapcs64/aapcs64.rst>
