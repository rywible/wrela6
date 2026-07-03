import type { AArch64MachineFunction } from "../../machine-ir/machine-function";
import type { AArch64MachineInstruction } from "../../machine-ir/machine-instruction";
import type { AArch64MachineScalarType, AArch64MachineType } from "../../machine-ir/machine-types";
import type { AArch64AllocationResult } from "../allocation/allocation-result";
import type { AArch64PhysicalInstruction } from "../finalization/physical-instruction-ir";
import type { AArch64LayoutPhysicalInstruction } from "../object/layout-encode-fixed-point";
import { sortAArch64BackendDiagnostics, type AArch64BackendDiagnostic } from "./diagnostics";
import {
  conditionOperandFromInstruction,
  firstUseVregSubjectKey,
  immediateValueOf,
  invalidLowering,
  moveWideShiftOperand,
  originStableKey,
  physicalRegisterForOperand,
  physicalRegisterForVreg,
  relocationFamilyForBranchKind,
  symbolTargetForCall,
  useRegisters,
} from "./machine-lowering-helpers";
import {
  buildLoweringRepairPlan,
  lowerMachineInstructionWithRepairs,
  type AArch64LoweringRepairContext,
} from "./machine-lowering-repairs";
import {
  blockLabelInstruction,
  instructionsWithBranchDistances,
  isAArch64LocalBranchOpcode,
  lowerLocalBranchInstruction,
  referencedLocalBranchTargetBlockIds,
} from "./machine-lowering-branches";
import { commitAArch64InstructionRewrite } from "./backend-rewrite-application";
import type { AArch64BackendRewriteKind } from "../facts/backend-rewrite-transaction";

export { aarch64FinalizationDiagnostic } from "./machine-lowering-helpers";
export type { AArch64LoweringRepairContext } from "./machine-lowering-repairs";

export function lowerAArch64MachineInstructions(
  functionKey: string,
  machineFunction: AArch64MachineFunction,
  allocation: AArch64AllocationResult,
  repairContext?: AArch64LoweringRepairContext,
  callBoundaries: readonly AArch64LoweringCallBoundary[] = [],
):
  | { readonly kind: "ok"; readonly instructions: readonly AArch64PhysicalInstruction[] }
  | { readonly kind: "error"; readonly diagnostics: readonly AArch64BackendDiagnostic[] } {
  const diagnostics: AArch64BackendDiagnostic[] = [];
  const repairPlan = buildLoweringRepairPlan(repairContext);
  const callBoundaryByInstructionId = new Map(
    callBoundaries.map((boundary) => [boundary.instructionId, boundary]),
  );
  const referencedBlockIds = referencedLocalBranchTargetBlockIds(machineFunction);
  const loweredBlocks: {
    readonly blockId: number;
    readonly instructions: readonly AArch64PhysicalInstruction[];
  }[] = [];
  let instructionOrder = 0;
  let nzcvConditionSubjectKey: string | undefined;
  for (const block of machineFunction.blocks) {
    const blockId = Number(block.blockId);
    const blockInstructions: AArch64PhysicalInstruction[] = referencedBlockIds.has(blockId)
      ? [blockLabelInstruction(functionKey, blockId)]
      : [];
    for (const instruction of block.instructions) {
      const lowered = lowerMachineInstructionWithRepairs(
        functionKey,
        instruction,
        allocation,
        repairPlan,
        lowerMachineInstruction,
        {
          instructionOrder,
          nzcvConditionSubjectKey,
          callBoundary: callBoundaryByInstructionId.get(Number(instruction.instructionId)),
        },
      );
      if (lowered.kind === "error") diagnostics.push(...lowered.diagnostics);
      else {
        const committed = commitLoweredInstructionRewrite(
          functionKey,
          instruction,
          lowered.instructions,
        );
        if (committed.kind === "error") diagnostics.push(...committed.diagnostics);
        else blockInstructions.push(...committed.value.instructions);
      }
      nzcvConditionSubjectKey = nzcvSubjectAfterInstruction(instruction, nzcvConditionSubjectKey);
      instructionOrder += 1;
    }
    if (block.terminator !== undefined) {
      const lowered = lowerMachineInstructionWithRepairs(
        functionKey,
        block.terminator,
        allocation,
        repairPlan,
        lowerMachineInstruction,
        {
          instructionOrder,
          nzcvConditionSubjectKey,
          callBoundary: callBoundaryByInstructionId.get(Number(block.terminator.instructionId)),
        },
      );
      if (lowered.kind === "error") diagnostics.push(...lowered.diagnostics);
      else {
        const committed = commitLoweredInstructionRewrite(
          functionKey,
          block.terminator,
          lowered.instructions,
        );
        if (committed.kind === "error") diagnostics.push(...committed.diagnostics);
        else blockInstructions.push(...committed.value.instructions);
      }
      nzcvConditionSubjectKey = nzcvSubjectAfterInstruction(
        block.terminator,
        nzcvConditionSubjectKey,
      );
      instructionOrder += 1;
    }
    loweredBlocks.push({
      blockId,
      instructions: Object.freeze(blockInstructions),
    });
  }
  return diagnostics.length === 0
    ? { kind: "ok", instructions: instructionsWithBranchDistances(loweredBlocks) }
    : { kind: "error", diagnostics: sortAArch64BackendDiagnostics(diagnostics) };
}

