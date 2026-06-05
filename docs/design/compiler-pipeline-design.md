# Compiler Pipeline Design

## Purpose

The compiler should turn a `uefi image` declaration and its reachable modules
into one self-contained AArch64 `.efi` file. The final artifact contains the
whole image: project source, any reachable vendored or replacement standard
library source, compiler-owned runtime intrinsics, generated sections,
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
- Keep compiler-owned authority narrow: explicit intrinsic contracts, target ABI
  lowering, generated entry thunks, code generation, linking, and image writing.
- Keep compiler back-end layers independent from language concepts such as
  `take`, `requires`, unique edge roots, or validated-buffer syntax.
- Make early binary milestones possible before the full language checker is
  complete.

## Non-Goals

- The compiler does not call a platform C compiler, C linker, libc, CRT, or
  GNU-EFI-style support library.
- The compiler does not initially need incremental compilation.
- The compiler does not initially need to emit reusable object files, although
  it should have an internal object model.
- The compiler does not give its shipped standard library private capabilities,
  hidden lowerings, or bypasses around ordinary checks.
- The first AArch64 backend does not need aggressive optimization.
- The first proof engine does not need a general SMT solver. Structural facts
  and interval/comparison reasoning are enough to start.

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
- the intrinsic boundary must be small and explicit enough that a replacement
  standard library cannot accidentally rely on compiler magic

This document is the pipeline roadmap. It does not fully define the proof
calculus. A companion proof-semantics design should define the core resource
state, checking judgments, fact language, trusted axioms, and failure diagnostic
model before the production checker is treated as settled.

## End-To-End Shape

```text
Source files and package roots
  -> module graph lexer
  -> parser / CST
  -> AST views
  -> item index
  -> name resolution
  -> type and kind checking
  -> image graph checking
  -> typed HIR and proof-relevant surface
  -> monomorphized whole-image program
  -> representation and layout facts
  -> proof MIR / SSA
  -> proof and resource checks
  -> checked MIR
  -> low-level IR
  -> AArch64 machine code
  -> internal object model
  -> internal linker
  -> PE/COFF EFI writer
  -> one .efi file
```

The important design rule is that checks should run at the layer where the
required information is clearest. HIR keeps source intent. Monomorphization and
layout make image-specific types and representation facts concrete. Proof MIR
gives a CFG, dominance, explicit values, and explicit exits. Later codegen
layers should see only already-proven executable behavior.

The standard library participates in this shape as source. The module graph may
load a default vendored stdlib, a user fork, or no stdlib at all. After module
loading, stdlib modules and project modules follow the same frontend, semantic,
HIR, proof, and codegen path.

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
    intrinsic-root.ts

  semantic/
    index.ts
    ids.ts
    item-index/
      index.ts
      diagnostics.ts
      intrinsic-catalog.ts
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

  layout/
    type-layout.ts
    abi-layout.ts
    data-layout.ts

  mono/
    reachable-program.ts
    monomorphizer.ts

  lir/
    lir.ts
    lower-mir.ts

  codegen/
    aarch64/
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
    intrinsics.ts
    memory.ts
    arithmetic.ts
    panic.ts

  target/
    uefi-aarch64/
      target.ts
      entry-thunk.ts
      firmware-abi.ts
      image-writer.ts

  compiler/
    compile-image.ts
    pipeline.ts

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
```

## Standard Library And Intrinsics Boundary

The standard library is replaceable source. The compiler may ship a convenient
default stdlib, and the CLI may vendor it into new projects, but the language
model must not depend on that stdlib having special authority.

Design rule:

```text
The standard library is ordinary Wrela source.

It may import compiler intrinsics, but it receives no private capabilities,
no hidden lowering behavior, no bypass of proof checks, and no privileged access
to layout, memory, target, firmware, or image operations.

Any operation the stdlib can perform must be expressible as:
  ordinary Wrela code
  plus explicit calls to compiler intrinsics
  plus proof/type obligations checked at that call site.
```

That makes the shipped stdlib one library distribution rather than a trusted
compiler extension. If the Wrela language model and intrinsic contracts are
sound, users can build different stdlibs for different domains without changing
the compiler.

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

The project manifest maps package roots. The default mapping can point `std` to
the vendored copy, but a project may point it at a fork, a sibling package, or
omit it and import only project modules and intrinsics.

```text
package roots:
  app -> src
  std -> vendor/wrela-std
  intrinsics -> compiler-owned intrinsic declarations

target:
  uefi-aarch64
```

The exact manifest syntax can evolve. The important contract is that package
resolution is explicit compiler-edge configuration. It is not a semantic
privilege granted to a particular source tree.

### Resolver Contract

The module graph resolver sees three kinds of roots:

```text
project roots
  ordinary source files owned by the user's project

