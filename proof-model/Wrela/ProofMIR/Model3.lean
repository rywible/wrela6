import Wrela.ProofMIR.Model2

/-!
Model 3 adds the proof-relevant part of Wrela private state:

* predicate facts are tied to the current private-state generation
* advancing private state increments the generation and clears visible facts
* a call requiring the current predicate fact is accepted only when a fact for
  the current generation is present

The resource state from Model 2 is embedded unchanged. This lets Model 3 keep
the no-open-obligations-on-return invariant while adding a separate theorem
pressure point: stale predicate facts cannot satisfy current-state requirements.
-/

namespace Wrela.ProofMIR.Model3

structure State where
  resources : Model2.State
  privateGeneration : Nat
  facts : List Nat
deriving Repr, DecidableEq

inductive Outcome where
  | cont (state : State)
  | returned (state : State)
deriving Repr, DecidableEq

def NoOpenReturned : Outcome -> Prop
  | .cont _ => True
  | .returned result => result.resources.obligations = []

def liftResourceOutcome (source : State) : Model2.Outcome -> Outcome
  | .cont resources =>
      .cont { source with resources := resources }
  | .returned resources =>
      .returned { source with resources := resources }

inductive Cmd where
  | resource (command : Model2.Cmd)
  | proveCurrentFact
  | advancePrivate
  | requireCurrentFact
  | seq (first second : Cmd)
  | branch (left right : Cmd)
  | ret
deriving Repr

inductive Checked : State -> Cmd -> Outcome -> Prop where
  | resource :
      Model2.Checked source.resources command resourceOutcome ->
      Checked source (.resource command) (liftResourceOutcome source resourceOutcome)

  | proveCurrentFact :
      Checked source
        .proveCurrentFact
        (.cont { source with facts := source.privateGeneration :: source.facts })

  | advancePrivate :
      Checked source
        .advancePrivate
        (.cont { source with privateGeneration := source.privateGeneration + 1, facts := [] })

  | requireCurrentFact :
      source.privateGeneration ∈ source.facts ->
      Checked source .requireCurrentFact (.cont source)

  | ret :
      source.resources.obligations = [] ->
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

theorem lifted_resource_outcome_has_no_open_obligations
    {source : State}
    {command : Model2.Cmd}
    {resourceOutcome : Model2.Outcome}
    (checked : Model2.Checked source.resources command resourceOutcome) :
    NoOpenReturned (liftResourceOutcome source resourceOutcome) := by
  cases resourceOutcome with
  | cont _ =>
      trivial
  | returned _ =>
      exact Model2.returned_has_no_open_obligations checked

theorem returned_outcome_has_no_open_obligations
    {source : State}
    {command : Cmd}
    {outcome : Outcome}
    (checked : Checked source command outcome) :
    NoOpenReturned outcome := by
  induction checked with
  | resource resourceChecked =>
      exact lifted_resource_outcome_has_no_open_obligations resourceChecked
  | proveCurrentFact =>
      trivial
  | advancePrivate =>
      trivial
  | requireCurrentFact _ =>
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
    result.resources.obligations = [] :=
  returned_outcome_has_no_open_obligations checked

def check (source : State) : Cmd -> Option Outcome
  | .resource command =>
      match Model2.check source.resources command with
      | none => none
      | some resourceOutcome => some (liftResourceOutcome source resourceOutcome)

  | .proveCurrentFact =>
      some (.cont { source with facts := source.privateGeneration :: source.facts })

  | .advancePrivate =>
      some (.cont { source with privateGeneration := source.privateGeneration + 1, facts := [] })

  | .requireCurrentFact =>
      if source.privateGeneration ∈ source.facts then
        some (.cont source)
      else
        none

  | .ret =>
      if source.resources.obligations = [] then
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
  | resource command =>
      unfold check at accepted
      cases resourceResult : Model2.check source.resources command with
      | none =>
          simp [resourceResult] at accepted
      | some resourceOutcome =>
          simp [resourceResult] at accepted
          cases accepted
          apply Checked.resource
          exact Model2.check_sound resourceResult

  | proveCurrentFact =>
      simp [check] at accepted
      cases accepted
      exact Checked.proveCurrentFact

  | advancePrivate =>
      simp [check] at accepted
      cases accepted
      exact Checked.advancePrivate

  | requireCurrentFact =>
      unfold check at accepted
      split at accepted
      · cases accepted
        apply Checked.requireCurrentFact
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
    result.resources.obligations = [] :=
  returned_has_no_open_obligations (check_sound accepted)

def clean : State :=
  {
    resources := Model2.clean,
    privateGeneration := 0,
    facts := [],
  }

def proveUseAndReturn : Cmd :=
  .seq
    .proveCurrentFact
    (.seq .requireCurrentFact .ret)

example : check clean proveUseAndReturn = some (.returned { clean with facts := [0] }) := by
  rfl

def staleFactAfterAdvance : Cmd :=
  .seq
    .proveCurrentFact
    (.seq .advancePrivate (.seq .requireCurrentFact .ret))

example : check clean staleFactAfterAdvance = none := by
  rfl

def resourceAndPrivateFactsCompose : Cmd :=
  .seq
    (.resource
      (.seq
        (.base (.openObligation 10))
        (.attemptConsume
          (.base (.dischargeObligation 10))
          (.seq (.base .consume) (.base (.dischargeObligation 10))))))
    (.seq .proveCurrentFact (.seq .requireCurrentFact .ret))

example :
    check clean resourceAndPrivateFactsCompose =
      some
        (.returned
          {
            resources := { valueAvailable := false, obligations := [] },
            privateGeneration := 0,
            facts := [0],
          }) := by
  rfl

end Wrela.ProofMIR.Model3
