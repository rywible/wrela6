/-!
Model 7 captures the smallest terminal-function closure rule.

Terminal functions are not allowed to "just return". A terminal body must reach
a platform operation or another terminal discharge path, and it must not return
with open obligations.

This model uses a simple flag `terminalReached` plus a list of open obligation
brands. A real model will replace the flag with a checked terminal call graph.
-/

namespace Wrela.ProofMIR.Model7

structure State where
  obligations : List Nat
  terminalReached : Bool
deriving Repr, DecidableEq

inductive Cmd where
  | skip
  | openObligation (session : Nat)
  | platformDischarge (session : Nat)
  | terminalCallDischarge (session : Nat)
  | seq (first second : Cmd)
  | branch (left right : Cmd)
  | ret
deriving Repr

inductive Outcome where
  | cont (state : State)
  | returned (state : State)
deriving Repr, DecidableEq

def terminalReturnSafe (state : State) : Prop :=
  state.obligations = [] ∧ state.terminalReached = true

def SafeReturned : Outcome -> Prop
  | .cont _ => True
  | .returned result => terminalReturnSafe result

def discharge (source : State) (session : Nat) : State :=
  {
    obligations := source.obligations.erase session,
    terminalReached := true,
  }

inductive Checked : State -> Cmd -> Outcome -> Prop where
  | skip :
      Checked source .skip (.cont source)

  | openObligation :
      Checked source
        (.openObligation session)
        (.cont { source with obligations := session :: source.obligations })

  | platformDischarge :
      session ∈ source.obligations ->
      Checked source (.platformDischarge session) (.cont (discharge source session))

  | terminalCallDischarge :
      session ∈ source.obligations ->
      Checked source (.terminalCallDischarge session) (.cont (discharge source session))

  | ret :
      terminalReturnSafe source ->
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

theorem returned_outcome_is_terminal_safe
    {source : State}
    {command : Cmd}
    {outcome : Outcome}
    (checked : Checked source command outcome) :
    SafeReturned outcome := by
  induction checked with
  | skip =>
      trivial
  | openObligation =>
      trivial
  | platformDischarge _ =>
      trivial
  | terminalCallDischarge _ =>
      trivial
  | ret safe =>
      exact safe
  | seqReturn _ firstSafe =>
      exact firstSafe
  | seqContinue _ _ _ secondSafe =>
      simpa using secondSafe
  | branchContinue _ _ _ _ =>
      trivial
  | branchReturn _ _ leftSafe _ =>
      exact leftSafe

def check (source : State) : Cmd -> Option Outcome
  | .skip =>
      some (.cont source)

  | .openObligation session =>
      some (.cont { source with obligations := session :: source.obligations })

  | .platformDischarge session =>
      if session ∈ source.obligations then
        some (.cont (discharge source session))
      else
        none

  | .terminalCallDischarge session =>
      if session ∈ source.obligations then
        some (.cont (discharge source session))
      else
        none

  | .ret =>
      if source.obligations = [] then
        if source.terminalReached = true then
          some (.returned source)
        else
          none
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

  | openObligation session =>
      simp [check] at accepted
      cases accepted
      exact Checked.openObligation

  | platformDischarge session =>
      unfold check at accepted
      split at accepted
      · cases accepted
        apply Checked.platformDischarge
        assumption
      · contradiction

  | terminalCallDischarge session =>
      unfold check at accepted
      split at accepted
      · cases accepted
        apply Checked.terminalCallDischarge
        assumption
      · contradiction

  | ret =>
      unfold check at accepted
      split at accepted
      · rename_i noObligations
        split at accepted
        · rename_i terminalReached
          cases accepted
          apply Checked.ret
          exact And.intro noObligations terminalReached
        · contradiction
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

theorem check_returned_is_terminal_safe
    {source : State}
    {command : Cmd}
    {result : State}
    (accepted : check source command = some (.returned result)) :
    terminalReturnSafe result :=
  returned_outcome_is_terminal_safe (check_sound accepted)

def clean : State :=
  { obligations := [], terminalReached := false }

def terminalClosesThroughPlatform : Cmd :=
  .seq
    (.openObligation 10)
    (.seq (.platformDischarge 10) .ret)

example :
    check clean terminalClosesThroughPlatform =
      some (.returned { obligations := [], terminalReached := true }) := by
  rfl

def terminalClosesThroughTerminalCall : Cmd :=
  .seq
    (.openObligation 10)
    (.seq (.terminalCallDischarge 10) .ret)

example :
    check clean terminalClosesThroughTerminalCall =
      some (.returned { obligations := [], terminalReached := true }) := by
  rfl

def terminalReturnsWithoutDischarge : Cmd :=
  .ret

example : check clean terminalReturnsWithoutDischarge = none := by
  rfl

def terminalReturnsWithOpenObligation : Cmd :=
  .seq (.openObligation 10) .ret

example : check clean terminalReturnsWithOpenObligation = none := by
  rfl

def terminalWrongDischarge : Cmd :=
  .seq
    (.openObligation 10)
    (.seq (.platformDischarge 11) .ret)

example : check clean terminalWrongDischarge = none := by
  rfl

end Wrela.ProofMIR.Model7
