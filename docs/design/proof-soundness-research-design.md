# Proof Soundness Research Design

## Purpose

This document defines the research and design work needed before Wrela's proof
system should be considered production-sound. The existing proof semantics doc
defines a small executable proof core and has survived several rounds of
pressure testing. This document addresses the five remaining load-bearing risks
around that core:

- source-to-Proof-MIR lowering is sound
- arithmetic and layout entailment are complete enough for accepted source
  programs
- every intrinsic contract is correctly specified and validated
- typed AST and HIR preserve enough provenance for proof, lowering, and
  diagnostics
- generics and interfaces cannot introduce aliasing or dynamic-dispatch holes

The goal is not to prove every future language feature. The goal is to make the
current language shape precise enough that implementation can proceed with clear
acceptance gates, executable break tests, and explicit places where future
features must extend the proof story.

## Current Confidence

The proof core is holding up for the resource mechanisms already modeled:

- affine, linear, copy, private-state, validation, and core-movable resources
- field-sensitive moves, loans, obligations, wrappers, and branch joins
- validation success transferring obligations from source buffers to packets
- fact invalidation after moves and private-state generation changes
- terminal discharge graphs
- layout facts at the proof-core boundary
- composition, permutation, and generated trace differential checks

This confidence is scoped. The executable proof core currently checks the core
state machine, not the complete compiler. A production proof checker also needs
sound lowering, a specified fact language, validated intrinsic axioms, preserved
origins, and generic/interface constraints that stay resource-safe after
monomorphization.

## Non-Goals

- Do not mechanize the whole language in Lean before implementing the first
  production checker.
- Do not introduce a general SMT solver as the first entailment engine.
- Do not add dynamic interface dispatch, trait objects, runtime type reflection,
  destructors, implicit drops, or hidden stdlib privileges.
- Do not prove target firmware behavior. Intrinsic and platform functions remain
  trusted boundaries, but their compiler-facing contracts must be explicit,
  typed, validated, and audited.
- Do not make source-visible hidden provenance facts. Brands, origin IDs, and
  session identities remain compiler metadata.

## Research Outputs

This research should produce six implementation-driving artifacts:

1. `docs/design/proof-mir-lowering-design.md`
   - HIR-to-Proof-MIR lowering schemas for every proof-relevant source
     construct.
   - A lowering soundness checklist for each schema.
   - Golden Proof MIR examples for representative valid and invalid programs.

2. `docs/design/proof-entailment-design.md`
   - The accepted fact grammar.
   - Normal forms and decision procedures for arithmetic, structural, and layout
     facts.
   - A rule that rejects unsupported `requires` shapes before proof checking.

3. `docs/design/intrinsic-contracts-design.md`
   - Typed intrinsic proof contracts and lowering contracts.
   - Catalog validation rules.
   - Initial intrinsic family specs for arithmetic, memory, AArch64, UEFI, and
     image/runtime operations.

4. `docs/design/hir-provenance-design.md`
   - Source, AST, item, symbol, type, resource, obligation, and lowering origin
     records.
   - Coverage rules for diagnostics and synthesized instructions.
   - Hidden provenance visibility rules.

5. `docs/design/generic-resource-safety-design.md`
   - Resource-kind lattice for generic parameters and type constructors.
   - Interface/static-bound rules.
   - Monomorphization and aliasing checks.

6. `tests/audit/proof-soundness-audit.test.ts`
   - A cross-layer audit suite that prevents production proof work from
     advancing when any required contract is missing.

If implementation renames one of these artifacts, the new artifact must be
linked from this document and must preserve the same acceptance gates.

## Cross-Cutting Model

The compiler pipeline should maintain this proof-relevant contract:

```text
parsed CST
  -> typed AST views and item index
  -> resolved, typed, source-origin-preserving HIR
  -> closed monomorphized HIR
  -> concrete representation and layout facts
  -> source-origin-preserving Proof MIR / SSA
  -> checked proof state
  -> destructive lowering only after proof success
```

Every layer has one job:

