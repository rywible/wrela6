/-!
Model 6 captures the resource-relevant shape of Wrela validation.

This model has one readable source buffer, one pending validation result, and
one validated packet token:

* `validate` creates a single-use pending validation result
* matching the validation result consumes it
* the Ok arm starts with source consumed into a packet
* the Err arm starts with the source still live and no packet
* both arms must converge to the same state
* return is legal only when source, packet, and pending validation are all closed
-/

namespace Wrela.ProofMIR.Model6

structure State where
  sourceLive : Bool
  validationLive : Bool
  packetLive : Bool
deriving Repr, DecidableEq

inductive Cmd where
  | skip
  | validate
  | matchValidation (ok err : Cmd)
  | dropSource
  | returnPacket
  | seq (first second : Cmd)
  | branch (left right : Cmd)
  | ret
deriving Repr

inductive Outcome where
  | cont (state : State)
  | returned (state : State)
deriving Repr, DecidableEq

def noLiveValidationResources (state : State) : Prop :=
  state.sourceLive = false ∧ state.validationLive = false ∧ state.packetLive = false

def NoValidationLeaksReturned : Outcome -> Prop
  | .cont _ => True
  | .returned result => noLiveValidationResources result

inductive Checked : State -> Cmd -> Outcome -> Prop where
  | skip :
      Checked source .skip (.cont source)

  | validate :
      source.sourceLive = true ->
      source.validationLive = false ->
      source.packetLive = false ->
      Checked source .validate (.cont { source with validationLive := true })

  | matchContinue :
      source.validationLive = true ->
      Checked { source with sourceLive := false, validationLive := false, packetLive := true } ok (.cont result) ->
      Checked { source with sourceLive := true, validationLive := false, packetLive := false } err (.cont result) ->
      Checked source (.matchValidation ok err) (.cont result)

  | matchReturn :
      source.validationLive = true ->
      Checked { source with sourceLive := false, validationLive := false, packetLive := true } ok (.returned result) ->
      Checked { source with sourceLive := true, validationLive := false, packetLive := false } err (.returned result) ->
      Checked source (.matchValidation ok err) (.returned result)

  | dropSource :
      source.sourceLive = true ->
      source.validationLive = false ->
      Checked source .dropSource (.cont { source with sourceLive := false })

  | returnPacket :
      source.packetLive = true ->
      source.validationLive = false ->
      Checked source .returnPacket (.cont { source with packetLive := false })

  | ret :
      noLiveValidationResources source ->
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

theorem returned_outcome_has_no_validation_leaks
    {source : State}
    {command : Cmd}
    {outcome : Outcome}
    (checked : Checked source command outcome) :
    NoValidationLeaksReturned outcome := by
  induction checked with
  | skip =>
      trivial
  | validate _ _ _ =>
      trivial
  | matchContinue _ _ _ _ _ =>
      trivial
  | matchReturn _ _ _ okSafe _ =>
      exact okSafe
  | dropSource _ _ =>
      trivial
  | returnPacket _ _ =>
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

