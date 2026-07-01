import type { OptIrCfgEdgeTable } from "../../../opt-ir/cfg";
import type { OptIrBlockId, OptIrOperationId, OptIrValueId } from "../../../opt-ir/ids";
import type { OptIrTerminator } from "../../../opt-ir/terminators";
import type { OptIrBlockParameter } from "../../../opt-ir/values";
import {
  aarch64MachineBlockId,
  aarch64RelocationReferenceId,
  aarch64SymbolId,
  aarch64VirtualRegisterId,
} from "../machine-ir/ids";
import type { AArch64MachineBlock } from "../machine-ir/machine-block";
import type { AArch64JumpTableRecord } from "../machine-ir/machine-function";
import type { AArch64MachineInstruction } from "../machine-ir/machine-instruction";
import {
  aarch64RelocationReference,
  type AArch64RelocationReference,
} from "../machine-ir/relocation-reference";
import {
  aarch64InstructionOperand,
  branchTarget,
  defVreg,
  immediateOperand,
  implicitDefResource,
  implicitUseResource,
  symbolOperand,
  useVreg,
} from "../machine-ir/operands";
import {
  aarch64VirtualRegister,
  type AArch64VirtualRegister,
} from "../machine-ir/virtual-register";
import { chooseAArch64SwitchShape } from "./branch-switch-profitability";
import { edgeBranchTarget } from "./edge-copy-lowering";
import { AARCH64_LOWERING_ID_STRIDE } from "./lowering-id-stride";
import { GPR64, registerClassForMachineType } from "./operation-materialization-helpers";
import type { AArch64LoweringSelectionRecord } from "./pipeline-stages";
import {
  terminatorConstantInstructions,
  terminatorInstruction,
} from "./terminator-instruction-helpers";

