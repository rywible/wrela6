import Wrela.ProofMIR.Model8

/-!
Model 12 adds declarative semantics for the unified Model 8 checker.

Model 8 is intentionally proof-carrying: `checkAccepted` returns an executable
result bundled with a safety proof. That is useful, but it makes the main safety
theorem feel suspiciously direct.

This model adds a separate `Checked` relation that describes which commands are
semantically accepted. It then proves that the executable Model 8 checker is
sound against that declarative relation.
-/

namespace Wrela.ProofMIR.Model12

abbrev State := Model8.State
abbrev Cmd := Model8.Cmd
abbrev Outcome := Model8.Outcome
abbrev ReturnMode := Model8.ReturnMode

def joinOutcome : Outcome -> Outcome -> Option Outcome
  | .cont leftState, .cont rightState =>
      if leftState = rightState then
        some (.cont leftState)
      else
        none
  | .returned leftMode leftState, .returned rightMode rightState =>
      if leftMode = rightMode then
        if leftState = rightState then
          some (.returned leftMode leftState)
        else
          none
      else
        none
  | _, _ => none

inductive Checked : State -> Cmd -> Outcome -> Prop where
  | skip :
      Checked source .skip (.cont source)

  | usePlace :
      Model8.canAccess source place = true ->
      Checked source (.usePlace place) (.cont source)

  | movePlace :
      Model8.canAccess source place = true ->
      Checked source (.movePlace place) (.cont (Model8.moveUnchecked source place))

  | openLoan :
      Model8.canAccess source place = true ->
      Checked source (.openLoan place) (.cont { source with loans := place :: source.loans })

  | closeLoan :
      Model8.loanLive source place = true ->
      Checked source (.closeLoan place) (.cont { source with loans := source.loans.erase place })

  | openObligation :
      Model8.obligationIdLive source obligationId ≠ true ->
      Checked source
        (.openObligation obligationId session token)
        (.cont
          {
            source with
            obligations := { id := obligationId, session := session, token := token } :: source.obligations,
          })

  | openMember :
      Model8.obligationIdLive source obligationId ≠ true ->
      Model8.memberLive source { session := session, token := token } ≠ true ->
      Checked source
        (.openMember obligationId session token)
        (.cont
          {
            source with
            obligations := { id := obligationId, session := session, token := token } :: source.obligations,
            members := { session := session, token := token } :: source.members,
          })

  | platformDischarge :
      Model8.obligationIdLive source obligationId = true ->
      Checked source (.platformDischarge obligationId) (.cont (Model8.dischargeUnchecked source obligationId))

  | terminalDischarge :
      Model8.obligationIdLive source obligationId = true ->
      Checked source (.terminalDischarge obligationId) (.cont (Model8.dischargeUnchecked source obligationId))

  | proveFact :
      Checked source
        (.proveFact key)
        (.cont
          {
            source with
            facts := { generation := source.privateGeneration, key := key } :: source.facts,
          })

  | advancePrivate :
      Checked source
        .advancePrivate
        (.cont { source with privateGeneration := source.privateGeneration + 1, facts := [] })

  | requireFact :
      Model8.factLive source key = true ->
      Checked source (.requireFact key) (.cont source)

  | openSource :
      Model8.sourceLive source sourceId ≠ true ->
      Checked source (.openSource sourceId) (.cont { source with sources := sourceId :: source.sources })

  | validate :
      Model8.sourceLive source sourceId = true ->
      Model8.validationIdLive source validationId ≠ true ->
      Model8.packetLive source packet ≠ true ->
      Checked source
        (.validate validationId sourceId packet)
        (.cont
          {
            source with
            validations :=
              { id := validationId, source := sourceId, packet := packet } :: source.validations,
          })

  | matchValidation :
      Model8.validationLive source { id := validationId, source := sourceId, packet := packet } = true ->
      Checked
        (Model8.validationOkState source { id := validationId, source := sourceId, packet := packet })
        ok
        okOutcome ->
      Checked
        (Model8.validationErrState source { id := validationId, source := sourceId, packet := packet })
        err
        errOutcome ->
      joinOutcome okOutcome errOutcome = some outcome ->
      Checked source (.matchValidation validationId sourceId packet ok err) outcome

  | dropSource :
      Model8.sourceLive source sourceId = true ->
      Model8.sourceHasPendingValidation source sourceId ≠ true ->
      Checked source (.dropSource sourceId) (.cont (Model8.removeSource source sourceId))

  | returnPacket :
      Model8.packetLive source packet = true ->
      Checked source (.returnPacket packet) (.cont (Model8.removePacket source packet))

  | attemptMove :
      Model8.canAccess source place = true ->
      Checked (Model8.moveUnchecked source place) ok okOutcome ->
      Checked source err errOutcome ->
      joinOutcome okOutcome errOutcome = some outcome ->
      Checked source (.attemptMove place ok err) outcome

  | yieldWake :
      Model8.noLeaks source ->
      Checked source .yieldWake (.cont source)

  | seqReturn :
      Checked source first (.returned mode result) ->
      Checked source (.seq first second) (.returned mode result)

  | seqContinue :
      Checked source first (.cont middle) ->
      Checked middle second outcome ->
      Checked source (.seq first second) outcome

  | branch :
      Checked source left leftOutcome ->
      Checked source right rightOutcome ->
      joinOutcome leftOutcome rightOutcome = some outcome ->
      Checked source (.branch left right) outcome

  | ret :
      Model8.closedForReturn mode source ->
      Checked source (.ret mode) (.returned mode source)

