/-!
Model 5 captures Wrela's field-sensitive receiver access.

The point of this model is small but load-bearing:

* while `self.rx` is loaned, `self.tx` remains usable
* while `self.rx` is loaned, `self.rx` itself is unavailable
* while any field loan is live, whole-`self` access is unavailable
* returning with a live field loan is rejected

This model is intentionally separate from the resource/session stack so the
field-sensitivity rule stays easy to inspect.
-/

namespace Wrela.ProofMIR.Model5

inductive Field where
  | rx
  | tx
deriving Repr, DecidableEq

structure State where
  rxAvailable : Bool
  txAvailable : Bool
  rxLoaned : Bool
  txLoaned : Bool
deriving Repr, DecidableEq

def fieldAvailable : State -> Field -> Bool
  | source, .rx => source.rxAvailable
  | source, .tx => source.txAvailable

def fieldLoaned : State -> Field -> Bool
  | source, .rx => source.rxLoaned
  | source, .tx => source.txLoaned

def setFieldAvailable (source : State) : Field -> Bool -> State
  | .rx, value => { source with rxAvailable := value }
  | .tx, value => { source with txAvailable := value }

def setFieldLoaned (source : State) : Field -> Bool -> State
  | .rx, value => { source with rxLoaned := value }
  | .tx, value => { source with txLoaned := value }

def wholeSelfAvailable (source : State) : Prop :=
  source.rxAvailable = true ∧
    source.txAvailable = true ∧
    source.rxLoaned = false ∧
    source.txLoaned = false

def noLiveLoans (source : State) : Prop :=
  source.rxLoaned = false ∧ source.txLoaned = false

inductive Cmd where
  | skip
  | useField (field : Field)
  | useSelf
  | moveField (field : Field)
  | openLoan (field : Field)
  | closeLoan (field : Field)
  | seq (first second : Cmd)
  | branch (left right : Cmd)
  | ret
deriving Repr

inductive Outcome where
  | cont (state : State)
  | returned (state : State)
deriving Repr, DecidableEq

def NoLoansReturned : Outcome -> Prop
  | .cont _ => True
  | .returned result => noLiveLoans result

inductive Checked : State -> Cmd -> Outcome -> Prop where
  | skip :
      Checked source .skip (.cont source)

  | useField :
      fieldAvailable source field = true ->
      fieldLoaned source field = false ->
      Checked source (.useField field) (.cont source)

  | useSelf :
      wholeSelfAvailable source ->
      Checked source .useSelf (.cont source)

  | moveField :
      fieldAvailable source field = true ->
      fieldLoaned source field = false ->
      Checked source (.moveField field) (.cont (setFieldAvailable source field false))

  | openLoan :
      fieldAvailable source field = true ->
      fieldLoaned source field = false ->
      Checked source (.openLoan field) (.cont (setFieldLoaned source field true))

  | closeLoan :
      fieldLoaned source field = true ->
      Checked source (.closeLoan field) (.cont (setFieldLoaned source field false))

  | ret :
      noLiveLoans source ->
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

theorem returned_outcome_has_no_live_loans
    {source : State}
    {command : Cmd}
    {outcome : Outcome}
    (checked : Checked source command outcome) :
    NoLoansReturned outcome := by
  induction checked with
  | skip =>
      trivial
  | useField _ _ =>
      trivial
  | useSelf _ =>
      trivial
  | moveField _ _ =>
      trivial
  | openLoan _ _ =>
      trivial
  | closeLoan _ =>
      trivial
  | ret noLoans =>
      exact noLoans
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

  | .useField field =>
      if fieldAvailable source field = true then
        if fieldLoaned source field = false then
          some (.cont source)
        else
          none
      else
        none

  | .useSelf =>
      if source.rxAvailable = true then
        if source.txAvailable = true then
          if source.rxLoaned = false then
            if source.txLoaned = false then
              some (.cont source)
            else
              none
          else
            none
        else
          none
      else
        none

  | .moveField field =>
      if fieldAvailable source field = true then
        if fieldLoaned source field = false then
          some (.cont (setFieldAvailable source field false))
        else
          none
      else
        none

  | .openLoan field =>
      if fieldAvailable source field = true then
        if fieldLoaned source field = false then
          some (.cont (setFieldLoaned source field true))
        else
          none
      else
        none

  | .closeLoan field =>
      if fieldLoaned source field = true then
        some (.cont (setFieldLoaned source field false))
      else
        none

  | .ret =>
      if source.rxLoaned = false then
        if source.txLoaned = false then
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

  | useField field =>
      unfold check at accepted
      split at accepted
      · rename_i available
        split at accepted
        · rename_i notLoaned
          cases accepted
          apply Checked.useField
          · exact available
          · exact notLoaned
        · contradiction
      · contradiction

  | useSelf =>
      unfold check at accepted
      split at accepted
      · rename_i rxAvailable
        split at accepted
        · rename_i txAvailable
          split at accepted
          · rename_i rxNotLoaned
            split at accepted
            · rename_i txNotLoaned
              cases accepted
              apply Checked.useSelf
              exact And.intro rxAvailable (And.intro txAvailable (And.intro rxNotLoaned txNotLoaned))
            · contradiction
          · contradiction
        · contradiction
      · contradiction

  | moveField field =>
      unfold check at accepted
      split at accepted
      · rename_i available
        split at accepted
        · rename_i notLoaned
          cases accepted
          apply Checked.moveField
          · exact available
          · exact notLoaned
        · contradiction
      · contradiction

  | openLoan field =>
      unfold check at accepted
      split at accepted
      · rename_i available
        split at accepted
        · rename_i notLoaned
          cases accepted
          apply Checked.openLoan
          · exact available
          · exact notLoaned
        · contradiction
      · contradiction

  | closeLoan field =>
      unfold check at accepted
      split at accepted
      · rename_i loaned
        cases accepted
        apply Checked.closeLoan
        exact loaned
      · contradiction

  | ret =>
      unfold check at accepted
      split at accepted
      · rename_i rxNotLoaned
        split at accepted
        · rename_i txNotLoaned
          cases accepted
          apply Checked.ret
          exact And.intro rxNotLoaned txNotLoaned
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

theorem check_returned_has_no_live_loans
    {source : State}
    {command : Cmd}
    {result : State}
    (accepted : check source command = some (.returned result)) :
    noLiveLoans result :=
  returned_outcome_has_no_live_loans (check_sound accepted)

def clean : State :=
  {
    rxAvailable := true,
    txAvailable := true,
    rxLoaned := false,
    txLoaned := false,
  }

def loanRxUseTxThenClose : Cmd :=
  .seq
    (.openLoan .rx)
    (.seq (.useField .tx) (.seq (.closeLoan .rx) .ret))

example : check clean loanRxUseTxThenClose = some (.returned clean) := by
  rfl

def loanRxUseRx : Cmd :=
  .seq (.openLoan .rx) (.useField .rx)

example : check clean loanRxUseRx = none := by
  rfl

def loanRxUseSelf : Cmd :=
  .seq (.openLoan .rx) .useSelf

example : check clean loanRxUseSelf = none := by
  rfl

def returnWithLoanedRx : Cmd :=
  .seq (.openLoan .rx) .ret

example : check clean returnWithLoanedRx = none := by
  rfl

def moveRxThenUseSelf : Cmd :=
  .seq (.moveField .rx) .useSelf

example : check clean moveRxThenUseSelf = none := by
  rfl

end Wrela.ProofMIR.Model5
