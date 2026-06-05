import Wrela.ProofMIR.Model3

/-!
Model 4 separates session member tokens from raw obligation brands.

Earlier models tracked only a list of live obligation session ids. Wrela needs
one more distinction: a yielded buffer or validated packet is a member token
minted by a particular session. Closing it through the wrong stream/batch/edge
must be rejected even if some other obligation brand is live.

This model keeps Model 3's private-state/resource core, then adds:

* member tokens `(session, token)`
* opening a member records the member and opens an obligation with its session
* discharging requires the exact member and matching session
* returning requires no open members and no open core obligations
-/

namespace Wrela.ProofMIR.Model4

structure Member where
  session : Nat
  token : Nat
deriving Repr, DecidableEq

structure State where
  core : Model3.State
  members : List Member
deriving Repr, DecidableEq

inductive Outcome where
  | cont (state : State)
  | returned (state : State)
deriving Repr, DecidableEq

def noOpenMembersAndObligations (state : State) : Prop :=
  state.members = [] ∧ state.core.resources.obligations = []

def NoLeaksReturned : Outcome -> Prop
  | .cont _ => True
  | .returned result => noOpenMembersAndObligations result

def eraseToModel3 (source : State) : Model3.Outcome -> Option Outcome
  | .cont core =>
      some (.cont { source with core := core })
  | .returned _ =>
      none

inductive Cmd where
  | core (command : Model3.Cmd)
  | openMember (session token : Nat)
  | dischargeMember (session token : Nat)
  | seq (first second : Cmd)
  | branch (left right : Cmd)
  | ret
deriving Repr

inductive Checked : State -> Cmd -> Outcome -> Prop where
  | core :
      Model3.Checked source.core command (.cont coreResult) ->
      Checked source (.core command) (.cont { source with core := coreResult })

  | openMember :
      Checked source
        (.openMember session token)
        (.cont
          {
            source with
            core :=
              {
                source.core with
                resources :=
                  {
                    source.core.resources with
                    obligations := session :: source.core.resources.obligations,
                  },
              },
            members := { session := session, token := token } :: source.members,
          })

  | dischargeMember :
      { session := session, token := token } ∈ source.members ->
      Checked source
        (.dischargeMember session token)
        (.cont
          {
            source with
            core :=
              {
                source.core with
                resources :=
                  {
                    source.core.resources with
                    obligations := source.core.resources.obligations.erase session,
                  },
              },
            members := source.members.erase { session := session, token := token },
          })

  | ret :
      source.members = [] ->
      source.core.resources.obligations = [] ->
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

theorem returned_outcome_has_no_leaks
    {source : State}
    {command : Cmd}
    {outcome : Outcome}
    (checked : Checked source command outcome) :
    NoLeaksReturned outcome := by
  induction checked with
  | core _ =>
      trivial
  | openMember =>
      trivial
  | dischargeMember _ =>
      trivial
  | ret noMembers noObligations =>
      exact And.intro noMembers noObligations
  | seqReturn _ firstSafe =>
      exact firstSafe
  | seqContinue _ _ _ secondSafe =>
      simpa using secondSafe
  | branchContinue _ _ _ _ =>
      trivial
  | branchReturn _ _ leftSafe _ =>
      exact leftSafe

theorem returned_has_no_leaks
    {source : State}
    {command : Cmd}
    {result : State}
    (checked : Checked source command (.returned result)) :
    noOpenMembersAndObligations result :=
  returned_outcome_has_no_leaks checked

def check (source : State) : Cmd -> Option Outcome
  | .core command =>
      match Model3.check source.core command with
      | some (.cont coreResult) => some (.cont { source with core := coreResult })
      | _ => none

  | .openMember session token =>
      some
        (.cont
          {
            source with
            core :=
              {
                source.core with
                resources :=
                  {
                    source.core.resources with
                    obligations := session :: source.core.resources.obligations,
                  },
              },
            members := { session := session, token := token } :: source.members,
          })

  | .dischargeMember session token =>
      if { session := session, token := token } ∈ source.members then
        some
          (.cont
            {
              source with
              core :=
                {
                  source.core with
                  resources :=
                    {
                      source.core.resources with
                      obligations := source.core.resources.obligations.erase session,
                    },
                },
              members := source.members.erase { session := session, token := token },
            })
      else
        none

  | .ret =>
      if source.members = [] then
        if source.core.resources.obligations = [] then
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
  | core command =>
      unfold check at accepted
      cases coreResult : Model3.check source.core command with
      | none =>
          simp [coreResult] at accepted
      | some coreOutcome =>
          cases coreOutcome with
          | returned _ =>
              simp [coreResult] at accepted
          | cont coreState =>
              simp [coreResult] at accepted
              cases accepted
              apply Checked.core
              exact Model3.check_sound coreResult

  | openMember session token =>
      simp [check] at accepted
      cases accepted
      exact Checked.openMember

  | dischargeMember session token =>
      unfold check at accepted
      split at accepted
      · cases accepted
        apply Checked.dischargeMember
        assumption
      · contradiction

  | ret =>
      unfold check at accepted
      split at accepted
      · rename_i noMembers
        split at accepted
        · rename_i noObligations
          cases accepted
          apply Checked.ret
          · exact noMembers
          · exact noObligations
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

theorem check_returned_has_no_leaks
    {source : State}
    {command : Cmd}
    {result : State}
    (accepted : check source command = some (.returned result)) :
    noOpenMembersAndObligations result :=
  returned_has_no_leaks (check_sound accepted)

def clean : State :=
  { core := Model3.clean, members := [] }

def openCloseAndReturn : Cmd :=
  .seq
    (.openMember 10 99)
    (.seq (.dischargeMember 10 99) .ret)

example : check clean openCloseAndReturn = some (.returned clean) := by
  rfl

def wrongSessionDischarge : Cmd :=
  .seq
    (.openMember 10 99)
    (.seq (.dischargeMember 11 99) .ret)

example : check clean wrongSessionDischarge = none := by
  rfl

def returnWithLiveMember : Cmd :=
  .seq (.openMember 10 99) .ret

example : check clean returnWithLiveMember = none := by
  rfl

def membersComposeWithPrivateFacts : Cmd :=
  .seq
    (.core (.seq .proveCurrentFact .requireCurrentFact))
    (.seq (.openMember 10 99) (.seq (.dischargeMember 10 99) .ret))

example :
    check clean membersComposeWithPrivateFacts =
      some (.returned { clean with core := { Model3.clean with facts := [0] } }) := by
  rfl

end Wrela.ProofMIR.Model4