interface AArch64LoweringInstructionContext {
  readonly instructionOrder: number;
  readonly nzcvConditionSubjectKey?: string;
  readonly callBoundary?: AArch64LoweringCallBoundary;
}

export interface AArch64LoweringCallBoundary {
  readonly instructionId: number;
  readonly argumentRegisters: readonly string[];
  readonly resultRegisters: readonly string[];
}

function commitLoweredInstructionRewrite(
  functionKey: string,
  instruction: AArch64MachineInstruction,
  replacements: readonly AArch64PhysicalInstruction[],
):
  | {
      readonly kind: "ok";
      readonly value: { readonly instructions: readonly AArch64PhysicalInstruction[] };
    }
  | { readonly kind: "error"; readonly diagnostics: readonly AArch64BackendDiagnostic[] } {
  return commitAArch64InstructionRewrite({
    kind: loweringRewriteKind(replacements),
    source: {
      stableKey: `insn:${functionKey}:${instruction.instructionId}`,
      opcode: String(instruction.opcode),
      operands: instruction.operands,
      provenanceSource: originStableKey(instruction.origin),
    },
    replacements,
  });
}

function loweringRewriteKind(
  replacements: readonly AArch64PhysicalInstruction[],
): AArch64BackendRewriteKind {
  if (replacements.some((instruction) => instruction.stableKey.includes(":remat:vreg:"))) {
    return "rematerialization";
  }
  if (
    replacements.some(
      (instruction) =>
        instruction.stableKey.includes(":spill:vreg:") ||
        instruction.stableKey.includes(":reload:vreg:"),
    )
  ) {
    return "spill-insertion";
  }
  return "instruction-replacement";
}

const THREE_REGISTER_OPCODES = new Set([
  "add-shifted-register",
  "sub-shifted-register",
  "and-shifted-register",
  "orr-shifted-register",
  "eor-shifted-register",
  "mul",
  "udiv",
  "sdiv",
  "lsl",
  "lsr",
  "tbl",
  "tbx",
  "cmeq",
  "bsl",
  "crc32",
  "pmull",
  "aes-sha-round",
  "fmla",
  "sqrdmulh",
  "sqrdmlah",
  "sqadd-saturating",
  "dotprod",
]);

const LOGICAL_IMMEDIATE_OPCODES = new Set([
  "and-logical-immediate",
  "orr-logical-immediate",
  "eor-logical-immediate",
]);

const LOAD_OPCODES = new Set(["ldr-unsigned-immediate", "ldar", "ld1"]);
const STORE_OPCODES = new Set(["str-unsigned-immediate", "stlr", "st1"]);
const LDADD_OPCODES = new Set(["ldadd", "ldadda", "ldaddl", "ldaddal"]);

