import type { AArch64LoweringDiagnostic } from "../machine-ir/diagnostics";
import type { AArch64MachineBlock } from "../machine-ir/machine-block";
import type { AArch64MachineFunction } from "../machine-ir/machine-function";
import type { AArch64MachineInstruction } from "../machine-ir/machine-instruction";
import { dependencyEdgeKey } from "../plan/required-constraints";
import type {
  AArch64MachineVerifierContext,
  AArch64MachineVerifierDescriptor,
} from "./verifier-suite";

export const aarch64MemoryOrderVerifierDescriptor: AArch64MachineVerifierDescriptor = {
  key: "memory-order",
  verify(context) {
    return verifyAArch64MemoryOrder(context);
  },
};

export function verifyAArch64MemoryOrder(
  context: AArch64MachineVerifierContext,
): readonly AArch64LoweringDiagnostic[] {
  const diagnostics: AArch64LoweringDiagnostic[] = [];
  for (const machineFunction of context.program.functions.entries()) {
    for (const block of machineFunction.blocks) {
      const instructions = block.instructions;
      for (let index = 0; index < instructions.length; index += 1) {
        const instruction = instructions[index];
        if (instruction === undefined) continue;
        if (instruction.memoryOrdering?.atomicity === "lseAtomic") {
          const expected = expectedLseAtomicOpcode(instruction.memoryOrdering.order);
          if (String(instruction.opcode) !== expected) {
            diagnostics.push(
              context.makeDiagnostic({
                code: "AARCH64_MEMORY_ORDER_REQUIRED_SEQUENCE_MISSING",
                ownerKey: `instruction:${instruction.instructionId}`,
                rootCauseKey: `lse-${instruction.memoryOrdering.order}`,
                stableDetail: `lse-atomic-suffix-invalid:${instruction.memoryOrdering.order}:${String(instruction.opcode)}`,
              }),
            );
          }
          continue;
        }
        if (instruction.memoryOrdering?.order === "sequentiallyConsistent") {
          diagnostics.push(
            ...verifySequentiallyConsistentNonLse(
              context,
              machineFunction,
              block,
              instructions,
              index,
            ),
          );
        }
        if (
          instruction.memoryOrdering?.order === "release" &&
          instruction.memoryOrdering.regionMemoryType === "deviceMmio" &&
          String(instruction.opcode) === "stlr" &&
          !hasTrailingBarrier(machineFunction, block, instructions, index)
        ) {
          diagnostics.push(
            context.makeDiagnostic({
              code: "AARCH64_MEMORY_ORDER_REQUIRED_SEQUENCE_MISSING",
              ownerKey: `instruction:${instruction.instructionId}`,
              rootCauseKey: "release-device-store",
              stableDetail: "release-device-store-missing-dmb",
            }),
          );
        }
        if (
          instruction.memoryOrdering?.order === "acquire" &&
          isLoad(instruction) &&
          String(instruction.opcode) !== "ldar" &&
          String(instruction.opcode) !== "ldaddal"
        ) {
          diagnostics.push(
            context.makeDiagnostic({
              code: "AARCH64_MEMORY_ORDER_REQUIRED_SEQUENCE_MISSING",
              ownerKey: `instruction:${instruction.instructionId}`,
              rootCauseKey: "acquire-load",
              stableDetail: `acquire-load-opcode-invalid:${String(instruction.opcode)}`,
            }),
          );
        }
        if (
          instruction.memoryOrdering?.order === "release" &&
          isStore(instruction) &&
          String(instruction.opcode) !== "stlr" &&
          String(instruction.opcode) !== "ldaddal"
        ) {
          diagnostics.push(
            context.makeDiagnostic({
              code: "AARCH64_MEMORY_ORDER_REQUIRED_SEQUENCE_MISSING",
              ownerKey: `instruction:${instruction.instructionId}`,
              rootCauseKey: "release-store",
              stableDetail: `release-store-opcode-invalid:${String(instruction.opcode)}`,
            }),
          );
        }
      }
    }
  }
  diagnostics.push(...verifyMemoryRequiredEdges(context));
  return diagnostics;
}

function expectedLseAtomicOpcode(order: string): "ldadd" | "ldadda" | "ldaddl" | "ldaddal" {
  switch (order) {
    case "acquire":
      return "ldadda";
    case "release":
      return "ldaddl";
    case "acquireRelease":
    case "sequentiallyConsistent":
      return "ldaddal";
    default:
      return "ldadd";
  }
}

function isLoad(instruction: AArch64MachineInstruction): boolean {
  return instruction.flags.mayLoad === true;
}

function isStore(instruction: AArch64MachineInstruction): boolean {
  return instruction.flags.mayStore === true;
}

