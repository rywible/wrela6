/-!
Model 10 captures terminal-function call graph closure.

Terminal bodies may discharge directly into a platform boundary or call another
terminal body that does. Every branch must reach such a boundary, and cycles are
rejected.
-/

namespace Wrela.ProofMIR.Model10

inductive TerminalBody where
  | fallthrough
  | platform
  | call (target : Nat)
  | branch (left right : TerminalBody)
deriving Repr

structure TerminalFunction where
  id : Nat
  body : TerminalBody
deriving Repr

structure TerminalGraph where
  functions : List TerminalFunction
deriving Repr

def findFunction : List TerminalFunction -> Nat -> Option TerminalFunction
  | [], _ => none
  | function :: rest, id =>
      if function.id == id then
        some function
      else
        findFunction rest id

def idSeen (visited : List Nat) (id : Nat) : Bool :=
  visited.any (fun existing => existing == id)

def bodySize : TerminalBody -> Nat
  | .fallthrough => 1
  | .platform => 1
  | .call _ => 1
  | .branch left right => 1 + bodySize left + bodySize right

def graphBodyBudget : List TerminalFunction -> Nat
  | [] => 0
  | function :: rest => bodySize function.body + graphBodyBudget rest

def graphBudget (graph : TerminalGraph) : Nat :=
  graph.functions.length + graphBodyBudget graph.functions + 1

def checkBody (graph : TerminalGraph) : Nat -> List Nat -> TerminalBody -> Bool
  | 0, _, _ => false
  | fuel + 1, visited, body =>
      match body with
      | .fallthrough => false
      | .platform => true
      | .branch left right =>
          checkBody graph fuel visited left && checkBody graph fuel visited right
      | .call target =>
          if idSeen visited target then
            false
          else
            match findFunction graph.functions target with
            | none => false
            | some function => checkBody graph fuel (target :: visited) function.body

def check (graph : TerminalGraph) (entry : Nat) : Bool :=
  checkBody graph (graphBudget graph) [] (.call entry)

inductive ReachesPlatform (graph : TerminalGraph) : List Nat -> TerminalBody -> Prop where
  | platform :
      ReachesPlatform graph visited .platform

  | branch :
      ReachesPlatform graph visited left ->
      ReachesPlatform graph visited right ->
      ReachesPlatform graph visited (.branch left right)

  | call :
      idSeen visited target ≠ true ->
      findFunction graph.functions target = some function ->
      ReachesPlatform graph (target :: visited) function.body ->
      ReachesPlatform graph visited (.call target)

theorem checkBody_sound
    {graph : TerminalGraph}
    {fuel : Nat}
    {visited : List Nat}
    {body : TerminalBody}
    (accepted : checkBody graph fuel visited body = true) :
    ReachesPlatform graph visited body := by
  induction fuel generalizing visited body with
  | zero =>
      cases body <;> simp [checkBody] at accepted
  | succ fuel bodySound =>
      cases body with
      | fallthrough =>
          simp [checkBody] at accepted
      | platform =>
          exact ReachesPlatform.platform
      | branch left right =>
          simp [checkBody] at accepted
          exact ReachesPlatform.branch
            (bodySound accepted.left)
            (bodySound accepted.right)
      | call target =>
          by_cases seen : idSeen visited target = true
          · simp [checkBody, seen] at accepted
          · simp [checkBody, seen] at accepted
            cases found : findFunction graph.functions target with
            | none =>
                simp [found] at accepted
            | some function =>
                simp [found] at accepted
                exact ReachesPlatform.call seen found (bodySound accepted)

theorem check_sound
    {graph : TerminalGraph}
    {entry : Nat}
    (accepted : check graph entry = true) :
    ReachesPlatform graph [] (.call entry) :=
  checkBody_sound accepted

theorem check_true_is_reachable_under_budget
    {graph : TerminalGraph}
    {entry : Nat}
    (accepted : check graph entry = true) :
    checkBody graph (graphBudget graph) [] (.call entry) = true :=
  accepted

def directPlatformGraph : TerminalGraph :=
  {
    functions :=
      [
        {
          id := 0,
          body := .platform,
        },
      ],
  }

example : check directPlatformGraph 0 = true := by
  rfl

def terminalChainGraph : TerminalGraph :=
  {
    functions :=
      [
        {
          id := 0,
          body := .call 1,
        },
        {
          id := 1,
          body := .platform,
        },
      ],
  }

example : check terminalChainGraph 0 = true := by
  rfl

def terminalBranchGraph : TerminalGraph :=
  {
    functions :=
      [
        {
          id := 0,
          body := .branch .platform (.call 1),
        },
        {
          id := 1,
          body := .platform,
        },
      ],
  }

example : check terminalBranchGraph 0 = true := by
  rfl

def terminalPartialBranchGraph : TerminalGraph :=
  {
    functions :=
      [
        {
          id := 0,
          body := .branch .platform .fallthrough,
        },
      ],
  }

example : check terminalPartialBranchGraph 0 = false := by
  rfl

def terminalSelfCycleGraph : TerminalGraph :=
  {
    functions :=
      [
        {
          id := 0,
          body := .call 0,
        },
      ],
  }

example : check terminalSelfCycleGraph 0 = false := by
  rfl

def terminalMutualCycleGraph : TerminalGraph :=
  {
    functions :=
      [
        {
          id := 0,
          body := .call 1,
        },
        {
          id := 1,
          body := .call 0,
        },
      ],
  }

example : check terminalMutualCycleGraph 0 = false := by
  rfl

def missingTerminalTargetGraph : TerminalGraph :=
  {
    functions :=
      [
        {
          id := 0,
          body := .call 99,
        },
      ],
  }

example : check missingTerminalTargetGraph 0 = false := by
  rfl

end Wrela.ProofMIR.Model10