export function layoutAArch64InstructionFromPhysicalInstruction(
  instruction: AArch64PhysicalInstruction,
): AArch64LayoutPhysicalInstruction {
  const operands: AArch64LayoutPhysicalInstruction["operands"] = Object.freeze(
    instruction.operands.flatMap((operand): AArch64LayoutPhysicalInstruction["operands"] => {
      if (operand.kind === "register") {
        return [{ kind: "register", register: operand.register }];
      }
      if (operand.kind === "immediate") {
        return [{ kind: "immediate", value: BigInt(operand.value) }];
      }
      if (operand.kind === "condition") {
        return [{ kind: "condition", condition: operand.condition }];
      }
      if (operand.kind === "memory") {
        return [
          { kind: "memory-base", register: operand.base },
          { kind: "immediate", value: BigInt(operand.offsetBytes) },
        ];
      }
      if (operand.kind === "symbol") {
        return [{ kind: "relocation-target", target: operand.symbol }];
      }
      if (operand.kind === "relocationLow12") {
        return [
          {
            kind: "relocation-low12",
            target: operand.symbol,
            addend: BigInt(operand.addend),
          },
        ];
      }
      return [];
    }),
  );
  const branchTarget = instruction.operands.find((operand) => operand.kind === "symbol");
  const low12Target = instruction.operands.find((operand) => operand.kind === "relocationLow12");
  return {
    stableKey: instruction.stableKey,
    opcode: instruction.opcode,
    operands,
    ...(instruction.definedSymbol === undefined
      ? {}
      : { definedSymbol: instruction.definedSymbol }),
    ...(instruction.security === undefined ? {} : { security: instruction.security }),
    ...(instruction.accessWidthBytes === undefined
      ? {}
      : { accessWidthBytes: instruction.accessWidthBytes }),
    ...(instruction.opcode === "bl" && branchTarget?.kind === "symbol"
      ? {
          relocation: { family: "branch26", target: branchTarget.symbol },
          branch: {
            kind: "bl" as const,
            targetKey: branchTarget.symbol,
            distanceBytes: 4,
            veneerPolicy: "backend-owned" as const,
          },
        }
      : {}),
    ...(instruction.branch !== undefined
      ? {
          relocation: {
            family: relocationFamilyForBranchKind(instruction.branch.kind),
            target: instruction.branch.targetKey,
          },
          branch: instruction.branch,
        }
      : {}),
    ...(instruction.opcode === "adrp" && branchTarget?.kind === "symbol"
      ? { relocation: { family: "pagebase-rel21", target: branchTarget.symbol } }
      : {}),
    ...(instruction.opcode === "add-pageoff" && low12Target?.kind === "relocationLow12"
      ? { relocation: { family: "pageoffset-12a", target: low12Target.symbol } }
      : {}),
    ...(instruction.provenanceSource === undefined
      ? {}
      : { provenanceSource: instruction.provenanceSource }),
  };
}