- AST views preserve lossless source shape and spans.
- Item indexing assigns deterministic declaration IDs.
- Semantic/HIR layers resolve names, type-check source intent, attach resource
  identities, and reject language forms that cannot be safely lowered.
- Monomorphization removes unresolved polymorphism from the proof boundary.
- Layout computes concrete representation facts.
- Proof MIR makes control flow, exits, facts, moves, consumes, loans,
  obligations, validation, attempts, and intrinsic calls explicit.
- The proof checker evaluates the explicit core state.

The proof checker must not rediscover source syntax. If Proof MIR needs to know
that an instruction came from a `take`, validation match, terminal call,
generic instantiation, or intrinsic contract, HIR lowering must attach that
origin and obligation metadata.

## Track 1: Source-To-Proof-MIR Lowering Soundness

### Problem

The proof core can be internally coherent while the compiler lowers source
constructs incorrectly. A source feature is sound only if every proof-relevant
effect becomes an explicit Proof MIR operation and every implicit source
guarantee becomes a checked fact, obligation, or type/resource constraint.

Dangerous lowering bugs include:

- `take` opens a stream loan but forgets an item obligation.
- `?` exits without checking live obligations and `Attempt` ownership.
- validation `Ok` consumes a source buffer but forgets to transfer the
  obligation to the produced packet.
- validation `Err` consumes the source when it should leave it live.
- terminal helpers are lowered as ordinary calls.
- private-state methods mutate state without advancing generation IDs.
- branch facts are attached after, rather than before, the dominated call.
- source spans survive, but proof origins for synthesized exits are missing.

### Design Rule

Proof MIR lowering must be schema-driven. Every HIR construct that can affect
resources, facts, exits, brands, private state, layout reads, or intrinsic calls
gets a named lowering schema.

Each schema must specify:

```text
source construct
HIR node shape
preconditions already checked by HIR/type layers
Proof MIR instructions emitted
resource-state effects
fact effects
exit edges
origin IDs attached to every emitted instruction
proof diagnostics expected on failure
```

Lowering is sound when the emitted Proof MIR is a conservative representation
of the source construct: if Proof MIR accepts, the source construct did not hide
a resource or fact violation relevant to the current language model.

### Required Lowering Schemas

The first production lowering design must include schemas for:

- local bindings, assignment, field access, and field move
- ordinary calls, consuming calls, constructor calls, predicate calls, terminal
  calls, platform calls, and intrinsic calls
- `requires`, `ensure`, predicate facts, and branch refinements
- `if`, `match`, loops, loop backedges, and joins
- `return`, `break`, `continue`, `yield`, `panic`, and `?`
- `take` over streams and buffers
- validation construction and exhaustive validation match
- `Attempt` success/error propagation
- private-state predicate and non-predicate calls
- wrapper construction, wrapper matching, and ordinary storage
- core transfer and bounded move-ring operations
- layout field reads and validated-buffer requirement checks

### Simulation Obligation

For each lowering schema, define a local simulation statement:

```text
Given well-typed HIR node H and incoming proof state S,
lower(H) emits Proof MIR fragment M.

If M checks from S to S',
then H's proof-relevant source effect is represented by S'.

If H would violate the source proof contract,
then every lowering of H either rejects before Proof MIR or emits M that the
Proof MIR checker rejects.
```

This is not a full mechanized proof. It is a checklist and test oracle for each
schema. The implementation must keep the checklist next to the lowering code or
in a table-driven audit fixture.

### Tests

Required test families:

- Golden lowering tests from source snippets to simplified Proof MIR snapshots.
- Differential tests that compare a tiny HIR-step reference model with the Proof
  MIR trace model for source-shaped fragments.
- Origin coverage tests: every emitted Proof MIR instruction has a source or
  synthesized origin.
- Exit-path tests: every HIR exit kind lowers to an explicit Proof MIR exit
  edge.
- Validation tests: Ok and Err lowerings have opposite source-buffer ownership
  effects.
- Attempt tests: success, error, and `?` paths account for every consumed input.
- Terminal graph tests: terminal calls remain terminal at Proof MIR, never
  ordinary calls.

### Acceptance Gate

No production Proof MIR builder should be considered ready until every
proof-relevant HIR node kind has:

