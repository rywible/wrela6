# Proof Semantics Design

## Purpose

The proof semantics define the checker contract for Wrela's resource-sensitive
middle of the compiler. This design specifies a small proof core with explicit
judgments for resources, facts, loans, obligations, calls, exits, validation,
private state, terminal discharge, and trusted intrinsic/platform boundaries.

This document is normative for the first production proof checker. It is not a
complete formalization of the whole source language. Source-shaped HIR and Proof
MIR should lower proof-relevant behavior into this core so the checker can reason
about one precise model instead of many ad hoc source features.

The design is paired with a small executable reference sketch:

```text
tests/support/proof-core-reference.ts
tests/unit/proof-core-reference.test.ts
tests/unit/proof-core-composition.test.ts
tests/unit/proof-core-trace.test.ts
```

The sketch is intentionally tiny, but it verifies the worked rejection examples
in this document plus positive-path checks, composition and permutation
properties over the core judgments, and generated trace differential checks. It
is a pressure test for the rules, not the production checker.

## Goals

- Define the core resource state used by Proof MIR checks.
- Define place, ownership, loan, brand, obligation, and fact vocabulary.
- Define judgments for use, move, consume, discharge, loaning, facts, calls, and
  exits.
- Make hidden provenance explicit to the compiler but unavailable to source
  `requires` clauses.
- Model intrinsics and private platform functions as trusted axioms with checked
  preconditions and postconditions.
- Explain how streams, validation results, private state, terminal functions,
  layout facts, `Attempt`, and multicore transfer map into the core.
- Provide diagnostic shapes with counterexample-path evidence.
- Work through thirty-nine representative invalid examples from
  `docs/language/invalid.md`.

## Non-Goals

- This design does not choose the final Proof MIR instruction set.
- This design does not define all arithmetic entailment. The first checker needs
  structural facts and interval/comparison reasoning, not a general SMT solver.
- This design does not mechanize the semantics in Lean.
- This design does not let standard-library source bypass proof checks.
- This design does not define target ABI or code generation.
- This design does not assign proof obligations to language mechanisms that are
  not in the current Wrela language/design surface.

## Current Language Scope

The confidence claims in this document are scoped to the language mechanisms
currently described in `docs/language` and the compiler design docs:

- resource use, move, consume, drop, and wrapper lifting
- `take` streams and session-bound obligations
- `requires` clauses, predicate facts, and private-state generations
- validation results and validated-buffer layout facts
- terminal functions and private platform functions
- intrinsic contracts
- `Attempt`-style fallible ownership transfer
- static interface/generic constraints only where they lower to explicit
  resource contracts
- multicore ownership transfer through checked move capabilities

Future language features need their own lowering rules and proof obligations
before they are covered by this proof core.

## Pipeline Position

The proof checker runs after the compiler has enough concrete information to
make proof facts meaningful:

```text
typed HIR
  -> closed monomorphized whole-image program
  -> concrete layout and ABI facts
  -> Proof MIR / SSA
  -> proof and resource checks
  -> checked MIR
```

HIR should preserve source intent and attach stable origins. Proof MIR should
make all control-flow exits explicit, attach resource-kind and layout facts, and
turn source features such as `take`, `Validation`, and `?` into explicit
obligation and branch operations.

## Core State

The proof checker evaluates each function over an abstract resource state.

```text
State S =
  places       Place -> Resource
  facts        FactSet
  obligations  ObligationId -> Obligation
  loans        LoanId -> Loan
  terminalGraph TerminalFn -> TerminalFn*
```

### Places

A `Place` is a stable proof-level access path:

```text
local
self
self.rx
self.rx.queue
buffer
packet
builder
result.Ok.packet
```

Places are field-sensitive. Moving `self.tx` makes the whole `self` value
partially unavailable until that field is restored or the owner is consumed.
Borrowing or loaning `self.rx` does not block disjoint fields such as `self.tx`,
but it does make the whole aggregate `self` unavailable while the loan is live.

### Resources

Each live place has a resource kind and proof metadata:

```text
Resource
  kind
  status
  brand
  generation
  ownerCore
  hiddenFacts
```

Kinds:

```text
Copy
Affine
Linear
Stream
Validation
Attempt
PrivateState
UniqueEdgeRoot
EdgePath
SealedPlatformToken
ValidatedBuffer
Never
```

Statuses:

```text
Live
Moved
Consumed
Discharged
Invalid
```

`Copy` values may be used repeatedly. Non-copy values have one current owner.
`Linear` obligations must be discharged exactly once. `Affine` values may move
at most once, but Wrela treats many affine capability values as non-droppable
unless their type declares a checked close/drop rule.

At control-flow joins, a non-copy place that is live on one incoming edge and
consumed on another becomes `MaybeConsumed`. A `MaybeConsumed` place is not
usable after the join. The checker should report the join path that consumed the
place and the path that left it live.

### Brands

Brands are hidden compiler metadata that relate values to the authority that
minted them:

```text
StreamSession(batch42)
EdgePath(self.rx)
Image(image0)
Core(core1)
PrivateState(builder, generation3)
```