theorem joinOutcome_safe
    {left right joined : Outcome}
    (joinedBy : joinOutcome left right = some joined)
    (leftSafe : Model8.SafeOutcome left) :
    Model8.SafeOutcome joined := by
  cases left with
  | cont leftState =>
      cases right with
      | cont rightState =>
          by_cases sameState : leftState = rightState
          · simp [joinOutcome, sameState] at joinedBy
            cases joinedBy
            trivial
          · have impossible : False := by
              simp [joinOutcome, sameState] at joinedBy
            exact False.elim impossible
      | returned _ _ =>
          simp [joinOutcome] at joinedBy
  | returned leftMode leftState =>
      cases right with
      | cont _ =>
          simp [joinOutcome] at joinedBy
      | returned rightMode rightState =>
          by_cases sameMode : leftMode = rightMode
          · by_cases sameState : leftState = rightState
            · cases sameMode
              cases sameState
              simp [joinOutcome] at joinedBy
              cases joinedBy
              exact leftSafe
            · have impossible : False := by
                simp [joinOutcome, sameMode, sameState] at joinedBy
              exact False.elim impossible
          · have impossible : False := by
              simp [joinOutcome, sameMode] at joinedBy
            exact False.elim impossible

theorem checked_safe
    {source : State}
    {command : Cmd}
    {outcome : Outcome}
    (checked : Checked source command outcome) :
    Model8.SafeOutcome outcome := by
  induction checked with
  | skip =>
      trivial
  | usePlace _ =>
      trivial
  | movePlace _ =>
      trivial
  | openLoan _ =>
      trivial
  | closeLoan _ =>
      trivial
  | openObligation _ =>
      trivial
  | openMember _ _ =>
      trivial
  | platformDischarge _ =>
      trivial
  | terminalDischarge _ =>
      trivial
  | proveFact =>
      trivial
  | advancePrivate =>
      trivial
  | requireFact _ =>
      trivial
  | openSource _ =>
      trivial
  | validate _ _ _ =>
      trivial
  | matchValidation _ _ _ joinedBy okSafe _ =>
      exact joinOutcome_safe joinedBy okSafe
  | dropSource _ _ =>
      trivial
  | returnPacket _ =>
      trivial
  | attemptMove _ _ _ joinedBy okSafe _ =>
      exact joinOutcome_safe joinedBy okSafe
  | yieldWake _ =>
      trivial
  | seqReturn _ firstSafe =>
      exact firstSafe
  | seqContinue _ _ _ secondSafe =>
      exact secondSafe
  | branch _ _ joinedBy leftSafe _ =>
      exact joinOutcome_safe joinedBy leftSafe
  | ret closed =>
      exact closed