package roots
  ordinary source files from vendored or dependency packages, including std

intrinsic root
  compiler-owned declarations with compiler-owned lowering contracts
```

Name resolution must not ask whether a module is "the real stdlib" to decide
whether an operation is allowed. A stdlib module, project module, or replacement
stdlib module may call the same intrinsic only by importing the same intrinsic
declaration and satisfying the same type and proof obligations.

```text
project module
  imports std.memory
  imports intrinsics.aarch64.barrier

default std module
  imports intrinsics.memory.volatile_load

replacement std module
  imports intrinsics.memory.volatile_load

all three callers:
  typecheck the intrinsic signature
  prove the intrinsic preconditions
  receive the same lowering behavior
```

This makes authority capability-shaped rather than package-shaped. If a raw
firmware operation requires a firmware table handle, boot-services token, unique
device root, or validated memory fact, the caller must have that value and prove
the obligation. The compiler should not special-case the caller's package path.

### Intrinsic Contracts

Intrinsics are the narrow trusted boundary. They are compiler-known declarations
with explicit signatures, target availability, proof obligations, and lowering
rules.

```text
IntrinsicDeclaration
  stable intrinsic ID
  module path
  signature
  target availability
  required facts
  consumed capabilities
  produced capabilities
  lowering contract
```

The compiler trusts the intrinsic contract and lowering, not the caller. The
proof-semantics companion should model intrinsics as trusted axioms with
preconditions and postconditions. Every intrinsic call site should be checked as
a normal call with an explicit obligation edge into Proof MIR.

Useful initial intrinsic families:

```text
intrinsics.memory
  volatile load/store
  raw copy/set if not inlined
  pointer offset with bounds/layout obligations

intrinsics.arithmetic
  checked integer operations
  widening/narrowing conversions with explicit range obligations

intrinsics.aarch64
  barriers
  register or system operations that are valid in the target profile

intrinsics.uefi
  firmware call ABI helpers over explicit firmware function pointers
  status conversion primitives

intrinsics.image
  compiler-known entry capability initialization
  panic/abort lowering policy
```

The default stdlib should mostly wrap these families in safer, domain-shaped
APIs. Replacement stdlibs can choose very different wrappers or expose the
intrinsics more directly.

## Typed HIR And Proof-Relevant Surface

HIR is the source-shaped, typed representation. It should still know language
constructs such as `take`, `requires`, `validated buffer`, `terminal fn`, and
`uefi image`, but it should be simpler and more regular than CST/AST views.

For Wrela, HIR is also the last source-shaped layer that fully understands the
language's proof-relevant surface. It does not prove path-sensitive resource
properties, but it must retain the semantic evidence that later whole-image
monomorphization and Proof MIR need. If HIR erases a `take` session, a
validated-buffer source relationship, a private-state transition, a consumed
receiver, or an intrinsic contract edge, no later phase should have to recover
that meaning from ordinary calls and blocks.

HIR should own checks that depend on declaration context, source intent, or
language grammar shape:

- item legality, such as where `platform`, `terminal`, `private`, and
  `predicate` functions may appear
- image declaration shape and device-section shape
- declared function parameter modes and receiver modes
- generic bounds and interface constraints before monomorphization
- type-reference validity and type-kind assignment
- validated-buffer section shape
- platform surface declaration rules
- source-level diagnostics that benefit from CST child identity

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
  buffers, and tokens minted from platform or intrinsic operations
- call-site requirement IDs for `requires` clauses and intrinsic preconditions
- predicate and `ensure` fact origins, without attempting full dominance checks
- source spans and HIR origin IDs for every proof-relevant node

This makes HIR a proof-aware semantic surface, not a proof checker. Whole-image
monomorphization instantiates this metadata, layout adds representation facts,
and Proof MIR performs the path-sensitive checks on explicit control flow.

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
  v0 = field source.len
  v1 = ge v0, 2
  branch v1, ok, reject

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
  -> Checked MIR
  -> codegen-oriented MIR/LIR
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

Proof MIR may be in SSA form for scalar values while keeping memory, resources,
loans, and obligations as explicit flow facts. Full memory SSA is not required
initially.

```text
MirFunction
  id
  parameters
  locals
  blocks
  sourceOrigin

MirBlock
  id
  parameters
  statements
  terminator
  incomingFacts

MirStatement
  Assign
  Move
  Consume
  Call
  OpenObligation
  DischargeObligation
  AssertFact

MirTerminator
  Branch
  Match
  Return
  Yield
  Continue
  Unreachable