export function lowerSwitchTerminator(input: {
  readonly terminator: Extract<OptIrTerminator, { readonly kind: "switch" }>;
  readonly edges: OptIrCfgEdgeTable;
  readonly valueRegisters: ReadonlyMap<OptIrValueId, AArch64VirtualRegister>;
  readonly blockParametersByBlock: ReadonlyMap<OptIrBlockId, readonly OptIrBlockParameter[]>;
}):
  | {
      readonly kind: "ok";
      readonly instructions: readonly AArch64MachineInstruction[];
      readonly edgeBlocks: readonly AArch64MachineBlock[];
      readonly virtualRegisters: readonly AArch64VirtualRegister[];
      readonly relocationReferences?: readonly AArch64RelocationReference[];
      readonly jumpTables: readonly AArch64JumpTableRecord[];
      readonly selectionRecords: readonly AArch64LoweringSelectionRecord[];
      readonly instruction: AArch64MachineInstruction;
    }
  | {
      readonly kind: "error";
      readonly stableDetail: string;
      readonly operationId?: OptIrOperationId;
    } {
  const scrutinee = input.valueRegisters.get(input.terminator.scrutinee);
  const defaultTarget =
    scrutinee === undefined
      ? undefined
      : edgeBranchTarget({
          operationId: input.terminator.operationId,
          edgeId: input.terminator.defaultEdge,
          edges: input.edges,
          valueRegisters: input.valueRegisters,
          blockParametersByBlock: input.blockParametersByBlock,
        });
  if (scrutinee === undefined || defaultTarget === undefined || defaultTarget.kind === "error") {
    return {
      kind: "error",
      operationId: input.terminator.operationId,
      stableDetail:
        defaultTarget?.kind === "error"
          ? defaultTarget.stableDetail
          : `lower-terminator:invalid-switch:${String(input.terminator.operationId)}`,
    };
  }

  const instructions: AArch64MachineInstruction[] = [];
  const virtualRegisters: AArch64VirtualRegister[] = [];
  const cases = parseSwitchCases({
    terminator: input.terminator,
    edges: input.edges,
    valueRegisters: input.valueRegisters,
    blockParametersByBlock: input.blockParametersByBlock,
  });
  if (cases.kind === "error") {
    return cases;
  }

  const switchShape = chooseAArch64SwitchShape({
    caseCount: cases.cases.length,
    valueSpan: cases.valueSpan,
    densityPermille: cases.densityPermille,
  });
  if (switchShape === "jumpTable") {
    return lowerJumpTableSwitchTerminator({
      terminator: input.terminator,
      scrutinee,
      defaultTarget: defaultTarget.target,
      cases: cases.cases,
      edgeBlocks: [...cases.edgeBlocks, ...defaultTarget.edgeBlocks],
      edgeCopyVirtualRegisters: [...cases.virtualRegisters, ...defaultTarget.virtualRegisters],
    });
  }

  let sequenceIndex = 0;
  for (let caseIndex = 0; caseIndex < cases.cases.length; caseIndex += 1) {
    const switchCase = cases.cases[caseIndex];
    if (switchCase === undefined) {
      return {
        kind: "error",
        operationId: input.terminator.operationId,
        stableDetail: `lower-terminator:invalid-switch-case:${String(input.terminator.operationId)}:<missing>`,
      };
    }
    const caseRegister = switchCaseRegister({
      operationId: input.terminator.operationId,
      caseIndex,
      scrutinee,
    });
    virtualRegisters.push(caseRegister);

    const constants = terminatorConstantInstructions({
      operationId: input.terminator.operationId,
      register: caseRegister,
      value: switchCase.label,
      sequenceIndex,
      label: `switch-case:${String(switchCase.label)}`,
    });
    instructions.push(...constants);
    sequenceIndex += constants.length;

    instructions.push(
      terminatorInstruction(
        input.terminator.operationId,
        "cmp-shifted-register",
        [
          useVreg(scrutinee, scrutinee.type),
          useVreg(caseRegister, caseRegister.type),
          implicitDefResource({ kind: "NZCV" }),
        ],
        sequenceIndex,
        "cmp-shifted-register",
        false,
      ),
    );
    sequenceIndex += 1;

    instructions.push(
      terminatorInstruction(
        input.terminator.operationId,
        "b-cond",
        [
          implicitUseResource({ kind: "NZCV" }),
          branchTarget(switchCase.target),
          immediateOperand(0n, GPR64),
        ],
        sequenceIndex,
      ),
    );
    sequenceIndex += 1;
  }

  return {
    kind: "ok",
    instructions,
    edgeBlocks: [...cases.edgeBlocks, ...defaultTarget.edgeBlocks],
    virtualRegisters: [
      ...virtualRegisters,
      ...cases.virtualRegisters,
      ...defaultTarget.virtualRegisters,
    ],
    jumpTables: [],
    selectionRecords: [
      switchSelectionRecord({
        operationId: input.terminator.operationId,
        shape: switchShape,
        emittedOpcodes: [...instructions.map((instruction) => String(instruction.opcode)), "b"],
      }),
    ],
    instruction: terminatorInstruction(
      input.terminator.operationId,
      "b",
      [branchTarget(defaultTarget.target)],
      sequenceIndex,
    ),
  };
}

interface ParsedSwitchCase {
  readonly label: bigint;
  readonly target: ReturnType<typeof aarch64MachineBlockId>;
}