theorem joinAccepted_erases
    {left right joined : Model8.Accepted}
    (accepted : Model8.joinAccepted left right = some joined) :
    joinOutcome left.outcome right.outcome = some joined.outcome := by
  cases left with
  | mk leftOutcome leftSafe =>
      cases right with
      | mk rightOutcome _rightSafe =>
          cases leftOutcome with
          | cont leftState =>
              cases rightOutcome with
              | cont rightState =>
                  by_cases sameState : leftState = rightState
                  · simp [Model8.joinAccepted, sameState, Model8.acceptedCont] at accepted
                    cases accepted
                    simp [joinOutcome, sameState]
                  · have impossible : False := by
                      simp [Model8.joinAccepted, sameState] at accepted
                    exact False.elim impossible
              | returned _ _ =>
                  simp [Model8.joinAccepted] at accepted
          | returned leftMode leftState =>
              cases rightOutcome with
              | cont _ =>
                  simp [Model8.joinAccepted] at accepted
              | returned rightMode rightState =>
                  by_cases sameMode : leftMode = rightMode
                  · by_cases sameState : leftState = rightState
                    · simp [Model8.joinAccepted, sameMode, sameState] at accepted
                      cases accepted
                      simp [joinOutcome, sameMode, sameState]
                    · have impossible : False := by
                        simp [Model8.joinAccepted, sameMode, sameState] at accepted
                      exact False.elim impossible
                  · have impossible : False := by
                      simp [Model8.joinAccepted, sameMode] at accepted
                    exact False.elim impossible

