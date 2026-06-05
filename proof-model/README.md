# Wrela Proof Model

This sidecar is an early Lean model for Wrela's proof-relevant core. It is not
the compiler and it is not yet the whole language. Its job is to pressure-test
the language model before the TypeScript checker exists.

Run:

```sh
lake build Wrela
```

The compiler-facing invariants derived from these models live in
`docs/design/proof-derived-compiler-invariants.md`.

## Models

- `Model0`: one affine value and at most one branded live obligation.
- `Model1`: multiple branded live obligations, branch joins, and an executable
  checker with a soundness theorem.
- `Model2`: fallible `Attempt`-style consumption. It proves checked Model 2
  programs erase/refine to checked Model 1 programs, so leak safety composes.
- `Model3`: private-state generations and predicate facts. Facts are scoped to
  the current private-state generation and cannot satisfy requirements after the
  private state advances.
- `Model4`: session member tokens separate from raw obligation brands. A token
  minted by one session cannot be discharged through another session.
- `Model5`: field-sensitive receiver places. Loaning `self.rx` blocks `self.rx`
  and whole-`self` access while leaving `self.tx` usable.
- `Model6`: validation flow. Ok consumes the source into a packet; Err preserves
  the source; the validation result is single-use; all paths must close source,
  packet, and pending validation before return.
- `Model7`: terminal closure. A terminal return must have reached a platform or
  terminal discharge and must have no open obligations.
- `Model8`: the first unified Proof MIR sketch. It puts field-sensitive places,
  loans, obligations, session members, validation state, private-state facts,
  terminal return modes, `yield`, branching, and `Attempt`-style fallible
  consumes into one executable checker.
- `Model9`: a bounded CFG-shaped Proof MIR checker. Blocks contain
  straight-line Model 8 proof commands, terminators perform jumps, branches, and
  returns, and accepted returned outcomes inherit Model 8's safety proof.
- `Model10`: terminal-function call graph closure. Direct platform discharge,
  terminal-call chains, and converging terminal branches are accepted; missing
  targets, fallthrough paths, self-cycles, and mutual cycles are rejected.
- `Model11`: validated-buffer layout fact ordering. Fixed fields and dynamic
  payload bytes can be read only after the relevant `layout.fits` and derived
  layout facts are present.
- `Model12`: declarative semantics for the unified Model 8 checker. It proves
  that the executable checker is sound against a separate `Checked` relation,
  then derives return-safety facts from that relation.

## Current Theorem Shape

The main invariant is:

```text
if the checker accepts a returning command,
then the returned resource state has no open obligations.
```

Model 2 also demonstrates the first composition pattern:

```text
Checked Model2 command
  -> erases to Checked Model1 command
  -> inherits Model1 no-open-obligations theorem
```

Model 3 keeps that resource invariant while adding private-state fact
invalidation.

Later models add parallel invariants:

```text
session member safety:
  accepted return -> no live members and no open obligations

field-loan safety:
  accepted return -> no live field loans

validation safety:
  accepted return -> no live source, validation result, or packet

terminal safety:
  accepted return -> terminal discharge reached and no open obligations
```

Model 8 starts collapsing those parallel invariants into one certified checker:

```text
check source command = some returned-outcome
  -> returned state has no live loans, obligations, members, validations,
     sources, or packets
  -> if the return mode is terminal, terminal discharge was reached
```

The checker itself returns an internal `Accepted` value carrying the safety proof;
the public `check` function erases that proof to an executable `Option Outcome`.

Model 9 then reuses that proof-carrying checker over compiler-shaped blocks:

```text
CFG block body commands must continue
terminators jump, branch, or return
branch targets must converge to the same certified outcome
accepted CFG return -> Model 8 closed-return theorem
```

Model 10 separately sketches the whole-image terminal call graph pass:

```text
terminal body reaches platform
terminal call target reaches platform
branch reaches platform only if every branch does
visited terminal function -> reject cycle
accepted check -> declarative ReachesPlatform proof
```

Model 11 sketches the validated-buffer layout discipline:

```text
layout.fits(end) proves the source contains bytes up to end
fixed fields require fits(fixedEnd)
dynamic bounds require fixed fields to have been read
dynamic payload reads require both payloadEnd(end) and fits(end)
accepted check -> declarative LayoutChecked proof
```

Model 12 answers the "too easy" concern around the proof-carrying checker:

```text
Model 8 executable check
  -> Model 12 declarative Checked semantics
  -> Checked safety theorem
  -> no leaked members/sources/etc. and terminal returns reached discharge
```

## Deliberate Omissions

This model does not yet cover:

- real Wrela syntax or HIR
- unbounded Proof MIR CFGs and loop invariants
- field-sensitive places beyond a two-field receiver in the unified model
- full `Validation` typing and generated validated-buffer field APIs
- `Attempt` result typing beyond fallible consumption/convergence
- integrating the terminal call graph certificate into Model 9 terminators
- richer arithmetic entailment, dominance, or ABI facts
- declarative completeness, meaning every semantically safe program is accepted
- lowering preservation from HIR to Proof MIR