function parseSwitchCases(input: {
  readonly terminator: Extract<OptIrTerminator, { readonly kind: "switch" }>;
  readonly edges: OptIrCfgEdgeTable;
  readonly valueRegisters: ReadonlyMap<OptIrValueId, AArch64VirtualRegister>;
  readonly blockParametersByBlock: ReadonlyMap<OptIrBlockId, readonly OptIrBlockParameter[]>;
}):
  | {
      readonly kind: "ok";
      readonly cases: readonly ParsedSwitchCase[];
      readonly edgeBlocks: readonly AArch64MachineBlock[];
      readonly virtualRegisters: readonly AArch64VirtualRegister[];
      readonly valueSpan: bigint;
      readonly densityPermille: number;
    }
  | {
      readonly kind: "error";
      readonly stableDetail: string;
      readonly operationId: OptIrOperationId;
    } {
  const parsedCases = [];
  const edgeBlocks: AArch64MachineBlock[] = [];
  const virtualRegisters: AArch64VirtualRegister[] = [];
  for (const switchCase of input.terminator.cases) {
    const target =
      switchCase === undefined
        ? undefined
        : edgeBranchTarget({
            operationId: input.terminator.operationId,
            edgeId: switchCase.edge,
            edges: input.edges,
            valueRegisters: input.valueRegisters,
            blockParametersByBlock: input.blockParametersByBlock,
          });
    const label = switchCase === undefined ? undefined : parseSwitchCaseLabel(switchCase.label);
    if (
      switchCase === undefined ||
      target === undefined ||
      target.kind === "error" ||
      label === undefined
    ) {
      return {
        kind: "error",
        operationId: input.terminator.operationId,
        stableDetail:
          target?.kind === "error"
            ? target.stableDetail
            : `lower-terminator:invalid-switch-case:${String(input.terminator.operationId)}:${switchCase?.label ?? "<missing>"}`,
      };
    }
    parsedCases.push({ label, target: target.target });
    edgeBlocks.push(...target.edgeBlocks);
    virtualRegisters.push(...target.virtualRegisters);
  }
  const sortedCases = parsedCases.sort((left, right) =>
    left.label < right.label ? -1 : left.label > right.label ? 1 : 0,
  );
  const firstCase = sortedCases[0];
  const lastCase = sortedCases[sortedCases.length - 1];
  const valueSpan =
    firstCase === undefined || lastCase === undefined ? 0n : lastCase.label - firstCase.label + 1n;
  const densityPermille =
    valueSpan <= 0n ? 0 : Math.min(1000, Number((BigInt(sortedCases.length) * 1000n) / valueSpan));
  return {
    kind: "ok",
    cases: Object.freeze(sortedCases),
    edgeBlocks,
    virtualRegisters,
    valueSpan,
    densityPermille,
  };
}