Brands are not source-visible values. Source `requires` clauses may not mention
them. Proof checks use them to reject cross-edge misrouting, wrong stream
closure, buffer serialization, cross-image token transfer, and stale private
facts.

### Obligations

An obligation is an outstanding resource that must be closed before an exit:

```text
Obligation
  id
  place
  kind
  openedAt
  closeBy
```

Examples:

- `take buffer` opens a linear buffer obligation.
- Iterating an RX stream move-yields one buffer obligation per item.
- `Option[WritableBuffer]` is affine because the `Some` branch may contain a
  live TX-slot obligation.
- A private builder is an affine/private-state obligation that must be sealed or
  closed.

### Loans

A loan temporarily reserves a place or capability path:

```text
Loan
  id
  place
  kind
  openedAt
  closesAt
```

Examples:

- `take self.rx.receive() as batch:` opens a stream loan over `self.rx`.
- A private RX builder opens a private edge-internal loan over its receiver.
- Pinned ownership transfer moves a value to another core and prevents local use.

While a loan is active, the loaned place and its subplaces cannot be used except
through the capability that owns the loan.

### Facts

Facts are proof-level propositions attached to values, blocks, and private-state
generations:

```text
len <= buffer.initialized_prefix
ready.written_len <= ready.capacity
layout.fixedFits(Packet)
layout.fits(Packet)
builder@generation3.can_insert(descriptor)
result is Some(slot)
```

Facts are stable only while the values and generations they mention remain live.
If a private state token advances, facts about the old generation do not apply
to the new generation. Moving or consuming a place invalidates facts that mention
that place, its descendants, or aggregate ancestors.

Hidden facts are tracked by the compiler but not expressible in source
`requires`:

```text
buffer.brand == batch42
buffer.origin == self.tx
packet.sourceSession == batch42
token.image == image0
```

Source-visible `requires` clauses are value facts only.

## Judgment Notation

Judgments are written over an environment `Gamma` and resource state `S`.

```text
Gamma; S |- use p => S
Gamma; S |- move p => S'
Gamma; S |- consume p => S'
Gamma; S |- openLoan p as l => S'
Gamma; S |- closeLoan l => S'
Gamma; S |- openObligation p as o => S'
Gamma; S |- discharge o by p => S'
Gamma; S |= fact
Gamma; S |- call f(args) => S'
Gamma; S |- exit kind => ok
Gamma; S1 join S2 => S'
Gamma; S |- loopBackedge => ok
```

Failure of any judgment produces a proof diagnostic with a source origin and a
counterexample path through Proof MIR.

## Composition And Permutation Laws

The proof checker should satisfy metamorphic laws for independent proof steps.
These laws are not examples of specific source programs; they are sanity checks
on the algebra of the proof state.

The first executable sketch checks these properties with generated inputs:

- adding independent facts is permutation invariant
- consuming disjoint resources commutes
- opening disjoint loans commutes
- wrapping disjoint resources commutes
- transferring disjoint core-movable resources commutes
- validation success matching commutes with independent wrapping
- validation obligation transfer commutes with independent core transfer
- dynamic layout facts are permutation invariant before layout reads
- branch joins are commutative for compatible resource states
- branch joins are associative for compatible resource states
- terminal graph validation is invariant under edge list order
- facts about consumed resources cannot be revived by reordering proof steps
- stale private-state facts cannot be revived after generation advance

These laws define where order should and should not matter. Operations over
disjoint places should produce the same proof state in either order. Operations
over overlapping places may reject in different local ways, but they must not
create a usable duplicated owner, a stale fact, or a hidden live obligation.

## Generated Trace Differential Checks

The executable sketch also generates small Proof MIR-like traces over a compact
instruction subset:

```text
use
consume
drop
openObligation
discharge
openLoan
wrap
matchValidationOk
markValidation
fallibleConsume
ordinaryDischarge
transferToCore
readLayout
exit
loopBackedge
addFact
requireFact
advancePrivate
```

The current generated pass runs 5,000 seeded traces up to 16 instructions long.
The generated initial state includes live linear, affine, copy, private-state,
validation, unbranded-validation, and core-movable resources so that traces
exercise owner production, validation targets, fallible ownership transfer,
ordinary-call rejection, core transfer, layout reads, exits, and loop backedges.

Each accepted operational step is checked against whole-state invariants:

- obligations point only to live places
- loans point only to live places
- facts mention only stable live places and current private-state generations
- consumed aggregate parents do not have live children

The same trace is then run through a smaller declarative checker in
`tests/unit/proof-core-trace.test.ts`. The two checkers must agree on acceptance,
rejection code, and final state snapshot. This is not a proof of soundness, but
it catches order-sensitive bugs that are easy to miss in one-off examples.

The first generated-trace pass found a real hole: direct `consume` could consume
a resource with a live obligation, leaving the obligation dangling. The core rule
now rejects that; only explicit discharge or validation transfer may consume an
obligated place.

Later hardening passes found additional holes that are now locked by both
deterministic tests and generated traces: generated owners cannot shadow a live
non-copy place, validation success requires exact source-brand equality, and
loans cannot open over places with live overlapping obligations.

