import type { OptIrCfgEdgeTable } from "../../../opt-ir/cfg";
import type {
  OptIrBlockId,
  OptIrEdgeId,
  OptIrOperationId,
  OptIrValueId,
} from "../../../opt-ir/ids";
import type { OptIrBlockParameter } from "../../../opt-ir/values";
import { aarch64MachineBlock, type AArch64MachineBlock } from "../machine-ir/machine-block";
import type { AArch64JumpTableRecord } from "../machine-ir/machine-function";
import type { AArch64MachineInstruction } from "../machine-ir/machine-instruction";
import {
  aarch64MachineBlockId,
  aarch64MachineInstructionId,
  aarch64VirtualRegisterId,
} from "../machine-ir/ids";
import { branchTarget } from "../machine-ir/operands";
import {
  aarch64VirtualRegister,
  type AArch64VirtualRegister,
} from "../machine-ir/virtual-register";
import type { AArch64LoweringSelectionRecord } from "./pipeline-stages";
import { copyInstruction, terminatorInstruction } from "./terminator-instruction-helpers";

const AARCH64_EDGE_COPY_ID_STRIDE = 1_000_000;
const AARCH64_EDGE_COPY_EDGE_STRIDE = 1024;

export function branchToEdge(input: {
  readonly operationId: OptIrOperationId;
  readonly edgeId: OptIrEdgeId;
  readonly edges: OptIrCfgEdgeTable;
  readonly valueRegisters: ReadonlyMap<OptIrValueId, AArch64VirtualRegister>;
  readonly blockParametersByBlock: ReadonlyMap<OptIrBlockId, readonly OptIrBlockParameter[]>;
}):
  | {
      readonly kind: "ok";
      readonly instructions: readonly AArch64MachineInstruction[];
      readonly edgeBlocks: readonly AArch64MachineBlock[];
      readonly virtualRegisters: readonly AArch64VirtualRegister[];
      readonly jumpTables: readonly AArch64JumpTableRecord[];
      readonly selectionRecords: readonly AArch64LoweringSelectionRecord[];
      readonly instruction: AArch64MachineInstruction;
    }
  | {
      readonly kind: "error";
      readonly stableDetail: string;
      readonly operationId: OptIrOperationId;
    } {
  const target = edgeBranchTarget(input);
  if (target.kind === "error") {
    return {
      kind: "error",
      operationId: input.operationId,
      stableDetail: target.stableDetail,
    };
  }
  return {
    kind: "ok",
    instructions: [],
    edgeBlocks: target.edgeBlocks,
    virtualRegisters: target.virtualRegisters,
    jumpTables: [],
    selectionRecords: [],
    instruction: terminatorInstruction(input.operationId, "b", [branchTarget(target.target)]),
  };
}

export function edgeBranchTarget(input: {
  readonly operationId: OptIrOperationId;
  readonly edgeId: OptIrEdgeId;
  readonly edges: OptIrCfgEdgeTable;
  readonly valueRegisters: ReadonlyMap<OptIrValueId, AArch64VirtualRegister>;
  readonly blockParametersByBlock: ReadonlyMap<OptIrBlockId, readonly OptIrBlockParameter[]>;
}):
  | {
      readonly kind: "ok";
      readonly target: ReturnType<typeof aarch64MachineBlockId>;
      readonly edgeBlocks: readonly AArch64MachineBlock[];
      readonly virtualRegisters: readonly AArch64VirtualRegister[];
    }
  | { readonly kind: "error"; readonly stableDetail: string } {
  const edge = input.edges.get(input.edgeId);
  if (edge?.toBlock === undefined) {
    return {
      kind: "error",
      stableDetail: `lower-terminator:missing-target:${String(input.operationId)}:${String(input.edgeId)}`,
    };
  }
  const target = aarch64MachineBlockId(Number(edge.toBlock));
  if (edge.arguments.length === 0) {
    return { kind: "ok", target, edgeBlocks: [], virtualRegisters: [] };
  }
  const parameters = input.blockParametersByBlock.get(edge.toBlock) ?? [];
  if (parameters.length !== edge.arguments.length) {
    return {
      kind: "error",
      stableDetail: `lower-terminator:edge-argument-count-mismatch:${String(input.operationId)}:${String(input.edgeId)}:${edge.arguments.length}:${parameters.length}`,
    };
  }
  const mappings = [];
  for (let index = 0; index < edge.arguments.length; index += 1) {
    const argument = edge.arguments[index];
    const parameter = parameters[index];
    const source = argument === undefined ? undefined : input.valueRegisters.get(argument);
    const output =
      parameter === undefined ? undefined : input.valueRegisters.get(parameter.valueId);
    if (
      argument === undefined ||
      parameter === undefined ||
      source === undefined ||
      output === undefined
    ) {
      return {
        kind: "error",
        stableDetail: `lower-terminator:edge-argument-missing-vreg:${String(input.operationId)}:${String(input.edgeId)}:${index}`,
      };
    }
    mappings.push({ source, output });
  }
  const lowered = edgeCopyBlock({
    operationId: input.operationId,
    edgeId: input.edgeId,
    target,
    mappings,
  });
  return {
    kind: "ok",
    target: lowered.block.blockId,
    edgeBlocks: [lowered.block],
    virtualRegisters: lowered.virtualRegisters,
  };
}

