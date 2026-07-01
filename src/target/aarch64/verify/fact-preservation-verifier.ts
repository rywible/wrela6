import type { AArch64PreservedFactSet } from "../machine-ir/fact-set";
import type { AArch64LoweringDiagnostic } from "../machine-ir/diagnostics";
import type { AArch64MachineInstruction } from "../machine-ir/machine-instruction";
import type {
  AArch64MachineVerifierContext,
  AArch64MachineVerifierDescriptor,
} from "./verifier-suite";

export const aarch64FactPreservationVerifierDescriptor: AArch64MachineVerifierDescriptor = {
  key: "facts",
  verify(context) {
    if (context.preservedFacts === undefined) {
      return [];
    }
    return verifyAArch64FactPreservation({
      preservedFacts: context.preservedFacts,
      preservedOptIrFactIds: context.preservedOptIrFactIds ?? [],
      context,
    });
  },
};

export function verifyAArch64FactPreservation(input: {
  readonly preservedFacts: AArch64PreservedFactSet;
  readonly preservedOptIrFactIds: readonly number[];
  readonly context: AArch64MachineVerifierContext;
}): readonly AArch64LoweringDiagnostic[] {
  const valid = new Set(input.preservedOptIrFactIds);
  const dropped = new Set(
    input.preservedFacts.droppedFacts.map((record) => Number(record.optIrFactId)),
  );
  const targetDeclarations = new Set(input.preservedFacts.targetDeclarations);
  const seen = new Map<string, string>();
  const diagnostics: AArch64LoweringDiagnostic[] = [];
  for (const record of input.preservedFacts.records) {
    const serialized = JSON.stringify(record.payload);
    const prior = seen.get(record.stableKey);
    if (prior !== undefined && prior !== serialized) {
      diagnostics.push(
        diagnostic(input.context, record.stableKey, "duplicate-conflicting-machine-fact"),
      );
    }
    seen.set(record.stableKey, serialized);
    if (
      record.lineage.optIrFactIds.length === 0 &&
      record.lineage.targetDeclarationKeys.length === 0
    ) {
      diagnostics.push(diagnostic(input.context, record.stableKey, "unjustified-machine-fact"));
    }
    for (const targetDeclarationKey of record.lineage.targetDeclarationKeys) {
      if (!targetDeclarations.has(targetDeclarationKey)) {
        diagnostics.push(
          diagnostic(
            input.context,
            record.stableKey,
            `missing-target-declaration:${targetDeclarationKey}`,
          ),
        );
      }
    }
    if (!machineFactSubjectExists(input.context, record.subject)) {
      diagnostics.push(
        diagnostic(input.context, record.stableKey, `missing-machine-subject:${record.stableKey}`),
      );
    }
    for (const optIrFactId of record.lineage.optIrFactIds) {
      const factId = Number(optIrFactId);
      if (dropped.has(factId)) {
        diagnostics.push(
          diagnostic(input.context, record.stableKey, `dropped-fact-preserved:optIrFact:${factId}`),
        );
        continue;
      }
      if (!valid.has(factId)) {
        diagnostics.push(
          diagnostic(input.context, record.stableKey, `resurrected-fact:optIrFact:${factId}`),
        );
      }
    }
  }
  return diagnostics;
}

function machineFactSubjectExists(
  context: AArch64MachineVerifierContext,
  subject: AArch64PreservedFactSet["records"][number]["subject"],
): boolean {
  const program = context.program;
  const functionIds = new Set(program.functions.entries().map((func) => Number(func.functionId)));
  const blocks = new Set(
    program.functions
      .entries()
      .flatMap((func) => func.blocks.map((block) => Number(block.blockId))),
  );
  const instructions = new Map(
    program.functions
      .entries()
      .flatMap((func) =>
        func.blocks.flatMap((block) => [
          ...block.instructions,
          ...(block.terminator === undefined ? [] : [block.terminator]),
        ]),
      )
      .map((instruction) => [Number(instruction.instructionId), instruction] as const),
  );
  const registers = new Set(
    program.functions
      .entries()
      .flatMap((func) => func.virtualRegisters.map((register) => Number(register.vreg))),
  );
  const frames = new Set(
    program.functions
      .entries()
      .flatMap((func) => func.frameObjects.map((frameObject) => Number(frameObject.frameObjectId))),
  );
  const symbols = new Set(program.globalSymbols.map((symbol) => String(symbol.symbol)));
  const callSites = new Set(
    program.functions
      .entries()
      .flatMap((func) => func.callClobbers.map((callClobber) => callClobber.callKey)),
  );
  switch (subject.kind) {
    case "machineFunction":
      return functionIds.has(subject.functionId);
    case "machineBlock":
      return blocks.has(subject.blockId);
    case "virtualRegister":
      return registers.has(subject.vreg);
    case "machineInstruction":
      return instructions.has(subject.instructionId);
    case "memoryOperand": {
      const instruction = instructions.get(subject.instructionId);
      return instruction === undefined
        ? false
        : hasMemoryOperandAt(instruction, subject.operandIndex);
    }
    case "frameObject":
      return frames.has(subject.frameObjectId);
    case "symbol":
      return symbols.has(subject.symbol);
    case "callSite":
      return callSites.has(subject.callKey);
    case "machineEdge": {
      const edgeKeys = new Set(
        [...(context.dependencyEdges ?? []), ...(context.requiredEdges ?? [])].map(
          (edge) =>
            `${edge.fromInstruction}->${edge.toInstruction}:${edge.kind}:${edge.resource ?? ""}:${edge.requiredBy.join(",")}`,
        ),
      );
      return edgeKeys.has(subject.edgeKey);
    }
    case "region":
      return subject.regionKey.length > 0;
  }
}

function hasMemoryOperandAt(instruction: AArch64MachineInstruction, operandIndex: number): boolean {
  const operand = instruction.operands[operandIndex];
  return operand?.role === "memoryBase" || operand?.role === "memoryIndex";
}

function diagnostic(
  context: AArch64MachineVerifierContext,
  ownerKey: string,
  stableDetail: string,
): AArch64LoweringDiagnostic {
  return context.makeDiagnostic({
    code: "AARCH64_FACT_PRESERVATION_INVALID",
    ownerKey,
    rootCauseKey: "machine-facts",
    stableDetail,
  });
}
