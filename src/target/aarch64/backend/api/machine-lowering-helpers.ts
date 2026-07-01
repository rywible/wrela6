import type { AArch64MachineInstruction } from "../../machine-ir/machine-instruction";
import type { AArch64AllocationResult } from "../allocation/allocation-result";
import type { AArch64PhysicalInstruction } from "../finalization/physical-instruction-ir";
import { aarch64BackendDiagnostic, type AArch64BackendDiagnostic } from "./diagnostics";

export type AArch64MachineInstructionLoweringResult =
  | { readonly kind: "ok"; readonly instruction: AArch64PhysicalInstruction }
  | { readonly kind: "error"; readonly diagnostics: readonly AArch64BackendDiagnostic[] };

export function blockSymbolKey(functionKey: string, blockId: number): string {
  return `${functionKey}:block:${blockId}`;
}

export function branchTargetBlockIdFromSymbol(targetKey: string | undefined): number | undefined {
  if (targetKey === undefined) return undefined;
  const match = /:block:(\d+)$/.exec(targetKey);
  return match === null ? undefined : Number(match[1]);
}

export function relocationFamilyForBranchKind(
  kind: NonNullable<AArch64PhysicalInstruction["branch"]>["kind"],
): "branch14" | "branch19" | "branch26" {
  if (kind === "tbz" || kind === "tbnz") return "branch14";
  if (kind === "b-cond" || kind === "cbz" || kind === "cbnz") return "branch19";
  return "branch26";
}

export function aarch64FinalizationDiagnostic(stableDetail: string): AArch64BackendDiagnostic {
  return aarch64BackendDiagnostic({
    code: "AARCH64_BACKEND_FINALIZATION_INVALID",
    ownerKey: "physical-ir",
    rootCauseKey: stableDetail,
    stableDetail,
  });
}

export function localBranchTargetBlockId(
  instruction: AArch64MachineInstruction,
): number | undefined {
  const target = instruction.operands.find(
    (operand) => operand.role === "branchTarget" && operand.operand.kind === "block",
  );
  return target?.operand.kind === "block" ? Number(target.operand.block) : undefined;
}

export function firstUseVregSubjectKey(instruction: AArch64MachineInstruction): string | undefined {
  const operand = instruction.operands.find(
    (candidate) => candidate.role === "use" && candidate.operand.kind === "vreg",
  );
  return operand?.operand.kind === "vreg"
    ? `vreg:${Number(operand.operand.register.vreg)}`
    : undefined;
}

export function symbolTargetForCall(instruction: AArch64MachineInstruction): string | undefined {
  const target = instruction.operands.find(
    (operand) => operand.role === "use" && operand.operand.kind === "symbol",
  );
  return target?.operand.kind === "symbol" ? String(target.operand.symbol) : undefined;
}

export function physicalRegisterForOperand(
  instruction: AArch64MachineInstruction,
  role: "def" | "use" | "tiedDefUse" | "memoryBase" | "memoryIndex",
  allocation: AArch64AllocationResult,
  overrideRegisters: ReadonlyMap<number, string> = new Map(),
  instructionOrder?: number,
): string | undefined {
  const operand = instruction.operands.find(
    (candidate) => candidate.role === role && candidate.operand.kind === "vreg",
  );
  if (operand?.operand.kind !== "vreg") return undefined;
  return physicalRegisterForVreg(
    Number(operand.operand.register.vreg),
    allocation,
    overrideRegisters,
    instructionOrder,
  );
}

export function physicalRegisterForVreg(
  vreg: number,
  allocation: AArch64AllocationResult,
  overrideRegisters: ReadonlyMap<number, string> = new Map(),
  instructionOrder?: number,
): string | undefined {
  const override = overrideRegisters.get(vreg);
  if (override !== undefined) return override;
  const segments = allocation.segmentsFor(vreg);
  if (instructionOrder !== undefined) {
    const coveringSegment = segments.find(
      (segment) => instructionOrder >= segment.startOrder && instructionOrder < segment.endOrder,
    );
    if (coveringSegment !== undefined) return coveringSegment.physical;
  }
  return segments[0]?.physical;
}

export function useRegisters(
  instruction: AArch64MachineInstruction,
  allocation: AArch64AllocationResult,
  overrideRegisters: ReadonlyMap<number, string>,
  instructionOrder?: number,
): readonly string[] {
  return Object.freeze(
    instruction.operands.flatMap((operand) =>
      operand.role === "use" && operand.operand.kind === "vreg"
        ? (physicalRegisterForVreg(
            Number(operand.operand.register.vreg),
            allocation,
            overrideRegisters,
            instructionOrder,
          ) ?? [])
        : [],
    ),
  );
}