function lowerJumpTableSwitchTerminator(input: {
  readonly terminator: Extract<OptIrTerminator, { readonly kind: "switch" }>;
  readonly scrutinee: AArch64VirtualRegister;
  readonly defaultTarget: ReturnType<typeof aarch64MachineBlockId>;
  readonly cases: readonly ParsedSwitchCase[];
  readonly edgeBlocks: readonly AArch64MachineBlock[];
  readonly edgeCopyVirtualRegisters: readonly AArch64VirtualRegister[];
}):
  | {
      readonly kind: "ok";
      readonly instructions: readonly AArch64MachineInstruction[];
      readonly edgeBlocks: readonly AArch64MachineBlock[];
      readonly virtualRegisters: readonly AArch64VirtualRegister[];
      readonly relocationReferences?: readonly AArch64RelocationReference[];
      readonly jumpTables: readonly AArch64JumpTableRecord[];
      readonly selectionRecords: readonly AArch64LoweringSelectionRecord[];
      readonly instruction: AArch64MachineInstruction;
    }
  | {
      readonly kind: "error";
      readonly stableDetail: string;
      readonly operationId?: OptIrOperationId;
    } {
  const firstCase = input.cases[0];
  const lastCase = input.cases[input.cases.length - 1];
  if (firstCase === undefined || lastCase === undefined) {
    return {
      kind: "error",
      operationId: input.terminator.operationId,
      stableDetail: `lower-terminator:invalid-switch:${String(input.terminator.operationId)}`,
    };
  }
  const minRegister = switchJumpTableRegister({
    operationId: input.terminator.operationId,
    index: 0,
    label: "min",
  });
  const indexRegister = switchJumpTableRegister({
    operationId: input.terminator.operationId,
    index: 1,
    label: "index",
  });
  const boundRegister = switchJumpTableRegister({
    operationId: input.terminator.operationId,
    index: 2,
    label: "bound",
  });
  const tableBase = switchJumpTableRegister({
    operationId: input.terminator.operationId,
    index: 3,
    label: "base",
  });
  const tablePage = switchJumpTableRegister({
    operationId: input.terminator.operationId,
    index: 6,
    label: "page",
  });
  const byteOffsetRegister = switchJumpTableRegister({
    operationId: input.terminator.operationId,
    index: 4,
    label: "byte-offset",
  });
  const targetRegister = switchJumpTableRegister({
    operationId: input.terminator.operationId,
    index: 5,
    label: "target",
  });
  const tableKey = `jump-table.${String(input.terminator.operationId)}`;
  const instructions: AArch64MachineInstruction[] = [];
  let sequenceIndex = 0;
  const minConstants = terminatorConstantInstructions({
    operationId: input.terminator.operationId,
    register: minRegister,
    value: firstCase.label,
    sequenceIndex,
    label: "jump-table:min",
  });
  instructions.push(...minConstants);
  sequenceIndex += minConstants.length;
  instructions.push(
    terminatorInstruction(
      input.terminator.operationId,
      "sub-shifted-register",
      [
        defVreg(indexRegister, indexRegister.type),
        useVreg(input.scrutinee, input.scrutinee.type),
        useVreg(minRegister, minRegister.type),
      ],
      sequenceIndex,
      "jump-table:index",
      false,
    ),
  );
  sequenceIndex += 1;
  const boundConstants = terminatorConstantInstructions({
    operationId: input.terminator.operationId,
    register: boundRegister,
    value: lastCase.label - firstCase.label,
    sequenceIndex,
    label: "jump-table:bound",
  });
  instructions.push(...boundConstants);
  sequenceIndex += boundConstants.length;
  instructions.push(
    terminatorInstruction(
      input.terminator.operationId,
      "cmp-shifted-register",
      [
        useVreg(indexRegister, indexRegister.type),
        useVreg(boundRegister, boundRegister.type),
        implicitDefResource({ kind: "NZCV" }),
      ],
      sequenceIndex,
      "jump-table:bounds-compare",
      false,
    ),
  );
  sequenceIndex += 1;
  instructions.push(
    terminatorInstruction(
      input.terminator.operationId,
      "b-cond",
      [
        implicitUseResource({ kind: "NZCV" }),
        branchTarget(input.defaultTarget),
        immediateOperand(4n, GPR64),
      ],
      sequenceIndex,
      "jump-table:bounds-default",
    ),
  );
  sequenceIndex += 1;
  instructions.push(
    terminatorInstruction(
      input.terminator.operationId,
      "lsl-immediate",
      [
        defVreg(byteOffsetRegister, byteOffsetRegister.type),
        useVreg(indexRegister, indexRegister.type),
        immediateOperand(3n, GPR64),
      ],
      sequenceIndex,
      "jump-table:scale",
      false,
    ),
  );
  sequenceIndex += 1;
  instructions.push(
    terminatorInstruction(
      input.terminator.operationId,
      "adrp",
      [defVreg(tablePage, tablePage.type), symbolOperand(aarch64SymbolId(tableKey))],
      sequenceIndex,
      "jump-table:page",
      false,
    ),
  );
  sequenceIndex += 1;
  instructions.push(
    terminatorInstruction(
      input.terminator.operationId,
      "add-pageoff",
      [
        defVreg(tableBase, tableBase.type),
        useVreg(tablePage, tablePage.type),
        immediateOperand(0n, tableBase.type),
        symbolOperand(aarch64SymbolId(tableKey)),
      ],
      sequenceIndex,
      "jump-table:pageoff",
      false,
    ),
  );
  sequenceIndex += 1;
  instructions.push(
    terminatorInstruction(
      input.terminator.operationId,
      "ldr-register-offset",
      [
        defVreg(targetRegister, targetRegister.type),
        memoryBaseVreg(tableBase),
        memoryIndexVreg(byteOffsetRegister),
      ],
      sequenceIndex,
      "jump-table:load-target",
      false,
    ),
  );
  sequenceIndex += 1;
  const entriesByLabel = new Map(input.cases.map((switchCase) => [switchCase.label, switchCase]));
  const entries = [];
  for (let value = firstCase.label; value <= lastCase.label; value += 1n) {
    entries.push({
      value,
      targetBlock: Number(entriesByLabel.get(value)?.target ?? input.defaultTarget),
    });
  }
  return {
    kind: "ok",
    instructions,
    edgeBlocks: input.edgeBlocks,
    virtualRegisters: [
      minRegister,
      indexRegister,
      boundRegister,
      tablePage,
      tableBase,
      byteOffsetRegister,
      targetRegister,
      ...input.edgeCopyVirtualRegisters,
    ],
    relocationReferences: jumpTableRelocations(input.terminator.operationId, tableKey),
    jumpTables: [
      {
        tableKey,
        operationKey: `terminator:${String(input.terminator.operationId)}`,
        entries,
        defaultTargetBlock: Number(input.defaultTarget),
        picSafe: true,
      },
    ],
    selectionRecords: [
      switchSelectionRecord({
        operationId: input.terminator.operationId,
        shape: "jumpTable",
        emittedOpcodes: [...instructions.map((instruction) => String(instruction.opcode)), "br"],
      }),
    ],
    instruction: terminatorInstruction(
      input.terminator.operationId,
      "br",
      [useVreg(targetRegister, targetRegister.type)],
      sequenceIndex,
    ),
  };
}

