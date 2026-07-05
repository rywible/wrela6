import type { AArch64MachineFunction } from "../../../machine-ir/machine-function";
import type { AArch64LayoutPhysicalInstruction } from "../../object/layout-encode-fixed-point";
import {
  layoutAArch64StackFrame,
  type AArch64FrameSlot,
  type AArch64FrameSlotRequest,
  type AArch64StackFrameLayout,
} from "../../frame/frame-layout";
import { finalizeAArch64PrologueEpilogue } from "../../frame/prologue-epilogue";
import { planAArch64Unwind } from "../../frame/unwind-plan";
import type { AArch64SpillSlotRequest } from "../../allocation/spill-remat";
import type { AArch64BackendTargetSurface } from "../backend-target-surface";
import type { AArch64BackendStageKey } from "../backend-pipeline";
import type { AArch64BackendDiagnostic } from "../diagnostics";
import { frameFinalizationInstructionsForAArch64Function } from "../function-finalization-instructions";
import { returnExitInputs } from "../function-security-projection";
import { aarch64FunctionStageFailure, runAArch64FunctionStage } from "../function-stage-runner";
import { aarch64FinalizationDiagnostic } from "../machine-lowering";

export interface AArch64FrameFinalizationStageResult {
  readonly prologueInstructions: readonly AArch64LayoutPhysicalInstruction[];
  readonly epilogueInstructions: readonly AArch64LayoutPhysicalInstruction[];
  readonly trapPreludeInstructions: readonly AArch64LayoutPhysicalInstruction[];
  readonly tailCallPreludeInstructions: readonly AArch64LayoutPhysicalInstruction[];
  readonly frame: AArch64StackFrameLayout;
  readonly frameSlots: readonly AArch64FrameSlot[];
  readonly frameSizeBytes: number;
  readonly frameShape: string;
  readonly wipeSlotKeys: readonly string[];
}

export function runAArch64FrameFinalizationStage(input: {
  readonly functionKey: string;
  readonly machineFunction: AArch64MachineFunction;
  readonly target: AArch64BackendTargetSurface;
  readonly spillSlots: readonly (AArch64SpillSlotRequest | AArch64FrameSlotRequest)[];
  readonly savedRegisters: readonly string[];
  readonly scratchRegister: string | undefined;
}):
  | {
      readonly kind: "ok";
      readonly value: AArch64FrameFinalizationStageResult;
      readonly diagnostics: readonly AArch64BackendDiagnostic[];
    }
  | {
      readonly kind: "error";
      readonly failedStage: AArch64BackendStageKey;
      readonly diagnostics: readonly AArch64BackendDiagnostic[];
    } {
  const frame = runAArch64FunctionStage({
    stageKey: "layout-frames",
    execute: () =>
      layoutAArch64StackFrame({
        functionKey: input.functionKey,
        spillSlots: input.spillSlots,
        savedRegisters: input.savedRegisters,
      }),
  });
  if (frame.kind === "error") return frame;
  if (frame.value.wipeSlots.length > 0 && input.scratchRegister === undefined) {
    return aarch64FunctionStageFailure("finalize-prologue-epilogue-tail-trap-noreturn", [
      aarch64FinalizationDiagnostic(`physical-ir:wipe-slot:no-scratch:${input.functionKey}`),
    ]);
  }
  const finalization = runAArch64FunctionStage({
    stageKey: "finalize-prologue-epilogue-tail-trap-noreturn",
    execute: () =>
      finalizeAArch64PrologueEpilogue({
        frame: frame.value,
        exits: returnExitInputs(input.functionKey, input.machineFunction),
      }),
  });
  if (finalization.kind === "error") return finalization;
  const unwind = runAArch64FunctionStage({
    stageKey: "plan-unwind",
    execute: () =>
      planAArch64Unwind({
        frame: frame.value,
        finalization: finalization.value,
        unwindCatalog: input.target.unwindCatalog,
      }),
  });
  if (unwind.kind === "error") return unwind;
  const frameInstructions = runAArch64FunctionStage({
    stageKey: "finalize-prologue-epilogue-tail-trap-noreturn",
    execute: () =>
      frameFinalizationInstructionsForAArch64Function({
        functionKey: input.functionKey,
        frame: frame.value,
        scratchRegister: input.scratchRegister,
      }),
  });
  if (frameInstructions.kind === "error") return frameInstructions;
  return {
    kind: "ok",
    value: Object.freeze({
      prologueInstructions: frameInstructions.value.prologueInstructions,
      epilogueInstructions: frameInstructions.value.epilogueInstructions,
      trapPreludeInstructions: frameInstructions.value.trapPreludeInstructions,
      tailCallPreludeInstructions: frameInstructions.value.tailCallPreludeInstructions,
      frame: frame.value,
      frameSlots: frame.value.slots,
      frameSizeBytes: unwind.value.frameSizeBytes,
      frameShape: unwind.value.classification,
      wipeSlotKeys: Object.freeze(frame.value.wipeSlots.map((slot) => slot.slotKey)),
    }),
    diagnostics: Object.freeze([]),
  };
}