theorem checkAccepted_sound
    {source : State}
    {command : Cmd}
    {accepted : Model8.Accepted}
    (acceptedByChecker : Model8.checkAccepted source command = some accepted) :
    Checked source command accepted.outcome := by
  induction command generalizing source accepted with
  | skip =>
      simp [Model8.checkAccepted, Model8.acceptedCont] at acceptedByChecker
      cases acceptedByChecker
      exact Checked.skip

  | usePlace place =>
      unfold Model8.checkAccepted at acceptedByChecker
      split at acceptedByChecker
      · rename_i accessible
        cases acceptedByChecker
        exact Checked.usePlace accessible
      · contradiction

  | movePlace place =>
      unfold Model8.checkAccepted at acceptedByChecker
      split at acceptedByChecker
      · rename_i accessible
        cases acceptedByChecker
        exact Checked.movePlace accessible
      · contradiction

  | openLoan place =>
      unfold Model8.checkAccepted at acceptedByChecker
      split at acceptedByChecker
      · rename_i accessible
        cases acceptedByChecker
        exact Checked.openLoan accessible
      · contradiction

  | closeLoan place =>
      unfold Model8.checkAccepted at acceptedByChecker
      split at acceptedByChecker
      · rename_i live
        cases acceptedByChecker
        exact Checked.closeLoan live
      · contradiction

  | openObligation obligationId session token =>
      unfold Model8.checkAccepted at acceptedByChecker
      split at acceptedByChecker
      · contradiction
      · rename_i notLive
        cases acceptedByChecker
        exact Checked.openObligation notLive

  | openMember obligationId session token =>
      unfold Model8.checkAccepted at acceptedByChecker
      by_cases obligationLive : Model8.obligationIdLive source obligationId = true
      · simp [obligationLive] at acceptedByChecker
      · simp [obligationLive] at acceptedByChecker
        let member : Model8.Member := { session := session, token := token }
        by_cases memberLive : Model8.memberLive source member = true
        · simp [member, memberLive] at acceptedByChecker
        · simp [member, memberLive] at acceptedByChecker
          cases acceptedByChecker
          exact Checked.openMember obligationLive memberLive

  | platformDischarge obligationId =>
      unfold Model8.checkAccepted at acceptedByChecker
      split at acceptedByChecker
      · rename_i live
        cases acceptedByChecker
        exact Checked.platformDischarge live
      · contradiction

  | terminalDischarge obligationId =>
      unfold Model8.checkAccepted at acceptedByChecker
      split at acceptedByChecker
      · rename_i live
        cases acceptedByChecker
        exact Checked.terminalDischarge live
      · contradiction

  | proveFact key =>
      simp [Model8.checkAccepted, Model8.acceptedCont] at acceptedByChecker
      cases acceptedByChecker
      exact Checked.proveFact

  | advancePrivate =>
      simp [Model8.checkAccepted, Model8.acceptedCont] at acceptedByChecker
      cases acceptedByChecker
      exact Checked.advancePrivate

  | requireFact key =>
      unfold Model8.checkAccepted at acceptedByChecker
      split at acceptedByChecker
      · rename_i live
        cases acceptedByChecker
        exact Checked.requireFact live
      · contradiction

  | openSource sourceId =>
      unfold Model8.checkAccepted at acceptedByChecker
      split at acceptedByChecker
      · contradiction
      · rename_i notLive
        cases acceptedByChecker
        exact Checked.openSource notLive

  | validate validationId sourceId packet =>
      unfold Model8.checkAccepted at acceptedByChecker
      split at acceptedByChecker
      · rename_i sourceLive
        split at acceptedByChecker
        · contradiction
        · rename_i validationNotLive
          split at acceptedByChecker
          · contradiction
          · rename_i packetNotLive
            cases acceptedByChecker
            exact Checked.validate sourceLive validationNotLive packetNotLive
      · contradiction

  | matchValidation validationId sourceId packet ok err okSound errSound =>
      unfold Model8.checkAccepted at acceptedByChecker
      let validation : Model8.PendingValidation := { id := validationId, source := sourceId, packet := packet }
      by_cases validationIsLive : Model8.validationLive source validation = true
      · simp [validation, validationIsLive] at acceptedByChecker
        cases okResult : Model8.checkAccepted (Model8.validationOkState source validation) ok with
        | none =>
            rw [okResult] at acceptedByChecker
            contradiction
        | some okAccepted =>
            cases errResult :
                Model8.checkAccepted (Model8.validationErrState source validation) err with
            | none =>
                rw [okResult, errResult] at acceptedByChecker
                contradiction
            | some errAccepted =>
                rw [okResult, errResult] at acceptedByChecker
                exact
                  Checked.matchValidation
                    (source := source)
                    (validationId := validationId)
                    (sourceId := sourceId)
                    (packet := packet)
                    (ok := ok)
                    (err := err)
                    validationIsLive
                    (by
                      simpa [validation] using okSound okResult)
                    (by
                      simpa [validation] using errSound errResult)
                    (joinAccepted_erases acceptedByChecker)
      · have impossible : False := by
          simp [validation, validationIsLive] at acceptedByChecker
        exact False.elim impossible

  | dropSource sourceId =>
      unfold Model8.checkAccepted at acceptedByChecker
      split at acceptedByChecker
      · rename_i sourceLive
        split at acceptedByChecker
        · contradiction
        · rename_i noPending
          cases acceptedByChecker
          exact Checked.dropSource sourceLive noPending
      · contradiction

  | returnPacket packet =>
      unfold Model8.checkAccepted at acceptedByChecker
      split at acceptedByChecker
      · rename_i packetLive
        cases acceptedByChecker
        exact Checked.returnPacket packetLive
      · contradiction

  | attemptMove place ok err okSound errSound =>
      unfold Model8.checkAccepted at acceptedByChecker
      split at acceptedByChecker
      · rename_i accessible
        cases okResult : Model8.checkAccepted (Model8.moveUnchecked source place) ok with
        | none =>
            simp [okResult] at acceptedByChecker
        | some okAccepted =>
            cases errResult : Model8.checkAccepted source err with
            | none =>
                simp [okResult, errResult] at acceptedByChecker
            | some errAccepted =>
                simp [okResult, errResult] at acceptedByChecker
                exact
                  Checked.attemptMove accessible
                    (okSound okResult)
                    (errSound errResult)
                    (joinAccepted_erases acceptedByChecker)
      · contradiction

  | yieldWake =>
      unfold Model8.checkAccepted at acceptedByChecker
      split at acceptedByChecker
      · rename_i closed
        cases acceptedByChecker
        exact Checked.yieldWake closed
      · contradiction

  | seq first second firstSound secondSound =>
      unfold Model8.checkAccepted at acceptedByChecker
      cases firstResult : Model8.checkAccepted source first with
      | none =>
          simp [firstResult] at acceptedByChecker
      | some firstAccepted =>
          cases firstAccepted with
          | mk firstOutcome firstSafe =>
              cases firstOutcome with
              | returned mode result =>
                  simp [firstResult] at acceptedByChecker
                  cases acceptedByChecker
                  exact Checked.seqReturn (firstSound firstResult)
              | cont middle =>
                  simp [firstResult] at acceptedByChecker
                  exact Checked.seqContinue (firstSound firstResult) (secondSound acceptedByChecker)

  | branch left right leftSound rightSound =>
      unfold Model8.checkAccepted at acceptedByChecker
      cases leftResult : Model8.checkAccepted source left with
      | none =>
          simp [leftResult] at acceptedByChecker
      | some leftAccepted =>
          cases rightResult : Model8.checkAccepted source right with
          | none =>
              simp [leftResult, rightResult] at acceptedByChecker
          | some rightAccepted =>
              simp [leftResult, rightResult] at acceptedByChecker
              exact
                Checked.branch
                  (leftSound leftResult)
                  (rightSound rightResult)
                  (joinAccepted_erases acceptedByChecker)

  | ret mode =>
      unfold Model8.checkAccepted at acceptedByChecker
      split at acceptedByChecker
      · rename_i closed
        cases acceptedByChecker
        exact Checked.ret closed
      · contradiction