function verifySequentiallyConsistentNonLse(
  context: AArch64MachineVerifierContext,
  machineFunction: AArch64MachineFunction,
  block: AArch64MachineBlock,
  instructions: readonly AArch64MachineInstruction[],
  index: number,
): readonly AArch64LoweringDiagnostic[] {
  const instruction = instructions[index];
  if (instruction === undefined) return [];
  if (isLoad(instruction)) {
    const diagnostics: AArch64LoweringDiagnostic[] = [];
    if (String(instruction.opcode) !== "ldar") {
      diagnostics.push(
        context.makeDiagnostic({
          code: "AARCH64_MEMORY_ORDER_REQUIRED_SEQUENCE_MISSING",
          ownerKey: `instruction:${instruction.instructionId}`,
          rootCauseKey: "seq-cst-load",
          stableDetail: `seq-cst-load-opcode-invalid:${String(instruction.opcode)}`,
        }),
      );
    }
    if (!hasLeadingBarrier(machineFunction, block, instructions, index)) {
      diagnostics.push(
        context.makeDiagnostic({
          code: "AARCH64_MEMORY_ORDER_REQUIRED_SEQUENCE_MISSING",
          ownerKey: `instruction:${instruction.instructionId}`,
          rootCauseKey: "seq-cst-load",
          stableDetail: "seq-cst-load-missing-leading-dmb",
        }),
      );
    }
    return diagnostics;
  }
  if (isStore(instruction)) {
    const diagnostics: AArch64LoweringDiagnostic[] = [];
    if (String(instruction.opcode) !== "stlr") {
      diagnostics.push(
        context.makeDiagnostic({
          code: "AARCH64_MEMORY_ORDER_REQUIRED_SEQUENCE_MISSING",
          ownerKey: `instruction:${instruction.instructionId}`,
          rootCauseKey: "seq-cst-store",
          stableDetail: `seq-cst-store-opcode-invalid:${String(instruction.opcode)}`,
        }),
      );
    }
    if (!hasTrailingBarrier(machineFunction, block, instructions, index)) {
      diagnostics.push(
        context.makeDiagnostic({
          code: "AARCH64_MEMORY_ORDER_REQUIRED_SEQUENCE_MISSING",
          ownerKey: `instruction:${instruction.instructionId}`,
          rootCauseKey: "seq-cst-store",
          stableDetail: "seq-cst-store-missing-trailing-dmb",
        }),
      );
    }
    return diagnostics;
  }
  return [];
}

function hasLeadingBarrier(
  machineFunction: AArch64MachineFunction,
  block: AArch64MachineBlock,
  instructions: readonly AArch64MachineInstruction[],
  index: number,
): boolean {
  if (isBarrier(instructions[index - 1])) return true;
  if (index !== 0) return false;
  const predecessors = predecessorBlocks(machineFunction, block);
  return (
    predecessors.length > 0 &&
    predecessors.every((predecessor) => isBarrier(lastInstructionBeforeTerminator(predecessor)))
  );
}

function hasTrailingBarrier(
  machineFunction: AArch64MachineFunction,
  block: AArch64MachineBlock,
  instructions: readonly AArch64MachineInstruction[],
  index: number,
): boolean {
  if (isBarrier(instructions[index + 1])) return true;
  if (index !== instructions.length - 1) return false;
  const successors = successorBlocks(machineFunction, block);
  return (
    successors.length > 0 && successors.every((successor) => isBarrier(successor.instructions[0]))
  );
}

function predecessorBlocks(
  machineFunction: AArch64MachineFunction,
  block: AArch64MachineBlock,
): readonly AArch64MachineBlock[] {
  return machineFunction.blocks.filter((candidate) =>
    instructionsForBlock(candidate).some((instruction) =>
      instruction.operands.some(
        (operand) =>
          operand.role === "branchTarget" &&
          operand.operand.kind === "block" &&
          operand.operand.block === block.blockId,
      ),
    ),
  );
}

function successorBlocks(
  machineFunction: AArch64MachineFunction,
  block: AArch64MachineBlock,
): readonly AArch64MachineBlock[] {
  const blocksById = new Map(
    machineFunction.blocks.map((candidate) => [candidate.blockId, candidate]),
  );
  return instructionsForBlock(block).flatMap((instruction) =>
    instruction.operands.flatMap((operand) => {
      if (operand.role !== "branchTarget" || operand.operand.kind !== "block") return [];
      const successor = blocksById.get(operand.operand.block);
      return successor === undefined ? [] : [successor];
    }),
  );
}

function instructionsForBlock(block: AArch64MachineBlock): readonly AArch64MachineInstruction[] {
  return [...block.instructions, ...(block.terminator === undefined ? [] : [block.terminator])];
}

function lastInstructionBeforeTerminator(
  block: AArch64MachineBlock,
): AArch64MachineInstruction | undefined {
  return block.instructions.at(-1);
}

function isBarrier(instruction: AArch64MachineInstruction | undefined): boolean {
  return (
    instruction !== undefined &&
    (String(instruction.opcode) === "dmb" || String(instruction.opcode) === "dsb")
  );
}

function verifyMemoryRequiredEdges(
  context: AArch64MachineVerifierContext,
): readonly AArch64LoweringDiagnostic[] {
  const requiredEdges = (context.requiredEdges ?? []).filter((edge) =>
    edge.requiredBy.includes("memory-order"),
  );
  if (requiredEdges.length === 0) return [];
  const graphKeys = new Set((context.dependencyEdges ?? []).map(dependencyEdgeKey));
  return requiredEdges
    .filter((edge) => !graphKeys.has(dependencyEdgeKey(edge)))
    .map((edge) =>
      context.makeDiagnostic({
        code: "AARCH64_MEMORY_ORDER_REQUIRED_SEQUENCE_MISSING",
        ownerKey: `instruction:${edge.toInstruction}`,
        rootCauseKey: "memory-order-edge",
        stableDetail: `memory-order-edge-missing:${edge.fromInstruction}:${edge.toInstruction}`,
      }),
    );
}
