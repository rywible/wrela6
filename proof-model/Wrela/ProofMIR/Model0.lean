/-!
Model 0 for Wrela's proof-relevant core.

This is intentionally tiny. It models one affine value and at most one live
linear obligation branded by a session id. The goal is not to model full Wrela;
it is to validate the smallest leak-prevention shape:

* an obligation can be opened only when no obligation is already live
* an obligation can be discharged only through the matching session
* return is legal only when no obligation is live
* using or consuming the affine value requires it to still be available

Later models can generalize the single obligation to a finite obligation map and
add explicit facts, Attempt, private-state generations, and layout-derived
claims.
-/

namespace Wrela.ProofMIR.Model0

structure State where
  valueAvailable : Bool
  obligation : Option Nat
deriving Repr

inductive Cmd where
  | skip
  | use
  | consume
  | openObligation (session : Nat)
  | dischargeObligation (session : Nat)
  | seq (first second : Cmd)
  | branch (left right : Cmd)
  | ret
deriving Repr

inductive Outcome where
  | cont (state : State)
  | returned (state : State)
deriving Repr

def NoOpenReturned : Outcome -> Prop
  | .cont _ => True
  | .returned result => result.obligation = none

inductive Checked : State -> Cmd -> Outcome -> Prop where
  | skip :
      Checked source .skip (.cont source)

  | use :
      source.valueAvailable = true ->
      Checked source .use (.cont source)

  | consume :
      source.valueAvailable = true ->
      Checked source .consume (.cont { source with valueAvailable := false })

  | openObligation :
      source.obligation = none ->
      Checked source (.openObligation session) (.cont { source with obligation := some session })

  | dischargeObligation :
      source.obligation = some session ->
      Checked source (.dischargeObligation session) (.cont { source with obligation := none })

  | ret :
      source.obligation = none ->
      Checked source .ret (.returned source)

  | seqReturn :
      Checked source first (.returned result) ->
      Checked source (.seq first second) (.returned result)

  | seqContinue :
      Checked source first (.cont middle) ->
      Checked middle second outcome ->
      Checked source (.seq first second) outcome

  | branchContinue :
      Checked source left (.cont result) ->
      Checked source right (.cont result) ->
      Checked source (.branch left right) (.cont result)

  | branchReturn :
      Checked source left (.returned result) ->
      Checked source right (.returned result) ->
      Checked source (.branch left right) (.returned result)

theorem returned_outcome_has_no_open_obligation
    {source : State}
    {command : Cmd}
    {outcome : Outcome}
    (checked : Checked source command outcome) :
    NoOpenReturned outcome := by
  induction checked with
  | skip =>
      trivial
  | use _ =>
      trivial
  | consume _ =>
      trivial
  | openObligation _ =>
      trivial
  | dischargeObligation _ =>
      trivial
  | ret closed =>
      exact closed
  | seqReturn _ firstSafe =>
      exact firstSafe
  | seqContinue _ _ _ secondSafe =>
      simpa using secondSafe
  | branchContinue _ _ _ _ =>
      trivial
  | branchReturn _ _ leftSafe _ =>
      exact leftSafe

theorem returned_has_no_open_obligation
    {source : State}
    {command : Cmd}
    {result : State}
    (checked : Checked source command (.returned result)) :
    result.obligation = none :=
  returned_outcome_has_no_open_obligation checked

def clean : State :=
  { valueAvailable := true, obligation := none }

example : Checked clean (.seq (.openObligation 7) (.seq (.dischargeObligation 7) .ret)) (.returned clean) := by
  apply Checked.seqContinue
  · apply Checked.openObligation
    rfl
  · apply Checked.seqContinue
    · apply Checked.dischargeObligation
      rfl
    · apply Checked.ret
      rfl

example
    (outcome : Outcome) :
    ¬ Checked { valueAvailable := true, obligation := some 7 } .ret outcome := by
  intro checked
  cases checked with
  | ret closed =>
      cases closed

example
    (outcome : Outcome) :
    ¬ Checked { valueAvailable := true, obligation := some 7 } (.dischargeObligation 8) outcome := by
  intro checked
  cases checked with
  | dischargeObligation matching =>
      cases matching

example
    (outcome : Outcome) :
    ¬ Checked { valueAvailable := false, obligation := none } .use outcome := by
  intro checked
  cases checked with
  | use available =>
      cases available

end Wrela.ProofMIR.Model0