theorem check_sound
    {source : State}
    {command : Cmd}
    {outcome : Outcome}
    (acceptedByChecker : Model8.check source command = some outcome) :
    Checked source command outcome := by
  unfold Model8.check at acceptedByChecker
  cases result : Model8.checkAccepted source command with
  | none =>
      simp [result] at acceptedByChecker
  | some accepted =>
      simp [result] at acceptedByChecker
      cases acceptedByChecker
      exact checkAccepted_sound result

theorem check_sound_safe
    {source : State}
    {command : Cmd}
    {outcome : Outcome}
    (acceptedByChecker : Model8.check source command = some outcome) :
    Model8.SafeOutcome outcome :=
  checked_safe (source := source) (command := command) (outcome := outcome)
    (check_sound acceptedByChecker)

theorem terminal_return_requires_discharge
    {source result : State}
    {command : Cmd}
    (acceptedByChecker : Model8.check source command = some (.returned .terminal result)) :
    result.terminalReached = true :=
  (check_sound_safe acceptedByChecker).right

theorem returned_program_has_no_members
    {source result : State}
    {command : Cmd}
    {mode : ReturnMode}
    (acceptedByChecker : Model8.check source command = some (.returned mode result)) :
    result.members = [] :=
  (check_sound_safe acceptedByChecker).left.right.right.left

theorem returned_program_has_no_live_sources
    {source result : State}
    {command : Cmd}
    {mode : ReturnMode}
    (acceptedByChecker : Model8.check source command = some (.returned mode result)) :
    result.sources = [] :=
  (check_sound_safe acceptedByChecker).left.right.right.right.right.left

end Wrela.ProofMIR.Model12