```

## Check Placement

The split should stay flexible. A check belongs at the layer where it is easiest
to make correct and easiest to diagnose.

| Check                                  | Preferred Layer      | Reason                                          |
| -------------------------------------- | -------------------- | ----------------------------------------------- |
| package root selection                 | compiler edge        | filesystem/package config concern               |
| tokenization, grammar, recovery        | frontend             | source preservation                             |
| declaration legality                   | HIR / semantic       | depends on source declarations                  |
| name resolution                        | semantic             | builds stable references                        |
| type references and generic bounds     | semantic / HIR       | source-level types and declarations             |
| intrinsic signature availability       | semantic / target    | compiler-owned declarations, target-gated       |
| image device section shape             | HIR / semantic image | image-specific language meaning                 |
| ABI shape of public/platform functions | layout / target      | target-specific representation                  |
| monomorphization completeness          | mono                 | whole-image reachability                        |
| validated-buffer layout shape          | HIR / layout         | declaration structure and concrete offsets      |
| layout-derived proof facts             | layout -> Proof MIR  | proof checks need concrete representation facts |
| use after move                         | Proof MIR            | path-sensitive resource flow                    |
| consume exactly once                   | Proof MIR            | path-sensitive resource flow                    |
| take-session closure                   | Proof MIR            | all exit paths are explicit                     |
| `?` crossing obligations               | Proof MIR            | exceptional/control exits are explicit          |
| predicate fact availability            | Proof MIR / SSA      | dominance and fact propagation                  |
| `requires` call-site discharge         | Proof MIR            | facts are attached to values and blocks         |
| intrinsic call preconditions           | Proof MIR            | checked like ordinary call obligations          |
| terminal function closure              | Proof MIR            | graph reachability over exits/calls             |
| validated-buffer requirement proofs    | Proof MIR            | path facts plus layout-derived facts            |
| stack frame correctness                | codegen/layout       | target ABI                                      |
| relocation correctness                 | object/linker        | binary layout                                   |

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
- trusted axioms for platform functions, runtime intrinsics, raw memory, and
  generated validated-buffer operations
- small-step operational semantics for the proof-relevant core
- proof-failure diagnostics, including counterexample path reporting

That companion design is not a pipeline phase with its own compiler artifact.
It does not need to be mechanized before implementation, but HIR and Proof MIR
should not be treated as settled until it is precise enough that a reference
checker and a production checker can disagree meaningfully in tests.

The current Lean-derived compiler invariants are captured in
`docs/design/proof-derived-compiler-invariants.md`. Treat that document as the
minimum proof-relevant contract for future HIR, layout, Proof MIR, checker, and
diagnostic work.

## Semantic Modules

### Package Roots And Intrinsic Declarations

Package root selection happens at the compiler edge before the module graph is
loaded. The semantic layers receive stable module identities and should not
perform filesystem discovery.

```text
PackageMap
  app root
  named package roots
  selected target
  intrinsic root for selected target
```

The intrinsic root contributes compiler-owned declarations to the same item
space as source declarations, but those declarations carry intrinsic IDs and
lowering contracts. Source modules cannot redefine an intrinsic ID by creating a
module with the same path.

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

Name resolution maps syntactic references to item IDs:

- imports
- package-qualified module paths
- module-qualified names
- type names
- function names
- fields and member names
- enum cases
- image devices
- intrinsic declarations exposed by the selected target

It should produce deterministic diagnostics and should not typecheck. It also
should not decide whether a caller is trusted. A resolved intrinsic is just a
compiler-owned callee with a contract that later passes must check.

### Type And Kind Checking

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

### Image Graph

Image checking starts from a `uefi image` declaration:

- find the image entry
- validate `devices:` entries
- mint unique edge root capabilities
- bind platform types such as firmware handles and machine devices
- build the closed image root for reachability

The output is a typed image root, not yet code.

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
  -> reachable intrinsic declarations
  -> closed monomorphized HIR
```

The result is a closed program with no unresolved polymorphism at the codegen or
proof boundary. Any unresolved polymorphism or unresolved source package here is
a compiler diagnostic. Intrinsics remain compiler-owned declarations with
lowering IDs rather than ordinary source bodies.

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

Proof MIR consumes these facts. This ordering is important for validated-buffer
requirements such as `layout.fits`, derived field offsets, and ABI-sensitive
platform calls. A proof that depends on concrete representation should not run
before representation exists.

## MIR And Proof Modules

### CFG Builder

Lower each monomorphized HIR function into blocks. Structured HIR becomes
explicit branches, joins, and exits.

### SSA Builder