## Core Judgments

### Use

```text
Gamma; S |- use p => S
```

Valid when:

- `p` exists.
- `p` is live.
- no active loan covers `p`.
- no active loan covers a child required by whole-aggregate use.
- no ancestor place needed for access is partially moved.

Using a consumed or moved place reports `PROOF_USE_AFTER_MOVE`.
Using a loaned place reports `PROOF_PLACE_LOANED`.

### Move And Consume

```text
Gamma; S |- move p => S[p := Moved]
Gamma; S |- consume p => S[p := Consumed]
```

`Copy` places remain live. Non-copy places become unavailable. `consume` is used
when the callee or operation takes ownership. `move` is used when ownership is
transferred to a new place.

Moving a field makes the containing aggregate partially unavailable. A later use
of the whole aggregate is legal only if every moved field has been restored or
the aggregate itself is consumed.

Shadowing a live non-copy place is rejected. This keeps source names stable
while obligations are live and prevents accidental hiding of resource state.

A plain `consume` is rejected when an overlapping live obligation exists.
Discharge and validation success use explicit obligation-aware rules that either
remove the obligation or transfer it to the produced value.

### Drop

```text
Gamma; S |- drop p => S'
```

Dropping is legal only for `Copy` values or for types that declare an explicit
checked drop rule. A wrapper containing an affine or linear value inherits that
value's resource obligations. Dropping `Option[WritableBuffer]`,
`Result[_, WritableBuffer]`, `List[ReadableBuffer]`, or any ordinary wrapper
that may contain a live obligation is rejected unless the wrapper type is a
checked linear owner with its own discharge semantics.

Even a droppable outer value cannot be dropped while an overlapping obligation
is live, or while a live non-droppable child is still owned by the aggregate.

### Open And Discharge Obligation

```text
Gamma; S |- openObligation p as o => S'
Gamma; S |- discharge o by p => S'
```

Opening an obligation records the place that must be closed. Discharge requires:

- the obligation exists
- the discharging place is the obligation place or a validated value derived
  from it
- the discharging terminal/platform function accepts the place's brand
- the place is consumed exactly once
- the obligation is removed

Discharging the wrong place reports `PROOF_OBLIGATION_PLACE_MISMATCH`.
Discharging with the wrong brand reports `PROOF_BRAND_MISMATCH`.
Leaving an obligation live at exit reports `PROOF_LIVE_OBLIGATION_ON_EXIT`.

### Loans

```text
Gamma; S |- openLoan p as l => S'
Gamma; S |- closeLoan l => S'
```

A loan reserves `p` and its subplaces. Disjoint fields are still available.
Closing a loan requires no live obligations whose brand depends on that loan.

Leaving a loan live at `return`, `break`, `continue`, `yield`, `?`, or `panic`
reports `PROOF_LIVE_LOAN_ON_EXIT`.

### Joins

```text
Gamma; S1 join S2 => S'
```

A join merges incoming block states. The first checker should use conservative
rules:

- a place live on all incoming edges remains live
- a place consumed on all incoming edges remains consumed
- a non-copy place live on some edges and consumed on others becomes
  `MaybeConsumed`
- the resource shape for a shared place must agree across incoming edges
- facts survive only if all incoming edges prove the same fact
- obligations and loans must agree across incoming edges unless the join is an
  explicit control-flow construct that carries them
- every surviving obligation or loan must still refer to a live resource

Using a `MaybeConsumed` place reports `PROOF_MAYBE_CONSUMED_AFTER_JOIN`.

### Loop Backedges

```text
Gamma; S |- loopBackedge => ok
```

A loop backedge is legal only when no linear obligation, stream loan, private
builder obligation, or non-invariant affine wrapper is live across the edge.
Loop facts survive only when they are loop invariants or facts about unchanged
copy values. This makes `continue` equivalent to an explicit backedge check.

### Entailment

```text
Gamma; S |= fact
```

The first entailment engine supports:

- exact stored facts
- branch refinements from `if`, `match`, and `while let`
- simple comparisons and interval facts over integers
- facts returned by `predicate fn`
- layout facts produced by the layout layer
- trusted postconditions from intrinsic/platform contracts

It does not use source comments, hidden provenance facts, ordinary functions, or
platform calls to prove source `requires`.

### Calls

```text
Gamma; S |- call f(args) => S'
```

Calls check:

- callee availability and function kind
- argument modes
- required facts
- consumed arguments
- returned resources and postconditions
- terminal/platform restrictions

Every call site must prove `requires` before ownership changes are committed.
If a fallible call may consume an affine or linear input, the callee must return
an `Attempt`-like shape describing what happens on success and error.

Ordinary functions cannot hide terminal discharge of session-bound or linear
tokens. A session-bound token must be discharged by a statically known terminal
function or private platform function in the active proof context.

### Exits

```text
Gamma; S |- exit return => ok
Gamma; S |- exit break => ok
Gamma; S |- exit continue => ok
Gamma; S |- exit yield => ok
Gamma; S |- exit question => ok
Gamma; S |- exit panic => ok
```

An exit is legal only when the state satisfies the exit contract:

- no live linear obligations, unless the function's return type explicitly
  carries them
- no live stream loans
- no private builder/state obligations that require closing
- no consumed value is used by the exit expression
- `?` is legal only when the function return type can carry the error and all
  consumed affine inputs are accounted for by `Attempt`
- `panic` does not discharge obligations in this model
- `yield` is legal only when no linear obligations or stream loans are live

## Function Kinds

```text
ordinary fn
  may use copy and borrowed values
  may move explicit consume parameters
  may not terminally discharge session-bound tokens unless the callee contract
  returns a new explicit owner

predicate fn
  pure proof code
  may observe stable facts
  may not mutate, consume, call platform code, or depend on unstable state

terminal fn
  closes linear/session obligations
  every path must discharge required inputs
  may call terminal or private platform functions
  terminal discharge graph must be acyclic

private platform fn
  trusted boundary inside edge/private code
  checked by signature, requires, and explicit consume parameters
  may produce trusted sealed tokens and facts

constructor fn
  may consume affine inputs stored into the constructed owner
  cannot duplicate stored affine fields
```

## Trusted Axioms

Intrinsics and private platform functions are trusted only at their explicit
contract boundary:

```text
Axiom
  signature
  required facts
  consumed capabilities
  produced capabilities
  hidden brands
  source-visible postconditions
  lowering id
```

The caller must prove required facts and provide consumed capabilities. The
checker then applies the axiom's postconditions. The caller's package path does
not matter; stdlib code and application code satisfy the same obligations.

Private platform functions cannot use `ensures`. Trusted return facts must be
encoded in sealed token types and axiom postconditions.

## Source Feature Mapping

### `take` And Streams

`take streamExpression as batch:` lowers to:

```text
call streamExpression only in take position
openLoan(receiverPath) as streamLoan
create Stream resource batch with brand StreamSession(batch)
for each yielded item:
  move-yield item with brand StreamSession(batch)
  openObligation(item) as itemObligation
body must discharge itemObligation exactly once
close streamLoan after iteration
```

Streams cannot be bound outside `take`, stored, returned, indexed, copied, or
iterated twice. Re-entering a stream while an item obligation is live is illegal.

### Validation

`Packet.validate(source=buffer, ...)` returns a single-use validation result:

```text
Validation[Packet, PacketReject, ReadableBuffer]
  source = buffer
  brand = buffer.brand
```

It must be exhaustively matched once inside the source buffer's `take` scope.

On `Ok(packet)`:

- the source buffer is consumed into `packet`
- `packet` receives the source stream/session brand
- the live source-buffer obligation transfers to `packet`
- only terminal functions accepting that brand may close it

The validation result's source brand must match the source buffer brand. A
non-validation resource cannot be matched as a validation result.

On `Err(rejected)`:

- the source buffer remains live
- `rejected` is ordinary data
- the buffer obligation still must be discharged

### Terminal Functions

Terminal functions are checked locally and globally. Locally, every path through
the body must discharge required linear/session inputs. Globally, the graph of
terminal-to-terminal calls must be acyclic and must eventually reach private
platform discharge. A closed graph of terminal helpers that only call each other
is rejected even when it is acyclic.

Ordinary functions cannot hide terminal discharge. Interfaces cannot provide
dynamic terminal dispatch. Destructors cannot discharge obligations implicitly.

### Private State

Private classes are affine state tokens. Non-predicate methods advance the state
generation:

```text
builder@generation3 -> builder@generation4
```

Predicate facts are generation-specific. A fact proven for
`builder@generation3` is not valid for `builder@generation4`.

Private state cannot be copied, stored in ordinary state, returned from public
APIs, or dropped without a checked close/seal operation.

### Layout Facts

Layout checking creates concrete facts after monomorphization:

```text
layout.fixedFits(Packet)
layout.dynamicRange(Packet.payload)
layout.fits(Packet)
```

Dynamic field reads require fixed fields and dynamic ranges to be proven in the
validated-buffer order. `layout.fits` is a containment fact, not permission to
read undeclared trailing bytes.

### Attempt

`Attempt[Ok, Err, Inputs]` models fallible calls that may consume affine inputs.

On success:

- listed inputs may be consumed
- success result owns any produced value

On error:

- the call must return, retain, or discharge each listed input
- `?` may propagate only when the return type carries the resulting ownership
  shape

A plain `Result` cannot hide a fallible consume of affine or linear values.
The first checker rejects `Attempt` consumes over places with live terminal
obligations unless the callee contract explicitly carries or discharges that
obligation shape.

### Multicore Transfer

Core transfer changes `ownerCore` metadata. A value can move between cores only
through a checked transfer type such as a bounded move ring. Transfer requires
`CoreMovableOwned`. Live stream items, validated buffers, edge-internal tokens,
platform tokens, and validation results do not satisfy that bound.

A value with an overlapping live obligation cannot be transferred to another
core by an ordinary move. Such a transfer would need a checked owner type whose
contract carries the obligation state.

### Wrappers And Ordinary Storage