function parseSwitchCaseLabel(label: string): bigint | undefined {
  try {
    if (label.trim() !== label || label.length === 0) {
      return undefined;
    }
    return BigInt(label);
  } catch {
    return undefined;
  }
}

function switchCaseRegister(input: {
  readonly operationId: OptIrOperationId;
  readonly caseIndex: number;
  readonly scrutinee: AArch64VirtualRegister;
}): AArch64VirtualRegister {
  return aarch64VirtualRegister({
    vreg: aarch64VirtualRegisterId(
      2_000_000_000 + Number(input.operationId) * AARCH64_LOWERING_ID_STRIDE + input.caseIndex,
    ),
    registerClass: registerClassForMachineType(input.scrutinee.type),
    type: input.scrutinee.type,
    origin: {
      kind: "synthetic",
      stableKey: `opt-ir-terminator:${String(input.operationId)}:switch-case:${input.caseIndex}`,
    },
  });
}

function switchJumpTableRegister(input: {
  readonly operationId: OptIrOperationId;
  readonly index: number;
  readonly label: string;
}): AArch64VirtualRegister {
  return aarch64VirtualRegister({
    vreg: aarch64VirtualRegisterId(
      2_500_000_000 + Number(input.operationId) * AARCH64_LOWERING_ID_STRIDE + input.index,
    ),
    registerClass: "gpr64",
    type: GPR64,
    origin: {
      kind: "synthetic",
      stableKey: `opt-ir-terminator:${String(input.operationId)}:jump-table:${input.label}`,
    },
  });
}

function memoryBaseVreg(register: AArch64VirtualRegister) {
  return aarch64InstructionOperand({
    role: "memoryBase",
    operand: { kind: "vreg", register },
    type: register.type,
  });
}

function memoryIndexVreg(register: AArch64VirtualRegister) {
  return aarch64InstructionOperand({
    role: "memoryIndex",
    operand: { kind: "vreg", register },
    type: register.type,
  });
}

function jumpTableRelocations(
  operationId: OptIrOperationId,
  tableKey: string,
): readonly AArch64RelocationReference[] {
  const symbol = aarch64SymbolId(tableKey);
  return Object.freeze(
    (["PAGE", "PAGEOFF12"] as const).map((kind, index) =>
      aarch64RelocationReference({
        relocationId: aarch64RelocationReferenceId(
          Number(operationId) * AARCH64_LOWERING_ID_STRIDE + 3000 + index,
        ),
        kind,
        symbol,
        addend: 0n,
        targetFingerprint: `aarch64-relocation:jump-table:${kind.toLowerCase()}`,
      }),
    ),
  );
}

function switchSelectionRecord(input: {
  readonly operationId: OptIrOperationId;
  readonly shape: ReturnType<typeof chooseAArch64SwitchShape>;
  readonly emittedOpcodes: readonly string[];
}): AArch64LoweringSelectionRecord {
  return Object.freeze({
    stageKey: "lower-terminators",
    subjectKey: `terminator:${String(input.operationId)}`,
    patternId: `switch.${input.shape}`,
    tier: "planning",
    coveredOperationIds: [Number(input.operationId)],
    factsUsed: [],
    emittedOpcodes: Object.freeze([...input.emittedOpcodes]),
    explanation: Object.freeze([`switch-lowering:${input.shape}`]),
  });
}