export function conditionOperandFromInstruction(
  instruction: AArch64MachineInstruction,
): { readonly kind: "condition"; readonly condition: string } | undefined {
  const conditionImmediate = [...instruction.operands]
    .reverse()
    .find((operand) => operand.role === "use" && operand.operand.kind === "immediate");
  if (conditionImmediate?.operand.kind !== "immediate") return undefined;
  const condition = conditionName(Number(conditionImmediate.operand.value));
  return condition === undefined ? undefined : { kind: "condition", condition };
}

function conditionName(conditionCode: number): string | undefined {
  const names = [
    "eq",
    "ne",
    "cs",
    "cc",
    "mi",
    "pl",
    "vs",
    "vc",
    "hi",
    "ls",
    "ge",
    "lt",
    "gt",
    "le",
    "al",
    "nv",
  ];
  return names[conditionCode];
}

export function moveWideShiftOperand(
  instruction: AArch64MachineInstruction,
): readonly { readonly kind: "immediate"; readonly value: number }[] {
  const immediates = instruction.operands.filter(
    (operand) => operand.role === "use" && operand.operand.kind === "immediate",
  );
  const shift = immediates[1];
  return shift?.operand.kind === "immediate"
    ? Object.freeze([{ kind: "immediate" as const, value: Number(shift.operand.value) }])
    : Object.freeze([]);
}

export function uniqueVregsForRoles(
  instruction: AArch64MachineInstruction,
  roles: readonly AArch64MachineInstruction["operands"][number]["role"][],
): readonly number[] {
  return Object.freeze(
    [
      ...new Set(
        instruction.operands.flatMap((operand) =>
          roles.includes(operand.role) && operand.operand.kind === "vreg"
            ? [Number(operand.operand.register.vreg)]
            : [],
        ),
      ),
    ].sort((left, right) => left - right),
  );
}

export function firstSpilledUseScratch(
  overrideRegisters: ReadonlyMap<number, string>,
): string | undefined {
  return [...overrideRegisters.values()][0];
}

export function stackRepairInstruction(input: {
  readonly stableKey: string;
  readonly opcode: "ldr-unsigned-immediate" | "str-unsigned-immediate";
  readonly register: string;
  readonly slot: { readonly slotKey: string; readonly offsetBytes: number };
  readonly provenanceSource: string;
}): AArch64PhysicalInstruction {
  return {
    stableKey: input.stableKey,
    opcode: input.opcode,
    operands: [
      { kind: "register", register: input.register },
      { kind: "memory", base: "sp", offsetBytes: input.slot.offsetBytes },
    ],
    memoryKey: `stack:${input.slot.slotKey}`,
    provenanceSource: input.provenanceSource,
  };
}

export function invalidLowering(
  stableKey: string,
  reason: string,
): Extract<AArch64MachineInstructionLoweringResult, { readonly kind: "error" }> {
  return {
    kind: "error",
    diagnostics: [aarch64FinalizationDiagnostic(`physical-ir:${reason}:instruction:${stableKey}`)],
  };
}

export function immediateValueOf(instruction: AArch64MachineInstruction): bigint {
  for (const operand of instruction.operands) {
    if (operand.operand.kind === "immediate") return operand.operand.value;
  }
  return 0n;
}

export function originStableKey(origin: AArch64MachineInstruction["origin"]): string {
  if (origin.kind === "syntheticLowering") return origin.stableKey;
  if (origin.kind === "source") return origin.sourceKey;
  if (origin.kind === "layout") return origin.layoutKey;
  if (origin.kind === "hir") return origin.hirKey;
  if (origin.kind === "mono") return origin.monoKey;
  if (origin.kind === "proofMir") return origin.proofMirKey;
  if (origin.kind === "checkedMir") return origin.checkedMirKey;
  if (origin.kind === "targetSurface") return origin.fingerprint;
  if (origin.kind === "machinePlanning") return origin.planningKey;
  if (origin.kind === "selectedPattern") return `pattern:${origin.patternId}`;
  if (origin.kind === "optIr")
    return `opt-ir:${origin.operationId ?? "none"}:${origin.valueId ?? "none"}`;
  return "unknown-origin";
}