Resource kind lifts through ordinary wrappers. If a wrapper may contain an
affine or linear value, the wrapper is itself non-copy and non-droppable unless
the wrapper type is a checked owner with explicit discharge rules.

Ordinary storage such as dataclass fields, ordinary class fields, lists, maps,
and unbounded containers cannot hide live obligations. Static collections are
allowed only when their type declares bounded ownership and discharge behavior.

## Diagnostics

Proof diagnostics should name:

- failing judgment
- source origin
- resource place
- resource kind and status
- obligation or loan ID
- relevant brand or generation when safe to reveal
- counterexample path through blocks and exits

Example:

```text
PROOF_LIVE_OBLIGATION_ON_EXIT
  return crosses live obligation buffer opened by take buffer
  path: block 3 -> branch Err -> return
```

Hidden brands should be described in source terms:

```text
packet belongs to stream session opened at take self.rx_a.receive()
but return_rx was called on session opened at take self.rx_b.receive()
```

## Worked Examples

Each example below corresponds to a runnable assertion in
`tests/unit/proof-core-reference.test.ts`.

### 1. Use After Consume

Source shape:

```wr
self.tx.send(buffer=buffer, len=0)
buffer.write_u8(offset=0, value=1)
```

Initial state:

```text
buffer: Linear, Live
```

Judgment:

```text
Gamma; S |- consume buffer => S1
Gamma; S1 |- use buffer
```

Rejected because `buffer` is already consumed. Diagnostic:
`PROOF_USE_AFTER_MOVE`.

### 2. Exit With Live Linear Obligation

Source shape:

```wr
take buffer:
    return buffer.len
```

Initial state after `take`:

```text
buffer: Linear, Live
obligations: buffer must be discharged
```

Judgment:

```text
Gamma; S |- exit return
```

Rejected because a live obligation crosses `return`. Diagnostic:
`PROOF_LIVE_OBLIGATION_ON_EXIT`.

### 3. Touching A Loaned Path

Source shape:

```wr
take self.rx.receive() as batch:
    let again = self.rx.receive()
```

Initial state after stream open:

```text
self.rx: Affine, Live
loans: self.rx loaned by batch
```

Judgment:

```text
Gamma; S |- use self.rx
```

Rejected because the stream loan covers `self.rx`. Diagnostic:
`PROOF_PLACE_LOANED`.

### 4. Wrong Stream Membership

Source shape:

```wr
take self.rx_a.receive() as a:
    take self.rx_b.receive() as b:
        for buffer in a:
            take buffer:
                b.drop_rx(buffer=buffer, rejected=rejected)
```

Initial state:

```text
buffer: Linear, brand StreamSession(a)
obligation: buffer must close through StreamSession(a)
```

Judgment:

```text
Gamma; S |- discharge buffer using StreamSession(b)
```

Rejected because the terminal receiver brand does not match the buffer brand.
Diagnostic: `PROOF_BRAND_MISMATCH`.

### 5. Matching Validation Twice

Source shape:

```wr
let result = Packet.validate(source=buffer, limits=limits)
match result: ...
match result: ...
```

Initial state:

```text
result: Validation, Live, single-use
```

Judgment:

```text
Gamma; S |- consume result => S1
Gamma; S1 |- consume result
```

Rejected because validation results are single-use. Diagnostic:
`PROOF_VALIDATION_ALREADY_MATCHED`.

### 6. Platform Requires Without Exact Fact

Source shape:

```wr
if len <= buffer.capacity:
    self.publish_tx(buffer=buffer, len=len)

private platform fn publish_tx(...)
    requires:
        len <= buffer.initialized_prefix
```

Initial state:

```text
facts: len <= buffer.capacity
```

Judgment:

```text
Gamma; S |= len <= buffer.initialized_prefix
```

Rejected because capacity does not prove initialized bytes. Diagnostic:
`PROOF_REQUIREMENT_NOT_PROVEN`.

### 7. Stale Predicate Fact After Private-State Advance

Source shape:

```wr
if builder.can_insert(descriptor=ready.descriptor):
    builder.note_progress()
    builder.attach_readable(ready=ready)
```

Initial state:

```text
builder@generation0
facts: builder@generation0.can_insert(desc)
```

After `note_progress`:

```text
builder@generation1
```

Judgment:

```text
Gamma; S |= builder@generation1.can_insert(desc)
```

Rejected because facts from the old private state do not carry forward.
Diagnostic: `PROOF_STALE_PRIVATE_FACT`.

### 8. Fallible Consume Without Attempt

Source shape:

```wr
let machine_plan = plan_machine_untyped(devices={ net0: net0 })?
```

Initial state:

```text
net0: Affine, Live
callee return: Result[MachinePlan, BootError]
```

Judgment:

```text
Gamma; S |- call plan_machine_untyped(consumes net0)
```

Rejected because a fallible consuming call must use an `Attempt`-like contract
that accounts for success and error ownership. Diagnostic:
`PROOF_ATTEMPT_REQUIRED`.

### 9. Terminal Discharge Cycle

Source shape:

```wr
terminal fn a(self, buffer: WritableBuffer):
    self.b(buffer=buffer)

terminal fn b(self, buffer: WritableBuffer):
    self.a(buffer=buffer)
```