SSA should initially cover scalar values and facts. It does not need to model
every memory cell. Resource tokens can be explicit values with move/consume
operations.

### Fact Engine

Facts should start simple:

- equality and inequality between values and constants
- bounds facts such as `source.len >= 2`
- enum/match refinement
- predicate-call facts
- validated-buffer layout facts such as `layout.fits`

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
call imply the callee's `requires` clauses. The first implementation can use
structural matching and interval facts before introducing a general solver.

## Lowering After Checks

Once Proof MIR is checked, lower to codegen-oriented MIR/LIR:

- remove proof-only facts
- lower high-level calls to concrete function IDs
- lower validated-buffer field access to loads with checked offsets
- lower enum cases to concrete representations
- lower resource operations to ordinary value movement or no-ops as appropriate
- preserve debug/source origin tables for diagnostics and future tooling

Back-end layers should not need to know why a move was legal.

## Runtime Intrinsics

Runtime intrinsics are compiler-owned. They are not an implicit standard
library, and they are not source modules with special privileges. They may be
emitted as:

- inline MIR/LIR expansions
- compiler-generated functions
- target-specific instruction sequences
- generated data or symbol references owned by the compiler

Initial runtime candidates:

- memory copy / memory set if not inlined
- checked arithmetic helpers
- panic or abort policy
- UEFI status conversion
- UTF-16 string constants for firmware output
- small integer conversion helpers

The default stdlib may wrap these candidates in ordinary Wrela APIs, but the
wrapper is not trusted by the compiler. No runtime intrinsic may depend on libc,
compiler-rt, or external object files.

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

The first backend can be deliberately modest:

- no global optimization
- simple linear-scan or local register allocation
- conservative stack slots
- direct calls and indirect calls
- integer/pointer operations first

UEFI firmware calls are indirect calls through loaded function pointers. The
compiler emits the call sequence according to the target ABI.

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

### 1. Source Frontend And Package Roots

- shared source text, spans, and diagnostics
- project manifest and explicit package root loading at the compiler edge
- default `std` root selection for new projects and support for replacement or
  omitted stdlib roots
- selected-target intrinsic root with compiler-owned declarations
- lexer and module graph lexer
- parser and lossless CST
- module graph parser across project and package roots

Output: parsed module graph with source-preserving CSTs for project/package
source modules, compiler-owned declaration entries for the intrinsic root, and
combined frontend diagnostics.

### 2. AST Views And Item Index

- typed CST views for declarations, expressions, statements, and type syntax
- module IDs and item IDs
- declaration collection across the parsed module graph
- intrinsic declaration collection into the same item ID space, marked with
  intrinsic IDs and lowering contracts
- duplicate declaration diagnostics

Output: stable IDs for modules, declarations, functions, types, images, fields,
parameters, and intrinsic declarations.

### 3. Name Resolution

- imports and module-qualified names
- package-qualified paths, including default or replacement `std` roots
- declaration scopes
- type names, function names, fields, enum cases, and image devices
- intrinsic paths exposed by the selected target
- deterministic unresolved/ambiguous-name diagnostics

Output: CST/HIR-facing references resolved to item IDs, with no trust
distinction between project modules and stdlib modules.

### 4. Type And Resource Kind Checking

- type-reference validation
- generic parameters and bounds
- interface constraints
- resource kind assignment
- signature checking for parameters, receivers, returns, function modifiers, and
  platform declarations
- intrinsic signature checking and target-availability diagnostics

Output: typed declarations and signatures with resource kinds.

### 5. Image Graph Checking

- `uefi image` root selection
- `devices:` section validation
- unique edge root binding
- platform surface availability
- image entry shape

Output: typed image root and image reachability seed.

### 6. Typed HIR And Proof-Relevant Surface

- lower AST views to typed, source-origin-preserving HIR
- preserve proof-relevant constructs such as `take`, `requires`, validation,
  attempt, terminal calls, private state transitions, and image/device origins
- assign stable obligation, session, brand, resource-place, and call-site
  requirement IDs
- retain resource kinds, parameter modes, receiver modes, intrinsic contract
  edges, predicate fact origins, and `ensure` fact origins
- make field-sensitive receiver access explicit enough for later place and loan
  tracking
- keep diagnostics source-level

Output: typed HIR for the reachable source program with proof-relevant metadata
that later phases instantiate and check.

### 7. Whole-Image Monomorphization

- start from the image root
- collect reachable functions and types
- include reachable project, vendored, replacement stdlib, and package modules
- instantiate generics
- instantiate proof-relevant HIR metadata such as resource kinds, obligation
  IDs, session/brand IDs, call-site requirements, and intrinsic contract edges
