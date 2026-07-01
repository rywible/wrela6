import type { AArch64StackFrameLayout } from "../frame/frame-layout";
import type { AArch64LayoutPhysicalInstruction } from "../object/layout-encode-fixed-point";
import { backendError, backendOk, type AArch64BackendResult } from "./diagnostics";
import {
  exitPreludeInstructionsForAArch64Frame,
  epilogueInstructionsForAArch64Frame,
  prologueInstructionsForAArch64Frame,
} from "./frame-instructions";
import { commitAArch64InstructionRewrite } from "./backend-rewrite-application";

export interface AArch64FinalizationInstructionGroups {
  readonly prologueInstructions: readonly AArch64LayoutPhysicalInstruction[];
  readonly epilogueInstructions: readonly AArch64LayoutPhysicalInstruction[];
  readonly trapPreludeInstructions: readonly AArch64LayoutPhysicalInstruction[];
  readonly tailCallPreludeInstructions: readonly AArch64LayoutPhysicalInstruction[];
}

export function frameFinalizationInstructionsForAArch64Function(input: {
  readonly functionKey: string;
  readonly frame: AArch64StackFrameLayout;
  readonly scratchRegister?: string;
}): AArch64BackendResult<AArch64FinalizationInstructionGroups> {
  const prologueInstructions = commitFrameInstructionGroup({
    sourceKey: `${input.functionKey}:frame:prologue`,
    sourceOpcode: "frame:prologue",
    instructions: prologueInstructionsForAArch64Frame(
      input.functionKey,
      input.frame,
      input.scratchRegister,
    ),
  });
  const epilogueInstructions = commitFrameInstructionGroup({
    sourceKey: `${input.functionKey}:frame:epilogue`,
    sourceOpcode: "frame:epilogue",
    instructions: epilogueInstructionsForAArch64Frame(
      input.functionKey,
      input.frame,
      input.scratchRegister,
    ),
  });
  const trapPreludeInstructions = commitFrameInstructionGroup({
    sourceKey: `${input.functionKey}:frame:trap-prelude`,
    sourceOpcode: "frame:trap-prelude",
    instructions: exitPreludeInstructionsForAArch64Frame(
      input.functionKey,
      input.frame,
      input.scratchRegister,
      "trap",
    ),
  });
  const tailCallPreludeInstructions = commitFrameInstructionGroup({
    sourceKey: `${input.functionKey}:frame:tail-call-prelude`,
    sourceOpcode: "frame:tail-call-prelude",
    instructions: exitPreludeInstructionsForAArch64Frame(
      input.functionKey,
      input.frame,
      input.scratchRegister,
      "tail-call",
    ),
  });
  const diagnostics = [
    prologueInstructions,
    epilogueInstructions,
    trapPreludeInstructions,
    tailCallPreludeInstructions,
  ].flatMap((result) => (result.kind === "error" ? result.diagnostics : []));
  if (diagnostics.length > 0) return backendError(diagnostics);
  if (
    prologueInstructions.kind === "error" ||
    epilogueInstructions.kind === "error" ||
    trapPreludeInstructions.kind === "error" ||
    tailCallPreludeInstructions.kind === "error"
  ) {
    return backendError(diagnostics);
  }
  return backendOk({
    prologueInstructions: prologueInstructions.value.instructions,
    epilogueInstructions: epilogueInstructions.value.instructions,
    trapPreludeInstructions: trapPreludeInstructions.value.instructions,
    tailCallPreludeInstructions: tailCallPreludeInstructions.value.instructions,
  });
}

function commitFrameInstructionGroup(input: {
  readonly sourceKey: string;
  readonly sourceOpcode: string;
  readonly instructions: readonly AArch64LayoutPhysicalInstruction[];
}): AArch64BackendResult<{ readonly instructions: readonly AArch64LayoutPhysicalInstruction[] }> {
  if (input.instructions.length === 0) {
    return backendOk({ instructions: Object.freeze([]) });
  }
  return commitAArch64InstructionRewrite({
    kind: "frame-layout-rewrite",
    source: { stableKey: input.sourceKey, opcode: input.sourceOpcode },
    replacements: input.instructions,
  });
}
