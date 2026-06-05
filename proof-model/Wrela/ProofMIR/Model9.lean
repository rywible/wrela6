import Wrela.ProofMIR.Model8

/-!
Model 9 lifts the unified Model 8 checker over explicit Proof MIR blocks.

Blocks contain straight-line proof commands and end in a terminator. This is
still a small bounded CFG model, but it matches the compiler-facing shape more
closely than the structured command models.
-/

namespace Wrela.ProofMIR.Model9

inductive Terminator where
  | jump (target : Nat)
  | branch (left right : Nat)
  | return (mode : Model8.ReturnMode)
deriving Repr

structure Block where
  id : Nat
  body : List Model8.Cmd
  terminator : Terminator
deriving Repr

structure Graph where
  entry : Nat
  fuel : Nat
  blocks : List Block
deriving Repr

def findBlock : List Block -> Nat -> Option Block
  | [], _ => none
  | block :: rest, id =>
      if block.id == id then
        some block
      else
        findBlock rest id

def runBody : Model8.State -> List Model8.Cmd -> Option Model8.State
  | state, [] => some state
  | state, command :: rest =>
      match Model8.checkAccepted state command with
      | none => none
      | some accepted =>
          match accepted.outcome with
          | .cont next => runBody next rest
          | .returned _ _ => none

def checkAcceptedFrom (graph : Graph) : Nat -> Nat -> Model8.State -> Option Model8.Accepted
  | 0, _, _ => none
  | fuel + 1, blockId, state =>
      match findBlock graph.blocks blockId with
      | none => none
      | some block =>
          match runBody state block.body with
          | none => none
          | some middle =>
              match block.terminator with
              | .jump target =>
                  checkAcceptedFrom graph fuel target middle
              | .branch left right =>
                  match checkAcceptedFrom graph fuel left middle, checkAcceptedFrom graph fuel right middle with
                  | some leftAccepted, some rightAccepted =>
                      Model8.joinAccepted leftAccepted rightAccepted
                  | _, _ => none
              | .return mode =>
                  Model8.checkAccepted middle (.ret mode)

def checkAccepted (graph : Graph) (state : Model8.State) : Option Model8.Accepted :=
  checkAcceptedFrom graph graph.fuel graph.entry state

def check (graph : Graph) (state : Model8.State) : Option Model8.Outcome :=
  match checkAccepted graph state with
  | none => none
  | some accepted => some accepted.outcome

theorem check_safe
    {graph : Graph}
    {state : Model8.State}
    {outcome : Model8.Outcome}
    (accepted : check graph state = some outcome) :
    Model8.SafeOutcome outcome := by
  unfold check at accepted
  cases result : checkAccepted graph state with
  | none =>
      simp [result] at accepted
  | some checked =>
      simp [result] at accepted
      cases accepted
      exact checked.safe

theorem check_returned_closed
    {graph : Graph}
    {state result : Model8.State}
    {mode : Model8.ReturnMode}
    (accepted : check graph state = some (.returned mode result)) :
    Model8.closedForReturn mode result :=
  check_safe accepted

def terminalLinearCfg : Graph :=
  {
    entry := 0,
    fuel := 3,
    blocks :=
      [
        {
          id := 0,
          body := [.openObligation 9 0 0],
          terminator := .jump 1,
        },
        {
          id := 1,
          body := [.platformDischarge 9],
          terminator := .return .terminal,
        },
      ],
  }

example :
    check terminalLinearCfg Model8.initial =
      some
        (.returned .terminal
          {
            Model8.initial with
            obligations := [],
            terminalReached := true,
          }) := by
  rfl

def terminalBranchConvergesCfg : Graph :=
  {
    entry := 0,
    fuel := 3,
    blocks :=
      [
        {
          id := 0,
          body := [.openObligation 9 0 0],
          terminator := .branch 1 2,
        },
        {
          id := 1,
          body := [.platformDischarge 9],
          terminator := .return .terminal,
        },
        {
          id := 2,
          body := [.terminalDischarge 9],
          terminator := .return .terminal,
        },
      ],
  }

example :
    check terminalBranchConvergesCfg Model8.initial =
      some
        (.returned .terminal
          {
            Model8.initial with
            obligations := [],
            terminalReached := true,
          }) := by
  rfl

def terminalBranchLeaksCfg : Graph :=
  {
    entry := 0,
    fuel := 3,
    blocks :=
      [
        {
          id := 0,
          body := [.openObligation 9 0 0],
          terminator := .branch 1 2,
        },
        {
          id := 1,
          body := [.platformDischarge 9],
          terminator := .return .terminal,
        },
        {
          id := 2,
          body := [],
          terminator := .return .terminal,
        },
      ],
  }

example : check terminalBranchLeaksCfg Model8.initial = none := by
  rfl

def sourceCannotEscapeReturnCfg : Graph :=
  {
    entry := 0,
    fuel := 1,
    blocks :=
      [
        {
          id := 0,
          body := [.openSource 200],
          terminator := .return .ordinary,
        },
      ],
  }

example : check sourceCannotEscapeReturnCfg Model8.initial = none := by
  rfl

def cycleExhaustsFuelCfg : Graph :=
  {
    entry := 0,
    fuel := 3,
    blocks :=
      [
        {
          id := 0,
          body := [],
          terminator := .jump 0,
        },
      ],
  }

example : check cycleExhaustsFuelCfg Model8.initial = none := by
  rfl

def bodyMayNotReturnCfg : Graph :=
  {
    entry := 0,
    fuel := 1,
    blocks :=
      [
        {
          id := 0,
          body := [.ret .ordinary],
          terminator := .return .ordinary,
        },
      ],
  }

example : check bodyMayNotReturnCfg Model8.initial = none := by
  rfl

end Wrela.ProofMIR.Model9
