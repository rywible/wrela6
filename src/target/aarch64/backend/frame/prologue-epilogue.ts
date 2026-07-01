import { compareCodeUnitStrings } from "../../../../shared/deterministic-sort";
import { backendOk, type AArch64BackendResult } from "../api/diagnostics";
import type { AArch64FrameSlot, AArch64StackFrameLayout } from "./frame-layout";

export interface AArch64FinalizationInstructionDraft {
  readonly stableKey: string;
  readonly role: string;
}

export interface AArch64ExitInput {
  readonly exitKey: string;
  readonly kind: "return" | "tail-call" | "trap" | "noreturn" | "unreachable";
  readonly cleanupPending?: boolean;
}

export interface AArch64ExitPlan {
  readonly exitKey: string;
  readonly ending:
    | "return"
    | "tail-call"
    | "ordinary-call-plus-epilogue"
    | "trap"
    | "noreturn"
    | "unreachable";
  readonly instructions: readonly AArch64FinalizationInstructionDraft[];
}

export interface AArch64PrologueEpiloguePlan {
  readonly prologue: readonly AArch64FinalizationInstructionDraft[];
  readonly exitPlans: readonly AArch64ExitPlan[];
}

export function finalizeAArch64PrologueEpilogue(input: {
  readonly frame: AArch64StackFrameLayout;
  readonly exits: readonly AArch64ExitInput[];
}): AArch64BackendResult<AArch64PrologueEpiloguePlan> {
  const prologue: AArch64FinalizationInstructionDraft[] = [];
  if (input.frame.totalSizeBytes > 0) prologue.push(draft("prologue:stack-adjust", "stack-adjust"));
  if (input.frame.requiresFrameRecord)
    prologue.push(draft("prologue:frame-record", "frame-record-setup"));
  for (const register of [...input.frame.savedRegisters].sort(compareCodeUnitStrings))
    prologue.push(draft(`prologue:save:${register}`, `save:${register}`));
  for (const slot of input.frame.wipeSlots)
    prologue.push(draft(`prologue:init:${slot.slotKey}`, `wipe-slot-init:${slot.slotKey}`));
  if (prologue.length > 0) prologue.push(draft("prologue:unwind-marker", "unwind-marker"));
  return backendOk({
    prologue: Object.freeze(prologue),
    exitPlans: Object.freeze(
      [...input.exits]
        .sort((left, right) => compareCodeUnitStrings(left.exitKey, right.exitKey))
        .map((exit) => exitPlan(exit, input.frame)),
    ),
  });
}

function exitPlan(exit: AArch64ExitInput, frame: AArch64StackFrameLayout): AArch64ExitPlan {
  const ending =
    exit.kind === "tail-call" && exit.cleanupPending === true
      ? "ordinary-call-plus-epilogue"
      : exit.kind;
  const instructions: AArch64FinalizationInstructionDraft[] = [];
  for (const slot of frame.wipeSlots)
    instructions.push(
      draft(`exit:${exit.exitKey}:wipe:${slot.slotKey}`, `wipe-slot:${slot.slotKey}`),
    );
  if (ending !== "noreturn" && ending !== "trap" && ending !== "unreachable") {
    for (const register of [...frame.savedRegisters].sort(compareCodeUnitStrings).reverse())
      instructions.push(draft(`exit:${exit.exitKey}:restore:${register}`, `restore:${register}`));
    if (frame.requiresFrameRecord)
      instructions.push(draft(`exit:${exit.exitKey}:frame-teardown`, "frame-teardown"));
    if (frame.totalSizeBytes > 0)
      instructions.push(draft(`exit:${exit.exitKey}:stack-restore`, "stack-restore"));
  }
  instructions.push(
    draft(
      `exit:${exit.exitKey}:${ending}`,
      ending === "ordinary-call-plus-epilogue" ? "call-plus-return" : ending,
    ),
  );
  return Object.freeze({
    exitKey: exit.exitKey,
    ending,
    instructions: Object.freeze(instructions),
  });
}

function draft(stableKey: string, role: string): AArch64FinalizationInstructionDraft {
  return Object.freeze({ stableKey, role });
}

export type { AArch64FrameSlot };
