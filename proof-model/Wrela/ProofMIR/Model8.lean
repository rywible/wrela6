/-!
Model 8 is the first unified Proof MIR sketch.

The executable examples at the bottom exercise the combined Wrela proof surface.
The implementation here is a sidecar semantics model, not the production
compiler.
-/

namespace Wrela.ProofMIR.Model8

inductive Field where
  | rx
  | tx
deriving Repr, BEq, DecidableEq

inductive Place where
  | self
  | field (field : Field)
deriving Repr, BEq, DecidableEq

inductive ReturnMode where
  | ordinary
  | terminal
deriving Repr, BEq, DecidableEq

structure Obligation where
  id : Nat
  session : Nat
  token : Nat
deriving Repr, BEq, DecidableEq

structure Member where
  session : Nat
  token : Nat
deriving Repr, BEq, DecidableEq

structure PendingValidation where
  id : Nat
  source : Nat
  packet : Nat
deriving Repr, BEq, DecidableEq

structure Fact where
  generation : Nat
  key : Nat
deriving Repr, BEq, DecidableEq

structure State where
  ownedRx : Bool
  ownedTx : Bool
  loans : List Place
  obligations : List Obligation
  members : List Member
  validations : List PendingValidation
  sources : List Nat
  packets : List Nat
  privateGeneration : Nat
  facts : List Fact
  terminalReached : Bool
deriving Repr, DecidableEq

inductive Outcome where
  | cont (state : State)
  | returned (mode : ReturnMode) (state : State)
deriving Repr, DecidableEq

def initial : State :=
  {
    ownedRx := true,
    ownedTx := true,
    loans := [],
    obligations := [],
    members := [],
    validations := [],
    sources := [],
    packets := [],
    privateGeneration := 0,
    facts := [],
    terminalReached := false,
  }

def noLeaks (state : State) : Prop :=
  state.loans = [] ∧
    state.obligations = [] ∧
    state.members = [] ∧
    state.validations = [] ∧
    state.sources = [] ∧
    state.packets = []

def closedForReturn (mode : ReturnMode) (state : State) : Prop :=
  noLeaks state ∧
    match mode with
    | .ordinary => True
    | .terminal => state.terminalReached = true

instance (state : State) : Decidable (noLeaks state) := by
  unfold noLeaks
  infer_instance

instance (mode : ReturnMode) (state : State) : Decidable (closedForReturn mode state) := by
  unfold closedForReturn
  cases mode <;> infer_instance

def SafeOutcome : Outcome -> Prop
  | .cont _ => True
  | .returned mode state => closedForReturn mode state

structure Accepted where
  outcome : Outcome
  safe : SafeOutcome outcome

def acceptedCont (state : State) : Accepted :=
  {
    outcome := .cont state,
    safe := trivial,
  }

def acceptedReturn (mode : ReturnMode) (state : State) (closed : closedForReturn mode state) :
    Accepted :=
  {
    outcome := .returned mode state,
    safe := closed,
  }

def placeOwned (state : State) : Place -> Bool
  | .self => state.ownedRx && state.ownedTx
  | .field .rx => state.ownedRx
  | .field .tx => state.ownedTx

def conflicts : Place -> Place -> Bool
  | .self, _ => true
  | _, .self => true
  | .field left, .field right => decide (left = right)

def hasConflictingLoan (state : State) (place : Place) : Bool :=
  state.loans.any (fun loan => conflicts loan place)

def canAccess (state : State) (place : Place) : Bool :=
  placeOwned state place && !hasConflictingLoan state place

def loanLive (state : State) (place : Place) : Bool :=
  state.loans.any (fun loan => loan == place)

def moveUnchecked (state : State) : Place -> State
  | .self => { state with ownedRx := false, ownedTx := false }
  | .field .rx => { state with ownedRx := false }
  | .field .tx => { state with ownedTx := false }

def obligationIdLive (state : State) (id : Nat) : Bool :=
  state.obligations.any (fun obligation => obligation.id == id)

def memberLive (state : State) (member : Member) : Bool :=
  state.members.any (fun existing => existing == member)

def validationLive (state : State) (validation : PendingValidation) : Bool :=
  state.validations.any (fun existing => existing == validation)

def validationIdLive (state : State) (id : Nat) : Bool :=
  state.validations.any (fun validation => validation.id == id)

def sourceHasPendingValidation (state : State) (source : Nat) : Bool :=
  state.validations.any (fun validation => validation.source == source)

def sourceLive (state : State) (source : Nat) : Bool :=
  state.sources.any (fun existing => existing == source)

def packetLive (state : State) (packet : Nat) : Bool :=
  state.packets.any (fun existing => existing == packet)

def factLive (state : State) (key : Nat) : Bool :=
  state.facts.any
    (fun fact => fact.generation == state.privateGeneration && fact.key == key)

def removeObligationById (state : State) (id : Nat) : State :=
  {
    state with
    obligations := state.obligations.filter (fun obligation => obligation.id != id),
    members :=
      state.members.filter
        (fun member =>
          !state.obligations.any
            (fun obligation =>
              obligation.id == id &&
                obligation.session == member.session &&
                obligation.token == member.token)),
  }