function edgeCopyBlock(input: {
  readonly operationId: OptIrOperationId;
  readonly edgeId: OptIrEdgeId;
  readonly target: ReturnType<typeof aarch64MachineBlockId>;
  readonly mappings: readonly {
    readonly source: AArch64VirtualRegister;
    readonly output: AArch64VirtualRegister;
  }[];
}): {
  readonly block: AArch64MachineBlock;
  readonly virtualRegisters: readonly AArch64VirtualRegister[];
} {
  const copyPlan = edgeCopyInstructions(input);
  return {
    block: aarch64MachineBlock({
      blockId: edgeCopyBlockId(input.operationId, input.edgeId),
      frequency: { kind: "warm" },
      instructions: copyPlan.instructions,
      terminator: terminatorInstruction(
        input.operationId,
        "b",
        [branchTarget(input.target)],
        edgeCopySequenceIndex(input.edgeId, copyPlan.instructions.length),
        `edge-copy:${String(input.edgeId)}:target`,
      ),
    }),
    virtualRegisters: copyPlan.virtualRegisters,
  };
}

function edgeCopyInstructions(input: {
  readonly operationId: OptIrOperationId;
  readonly edgeId: OptIrEdgeId;
  readonly mappings: readonly {
    readonly source: AArch64VirtualRegister;
    readonly output: AArch64VirtualRegister;
  }[];
}): {
  readonly instructions: readonly AArch64MachineInstruction[];
  readonly virtualRegisters: readonly AArch64VirtualRegister[];
} {
  const effectiveMappings = input.mappings.filter(
    (mapping) => mapping.source.vreg !== mapping.output.vreg,
  );
  const sourceIds = new Set(effectiveMappings.map((mapping) => Number(mapping.source.vreg)));
  const hasOverwriteHazard = effectiveMappings.some((mapping) =>
    sourceIds.has(Number(mapping.output.vreg)),
  );
  if (!hasOverwriteHazard) {
    return {
      instructions: effectiveMappings.map((mapping, index) =>
        edgeCopyInstruction({
          operationId: input.operationId,
          edgeId: input.edgeId,
          sequenceIndex: index,
          output: mapping.output,
          input: mapping.source,
          label: `edge-copy:${String(input.edgeId)}:${index}`,
        }),
      ),
      virtualRegisters: [],
    };
  }
  const temps = effectiveMappings.map((mapping, index) =>
    edgeCopyTempRegister({
      operationId: input.operationId,
      edgeId: input.edgeId,
      index,
      source: mapping.source,
    }),
  );
  return {
    instructions: [
      ...effectiveMappings.map((mapping, index) =>
        edgeCopyInstruction({
          operationId: input.operationId,
          edgeId: input.edgeId,
          sequenceIndex: index,
          output: temps[index] ?? mapping.output,
          input: mapping.source,
          label: `edge-copy:${String(input.edgeId)}:tmp:${index}`,
        }),
      ),
      ...effectiveMappings.map((mapping, index) =>
        edgeCopyInstruction({
          operationId: input.operationId,
          edgeId: input.edgeId,
          sequenceIndex: effectiveMappings.length + index,
          output: mapping.output,
          input: temps[index] ?? mapping.source,
          label: `edge-copy:${String(input.edgeId)}:out:${index}`,
        }),
      ),
    ],
    virtualRegisters: temps,
  };
}

function edgeCopyTempRegister(input: {
  readonly operationId: OptIrOperationId;
  readonly edgeId: OptIrEdgeId;
  readonly index: number;
  readonly source: AArch64VirtualRegister;
}): AArch64VirtualRegister {
  return aarch64VirtualRegister({
    vreg: aarch64VirtualRegisterId(
      4_500_000_000 +
        Number(input.operationId) * AARCH64_EDGE_COPY_ID_STRIDE +
        Number(input.edgeId) * AARCH64_EDGE_COPY_EDGE_STRIDE +
        input.index,
    ),
    registerClass: input.source.registerClass,
    type: input.source.type,
    origin: {
      kind: "synthetic",
      stableKey: `opt-ir-terminator:${String(input.operationId)}:edge-copy:${String(input.edgeId)}:tmp:${input.index}`,
    },
  });
}

function edgeCopyInstruction(input: {
  readonly operationId: OptIrOperationId;
  readonly edgeId: OptIrEdgeId;
  readonly sequenceIndex: number;
  readonly output: AArch64VirtualRegister;
  readonly input: AArch64VirtualRegister;
  readonly label: string;
}): AArch64MachineInstruction {
  const isVectorCopy =
    input.output.registerClass === "vector64" || input.output.registerClass === "vector128";
  return copyInstruction({
    instructionId: aarch64MachineInstructionId(
      4_000_000_000 +
        Number(input.operationId) * AARCH64_EDGE_COPY_ID_STRIDE +
        Number(input.edgeId) * AARCH64_EDGE_COPY_EDGE_STRIDE +
        input.sequenceIndex,
    ),
    output: input.output,
    input: input.input,
    originKey: `opt-ir-terminator:${String(input.operationId)}:${input.label}:${input.sequenceIndex}`,
    issueClass: isVectorCopy ? "vector" : "integer",
  });
}

function edgeCopyBlockId(operationId: OptIrOperationId, edgeId: OptIrEdgeId) {
  return aarch64MachineBlockId(
    4_000_000_000 +
      Number(operationId) * AARCH64_EDGE_COPY_ID_STRIDE +
      Number(edgeId) * AARCH64_EDGE_COPY_EDGE_STRIDE,
  );
}

function edgeCopySequenceIndex(edgeId: OptIrEdgeId, offset: number): number {
  return 500_000 + Number(edgeId) * AARCH64_EDGE_COPY_EDGE_STRIDE + offset;
}