- retain reachable compiler-owned intrinsic declarations by intrinsic ID
- reject unresolved polymorphism at the whole-image boundary

Output: closed monomorphized HIR plus reachable intrinsic IDs.

### 8. Representation And Layout Facts

- type sizes and alignments
- field offsets
- enum representations
- validated-buffer layout offsets
- ABI parameter and return shapes
- target pointer width and alignment facts

Output: concrete layout and ABI facts for the closed program.

### 9. Proof MIR Builder

- lower monomorphized HIR to CFG blocks
- represent scalar values in SSA where useful
- preserve source origins, HIR origins, type IDs, resource kind IDs, obligation
  IDs, borrow/session IDs, and layout facts
- make all exits explicit

Output: Proof MIR for each monomorphized function.

### 10. Proof And Resource Checking

- fact propagation
- requirement entailment
- intrinsic call precondition and postcondition checking
- move/use/consume checking
- take-session and validation/attempt obligations
- terminal closure
- private state threading
- field-sensitive place and loan tracking
- proof-failure diagnostics with counterexample paths

Output: checked MIR or proof diagnostics.

### 11. Codegen MIR And LIR Lowering

- erase proof-only facts
- lower resource operations to executable effects or no-ops
- lower field access, enum cases, calls, branches, and constants
- preserve debug/source origin tables
- lower to target-independent low-level IR

Output: LIR with symbols, sections, and relocations.

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

### 16. Full Image Validation

- compile representative `uefi image` programs
- compile with the default vendored stdlib
- compile with a tiny replacement stdlib that wraps the same intrinsics
- compile a no-stdlib program that imports intrinsics directly where allowed
- run parser/semantic/proof/codegen integration tests
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

This checker does not need SSA cleverness. It should prefer clarity over speed.

### Interpreter Differential Tests

The compiler should eventually have interpreters for small programs at two
levels:

- HIR or typed HIR interpreter for pure/source-shaped fragments
- MIR interpreter for checked MIR

For snippets without firmware effects, both interpreters should produce the
same result. For UEFI-oriented snippets, tests can provide a fake firmware table
with deterministic function pointers and observable calls.

```text
source snippet
  -> typed HIR interpreter result
  -> MIR interpreter result
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

Trace validation should be optional and test-only at first. The production
compiler should not depend on trace generation for correctness.

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
  encoder, relocation, linker, and PE writer.
- Integration tests at each pipeline boundary.
- Golden byte tests for tiny AArch64 instruction sequences.
- PE header round-trip tests that parse emitted bytes.
- QEMU/UEFI smoke tests once binary emission exists.
- Property tests for CFG invariants, SSA dominance, relocation bounds, and
  deterministic output.
- Integration tests that compile equivalent programs through default stdlib,
  replacement stdlib, and direct intrinsic wrappers where the language permits.
- Negative tests proving stdlib modules cannot bypass intrinsic preconditions,
  resource checks, target availability, or layout obligations.
- Targeted differential tests for Proof MIR facts/resource flow, requirement
  entailment, layout, MIR lowering on small pure programs, linker layout, and PE
  validation.

Required invariants:

```text
CST reconstructs source exactly.
HIR nodes keep source origins.
Project modules and stdlib modules follow the same semantic rules.
Replacement stdlibs can wrap the same intrinsics as the default stdlib.
No source module can shadow or redefine a compiler-owned intrinsic ID.
MIR blocks have valid terminators.
SSA values have one definition.
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
- Keep the back end ignorant of language obligations.
- Treat the standard library as source, not compiler authority.
- Make intrinsic contracts explicit, target-gated, and checked at every call
  site.
- Resolve package roots at compiler edges and keep filesystem access out of
  semantic layers.
- Build the binary spine early, even before the full semantic checker exists.
- Prefer small target-owned ABI abstractions over scattered target constants.
- Treat the robust test suite as the main correctness mechanism.
- Add reference checkers only for high-risk algorithmic boundaries where they
  make tests stronger without becoming a second compiler.
- Keep external specifications as tests and constants near the target and PE
  writer, not embedded throughout semantic layers.

## References

- UEFI Specification: image loading, image entry, system table, and AArch64 UEFI
  behavior: <https://uefi.org/specs/UEFI/2.10/02_Overview.html> and
  <https://uefi.org/specs/UEFI/2.10/04_EFI_System_Table.html>
- PE/COFF format reference:
  <https://learn.microsoft.com/en-us/windows/win32/debug/pe-format>
- Arm AArch64 procedure call standard:
  <https://github.com/ARM-software/abi-aa/blob/main/aapcs64/aapcs64.rst>