def removeValidation (state : State) (validation : PendingValidation) : State :=
  {
    state with
    validations := state.validations.filter (fun existing => existing != validation),
  }

def removeSource (state : State) (source : Nat) : State :=
  {
    state with
    sources := state.sources.filter (fun existing => existing != source),
  }

def removePacket (state : State) (packet : Nat) : State :=
  {
    state with
    packets := state.packets.filter (fun existing => existing != packet),
  }

def validationOkState (state : State) (validation : PendingValidation) : State :=
  {
    removeValidation (removeSource state validation.source) validation with
    packets := validation.packet :: state.packets.filter (fun existing => existing != validation.packet),
  }

def validationErrState (state : State) (validation : PendingValidation) : State :=
  removeValidation state validation

def dischargeUnchecked (state : State) (id : Nat) : State :=
  { removeObligationById state id with terminalReached := true }

inductive Cmd where
  | skip
  | usePlace (place : Place)
  | movePlace (place : Place)
  | openLoan (place : Place)
  | closeLoan (place : Place)
  | openObligation (id session token : Nat)
  | openMember (id session token : Nat)
  | platformDischarge (id : Nat)
  | terminalDischarge (id : Nat)
  | proveFact (key : Nat)
  | advancePrivate
  | requireFact (key : Nat)
  | openSource (source : Nat)
  | validate (id source packet : Nat)
  | matchValidation (id source packet : Nat) (ok err : Cmd)
  | dropSource (source : Nat)
  | returnPacket (packet : Nat)
  | attemptMove (place : Place) (ok err : Cmd)
  | yieldWake
  | seq (first second : Cmd)
  | branch (left right : Cmd)
  | ret (mode : ReturnMode)
deriving Repr

def joinAccepted (left right : Accepted) : Option Accepted :=
  match left.outcome, right.outcome with
  | .cont leftState, .cont rightState =>
      if leftState = rightState then
        some (acceptedCont leftState)
      else
        none
  | .returned leftMode leftState, .returned rightMode rightState =>
      if leftMode = rightMode then
        if leftState = rightState then
          some left
        else
          none
      else
        none
  | _, _ => none

def checkAccepted (source : State) : Cmd -> Option Accepted
  | .skip =>
      some (acceptedCont source)

  | .usePlace place =>
      if canAccess source place then
        some (acceptedCont source)
      else
        none

  | .movePlace place =>
      if canAccess source place then
        some (acceptedCont (moveUnchecked source place))
      else
        none

  | .openLoan place =>
      if canAccess source place then
        some (acceptedCont { source with loans := place :: source.loans })
      else
        none

  | .closeLoan place =>
      if loanLive source place then
        some (acceptedCont { source with loans := source.loans.erase place })
      else
        none

  | .openObligation id session token =>
      if obligationIdLive source id then
        none
      else
        some
          (acceptedCont
            {
              source with
              obligations := { id := id, session := session, token := token } :: source.obligations,
            })

  | .openMember id session token =>
      let member := { session := session, token := token }
      if obligationIdLive source id then
        none
      else if memberLive source member then
        none
      else
        some
          (acceptedCont
            {
              source with
              obligations := { id := id, session := session, token := token } :: source.obligations,
              members := member :: source.members,
            })

  | .platformDischarge id =>
      if obligationIdLive source id then
        some (acceptedCont (dischargeUnchecked source id))
      else
        none

  | .terminalDischarge id =>
      if obligationIdLive source id then
        some (acceptedCont (dischargeUnchecked source id))
      else
        none

  | .proveFact key =>
      some
        (acceptedCont
          {
            source with
            facts := { generation := source.privateGeneration, key := key } :: source.facts,
          })

  | .advancePrivate =>
      some
        (acceptedCont
          {
            source with
            privateGeneration := source.privateGeneration + 1,
            facts := [],
          })

  | .requireFact key =>
      if factLive source key then
        some (acceptedCont source)
      else
        none

  | .openSource sourceId =>
      if sourceLive source sourceId then
        none
      else
        some (acceptedCont { source with sources := sourceId :: source.sources })

  | .validate id sourceId packet =>
      let validation := { id := id, source := sourceId, packet := packet }
      if sourceLive source sourceId then
        if validationIdLive source id then
          none
        else if packetLive source packet then
          none
        else
          some (acceptedCont { source with validations := validation :: source.validations })
      else
        none

  | .matchValidation id sourceId packet ok err =>
      let validation := { id := id, source := sourceId, packet := packet }
      if validationLive source validation then
        match
          checkAccepted (validationOkState source validation) ok,
          checkAccepted (validationErrState source validation) err with
        | some okAccepted, some errAccepted => joinAccepted okAccepted errAccepted
        | _, _ => none
      else
        none

  | .dropSource sourceId =>
      if sourceLive source sourceId then
        if sourceHasPendingValidation source sourceId then
          none
        else
          some (acceptedCont (removeSource source sourceId))
      else
        none

  | .returnPacket packet =>
      if packetLive source packet then
        some (acceptedCont (removePacket source packet))
      else
        none

  | .attemptMove place ok err =>
      if canAccess source place then
        match checkAccepted (moveUnchecked source place) ok, checkAccepted source err with
        | some okAccepted, some errAccepted => joinAccepted okAccepted errAccepted
        | _, _ => none
      else
        none

  | .yieldWake =>
      if noLeaks source then
        some (acceptedCont source)
      else
        none

  | .seq first second =>
      match checkAccepted source first with
      | none => none
      | some firstAccepted =>
          match firstAccepted.outcome with
          | .returned _ _ => some firstAccepted
          | .cont middle => checkAccepted middle second

  | .branch left right =>
      match checkAccepted source left, checkAccepted source right with
      | some leftAccepted, some rightAccepted => joinAccepted leftAccepted rightAccepted
      | _, _ => none

  | .ret mode =>
      if closed : closedForReturn mode source then
        some (acceptedReturn mode source closed)
      else
        none