def check (source : State) : Cmd -> Option Outcome
  | .skip =>
      some (.cont source)

  | .validate =>
      if source.sourceLive = true then
        if source.validationLive = false then
          if source.packetLive = false then
            some (.cont { source with validationLive := true })
          else
            none
        else
          none
      else
        none

  | .matchValidation ok err =>
      if source.validationLive = true then
        let okSource := { source with sourceLive := false, validationLive := false, packetLive := true }
        let errSource := { source with sourceLive := true, validationLive := false, packetLive := false }
        match check okSource ok, check errSource err with
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

  | .dropSource =>
      if source.sourceLive = true then
        if source.validationLive = false then
          some (.cont { source with sourceLive := false })
        else
          none
      else
        none

  | .returnPacket =>
      if source.packetLive = true then
        if source.validationLive = false then
          some (.cont { source with packetLive := false })
        else
          none
      else
        none

  | .ret =>
      if source.sourceLive = false then
        if source.validationLive = false then
          if source.packetLive = false then
            some (.returned source)
          else
            none
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

  | validate =>
      unfold check at accepted
      split at accepted
      · rename_i sourceLive
        split at accepted
        · rename_i noValidation
          split at accepted
          · rename_i noPacket
            cases accepted
            apply Checked.validate
            · exact sourceLive
            · exact noValidation
            · exact noPacket
          · contradiction
        · contradiction
      · contradiction

  | matchValidation ok err okSound errSound =>
      unfold check at accepted
      split at accepted
      · rename_i validationLive
        let okSource := { source with sourceLive := false, validationLive := false, packetLive := true }
        let errSource := { source with sourceLive := true, validationLive := false, packetLive := false }
        cases okResult : check okSource ok with
        | none =>
            simp [okSource, okResult] at accepted
        | some okOutcome =>
            cases errResult : check errSource err with
            | none =>
                simp [okSource, errSource, okResult, errResult] at accepted
            | some errOutcome =>
                cases okOutcome with
                | cont okState =>
                    cases errOutcome with
                    | cont errState =>
                        simp [okSource, errSource, okResult, errResult] at accepted
                        cases accepted with
                        | intro same outcomeEq =>
                          cases outcomeEq
                          apply Checked.matchContinue
                          · exact validationLive
                          · exact okSound okResult
                          · subst errState
                            exact errSound errResult
                    | returned _ =>
                        simp [okSource, errSource, okResult, errResult] at accepted
                | returned okState =>
                    cases errOutcome with
                    | cont _ =>
                        simp [okSource, errSource, okResult, errResult] at accepted
                    | returned errState =>
                        simp [okSource, errSource, okResult, errResult] at accepted
                        cases accepted with
                        | intro same outcomeEq =>
                          cases outcomeEq
                          apply Checked.matchReturn
                          · exact validationLive
                          · exact okSound okResult
                          · subst errState
                            exact errSound errResult
      · contradiction

  | dropSource =>
      unfold check at accepted
      split at accepted
      · rename_i sourceLive
        split at accepted
        · rename_i noValidation
          cases accepted
          apply Checked.dropSource
          · exact sourceLive
          · exact noValidation
        · contradiction
      · contradiction

  | returnPacket =>
      unfold check at accepted
      split at accepted
      · rename_i packetLive
        split at accepted
        · rename_i noValidation
          cases accepted
          apply Checked.returnPacket
          · exact packetLive
          · exact noValidation
        · contradiction
      · contradiction

  | ret =>
      unfold check at accepted
      split at accepted
      · rename_i noSource
        split at accepted
        · rename_i noValidation
          split at accepted
          · rename_i noPacket
            cases accepted
            apply Checked.ret
            exact And.intro noSource (And.intro noValidation noPacket)
          · contradiction
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

theorem check_returned_has_no_validation_leaks
    {source : State}
    {command : Cmd}
    {result : State}
    (accepted : check source command = some (.returned result)) :
    noLiveValidationResources result :=
  returned_outcome_has_no_validation_leaks (check_sound accepted)

def clean : State :=
  { sourceLive := true, validationLive := false, packetLive := false }

def closed : State :=
  { sourceLive := false, validationLive := false, packetLive := false }

def validateCloseBothPaths : Cmd :=
  .seq
    .validate
    (.seq
      (.matchValidation .returnPacket .dropSource)
      .ret)

example : check clean validateCloseBothPaths = some (.returned closed) := by
  rfl

def returnWithPendingValidation : Cmd :=
  .seq .validate .ret

example : check clean returnWithPendingValidation = none := by
  rfl

def okPathForgetsPacket : Cmd :=
  .seq
    .validate
    (.matchValidation .skip .dropSource)

example : check clean okPathForgetsPacket = none := by
  rfl

def errPathForgetsSource : Cmd :=
  .seq
    .validate
    (.matchValidation .returnPacket .skip)

example : check clean errPathForgetsSource = none := by
  rfl

end Wrela.ProofMIR.Model6