- a lowering schema
- a golden lowering test
- at least one invalid source example that fails for the intended proof reason
- origin coverage
- a statement of which earlier phase preconditions it relies on

## Track 2: Arithmetic And Layout Entailment Completeness

### Problem

The checker must prove `requires` and layout facts that source programs depend
on, but a general solver is too much for the first implementation. The hole to
avoid is accepting source-level `requires` syntax that the compiler cannot prove
or disprove predictably.

Completeness must therefore be scoped:

```text
The entailment engine must be complete for the fact grammar Wrela accepts in
requires, ensure, predicate postconditions, layout rules, and intrinsic
contracts.
```

Unsupported fact shapes should be rejected where they are declared or used, not
silently treated as maybe-true.

### Fact Classes

The first fact language should have these classes:

```text
Boolean structural facts
  result is Ok
  option is Some
  enum case refinements
  place.kind facts produced by type/lowering rules

Resource facts
  place is live
  place has resource kind K
  place has ownerCore C
  place has current private generation G

Arithmetic facts
  x == y
  x != y
  x < y
  x <= y
  x >= c
  x + c <= y
  x + c <= y + d
  0 <= offset
  offset + len <= capacity

Layout facts
  layout.fixedFits(Type)
  layout.dynamicRange(Type.field)
  layout.fits(Type)
  field.offset == constant
  field.length == expression in accepted arithmetic grammar

Intrinsic contract facts
  facts expressible in the same accepted grammar
```

Do not accept arbitrary quantifiers, recursion, multiplication of symbolic
values, uninterpreted function equality, arbitrary bit-vector reasoning, or
facts that mention hidden provenance from source syntax.

### Normal Forms

The entailment design should normalize arithmetic to difference constraints:

```text
x - y <= c
x <= c
-x <= c
```

This is enough for bounds such as:

```text
source.len >= 2
offset + len <= buffer.capacity
payload_start + payload_len <= source.len
initialized_prefix <= capacity
```

For non-negative unsigned values, type/layout facts may introduce lower-bound
facts such as `0 <= len`.

The first implementation can use a Bellman-Ford-style difference-constraints
closure or an interval-plus-difference hybrid. The key is deterministic
explanations: when a proof fails, the checker should report the missing
inequality rather than "solver failed."

### Layout Entailment

Layout facts should be generated after monomorphization and representation
calculation. The layout layer must provide facts in dependency order:

1. fixed fields fit
2. fixed field reads are allowed
3. dynamic range expressions are computed with checked arithmetic
4. dynamic ranges fit inside source length/capacity
5. derived fields are exposed
6. `layout.fits(Type)` is emitted only after all declared fields fit

`layout.fits(Type)` is a containment fact. It does not allow reads of
undeclared trailing bytes.

### Completeness Policy

A source fact is accepted only if it can be lowered into the accepted fact
grammar. If the compiler sees:

```text
requires:
    hash(buffer) == expected
```

and `hash` is not a predicate function with a typed, accepted postcondition,
the declaration is rejected as an unsupported proof expression.

This prevents the language from depending on an unspecified future solver.

### Tests

Required test families:

- Entailment positive/negative examples for every accepted arithmetic normal
  form.
- Monotonicity property: adding facts cannot make a previously proven accepted
  fact unproven, except when a resource-state transition invalidates those
  facts before entailment.
- Invalidation property: moving a place, consuming a place, or advancing private
  generation removes facts that mention stale places/generations.
- Layout dependency tests: dynamic reads fail before fixed fit and dynamic
  range facts, succeed after both.
- Brute-force finite-domain oracle tests for small integer constraints.
- Unsupported-fact diagnostics for facts outside the grammar.

### Acceptance Gate

The entailment engine is complete enough when:

- every accepted `requires`/`ensure`/predicate/intrinsic fact lowers to a known
  fact class
- each fact class has a deterministic decision procedure
- unsupported facts are rejected before proof checking depends on them
- layout reads never rely on facts not emitted by the layout layer
- every failed proof can name the missing fact or unsupported expression

## Track 3: Intrinsic Contract Correctness