def check (source : State) (command : Cmd) : Option Outcome :=
  match checkAccepted source command with
  | none => none
  | some accepted => some accepted.outcome

theorem check_safe
    {source : State}
    {command : Cmd}
    {outcome : Outcome}
    (accepted : check source command = some outcome) :
    SafeOutcome outcome := by
  unfold check at accepted
  cases result : checkAccepted source command with
  | none =>
      simp [result] at accepted
  | some checked =>
      simp [result] at accepted
      cases accepted
      exact checked.safe

theorem check_returned_closed
    {source : State}
    {command : Cmd}
    {mode : ReturnMode}
    {result : State}
    (accepted : check source command = some (.returned mode result)) :
    closedForReturn mode result :=
  check_safe accepted

theorem check_returned_has_no_leaks
    {source : State}
    {command : Cmd}
    {mode : ReturnMode}
    {result : State}
    (accepted : check source command = some (.returned mode result)) :
    noLeaks result :=
  (check_returned_closed accepted).left

def closeRxPacket : Cmd :=
  .seq
    (.openMember 1 10 100)
    (.seq
      (.openSource 200)
      (.seq
        (.validate 300 200 400)
        (.matchValidation 300 200 400
          (.seq (.returnPacket 400) (.platformDischarge 1))
          (.seq (.dropSource 200) (.platformDischarge 1)))))

example :
    check initial closeRxPacket =
      some
        (.cont
          {
            initial with
            obligations := [],
            members := [],
            sources := [],
            packets := [],
            terminalReached := true,
          }) := by
  rfl

def wrongSessionClose : Cmd :=
  .seq (.openMember 1 10 100) (.terminalDischarge 2)

example : check initial wrongSessionClose = none := by
  rfl

def stalePrivateFact : Cmd :=
  .seq (.proveFact 7) (.seq .advancePrivate (.requireFact 7))

example : check initial stalePrivateFact = none := by
  rfl

def loanRxUseTx : Cmd :=
  .seq (.openLoan (.field .rx)) (.seq (.usePlace (.field .tx)) (.closeLoan (.field .rx)))

example :
    check initial loanRxUseTx =
      some (.cont initial) := by
  rfl

def loanRxUseSelf : Cmd :=
  .seq (.openLoan (.field .rx)) (.usePlace .self)

example : check initial loanRxUseSelf = none := by
  rfl

def validationMustCloseBothArms : Cmd :=
  .seq
    (.openSource 200)
    (.seq
      (.validate 300 200 400)
      (.matchValidation 300 200 400
        (.returnPacket 400)
        (.dropSource 200)))

example :
    check initial validationMustCloseBothArms =
      some (.cont { initial with sources := [], packets := [] }) := by
  rfl

def validationErrLeaksSource : Cmd :=
  .seq
    (.openSource 200)
    (.seq
      (.validate 300 200 400)
      (.matchValidation 300 200 400
        (.returnPacket 400)
        .skip))

example : check initial validationErrLeaksSource = none := by
  rfl

def terminalReturnWithoutDischarge : Cmd :=
  .ret .terminal

example : check initial terminalReturnWithoutDischarge = none := by
  rfl

def terminalReturnAfterDischarge : Cmd :=
  .seq (.openObligation 9 0 0) (.seq (.platformDischarge 9) (.ret .terminal))

example :
    check initial terminalReturnAfterDischarge =
      some
        (.returned .terminal
          {
            initial with
            obligations := [],
            terminalReached := true,
          }) := by
  rfl

def attemptKeepsInputOnError : Cmd :=
  .seq
    (.attemptMove (.field .rx)
      (.seq (.openObligation 70 0 0) (.platformDischarge 70))
      .skip)
    (.usePlace (.field .rx))

example :
    check initial attemptKeepsInputOnError =
      none := by
  rfl

def attemptConvergesWhenErrAlsoConsumesInput : Cmd :=
  .attemptMove (.field .rx)
    .skip
    (.movePlace (.field .rx))

example :
    check initial attemptConvergesWhenErrAlsoConsumesInput =
      some
        (.cont
          {
            initial with
            ownedRx := false,
          }) := by
  rfl

end Wrela.ProofMIR.Model8