function lowerMachineInstruction(
  functionKey: string,
  instruction: AArch64MachineInstruction,
  allocation: AArch64AllocationResult,
  overrideRegisters: ReadonlyMap<number, string> = new Map(),
  context: AArch64LoweringInstructionContext,
):
  | { readonly kind: "ok"; readonly instruction: AArch64PhysicalInstruction }
  | { readonly kind: "error"; readonly diagnostics: readonly AArch64BackendDiagnostic[] } {
  const opcode = String(instruction.opcode);
  const stableKey = `insn:${functionKey}:${instruction.instructionId}`;
  if (opcode === "ret") {
    return {
      kind: "ok",
      instruction: {
        stableKey,
        opcode,
        operands: [],
        provenanceSource: originStableKey(instruction.origin),
      },
    };
  }
  if (opcode === "trap" || opcode === "dmb" || opcode === "dsb") {
    return {
      kind: "ok",
      instruction: {
        stableKey,
        opcode,
        operands: [],
        provenanceSource: originStableKey(instruction.origin),
      },
    };
  }
  if (opcode === "br") {
    const target = physicalRegisterForOperand(
      instruction,
      "use",
      allocation,
      overrideRegisters,
      context.instructionOrder,
    );
    if (target === undefined) return invalidLowering(stableKey, "missing-allocation:br");
    return {
      kind: "ok",
      instruction: {
        stableKey,
        opcode,
        operands: [{ kind: "register", register: target }],
        fixedRegisterUses: context.callBoundary?.argumentRegisters,
        fixedRegisterDefs: context.callBoundary?.resultRegisters,
        provenanceSource: originStableKey(instruction.origin),
      },
    };
  }
  if (opcode === "blr") {
    const target = physicalRegisterForOperand(
      instruction,
      "use",
      allocation,
      overrideRegisters,
      context.instructionOrder,
    );
    if (target === undefined) return invalidLowering(stableKey, "missing-allocation:blr");
    return {
      kind: "ok",
      instruction: {
        stableKey,
        opcode,
        operands: [{ kind: "register", register: target }],
        provenanceSource: originStableKey(instruction.origin),
      },
    };
  }
  if (opcode === "bl") {
    const target = symbolTargetForCall(instruction);
    if (target === undefined) return invalidLowering(stableKey, "missing-call-target:bl");
    return {
      kind: "ok",
      instruction: {
        stableKey,
        opcode,
        operands: [{ kind: "symbol", symbol: target }],
        fixedRegisterUses: context.callBoundary?.argumentRegisters,
        fixedRegisterDefs: context.callBoundary?.resultRegisters,
        provenanceSource: originStableKey(instruction.origin),
      },
    };
  }
  if (isAArch64LocalBranchOpcode(opcode)) {
    return lowerLocalBranchInstruction(
      functionKey,
      stableKey,
      instruction,
      allocation,
      overrideRegisters,
      context,
    );
  }
  if (opcode === "movz" || opcode === "movk" || opcode === "movn") {
    const destination = physicalRegisterForOperand(
      instruction,
      opcode === "movk" ? "tiedDefUse" : "def",
      allocation,
      overrideRegisters,
      context.instructionOrder,
    );
    if (destination === undefined)
      return invalidLowering(stableKey, "missing-allocation:destination");
    return {
      kind: "ok",
      instruction: {
        stableKey,
        opcode,
        operands: [
          { kind: "register", register: destination },
          { kind: "immediate", value: Number(immediateValueOf(instruction)) },
          ...moveWideShiftOperand(instruction),
        ],
        provenanceSource: originStableKey(instruction.origin),
      },
    };
  }
  if (opcode === "add-immediate" || opcode === "sub-immediate") {
    const destination = physicalRegisterForOperand(
      instruction,
      "def",
      allocation,
      overrideRegisters,
      context.instructionOrder,
    );
    const source = physicalRegisterForOperand(
      instruction,
      "use",
      allocation,
      overrideRegisters,
      context.instructionOrder,
    );
    if (destination === undefined || source === undefined) {
      return invalidLowering(stableKey, `missing-allocation:${opcode}`);
    }
    return {
      kind: "ok",
      instruction: {
        stableKey,
        opcode,
        operands: [
          { kind: "register", register: destination },
          { kind: "register", register: source },
          { kind: "immediate", value: Number(immediateValueOf(instruction)) },
        ],
        provenanceSource: originStableKey(instruction.origin),
      },
    };
  }
  if (LOAD_OPCODES.has(opcode) || STORE_OPCODES.has(opcode)) {
    const register = LOAD_OPCODES.has(opcode)
      ? physicalRegisterForOperand(
          instruction,
          "def",
          allocation,
          overrideRegisters,
          context.instructionOrder,
        )
      : physicalRegisterForOperand(
          instruction,
          "use",
          allocation,
          overrideRegisters,
          context.instructionOrder,
        );
    const base = physicalRegisterForOperand(
      instruction,
      "memoryBase",
      allocation,
      overrideRegisters,
      context.instructionOrder,
    );
    if (register === undefined || base === undefined) {
      return invalidLowering(stableKey, `missing-allocation:${opcode}`);
    }
    return {
      kind: "ok",
      instruction: {
        stableKey,
        opcode,
        operands: [
          { kind: "register", register },
          { kind: "memory", base, offsetBytes: Number(immediateValueOf(instruction)) },
        ],
        ...accessWidthForLoadStore(instruction),
        memoryKey: `memory:${base}:${immediateValueOf(instruction).toString()}`,
        provenanceSource: originStableKey(instruction.origin),
      },
    };
  }
  if (LDADD_OPCODES.has(opcode)) {
    const source = physicalRegisterForOperand(
      instruction,
      "use",
      allocation,
      overrideRegisters,
      context.instructionOrder,
    );
    const destination = physicalRegisterForOperand(
      instruction,
      "def",
      allocation,
      overrideRegisters,
      context.instructionOrder,
    );
    const base = physicalRegisterForOperand(
      instruction,
      "memoryBase",
      allocation,
      overrideRegisters,
      context.instructionOrder,
    );
    if (source === undefined || destination === undefined || base === undefined) {
      return invalidLowering(stableKey, `missing-allocation:${opcode}`);
    }
    return {
      kind: "ok",
      instruction: {
        stableKey,
        opcode,
        operands: [
          { kind: "register", register: source },
          { kind: "register", register: destination },
          { kind: "memory", base, offsetBytes: 0 },
        ],
        memoryKey: `memory:${base}:0`,
        provenanceSource: originStableKey(instruction.origin),
      },
    };
  }
  if (opcode === "rev" || opcode === "rev16" || opcode === "rev32") {
    const destination = physicalRegisterForOperand(
      instruction,
      "def",
      allocation,
      overrideRegisters,
      context.instructionOrder,
    );
    const source = physicalRegisterForOperand(
      instruction,
      "use",
      allocation,
      overrideRegisters,
      context.instructionOrder,
    );
    if (destination === undefined || source === undefined) {
      return invalidLowering(stableKey, `missing-allocation:${opcode}`);
    }
    return {
      kind: "ok",
      instruction: {
        stableKey,
        opcode,
        operands: [
          { kind: "register", register: destination },
          { kind: "register", register: source },
        ],
        provenanceSource: originStableKey(instruction.origin),
      },
    };
  }
  if (opcode === "fcvt-fp16" || opcode === "mov-vector") {
    const destination = physicalRegisterForOperand(
      instruction,
      "def",
      allocation,
      overrideRegisters,
      context.instructionOrder,
    );
    const source = physicalRegisterForOperand(
      instruction,
      "use",
      allocation,
      overrideRegisters,
      context.instructionOrder,
    );
    if (destination === undefined || source === undefined) {
      return invalidLowering(stableKey, `missing-allocation:${opcode}`);
    }
    return {
      kind: "ok",
      instruction: {
        stableKey,
        opcode,
        operands: [
          { kind: "register", register: destination },
          { kind: "register", register: source },
        ],
        provenanceSource: originStableKey(instruction.origin),
      },
    };
  }
  if (opcode === "movi") {
    const destination = physicalRegisterForOperand(
      instruction,
      "def",
      allocation,
      overrideRegisters,
      context.instructionOrder,
    );
    if (destination === undefined) return invalidLowering(stableKey, "missing-allocation:movi");
    return {
      kind: "ok",
      instruction: {
        stableKey,
        opcode,
        operands: [
          { kind: "register", register: destination },
          { kind: "immediate", value: Number(immediateValueOf(instruction)) },
        ],
        provenanceSource: originStableKey(instruction.origin),
      },
    };
  }
  if (opcode === "fmadd") {
    const destination = physicalRegisterForOperand(
      instruction,
      "def",
      allocation,
      overrideRegisters,
      context.instructionOrder,
    );
    const uses = useRegisters(instruction, allocation, overrideRegisters, context.instructionOrder);
    if (
      destination === undefined ||
      uses[0] === undefined ||
      uses[1] === undefined ||
      uses[2] === undefined
    ) {
      return invalidLowering(stableKey, "missing-allocation:fmadd");
    }
    return {
      kind: "ok",
      instruction: {
        stableKey,
        opcode,
        operands: [
          { kind: "register", register: destination },
          { kind: "register", register: uses[0] },
          { kind: "register", register: uses[1] },
          { kind: "register", register: uses[2] },
        ],
        provenanceSource: originStableKey(instruction.origin),
      },
    };
  }
  if (THREE_REGISTER_OPCODES.has(opcode)) {
    const destination = physicalRegisterForOperand(
      instruction,
      "def",
      allocation,
      overrideRegisters,
      context.instructionOrder,
    );
    const uses = instruction.operands.filter(
      (operand) => operand.role === "use" && operand.operand.kind === "vreg",
    );
    const left = physicalRegisterForVreg(
      Number(uses[0]?.operand.kind === "vreg" ? uses[0].operand.register.vreg : -1),
      allocation,
      overrideRegisters,
      context.instructionOrder,
    );
    const right = physicalRegisterForVreg(
      Number(uses[1]?.operand.kind === "vreg" ? uses[1].operand.register.vreg : -1),
      allocation,
      overrideRegisters,
      context.instructionOrder,
    );
    if (destination === undefined || left === undefined || right === undefined) {
      return invalidLowering(stableKey, `missing-allocation:${opcode}`);
    }
    return {
      kind: "ok",
      instruction: {
        stableKey,
        opcode,
        operands: [
          { kind: "register", register: destination },
          { kind: "register", register: left },
          { kind: "register", register: right },
        ],
        provenanceSource: originStableKey(instruction.origin),
      },
    };
  }
  if (LOGICAL_IMMEDIATE_OPCODES.has(opcode)) {
    const destination = physicalRegisterForOperand(
      instruction,
      "def",
      allocation,
      overrideRegisters,
      context.instructionOrder,
    );
    const source = physicalRegisterForOperand(
      instruction,
      "use",
      allocation,
      overrideRegisters,
      context.instructionOrder,
    );
    if (destination === undefined || source === undefined) {
      return invalidLowering(stableKey, `missing-allocation:${opcode}`);
    }
    return {
      kind: "ok",
      instruction: {
        stableKey,
        opcode,
        operands: [
          { kind: "register", register: destination },
          { kind: "register", register: source },
          { kind: "immediate", value: Number(immediateValueOf(instruction)) },
        ],
        provenanceSource: originStableKey(instruction.origin),
      },
    };
  }
  if (opcode === "cmp-shifted-register") {
    const uses = useRegisters(instruction, allocation, overrideRegisters, context.instructionOrder);
    if (uses[0] === undefined || uses[1] === undefined) {
      return invalidLowering(stableKey, "missing-allocation:cmp-shifted-register");
    }
    return {
      kind: "ok",
      instruction: {
        stableKey,
        opcode,
        operands: [
          { kind: "register", register: uses[0] },
          { kind: "register", register: uses[1] },
        ],
        provenanceSource: originStableKey(instruction.origin),
      },
    };
  }
  if (opcode === "cset") {
    const destination = physicalRegisterForOperand(
      instruction,
      "def",
      allocation,
      overrideRegisters,
      context.instructionOrder,
    );
    const condition = conditionOperandFromInstruction(instruction);
    if (destination === undefined || condition === undefined) {
      return invalidLowering(stableKey, "missing-allocation:cset");
    }
    return {
      kind: "ok",
      instruction: {
        stableKey,
        opcode,
        operands: [{ kind: "register", register: destination }, condition],
        provenanceSource: originStableKey(instruction.origin),
      },
    };
  }
  if (opcode === "csel") {
    const destination = physicalRegisterForOperand(
      instruction,
      "def",
      allocation,
      overrideRegisters,
      context.instructionOrder,
    );
    const uses = useRegisters(instruction, allocation, overrideRegisters, context.instructionOrder);
    const condition = conditionOperandFromInstruction(instruction);
    if (
      destination === undefined ||
      uses[0] === undefined ||
      uses[1] === undefined ||
      condition === undefined
    ) {
      return invalidLowering(stableKey, "missing-allocation:csel");
    }
    return {
      kind: "ok",
      instruction: {
        stableKey,
        opcode,
        operands: [
          { kind: "register", register: destination },
          { kind: "register", register: uses[0] },
          { kind: "register", register: uses[1] },
          condition,
        ],
        provenanceSource: originStableKey(instruction.origin),
      },
    };
  }
  if (opcode === "ccmp") {
    const uses = useRegisters(instruction, allocation, overrideRegisters, context.instructionOrder);
    const condition = conditionOperandFromInstruction(instruction);
    const nzcv = instruction.operands.find(
      (operand) => operand.role === "use" && operand.operand.kind === "immediate",
    );
    if (uses[0] === undefined || uses[1] === undefined || condition === undefined) {
      return invalidLowering(stableKey, "missing-allocation:ccmp");
    }
    return {
      kind: "ok",
      instruction: {
        stableKey,
        opcode,
        operands: [
          { kind: "register", register: uses[0] },
          { kind: "register", register: uses[1] },
          {
            kind: "immediate",
            value: Number(nzcv?.operand.kind === "immediate" ? nzcv.operand.value : 0n),
          },
          condition,
        ],
        provenanceSource: originStableKey(instruction.origin),
      },
    };
  }
  if (opcode === "adrp") {
    const destination = physicalRegisterForOperand(
      instruction,
      "def",
      allocation,
      overrideRegisters,
      context.instructionOrder,
    );
    const symbol = symbolTargetForCall(instruction);
    if (destination === undefined || symbol === undefined) {
      return invalidLowering(stableKey, "missing-allocation:adrp");
    }
    return {
      kind: "ok",
      instruction: {
        stableKey,
        opcode,
        operands: [
          { kind: "register", register: destination },
          { kind: "symbol", symbol },
        ],
        provenanceSource: originStableKey(instruction.origin),
      },
    };
  }
  if (opcode === "add-pageoff") {
    const destination = physicalRegisterForOperand(
      instruction,
      "def",
      allocation,
      overrideRegisters,
      context.instructionOrder,
    );
    const source = physicalRegisterForOperand(
      instruction,
      "use",
      allocation,
      overrideRegisters,
      context.instructionOrder,
    );
    const symbol = symbolTargetForCall(instruction);
    if (destination === undefined || source === undefined || symbol === undefined) {
      return invalidLowering(stableKey, "missing-allocation:add-pageoff");
    }
    return {
      kind: "ok",
      instruction: {
        stableKey,
        opcode,
        operands: [
          { kind: "register", register: destination },
          { kind: "register", register: source },
          { kind: "relocationLow12", symbol, addend: Number(immediateValueOf(instruction)) },
        ],
        provenanceSource: originStableKey(instruction.origin),
      },
    };
  }
  return invalidLowering(stableKey, `unsupported-opcode:${opcode}`);
}