### Problem

Intrinsics are trusted axioms. A wrong intrinsic contract can make the whole
language unsound even when the proof checker is otherwise correct.

The current item-index design stores intrinsic proof and lowering contracts as
opaque metadata. That is a good early collection step, but production proof work
needs typed contracts and a validator before any intrinsic can be called.

Dangerous intrinsic bugs include:

- a lowering consumes a capability but the proof contract says it only borrows
  it
- a proof contract produces a sealed token that the lowering does not actually
  create
- a platform call returns trusted layout or range facts without validating the
  source values
- a target-unavailable intrinsic is still resolved
- an intrinsic mentions a parameter name that does not exist
- a stringly proof contract says `len <= capacity` but the actual parameter is
  `length`
- memory intrinsics allow pointer arithmetic without range/layout obligations

### Contract Shape

Production intrinsic contracts should be typed records, not opaque strings:

```text
IntrinsicContract
  intrinsicId
  signature
  targetAvailability
  parameterModes
  requiredFacts
  consumes
  borrows
  produces
  postFacts
  hiddenBrandsProduced
  failureMode
  loweringContract
  auditNote
```

Facts should reference parameter IDs or symbolic contract variables, not raw
source strings. Produced capabilities should name their resource kind, brand
source, owner core, droppability, and visibility.

The `auditNote` is not trusted by the compiler. It is human review evidence for
why the axiom is acceptable.

### Validator

An intrinsic catalog validator should run before item indexing or during target
selection. It must reject:

- duplicate intrinsic IDs
- empty or unknown target availability
- proof facts outside the accepted fact grammar
- references to unknown parameters or type parameters
- consumed parameters whose signature mode does not permit consumption
- produced sealed tokens without a brand/origin rule
- lowering contracts with unknown backend or operation IDs
- mismatches between proof contract effects and lowering effect declarations
- intrinsic types that claim ordinary constructibility for sealed resources
- platform/firmware operations not gated by target profile

### Contract And Lowering Compatibility

The compiler cannot prove that firmware or hardware does what an intrinsic says.
It can and must prove that the compiler's own lowering matches the declared
compiler-facing effects.

For each intrinsic lowering operation, define a conservative effect summary:

```text
LoweringEffect
  reads memory?
  writes memory?
  may trap/panic?
  consumes parameters?
  produces result?
  changes ownerCore?
  emits barrier?
  calls firmware function pointer?
```

The intrinsic validator checks the proof contract against this summary. For
example, a volatile store lowering must not have a proof contract that says the
buffer remains untouched if the lowering effect summary writes through it.

### Initial Intrinsic Families

Research should specify contracts for:

- checked integer arithmetic and range conversion
- pointer offset and raw memory access over validated layout/range facts
- volatile load/store and memory barriers
- AArch64 system operations used by the UEFI profile
- UEFI function-pointer ABI calls
- image entry capability initialization
- panic/abort runtime behavior

### Tests

Required test families:

- Invalid fake catalogs for every validator rule.
- Snapshot tests for initial intrinsic family contracts.
- Contract/lowering compatibility tests.
- Target availability tests.
- Call-site proof tests: intrinsic calls fail unless their required facts and
  capabilities are present.
- No-bypass tests: stdlib, project code, and replacement stdlib modules satisfy
  the same intrinsic call obligations.

### Acceptance Gate

No intrinsic should be callable from HIR or Proof MIR until:

- its contract passes catalog validation
- its facts use the accepted fact grammar
- its lowering operation has an effect summary
- proof contract effects are compatible with lowering effects
- it has at least one positive call-site test and one negative call-site test

## Track 4: Typed AST/HIR Provenance Preservation

### Problem

The proof checker needs hidden provenance to be sound and source provenance to
be useful. Losing either creates holes:

- if hidden brands are lost, a packet can close through the wrong receiver
- if private-state generation origins are lost, stale facts can survive
- if source origins are missing, diagnostics become unactionable
- if synthesized Proof MIR lacks origin IDs, counterexample paths point into
  compiler internals without source explanation
