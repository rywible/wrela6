import Wrela.ProofMIR.Model1

/-!
Model 2 adds a small fallible-call shape that behaves like the resource-relevant
part of Wrela's `Attempt`.

`attemptConsume ok err` means:

* the call is allowed only when the affine input is available
* the success continuation starts after that input has been consumed
* the error continuation starts from the original state, so it must retain,
  consume, discharge, or return resources explicitly
* both continuations must produce the same outcome state before the attempt can
  be accepted

The important composition theorem is `checked_refines_model1`: every checked
Model 2 command erases to a checked Model 1 command. Model 2 therefore inherits
Model 1's no-open-obligations-on-return theorem instead of reproving leak safety
from scratch.
-/

namespace Wrela.ProofMIR.Model2

abbrev State := Model1.State
abbrev Outcome := Model1.Outcome

inductive Cmd where
  | base (command : Model1.Cmd)
  | seq (first second : Cmd)
  | branch (left right : Cmd)
  | attemptConsume (ok err : Cmd)
deriving Repr

def erase : Cmd -> Model1.Cmd
  | .base command =>
      command
  | .seq first second =>
      .seq (erase first) (erase second)
  | .branch left right =>
      .branch (erase left) (erase right)
  | .attemptConsume ok err =>
      .branch (.seq .consume (erase ok)) (erase err)

inductive Checked : State -> Cmd -> Outcome -> Prop where
  | base :
      Model1.Checked source command outcome ->
      Checked source (.base command) outcome

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

  | attemptContinue :
      source.valueAvailable = true ->
      Checked { source with valueAvailable := false } ok (.cont result) ->
      Checked source err (.cont result) ->
      Checked source (.attemptConsume ok err) (.cont result)

  | attemptReturn :
      source.valueAvailable = true ->
      Checked { source with valueAvailable := false } ok (.returned result) ->
      Checked source err (.returned result) ->
      Checked source (.attemptConsume ok err) (.returned result)

theorem checked_refines_model1
    {source : State}
    {command : Cmd}
    {outcome : Outcome}
    (checked : Checked source command outcome) :
    Model1.Checked source (erase command) outcome := by
  induction checked with
  | base baseChecked =>
      exact baseChecked

  | seqReturn _ firstRefines =>
      apply Model1.Checked.seqReturn
      exact firstRefines

  | seqContinue _ _ firstRefines secondRefines =>
      apply Model1.Checked.seqContinue
      · exact firstRefines
      · exact secondRefines

  | branchContinue _ _ leftRefines rightRefines =>
      apply Model1.Checked.branchContinue
      · exact leftRefines
      · exact rightRefines

  | branchReturn _ _ leftRefines rightRefines =>
      apply Model1.Checked.branchReturn
      · exact leftRefines
      · exact rightRefines

  | attemptContinue available _ _ okRefines errRefines =>
      apply Model1.Checked.branchContinue
      · apply Model1.Checked.seqContinue
        · apply Model1.Checked.consume
          exact available
        · exact okRefines
      · exact errRefines

  | attemptReturn available _ _ okRefines errRefines =>
      apply Model1.Checked.branchReturn
      · apply Model1.Checked.seqContinue
        · apply Model1.Checked.consume
          exact available
        · exact okRefines
      · exact errRefines

theorem returned_has_no_open_obligations
    {source : State}
    {command : Cmd}
    {result : State}
    (checked : Checked source command (.returned result)) :
    result.obligations = [] :=
  Model1.returned_has_no_open_obligations (checked_refines_model1 checked)

def check (source : State) : Cmd -> Option Outcome
  | .base command =>
      Model1.check source command

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

  | .attemptConsume ok err =>
      if source.valueAvailable then
        let successSource := { source with valueAvailable := false }
        match check successSource ok, check source err with
        | some (.cont okResult), some (.cont errResult) =>
            if okResult = errResult then
              some (.cont okResult)
            else
              none
        | some (.returned okResult), some (.returned errResult) =>
            if okResult = errResult then
              some (.returned okResult)
            else
              none
        | _, _ => none
      else
        none

theorem check_sound
    {source : State}
    {command : Cmd}
    {outcome : Outcome}
    (accepted : check source command = some outcome) :
    Checked source command outcome := by
  induction command generalizing source outcome with
  | base command =>
      simp [check] at accepted
      apply Checked.base
      exact Model1.check_sound accepted

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

  | attemptConsume ok err okSound errSound =>
      unfold check at accepted
      split at accepted
      · rename_i available
        let successSource := { source with valueAvailable := false }
        cases okResult : check successSource ok with
        | none =>
            simp [successSource, okResult] at accepted
        | some okOutcome =>
            cases errResult : check source err with
            | none =>
                simp [successSource, okResult, errResult] at accepted
            | some errOutcome =>
                cases okOutcome with
                | cont okState =>
                    cases errOutcome with
                    | cont errState =>
                        simp [successSource, okResult, errResult] at accepted
                        cases accepted with
                        | intro same outcomeEq =>
                          cases outcomeEq
                          apply Checked.attemptContinue
                          · exact available
                          · exact okSound okResult
                          · subst errState
                            exact errSound errResult
                    | returned _ =>
                        simp [successSource, okResult, errResult] at accepted
                | returned okState =>
                    cases errOutcome with
                    | cont _ =>
                        simp [successSource, okResult, errResult] at accepted
                    | returned errState =>
                        simp [successSource, okResult, errResult] at accepted
                        cases accepted with
                        | intro same outcomeEq =>
                          cases outcomeEq
                          apply Checked.attemptReturn
                          · exact available
                          · exact okSound okResult
                          · subst errState
                            exact errSound errResult
      · contradiction

theorem check_returned_has_no_open_obligations
    {source : State}
    {command : Cmd}
    {result : State}
    (accepted : check source command = some (.returned result)) :
    result.obligations = [] :=
  returned_has_no_open_obligations (check_sound accepted)

def clean : State :=
  { valueAvailable := true, obligations := [] }

def attemptBothPathsConsume : Cmd :=
  .seq
    (.attemptConsume
      (.base .skip)
      (.base .consume))
    (.base .ret)

example : check clean attemptBothPathsConsume = some (.returned { valueAvailable := false, obligations := [] }) := by
  rfl

def attemptErrorLeaksInput : Cmd :=
  .seq
    (.attemptConsume
      (.base .skip)
      (.base .skip))
    (.base .ret)

example : check clean attemptErrorLeaksInput = none := by
  rfl

def attemptClosesNestedObligations : Cmd :=
  .seq
    (.base (.openObligation 10))
    (.seq
      (.attemptConsume
        (.base (.dischargeObligation 10))
        (.seq (.base .consume) (.base (.dischargeObligation 10))))
      (.base .ret))

example : check clean attemptClosesNestedObligations = some (.returned { valueAvailable := false, obligations := [] }) := by
  rfl

end Wrela.ProofMIR.Model2
