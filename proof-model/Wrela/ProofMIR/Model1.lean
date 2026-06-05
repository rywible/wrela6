/-!
Model 1 extends Model 0 from "at most one live obligation" to a finite list of
live obligations, each branded by a session id.

This is still deliberately small:

* an affine value can be used or consumed only while available
* opening an obligation adds its session brand to the live-obligation list
* discharging requires a matching live session brand and removes one occurrence
* return requires the live-obligation list to be empty
* branches may join only when both arms produce the same outcome state

This starts to look like Wrela's nested session shape: a stream loan and a
yielded buffer obligation can be live at the same time, and both must be closed
before return/yield/other terminal exits.
-/

namespace Wrela.ProofMIR.Model1

structure State where
  valueAvailable : Bool
  obligations : List Nat
deriving Repr, DecidableEq

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
deriving Repr, DecidableEq

def NoOpenReturned : Outcome -> Prop
  | .cont _ => True
  | .returned result => result.obligations = []

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
      Checked source
        (.openObligation session)
        (.cont { source with obligations := session :: source.obligations })

  | dischargeObligation :
      session ∈ source.obligations ->
      Checked source
        (.dischargeObligation session)
        (.cont { source with obligations := source.obligations.erase session })

  | ret :
      source.obligations = [] ->
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

theorem returned_outcome_has_no_open_obligations
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
  | openObligation =>
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

theorem returned_has_no_open_obligations
    {source : State}
    {command : Cmd}
    {result : State}
    (checked : Checked source command (.returned result)) :
    result.obligations = [] :=
  returned_outcome_has_no_open_obligations checked

def check (source : State) : Cmd -> Option Outcome
  | .skip =>
      some (.cont source)

  | .use =>
      if source.valueAvailable then
        some (.cont source)
      else
        none

  | .consume =>
      if source.valueAvailable then
        some (.cont { source with valueAvailable := false })
      else
        none

  | .openObligation session =>
      some (.cont { source with obligations := session :: source.obligations })

  | .dischargeObligation session =>
      if session ∈ source.obligations then
        some (.cont { source with obligations := source.obligations.erase session })
      else
        none

  | .ret =>
      if source.obligations = [] then
        some (.returned source)
      else
        none

  | .seq first second =>
      match check source first with
      | none => none
      | some (.returned result) => some (.returned result)
      | some (.cont middle) => check middle second

  | .branch left right =>
      match check source left, check source right with
      | some (.cont leftResult), some (.cont rightResult) =>
          if leftResult = rightResult then
            some (.cont leftResult)
          else
            none
      | some (.returned leftResult), some (.returned rightResult) =>
          if leftResult = rightResult then
            some (.returned leftResult)
          else
            none
      | _, _ => none

theorem check_sound
    {source : State}
    {command : Cmd}
    {outcome : Outcome}
    (accepted : check source command = some outcome) :
    Checked source command outcome := by
  induction command generalizing source outcome with
  | skip =>
      simp [check] at accepted
      cases accepted
      exact Checked.skip

  | use =>
      unfold check at accepted
      split at accepted
      · cases accepted
        apply Checked.use
        assumption
      · contradiction

  | consume =>
      unfold check at accepted
      split at accepted
      · cases accepted
        apply Checked.consume
        assumption
      · contradiction

  | openObligation session =>
      simp [check] at accepted
      cases accepted
      exact Checked.openObligation

  | dischargeObligation session =>
      unfold check at accepted
      split at accepted
      · cases accepted
        apply Checked.dischargeObligation
        assumption
      · contradiction

  | ret =>
      unfold check at accepted
      split at accepted
      · cases accepted
        apply Checked.ret
        assumption
      · contradiction

  | seq first second firstSound secondSound =>
      unfold check at accepted
      cases firstResult : check source first with
      | none =>
          simp [firstResult] at accepted
      | some firstOutcome =>
          cases firstOutcome with
          | returned result =>
              simp [firstResult] at accepted
              cases accepted
              apply Checked.seqReturn
              exact firstSound firstResult
          | cont middle =>
              simp [firstResult] at accepted
              apply Checked.seqContinue
              · exact firstSound firstResult
              · exact secondSound accepted

  | branch left right leftSound rightSound =>
      unfold check at accepted
      cases leftResult : check source left with
      | none =>
          simp [leftResult] at accepted
      | some leftOutcome =>
          cases rightResult : check source right with
          | none =>
              simp [leftResult, rightResult] at accepted
          | some rightOutcome =>
              cases leftOutcome with
              | cont leftState =>
                  cases rightOutcome with
                  | cont rightState =>
                      simp [leftResult, rightResult] at accepted
                      cases accepted with
                      | intro same outcomeEq =>
                        cases outcomeEq
                        apply Checked.branchContinue
                        · exact leftSound leftResult
                        · subst rightState
                          exact rightSound rightResult
                  | returned _ =>
                      simp [leftResult, rightResult] at accepted
              | returned leftState =>
                  cases rightOutcome with
                  | cont _ =>
                      simp [leftResult, rightResult] at accepted
                  | returned rightState =>
                      simp [leftResult, rightResult] at accepted
                      cases accepted with
                      | intro same outcomeEq =>
                        cases outcomeEq
                        apply Checked.branchReturn
                        · exact leftSound leftResult
                        · subst rightState
                          exact rightSound rightResult

theorem check_returned_has_no_open_obligations
    {source : State}
    {command : Cmd}
    {result : State}
    (accepted : check source command = some (.returned result)) :
    result.obligations = [] :=
  returned_has_no_open_obligations (check_sound accepted)

def clean : State :=
  { valueAvailable := true, obligations := [] }

def nestedTakeLikeProgram : Cmd :=
  .seq (.openObligation 10)
    (.seq (.openObligation 20)
      (.seq (.dischargeObligation 20)
        (.seq (.dischargeObligation 10) .ret)))

example : Checked clean nestedTakeLikeProgram (.returned clean) := by
  unfold nestedTakeLikeProgram
  apply Checked.seqContinue
  · apply Checked.openObligation
  · apply Checked.seqContinue
    · apply Checked.openObligation
    · apply Checked.seqContinue
      · apply Checked.dischargeObligation
        simp
      · apply Checked.seqContinue
        · apply Checked.dischargeObligation
          simp
        · apply Checked.ret
          rfl

example : check clean nestedTakeLikeProgram = some (.returned clean) := by
  rfl

example : check { valueAvailable := true, obligations := [7] } .ret = none := by
  rfl

example : check { valueAvailable := true, obligations := [7] } (.dischargeObligation 8) = none := by
  rfl

example : check { valueAvailable := false, obligations := [] } .consume = none := by
  rfl

example
    (outcome : Outcome) :
    ¬ Checked { valueAvailable := true, obligations := [7] } .ret outcome := by
  intro checked
  cases checked with
  | ret closed =>
      simp at closed

example
    (outcome : Outcome) :
    ¬ Checked { valueAvailable := true, obligations := [7] } (.dischargeObligation 8) outcome := by
  intro checked
  cases checked with
  | dischargeObligation matching =>
      simp at matching

example
    (outcome : Outcome) :
    ¬ Checked { valueAvailable := false, obligations := [] } .consume outcome := by
  intro checked
  cases checked with
  | consume available =>
      cases available

end Wrela.ProofMIR.Model1