- if item/type/function IDs are not carried, intrinsic and generic calls can be
  resolved differently by later phases

### Provenance Bundle

Every HIR node and Proof MIR instruction should carry a `Provenance` bundle
appropriate to its layer:

```text
SourceOrigin
  sourceId
  span
  displayPath

AstOrigin
  syntaxKind
  sourceOrigin

ItemOrigin
  moduleId
  itemId
  declarationKind

SymbolOrigin
  symbolId
  itemId
  nameSpan

TypeOrigin
  typeId
  typeArgumentOrigins
  resourceKind

ResourceOrigin
  place
  resourceKind
  brandSeed
  ownerCore
  mintedBy

ObligationOrigin
  obligationId
  openedBy
  mustCloseBy

LoweringOrigin
  hirNodeId
  schemaId
  synthesizedReason
```

Not every instruction needs every field. The rule is that every diagnostic must
be able to trace back to source and every hidden proof relation must trace back
to a compiler-owned origin that cannot be forged by source.

### Hidden Provenance Visibility

Hidden provenance is used by the compiler but not source-visible:

```text
buffer.brand == StreamSession(batch)
packet.origin == buffer
builder.generation == 3
token.image == image0
```

Source `requires` cannot mention these facts. Diagnostics can describe them in
source terms:

```text
packet belongs to the receive session opened here
but this terminal call closes a different receive session
```

### Coverage Rules

HIR construction must attach source/item/type origins to:

- declarations
- parameters
- fields
- expressions
- statements
- type references
- call sites
- pattern arms
- validated-buffer sections
- image/device entries

Proof MIR lowering must attach source or synthesized origins to:

- every block
- every terminator
- every move/consume/use/drop
- every fact assertion
- every obligation/loan open and close
- every validation and attempt operation
- every intrinsic and platform call
- every join and loop backedge
- every synthesized cleanup or exit check

### Tests

Required test families:

- AST view span tests for all named declaration and expression views.
- HIR provenance coverage tests: no HIR node with diagnostic potential lacks
  origin.
- Proof MIR provenance coverage tests: no instruction or terminator lacks
  origin.
- Hidden-provenance non-visibility tests: source `requires` that mentions hidden
  origin/brand facts is rejected.
- Diagnostic path tests: proof failures include the opening origin and failing
  use/exit/call origin.
- Monomorphization origin tests: instantiated functions retain source origin
  and instantiation origin.

### Acceptance Gate

The provenance design is sufficient when:

- every ID produced by item indexing is preserved through HIR where relevant
- every proof-relevant source construct has a HIR origin
- every Proof MIR instruction has source or synthesized lowering origin
- every proof diagnostic can name both cause and failure sites
- hidden provenance cannot be written in source facts

## Track 5: Generic And Interface Resource Safety

### Problem

Generics and interfaces can accidentally reintroduce aliasing if generic code
is type-checked as if `T` were copy-safe and later instantiated with an affine
or linear type. Interfaces are especially risky if they become dynamic dispatch
or allow terminal behavior to hide behind ordinary calls.

The current language shape avoids many of these holes by saying interfaces are
static constraints only and all constrained uses are monomorphized. The
implementation must preserve that.

### Resource-Kind Lattice

The type checker needs a resource-kind lattice:

```text
Copy
  freely copyable, droppable

Affine
  one owner, may be moved once, drop depends on type rule

Linear
  one owner, must be discharged

PrivateState
  affine state token with generation

SingleUse
  affine token that must be consumed by a specific operation, such as validation

CoreMovableOwned
  movable across cores only through checked transfer capabilities

Sealed
  cannot be constructed by ordinary source
```

Some entries are orthogonal capabilities rather than a single total order. The
implementation should model this as resource properties, not force everything
into one enum if that loses information.

### Generic Bounds

Generic parameters should default to the most restrictive useful mode:

```text
T
  may be used only as an opaque owned value
  cannot be copied, dropped, stored in copy-only containers, or duplicated
  unless bounds allow it

T: Copy
  may be copied and dropped

T: AffineOwned
  may be moved but not copied

T: LinearOwned
  must be discharged or returned through an explicit owner contract

T: CoreMovableOwned
  may be transferred across cores through checked transfer APIs

T: Interface
  grants only the statically declared member operations and their resource
  contracts
```

