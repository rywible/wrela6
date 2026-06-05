# Proof-Derived Compiler Invariants

This document records the compiler invariants derived from the Lean proof
sidecar in `proof-model/`. It is a compiler-facing guide: it says what future
HIR, monomorphization, layout, Proof MIR, and checker implementations must
preserve.

The Lean model does not prove the TypeScript compiler. It validates the
proof-relevant language core and gives the compiler a set of invariants that
should become data structures, checks, diagnostics, and tests.

## Lean Sources

| Model     | Compiler-relevant result                                                                         |
| --------- | ------------------------------------------------------------------------------------------------ |
| `Model2`  | Fallible `Attempt` consumption composes with no-open-obligation safety.                          |
| `Model3`  | Private predicate facts are scoped to a private-state generation.                                |
| `Model4`  | Session member tokens are separate from raw obligation IDs.                                      |
| `Model5`  | Receiver places are field-sensitive; disjoint fields may remain usable.                          |
| `Model6`  | Validation is a single-use resource split, not an `Option`.                                      |
| `Model7`  | Terminal returns require discharge and no open obligations.                                      |
| `Model8`  | Unified checker closes loans, obligations, members, validations, sources, and packets on return. |
| `Model9`  | Proof MIR blocks inherit the unified checker safety theorem.                                     |
| `Model10` | Accepted terminal call graphs imply declarative reachability to platform.                        |
| `Model11` | Validated-buffer reads require ordered layout facts.                                             |
| `Model12` | The unified executable checker is sound against a separate declarative `Checked` relation.       |

## Reading Rules

- Treat these as language invariants, not implementation suggestions.
- If HIR or Proof MIR cannot represent one of these concepts explicitly, the
  compiler is missing proof-relevant data.
- If a check needs control-flow, branch convergence, or exit-path reasoning, put
  it in Proof MIR instead of HIR.
- If a diagnostic depends on source shape, HIR should retain enough origin IDs
  for Proof MIR to report the error without reverse-engineering syntax.
- The initial implementation should use exact state convergence at joins. A
  later implementation may replace exact equality with a proven canonical state
  equivalence relation.

## Unified Closure

An accepted returned outcome must not leak proof-relevant state.

At a return boundary, the state must have:

- no live place loans
- no open obligations
- no live session members
- no pending validation results
- no live validation source buffers
- no live validated packet tokens

For terminal returns, the state must also prove that terminal discharge was
reached.

Compiler consequence:

- Proof MIR should model a single resource state that contains all of the above,
  not separate checkers that can disagree.
- `return`, `yield`, `break`, `continue`, `?`, `panic`, and terminal exits must
  all be treated as exit edges with resource-state preconditions.
- Ordinary `return` requires resource closure. Terminal `return` requires
  resource closure plus terminal reachability.

## Proof-Relevant State Is Explicit

The compiler must not hide resources inside ordinary values.

Proof MIR state needs explicit representations for:

- resource-bearing places, including receiver fields such as `self.rx`
- moved or consumed places
- field loans
- obligations
- session/member brands
- pending validations
- validation source tokens and output packet tokens
- private-state generations
- proof facts and fact origins
- terminal reachability
- layout facts

Compiler consequence:

- HIR must attach stable IDs for obligations, sessions, brands, places,
  validation results, attempt inputs, private state transitions, call-site
  requirements, and fact origins.
- Monomorphization must instantiate these IDs; it must not erase them.
- Proof MIR must preserve them through blocks and terminators.

## Places, Moves, And Loans

Place access is field-sensitive.

The model establishes:

- using a place requires that the place is still owned and has no conflicting
  live loan
- moving `self.rx` makes `self.rx` unavailable
- moving a field makes whole-`self` unavailable as an intact object
- a loan of `self.rx` blocks `self` and `self.rx`
- a loan of `self.rx` does not block disjoint `self.tx`
- returning with any live loan is rejected

Compiler consequence:

- Represent places as structured paths, not strings.
- Receiver-mode checking should lower to place operations in Proof MIR.
- A whole-object use conflicts with any live field loan.
- A field use conflicts only with loans of the same field or whole object.
- The first checker may support only shallow field paths, but the IR should not
  preclude deeper paths.

## Obligations And Session Members

Session membership is not the same thing as "some obligation exists".

The model establishes:

- opening a stream/session member records both an obligation and a member token
- member tokens contain session and token identity
- discharge must match the exact member/session it is authorized to close
- discharging through the wrong session is rejected
- returned states contain no live members and no open obligations

Compiler consequence:

- Stream-yielded buffers, validated packets, edge-internal tokens, and terminal
  arguments need hidden membership/provenance brands.
- Terminal functions must consume the specific member they are authorized to
  close.
- Ordinary helper functions must not be able to erase or rebrand session-bound
  tokens.
- Diagnostics should name both the token and the expected session when a close
  is misrouted.

## Validation

Validation is a single-use resource split.

The model establishes:

- `validate` creates a pending validation result tied to a source and packet
  identity
- matching consumes the pending validation result
- the `Ok` arm starts with the source consumed into a packet
- the `Err` arm starts with the source still live and no packet
- both arms must converge to the same resource state
- a validation result cannot be stored, returned, copied, matched twice, or
  ignored

Compiler consequence:

- Validation cannot lower to ordinary `Option` or `Result` before proof checks.
- Proof MIR should have explicit `Validate` and `MatchValidation` operations.
- `Ok` and `Err` arms must be checked from different input resource states.
- The join after a validation match must compare the full proof/resource state.
- Diagnostics should report which arm leaks or changes ownership differently.

## Attempt