Initial graph:

```text
a -> b
b -> a
```

Judgment:

```text
Gamma |- terminalGraph acyclic
```

Rejected because terminal discharge graphs must be acyclic. Diagnostic:
`PROOF_TERMINAL_CYCLE`.

### 10. Dynamic Layout Read Before Fixed Fit

Source shape:

```wr
require:
    payload[0] == 1 else PacketReject(...)
    source.len >= 2 else PacketReject(...)
```

Initial state:

```text
facts: none for layout.fixedFits(Packet)
```

Judgment:

```text
Gamma; S |- read Packet.payload
```

Rejected because fixed-field fit has not been proven before dynamic field
access. Diagnostic: `PROOF_LAYOUT_FIT_NOT_PROVEN`.

## Second-Pass Pressure Tests

These examples cover the holes most likely to make the language unsound after
the first proof-core pass.

### 11. Branch Join With Maybe-Consumed Resource

Source shape:

```wr
if condition:
    self.tx.send(buffer=buffer, len=0)

buffer.write_u8(offset=0, value=1)
```

Incoming states:

```text
then: buffer Consumed
else: buffer Live
```

Join:

```text
Gamma; S_then join S_else => buffer MaybeConsumed
Gamma; S_join |- use buffer
```

Rejected because the post-join path cannot prove `buffer` is live. Diagnostic:
`PROOF_MAYBE_CONSUMED_AFTER_JOIN`.

### 12. Loop Backedge With Live Obligation

Source shape:

```wr
loop:
    take buffer:
        continue
```

State at backedge:

```text
obligations: buffer must be discharged
```

Judgment:

```text
Gamma; S |- loopBackedge
```

Rejected because the next loop iteration would start while the previous
iteration still owns a live obligation. Diagnostic:
`PROOF_LIVE_OBLIGATION_ON_LOOP_BACKEDGE`.

### 13. Dropping Wrapper That May Contain Linear Resource

Source shape:

```wr
let maybe = self.tx.acquire_tx()
return
```

State:

```text
maybe: Option[WritableBuffer], non-copy, may contain live TX obligation
```

Judgment:

```text
Gamma; S |- drop maybe
```

Rejected because ordinary wrapper scope end cannot discharge the hidden
obligation. Diagnostic: `PROOF_RESOURCE_MUST_BE_HANDLED`.

### 14. Ordinary Helper Hiding Terminal Discharge

Source shape:

```wr
fn close_packet(self, batch: RxBatch, packet: Packet):
    batch.return_rx(packet=packet)
```

Judgment:

```text
Gamma; S |- call ordinary close_packet(packet)
```

Rejected because ordinary functions cannot terminally discharge session-bound
tokens. Diagnostic: `PROOF_ORDINARY_FUNCTION_CANNOT_DISCHARGE`.

### 15. Aggregate Use After Field Move

Source shape:

```wr
let moved_tx = self.tx
self.tick()
```

State:

```text
self: Live
self.tx: Consumed
```

Judgment:

```text
Gamma; S |- use self
```

Rejected because `self` is partially moved. Diagnostic:
`PROOF_PARTIAL_MOVE`.

### 16. Validation Ok Transfers Obligation

Source shape:

```wr
match Packet.validate(source=buffer, limits=limits):
    case Ok(packet):
        batch.return_rx(packet=packet)
```

Ok branch state:

```text
buffer: Consumed
packet: Linear, brand StreamSession(batch)
obligation: transferred from buffer to packet
```

The original `buffer` cannot be used after validation success. The packet can be
closed only by a terminal receiver with the same stream brand. A mismatched
receiver reports `PROOF_BRAND_MISMATCH`.

### 17. Cross-Core Transfer Of Session Token

Source shape:

```wr
let pushed = self.outbox.push(item=packet)
```

State:

```text
packet: ValidatedBuffer, brand StreamSession(batch)
```

Judgment:

```text
Gamma; S |- transferToCore packet core1
```

Rejected because session-bound validated buffers do not satisfy
`CoreMovableOwned`. Diagnostic: `PROOF_NOT_CORE_MOVABLE`.

### 18. Shadowing A Live Resource

Source shape:

```wr
take buffer:
    let buffer = 1
```

Judgment:

```text
Gamma; S |- bind buffer
```

Rejected because the source name already denotes a live non-copy resource.
Diagnostic: `PROOF_SHADOWS_LIVE_RESOURCE`.

## Third-Pass Break Tests

These examples were added after trying to break the proof rules through aliasing,
branch merging, stale fact retention, and terminal-helper escape hatches.

### 19. Whole Aggregate Use While A Field Is Loaned

Source shape:

```wr
take self.rx.receive() as batch:
    self.reset()
```

State:

```text
self: Affine, Live
self.rx: Affine, Live
loans: self.rx loaned by batch
```

Judgment:

```text
Gamma; S |- use self
```

Rejected because whole-aggregate use might observe, move, or overwrite the
loaned field. Disjoint sibling field use, such as `self.tx`, remains legal.
Diagnostic: `PROOF_PARTIAL_LOAN`.

