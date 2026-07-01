import {
  aarch64BackendDiagnostic,
  backendError,
  backendOk,
  type AArch64BackendDiagnostic,
  type AArch64BackendResult,
} from "../api/diagnostics";

export type AArch64PhysicalOperand =
  | { readonly kind: "register"; readonly register: string }
  | { readonly kind: "memory"; readonly base: string; readonly offsetBytes: number }
  | { readonly kind: "immediate"; readonly value: number }
  | { readonly kind: "condition"; readonly condition: string }
  | { readonly kind: "symbol"; readonly symbol: string }
  | { readonly kind: "relocationLow12"; readonly symbol: string; readonly addend: number }
  | { readonly kind: "vreg"; readonly vreg: number };

export interface AArch64PhysicalInstruction {
  readonly stableKey: string;
  readonly opcode: string;
  readonly operands: readonly AArch64PhysicalOperand[];
  readonly relocationHoleOwner?: string;
  readonly securityLabel?: string;
  readonly provenanceSource?: string;
  readonly memoryKey?: string;
  readonly fixedRegisterUses?: readonly string[];
  readonly fixedRegisterDefs?: readonly string[];
  readonly definedSymbol?: {
    readonly stableKey: string;
    readonly isGlobal?: boolean;
  };
  readonly branch?: {
    readonly kind: "b" | "bl" | "b-cond" | "cbz" | "cbnz" | "tbz" | "tbnz";
    readonly targetKey: string;
    readonly distanceBytes: number;
    readonly veneerPolicy?: "backend-owned" | "linker-owned" | "none";
  };
  readonly security?: {
    readonly branchConditionSubjectKey?: string;
    readonly tableIndexSubjectKey?: string;
    readonly helperArgumentSubjectKeys?: readonly string[];
  };
}

export function buildAArch64PhysicalInstructionIr(input: {
  readonly instructions: readonly AArch64PhysicalInstruction[];
}): AArch64BackendResult<{ readonly instructions: readonly AArch64PhysicalInstruction[] }> {
  const diagnostics: AArch64BackendDiagnostic[] = [];
  for (const instruction of input.instructions) {
    for (const operand of instruction.operands) {
      if (operand.kind === "vreg")
        diagnostics.push(
          diagnostic(
            `physical-ir:unresolved-virtual-register:instruction:${instruction.stableKey}:vreg:${operand.vreg}`,
          ),
        );
    }
  }
  if (diagnostics.length > 0) return backendError(diagnostics);
  return backendOk({
    instructions: Object.freeze([...input.instructions]),
  });
}

function diagnostic(stableDetail: string): AArch64BackendDiagnostic {
  return aarch64BackendDiagnostic({
    code: "AARCH64_BACKEND_FINALIZATION_INVALID",
    ownerKey: "physical-ir",
    rootCauseKey: stableDetail,
    stableDetail,
  });
}
