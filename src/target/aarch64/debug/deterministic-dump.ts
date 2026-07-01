import type { AArch64PreservedFactSet } from "../machine-ir/fact-set";
import type { AArch64MachineProgram } from "../machine-ir/machine-program";

export function dumpAArch64MachineProgramDeterministically(input: {
  readonly program: AArch64MachineProgram;
  readonly preservedFacts?: AArch64PreservedFactSet;
  readonly includeDebugExplanations?: boolean;
}): string {
  const lines: string[] = [];
  lines.push(
    `program ${Number(input.program.programId)} target=${input.program.targetFingerprint}`,
  );
  lines.push(`entry ${String(input.program.entrySymbol)}`);
  for (const symbol of [...input.program.globalSymbols].sort((left, right) =>
    String(left.symbol).localeCompare(String(right.symbol)),
  )) {
    lines.push(`symbol ${String(symbol.symbol)} ${symbol.visibility} ${symbol.section ?? ""}`);
  }
  for (const machineFunction of input.program.functions.entries()) {
    lines.push(`function ${Number(machineFunction.functionId)} ${String(machineFunction.symbol)}`);
    for (const relocation of machineFunction.relocationReferences) {
      lines.push(
        `  relocation ${Number(relocation.relocationId)} ${relocation.kind} ${String(relocation.symbol)} addend=${relocation.addend} target=${relocation.targetFingerprint}`,
      );
    }
    for (const literal of machineFunction.literalPoolPlan) {
      lines.push(`  literal ${literal}`);
    }
    for (const remat of machineFunction.rematerializationPlan) {
      lines.push(
        `  remat ${Number(remat.producer)} ${remat.kind} cost=${remat.cost} facts=${remat.requiredFacts.join(",")} symbols=${remat.requiredSymbols.join(",")}`,
      );
    }
    for (const jumpTable of machineFunction.jumpTablePlan) {
      lines.push(
        `  jumptable ${jumpTable.tableKey} default=${jumpTable.defaultTargetBlock} entries=${jumpTable.entries.map((entry) => `${entry.value}->${entry.targetBlock}`).join(",")}`,
      );
    }
    for (const frameObject of machineFunction.frameObjects) {
      lines.push(
        `  frame ${Number(frameObject.frameObjectId)} ${frameObject.kind} ${frameObject.size}`,
      );
    }
    for (const block of machineFunction.blocks) {
      lines.push(`  block ${Number(block.blockId)} ${block.frequency.kind}`);
      for (const instruction of block.instructions) {
        lines.push(`    ${Number(instruction.instructionId)} ${String(instruction.opcode)}`);
        if (input.includeDebugExplanations === true) {
          lines.push(`      origin ${JSON.stringify(instruction.origin)}`);
        }
      }
      if (block.terminator !== undefined) {
        lines.push(
          `    term ${Number(block.terminator.instructionId)} ${String(block.terminator.opcode)}`,
        );
        if (input.includeDebugExplanations === true) {
          lines.push(`      origin ${JSON.stringify(block.terminator.origin)}`);
        }
      }
    }
  }
  for (const record of input.preservedFacts?.records ?? []) {
    lines.push(`fact ${Number(record.factId)} ${record.stableKey}`);
  }
  if (input.includeDebugExplanations === true) {
    for (const origin of input.program.provenance.origins) {
      lines.push(`origin ${JSON.stringify(origin)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