### 20. Branch Join With Different Obligations

Source shape:

```wr
if condition:
    take buffer:
        mark_open(buffer)

return 0
```

Incoming states:

```text
then: obligation rx-buffer is live
else: no obligation
```

Join:

```text
Gamma; S_then join S_else
```

Rejected because implicit joins cannot invent a single obligation state from
different incoming obligation sets. Diagnostic:
`PROOF_BRANCH_OBLIGATION_MISMATCH`.

### 21. Branch Join With Different Loans

Source shape:

```wr
if condition:
    take self.rx.receive() as batch:
        maybe_continue()

self.rx.poll()
```

Incoming states:

```text
then: self.rx loaned
else: no loan
```

Join:

```text
Gamma; S_then join S_else
```

Rejected because implicit joins cannot merge different active loan sets.
Diagnostic: `PROOF_BRANCH_LOAN_MISMATCH`.

### 22. Old Private-State Fact Still Present After Advance

Source shape:

```wr
if builder.can_insert(descriptor=desc):
    builder.note_progress()
    trusted_insert(builder=builder, descriptor=desc)
```

State before mutation:

```text
builder@generation0
facts: builder@generation0.can_insert(desc)
```

After mutation:

```text
builder@generation1
```

Judgment:

```text
Gamma; S |= builder@generation0.can_insert(desc)
```

Rejected because generation advance prunes old private facts instead of leaving
stale facts available to later requires clauses. Diagnostic:
`PROOF_STALE_PRIVATE_FACT`.

### 23. Fact About Consumed Resource

Source shape:

```wr
if len <= buffer.initialized_prefix:
    self.tx.send(buffer=buffer, len=len)
    trusted_use_len(buffer=buffer, len=len)
```

State after send:

```text
buffer: Consumed
facts before send: len <= buffer.initialized_prefix
```

Judgment:

```text
Gamma; S |= len <= buffer.initialized_prefix
```

Rejected because facts mentioning a consumed place are invalidated with the
place. Diagnostic: `PROOF_REQUIREMENT_NOT_PROVEN`.

### 24. Dynamic Layout Read Without Dynamic Range

Source shape:

```wr
if layout.fixedFits(Packet):
    require:
        Packet.payload[0] == 1 else PacketReject(...)
```

State:

```text
facts: layout.fixedFits(Packet)
missing: layout.dynamicRange(Packet.payload)
```

Judgment:

```text
Gamma; S |- read Packet.payload
```

Rejected because fixed-field fit does not prove the dynamic payload range.
Diagnostic: `PROOF_LAYOUT_DYNAMIC_RANGE_NOT_PROVEN`.

### 25. Field Use After Aggregate Consume

Source shape:

```wr
let moved_self = self
self.tx.flush()
```

State:

```text
self: Consumed
self.tx: was a child of self
```

Judgment:

```text
Gamma; S |- use self.tx
```

Rejected because consuming an aggregate consumes all owned subplaces.
Diagnostic: `PROOF_USE_AFTER_MOVE`.

### 26. Linear Obligation On Copy Value

Source shape:

```wr
take count:
    terminal_close(count)
```

State:

```text
count: Copy, Live
```

Judgment:

```text
Gamma; S |- openObligation count as count-close
```

Rejected because linear obligations only attach to non-copy resources.
Diagnostic: `PROOF_OBLIGATION_KIND_MISMATCH`.

### 27. Duplicate Obligation Identifier

Source shape:

```wr
take left:
    take right:
        ...
```

Lowering bug:

```text
openObligation left as rx-buffer
openObligation right as rx-buffer
```

Rejected because obligation IDs are stable proof identities and cannot be
silently overwritten. Diagnostic: `PROOF_DUPLICATE_OBLIGATION_ID`.

### 28. Duplicate Loan Identifier

Source shape:

```wr
take self.rx.receive() as first:
    take self.tx.acquire() as second:
        ...
```

Lowering bug:

```text
openLoan self.rx as edge-session
openLoan self.tx as edge-session
```

Rejected because loan IDs are stable proof identities and cannot be silently
overwritten. Diagnostic: `PROOF_DUPLICATE_LOAN_ID`.

### 29. Terminal Graph Without Platform Discharge

Source shape:

```wr
terminal fn closePacket(packet: Packet):
    sanitizeOnly(packet=packet)

terminal fn sanitizeOnly(packet: Packet):
    return
```

Graph:

```text
closePacket -> sanitizeOnly
platform discharge set: platformDischarge
```

Judgment:

```text
Gamma |- terminalGraph reachesPlatformDischarge
```

Rejected because an acyclic terminal helper graph still must reach a private
platform discharge that actually closes the obligation. Diagnostic:
`PROOF_TERMINAL_NO_PLATFORM_DISCHARGE`.

## Fourth-Pass Break Tests

These examples attack validation provenance, obligation overlap, branch resource
identity, and ordinary ownership operations that might otherwise hide terminal
state.

### 30. Validation Ok With Mismatched Source Brand

Source shape:

```wr
let validation = Packet.validate(source=buffer_b, limits=limits)
match validation:
    case Ok(packet):
        return_rx_a(packet=packet)
```