`Attempt` is the fallible sibling of validation for affine consumption.

The model establishes:

- success may consume an input
- error starts from the original input state
- the success and error paths must converge to the same resulting resource state
- after an attempt, a value is usable only if both paths leave it usable

Compiler consequence:

- Fallible calls that consume affine inputs must lower to explicit
  attempt-like Proof MIR operations.
- `?` over an affine-consuming call is legal only if the error edge carries,
  returns, or discharges the consumed resource consistently.
- Ordinary `Result` is not enough to model ownership unless it carries explicit
  resource obligations.

## Private State And Facts

Predicate facts are scoped to private-state generation.

The model establishes:

- proving a fact records the current private-state generation
- advancing private state increments the generation and clears old facts
- requiring a fact succeeds only for the current generation
- stale facts cannot satisfy platform or intrinsic preconditions

Compiler consequence:

- Private state tokens need generation or version identity in HIR and Proof MIR.
- Non-predicate private calls that advance state must invalidate facts tied to
  the old state.
- Predicate calls may produce facts, but ordinary/terminal/platform calls must
  not be usable as proof functions.
- Diagnostics should identify stale facts by their origin and the state
  transition that invalidated them.

## Terminal Closure

Terminal closure is both a local resource invariant and a whole-image graph
invariant.

The model establishes:

- terminal return requires no live proof/resource state
- terminal return also requires that discharge was reached
- a terminal body reaches platform if it calls platform directly, calls another
  terminal body that reaches platform, or branches where every branch reaches
  platform
- fallthrough, missing terminal targets, self-cycles, and mutual terminal cycles
  are rejected

Compiler consequence:

- Terminal functions need a whole-image terminal call graph after
  monomorphization.
- The terminal graph checker should produce a certificate or fact consumed by
  Proof MIR.
- Terminal dispatch must be statically known. Dynamic dispatch over terminal
  ownership closure is not part of the initial language model.
- A terminal function may delegate closure only to platform functions or other
  certified terminal functions.

## Layout Facts

Validated-buffer reads require ordered layout facts.

The model establishes:

- `layout.fits(end)` proves the source contains bytes up to `end`
- fixed fields may be read only after `layout.fits(fixedEnd)`
- dynamic payload bounds may be derived only after fixed fields are read
- dynamic payload reads require both `payloadEnd(end)` and `layout.fits(end)`
- `layout.fits(end)` cannot be assumed when `end` exceeds the source length

Compiler consequence:

- Layout facts are produced after monomorphization and representation/layout
  computation.
- Proof MIR should carry concrete layout facts such as fixed-end offsets,
  derived payload ends, and `layout.fits` proofs.
- Validated-buffer field access should lower only after the needed facts are
  visible to the checker.
- Arithmetic entailment can start structural and bounded. Do not require a
  general SMT solver for the first implementation.

## CFG And Joins

Branches and fallible splits must converge.

The model establishes:

- block bodies must continue; returns belong to terminators
- branch targets must produce the same certified outcome
- validation and attempt joins compare the full proof/resource state
- bounded CFG checking inherits the unified return-safety theorem

Compiler consequence:

- Proof MIR should normalize structured source control flow into explicit
  blocks and terminators before resource checking.
- Joins should initially require exact state equality.
- If exact equality becomes too strict, introduce a canonical state equivalence
  relation and prove/test it separately.
- Diagnostics should report the left and right incoming states at failed joins.

## Checker Architecture

The compiler checker should have two distinguishable layers:

- executable checker: computes acceptance or diagnostics
- declarative/reference semantics: specifies what accepted means

The Lean model now proves the executable unified checker sound against a
separate declarative `Checked` relation. The TypeScript implementation should
mirror this separation as much as is practical.

Compiler consequence:

- Keep a slow reference checker for Proof MIR even if production later gains an
  optimized dataflow checker.
- Differential-test optimized and reference checkers on generated Proof MIR.
- Prefer checkers that can emit proof traces or counterexample paths.
- Avoid special cases that mutate resource state outside the central checker.

## Diagnostics And Tests

Every invariant above should have:

- a direct unit test for the checker rule
- at least one invalid Wrela source-level test when the frontend can express it
- a Proof MIR reference-checker test
- a fuzz or differential test once the relevant generator exists

Priority negative cases:

- return/yield with a live obligation, member, loan, validation, source, or
  packet
- wrong-session stream close
- validation `Ok` arm leaks packet or `Err` arm leaks source
- attempt success consumes input but error does not converge
- stale private predicate fact after private-state advancement
- terminal fallthrough, terminal cycles, and missing terminal call targets
- dynamic payload read without both `payloadEnd` and `layout.fits`

## Implementation Checklist

HIR must retain:

- proof-relevant source origins
- resource places and receiver modes
- obligation/session/brand IDs
- validation and attempt IDs
- private-state transition IDs
- fact origins and call-site requirement IDs

Monomorphization must preserve and instantiate:

- resource kinds
- proof IDs
- terminal call graph nodes
- intrinsic contract edges
- validated-buffer identities

Layout must produce:

- fixed field offsets and ends
- derived dynamic ends
- `layout.fits` fact inputs
- ABI facts needed by platform calls

Proof MIR must contain:

- explicit blocks and terminators
- explicit resource operations
- explicit validation and attempt splits
- explicit terminal returns and terminal-call facts
- explicit layout and predicate facts
- enough origin data for diagnostics

The checker must reject:

- any exit that crosses live proof/resource state
- any terminal return without certified terminal reachability
- any branch, validation, or attempt join with divergent resource state
- any stale fact use
- any misrouted session/member discharge
- any validated-buffer read without the required layout facts