function accessWidthForLoadStore(instruction: AArch64MachineInstruction): {
  readonly accessWidthBytes?: number;
} {
  const accessType = instruction.operands[0]?.type;
  const accessWidthBytes = memoryAccessBytesForType(accessType);
  return accessWidthBytes === undefined ? {} : { accessWidthBytes };
}

function memoryAccessBytesForType(type: AArch64MachineType | undefined): number | undefined {
  if (type === undefined) {
    return undefined;
  }
  switch (type.kind) {
    case "integer":
    case "float":
    case "pointer":
    case "token":
    case "resourceToken":
      return memoryAccessBytesForScalarType(type);
    case "vector": {
      const laneBytes = memoryAccessBytesForScalarType(type.laneType);
      return laneBytes === undefined ? undefined : laneBytes * type.laneCount;
    }
  }
}

function memoryAccessBytesForScalarType(type: AArch64MachineScalarType): number | undefined {
  switch (type.kind) {
    case "integer":
    case "float":
      return Math.max(1, Math.ceil(type.width / 8));
    case "pointer":
      return 8;
    case "token":
    case "resourceToken":
      return undefined;
  }
}

function nzcvSubjectAfterInstruction(
  instruction: AArch64MachineInstruction,
  currentSubject: string | undefined,
): string | undefined {
  if (definesNzcvFromVregComparison(instruction)) {
    return firstUseVregSubjectKey(instruction);
  }
  return instructionImplicitlyDefinesNzcv(instruction) ? undefined : currentSubject;
}

function definesNzcvFromVregComparison(instruction: AArch64MachineInstruction): boolean {
  const opcode = String(instruction.opcode);
  return opcode === "cmp-shifted-register" || opcode === "ccmp";
}

function instructionImplicitlyDefinesNzcv(instruction: AArch64MachineInstruction): boolean {
  return instruction.operands.some(
    (operand) =>
      operand.role === "implicitDef" &&
      operand.operand.kind === "resource" &&
      operand.operand.resource.kind === "NZCV",
  );
}