State:

```text
buffer: Linear, brand StreamSession(a)
validation: Validation, brand StreamSession(b)
```

Judgment:

```text
Gamma; S |- matchValidationOk validation buffer packet
```

Rejected because validation success can only consume the exact branded source it
validated. Diagnostic: `PROOF_BRAND_MISMATCH`.

### 31. Matching A Non-Validation Resource

Source shape:

```wr
match buffer:
    case Ok(packet): ...
```

State:

```text
buffer: Linear, Live
```

Judgment:

```text
Gamma; S |- matchValidation buffer
```

Rejected because only single-use validation results may be matched through the
validation judgment. Diagnostic: `PROOF_RESOURCE_KIND_MISMATCH`.

### 32. Droppable Resource With Live Obligation

Source shape:

```wr
let slot = acquire_slot()
mark_must_close(slot)
drop slot
```

State:

```text
slot: Affine, droppable by type
obligation: slot-close is live
```

Judgment:

```text
Gamma; S |- drop slot
```

Rejected because explicit droppability does not override a live terminal
obligation. Diagnostic: `PROOF_RESOURCE_HAS_LIVE_OBLIGATION`.

### 33. Core Transfer With Live Obligation

Source shape:

```wr
take packet:
    outbox.push_to_core1(packet=packet)
```

State:

```text
packet: Linear, CoreMovableOwned
obligation: packet-close is live
```

Judgment:

```text
Gamma; S |- transferToCore packet core1
```

Rejected because ordinary core transfer cannot move an unclosed obligation to a
different proof context. Diagnostic: `PROOF_RESOURCE_HAS_LIVE_OBLIGATION`.

### 34. Branch Join With Different Resource Metadata

Source shape:

```wr
if condition:
    packet = packet_from_rx_a()
else:
    packet = packet_from_rx_b()

return_rx_a(packet=packet)
```

Incoming states:

```text
then: packet brand StreamSession(a)
else: packet brand StreamSession(b)
```

Join:

```text
Gamma; S_then join S_else
```

Rejected because a stable place cannot silently change brand, kind, generation,
drop rule, or core ownership across a join. Diagnostic:
`PROOF_BRANCH_RESOURCE_MISMATCH`.

### 35. Obligation Over Maybe-Consumed Place

Source shape:

```wr
take buffer:
    if condition:
        hidden_consume(buffer)
    return_rx(buffer=buffer)
```

Incoming states:

```text
then: buffer Consumed, obligation rx-buffer still live
else: buffer Live, obligation rx-buffer live
```

Join:

```text
Gamma; S_then join S_else
```

Rejected because an obligation cannot survive a join if its place is
`MaybeConsumed`. Diagnostic: `PROOF_BRANCH_OBLIGATION_RESOURCE_MISMATCH`.

### 36. Two Obligations On The Same Place

Source shape:

```wr
take buffer as rx_buffer:
    take buffer as tx_buffer:
        ...
```

Lowering bug:

```text
openObligation buffer as rx-buffer
openObligation buffer as tx-buffer
```

Rejected because a single owned resource cannot carry two independent terminal
obligations. Diagnostic: `PROOF_PLACE_ALREADY_OBLIGATED`.

### 37. Nested Obligations On Overlapping Places

Source shape:

```wr
take self:
    take self.tx:
        ...
```

State:

```text
self: Affine, Live
self.tx: Linear, Live
```

Judgment:

```text
Gamma; S |- openObligation self.tx as tx-close
```

Rejected when `self` already has a live obligation, because parent and child
obligations would permit double-close or partial-close ambiguity. Diagnostic:
`PROOF_PLACE_ALREADY_OBLIGATED`.

### 38. Copy Aggregate With Live Linear Child

Source shape:

```wr
let box = Box(item=linear_item)
drop box
```

State:

```text
box: Copy, Live
box.item: Linear, Live
```

Judgment:

```text
Gamma; S |- drop box
```

Rejected because the outer copy marker cannot erase the live non-droppable child
resource. Diagnostic: `PROOF_RESOURCE_CHILD_MUST_BE_HANDLED`.

### 39. Attempt Consume With Live Obligation

Source shape:

```wr
take buffer:
    fallible_send(buffer=buffer)?
```

State:

```text
buffer: Linear, Live
obligation: rx-buffer is live
callee return: Attempt[Ok, Err, buffer]
```

Judgment:

```text
Gamma; S |- call fallible_send(consumes buffer)
```

Rejected unless the `Attempt` contract explicitly carries or discharges the
obligation shape. The first checker rejects the generic consume. Diagnostic:
`PROOF_RESOURCE_HAS_LIVE_OBLIGATION`.

## Open Risks

The first production checker should explicitly test these risk areas:

- exact rules for affine-but-droppable versus affine-and-must-close values
- how much arithmetic entailment is needed before the first backend milestone
- diagnostic minimization for long counterexample paths
- representation of source-level names after monomorphization
- how private-state generation facts are displayed without exposing hidden
  compiler implementation details

These are implementation risks, not holes in the core contract. The checker
should keep them isolated behind the core judgments above.