Generic code type-checks against the bound, not against future instantiations.
If the generic body copies `T`, it needs `T: Copy`. If it stores `T` in an
ordinary dataclass, that dataclass must be allowed to own the resource kind. If
it calls a terminal method, the bound must expose a terminal contract and the
call remains terminal in Proof MIR.

### Type Constructor Lifting

Ordinary type constructors lift resource kind:

```text
Option[T]
Result[T, E]
Tuple[T, U]
List[T]
Map[K, V]
ordinary class fields
```

If `T` is affine or linear, the containing type is affine or linear unless the
container is a checked owner with explicit discharge behavior.

Ordinary dataclasses should reject affine or linear fields unless the design
later adds checked owner dataclasses. This keeps "value aggregates" copy-safe.

### Interface Rules

Interfaces remain static:

- interface names appear only in type-parameter bounds
- interface names do not appear as ordinary value, field, or parameter types
- there are no trait objects or runtime vtables
- every constrained call is resolved by monomorphization
- terminal/interface members preserve their function kind in HIR and Proof MIR
- interface default methods, if added later, are ordinary source and receive no
  privilege

An interface cannot launder terminal discharge:

```text
interface Closer[T]:
    terminal fn close(self, item: T)
```

A generic call to `close` remains a terminal call with explicit obligations. It
cannot be lowered as an ordinary function call.

### Monomorphization Obligations

Before Proof MIR:

- all generic functions reachable from the image are instantiated with concrete
  type arguments
- every interface-constrained call resolves to a concrete function ID
- every concrete instantiation has concrete resource kinds
- any bound not satisfied by the concrete type is a diagnostic
- no unresolved generic type reaches Proof MIR
- no dynamic interface value reaches HIR, Proof MIR, or codegen

### Tests

Required test families:

- Generic body rejects copying unconstrained `T`.
- Generic body accepts copying `T: Copy`.
- Ordinary dataclass rejects affine/linear generic fields without checked owner
  semantics.
- `Option[T]`, `Result[T, E]`, tuples, lists, and maps lift resource kind.
- `MoveRing[T: CoreMovableOwned]` rejects session-bound buffers, validation
  results, platform tokens, and private state.
- Interface names are rejected as value/field/parameter types.
- Interface-constrained terminal calls lower as terminal calls.
- Monomorphization rejects unresolved generic calls at the Proof MIR boundary.
- A generic wrapper cannot silently drop `T` unless the bound allows drop.

### Acceptance Gate

Generics and interfaces are safe enough when:

- every generic operation is checked under explicit resource bounds
- every type constructor has a resource-lifting rule
- no dynamic interface values exist
- monomorphized HIR has concrete resource kinds everywhere
- Proof MIR sees concrete function, type, item, and intrinsic IDs
- invalid generic aliasing examples fail before or during Proof MIR

## Integrated Proof-Obligation Matrix

| Risk                      | Required Design Answer                           | Required Tests                                               | Blocks                             |
| ------------------------- | ------------------------------------------------ | ------------------------------------------------------------ | ---------------------------------- |
| HIR-to-Proof-MIR lowering | Schema for every proof-relevant HIR node         | Golden lowering, differential trace, origin coverage         | Proof MIR builder                  |
| Entailment completeness   | Accepted fact grammar plus decision procedures   | Fact oracle, layout dependency, unsupported fact diagnostics | Requirement checker                |
| Intrinsic correctness     | Typed contract schema plus catalog validator     | Invalid catalogs, compatibility, target gating               | Intrinsic calls                    |
| Provenance                | Source/HIR/Proof MIR origin bundles              | Coverage, hidden provenance rejection, diagnostic paths      | User-facing proof diagnostics      |
| Generics/interfaces       | Resource bounds, lifting, static interface rules | Generic aliasing, monomorphization, interface terminal calls | Monomorphizer and HIR type checker |

## Integrated Break Scenarios

The research should maintain a list of cross-track programs that must fail for
the intended reason:

1. `take` buffer lowered without opening an obligation.
2. Validation `Ok` creates a packet with a fresh brand instead of source brand.
3. Validation `Err` consumes the source buffer.
4. `?` crosses a live obligation with plain `Result`.
5. `Attempt` error path drops an affine input.
6. Predicate fact proven on `builder@generation0` used after generation advance.
7. `requires` mentions `buffer.origin == self.rx`.
8. Layout dynamic field read uses `layout.fits` without proving the specific
   dynamic range.
9. Intrinsic volatile store proof contract forgets that the operation writes.
10. Intrinsic produces a sealed token without a brand/origin rule.
11. Replacement stdlib calls an intrinsic with missing preconditions.
12. Generic function copies unconstrained `T`.
13. Generic ordinary wrapper drops `T` at scope end.
14. Interface terminal method lowers as ordinary call.
15. Interface name appears as a runtime field type.
16. `MoveRing[Packet]` accepts a session-bound validated buffer.
17. Monomorphized HIR reaches Proof MIR with unresolved type parameter.
18. Synthesized loop backedge check has no source/lowering origin.
19. Branch join merges two brands under one stable place.
20. Private platform call is available on the wrong target.

Each break scenario should become either a unit test, integration test, or audit
fixture. If a scenario cannot yet be represented by parser/HIR implementation,
keep it as a documented pending fixture with the implementation milestone that
will enable it.

## Implementation Sequence

### Phase 1: Provenance And Lowering Surface

- Define HIR origin and Proof MIR origin records.
- Enumerate proof-relevant HIR node kinds.
- Draft lowering schemas for existing language constructs.
- Add audit tests that fail when a proof-relevant HIR node has no schema.

### Phase 2: Fact Language And Entailment

- Define accepted proof-expression grammar.
- Reject unsupported `requires` and intrinsic fact expressions.
- Implement arithmetic normal forms and layout fact dependencies.
- Add finite-domain oracle tests for arithmetic entailment.

### Phase 3: Intrinsic Contract Validation

- Replace opaque proof/lowering contract strings at proof consumption time with
  typed records.
- Add intrinsic catalog validator.
- Add lowering effect summaries.
- Specify initial intrinsic families.

### Phase 4: Generic Resource Safety

- Add resource-property model for concrete and generic types.
- Add type-constructor lifting rules.
- Enforce static-only interface usage.
- Ensure monomorphized HIR contains no unresolved generic resource behavior.

### Phase 5: Proof MIR Builder And Integrated Break Suite

- Implement schema-driven lowering into Proof MIR.
- Add golden Proof MIR fixtures.
- Run the existing proof-core reference tests against lowered traces where
  possible.
- Add cross-track break scenarios as parser/HIR/proof integration tests.

## Readiness Levels

Use these levels to avoid overstating confidence:

```text
Level 0: proof core only
  executable state machine checks pass

Level 1: source lowering specified
  every proof-relevant HIR node has a lowering schema

Level 2: accepted facts decidable
  all source-visible proof facts fit the fact grammar

Level 3: intrinsic boundary validated
  every intrinsic has a typed, validated contract and effect-compatible lowering

Level 4: provenance complete
  every proof diagnostic can trace cause and failure to source/lowering origins

Level 5: generics closed
  monomorphized Proof MIR has concrete resource behavior and no dynamic
  interface holes

Level 6: integrated source-to-proof tests
  representative source programs lower to Proof MIR and pass/fail for the
  intended proof reasons
```

The language should not be called production-sound before Level 6 for the
current feature set.

## What This Means For The Language

The current language shape still looks viable. The remaining risks do not force
a redesign, but they do force discipline:

- Lowering must be explicit and audited.
- The fact language must be intentionally limited until a stronger solver is
  specified.
- Intrinsics must become typed axioms with validator support.
- Provenance must be a first-class compiler data model, not an afterthought.
- Generics and interfaces must stay static and resource-bounded.

If implementation follows these gates, the earlier proof-core confidence can
grow into source-level confidence. If any gate fails, the right response is to
reject or narrow the source feature rather than weakening the proof checker.
