import {
  aarch64BackendDiagnostic,
  sortAArch64BackendDiagnostics,
  type AArch64BackendDiagnostic,
} from "../api/diagnostics";
import type { CompileAArch64ObjectInput } from "../api/compile-aarch64-object";
import { machineFactSubjectKey } from "../../machine-ir/fact-set";
import { importAArch64BackendFacts } from "../facts/backend-fact-import";
import type { AArch64MachineInstruction } from "../../machine-ir/machine-instruction";
import type { AArch64MachineFunction } from "../../machine-ir/machine-function";
import { machineCallSiteForInstruction } from "../api/machine-call-sites";

export type VerifyAArch64BackendInputContractResult =
  | { readonly kind: "ok"; readonly diagnostics: readonly AArch64BackendDiagnostic[] }
  | { readonly kind: "error"; readonly diagnostics: readonly AArch64BackendDiagnostic[] };

export function verifyAArch64BackendInputContract(
  input: CompileAArch64ObjectInput,
): VerifyAArch64BackendInputContractResult {
  const diagnostics: AArch64BackendDiagnostic[] = [];
  if (input.target.sourceSurfaceFingerprint.length === 0) {
    diagnostics.push(diagnostic("target", "fingerprint", "input-contract:missing-source-target"));
  }
  if (input.target.backendSurfaceFingerprint.length === 0) {
    diagnostics.push(diagnostic("target", "fingerprint", "input-contract:missing-backend-target"));
  }
  if (input.closedImagePlan.authorityFingerprint.length === 0) {
    diagnostics.push(
      diagnostic("closed-image", "fingerprint", "input-contract:missing-closed-image-authority"),
    );
  }
  if (
    input.machineProgram.targetFingerprint !== input.target.sourceSurfaceFingerprint &&
    !input.machineProgram.consultedSubsurfaceFingerprints.includes(
      input.target.sourceSurfaceFingerprint,
    )
  ) {
    diagnostics.push(
      diagnostic(
        "target",
        "fingerprint",
        `input-contract:stale-target:${input.machineProgram.targetFingerprint}:${input.target.sourceSurfaceFingerprint}`,
      ),
    );
  }
  diagnostics.push(...verifyMachineSubjectAmbiguity(input));
  diagnostics.push(...verifyFactSubjects(input));
  diagnostics.push(...verifyFactImportContract(input));
  const sortedDiagnostics = sortAArch64BackendDiagnostics(diagnostics);
  return sortedDiagnostics.length === 0
    ? { kind: "ok", diagnostics: [] }
    : { kind: "error", diagnostics: sortedDiagnostics };
}

function verifyMachineSubjectAmbiguity(
  input: CompileAArch64ObjectInput,
): readonly AArch64BackendDiagnostic[] {
  const diagnostics: AArch64BackendDiagnostic[] = [];
  const functionSymbols = new Set<string>();
  const functionIds = new Map<number, number>();
  const symbols = new Map<string, number>();
  for (const machineFunction of input.machineProgram.functions.entries()) {
    const symbol = String(machineFunction.symbol);
    if (functionSymbols.has(symbol)) {
      diagnostics.push(
        diagnostic(symbol, "function-symbol", `input-contract:duplicate-function-symbol:${symbol}`),
      );
    }
    functionSymbols.add(symbol);
    increment(functionIds, Number(machineFunction.functionId));
    increment(symbols, symbol);
    diagnostics.push(...verifyFunctionLocalSubjectAmbiguity(symbol, machineFunction));
  }
  for (const symbol of input.machineProgram.globalSymbols) {
    increment(symbols, String(symbol.symbol));
  }
  diagnostics.push(
    ...duplicateCountDiagnostics(
      functionIds,
      "function-id",
      (functionId) => `input-contract:ambiguous-machine-function:function:${functionId}`,
    ),
    ...duplicateCountDiagnostics(
      symbols,
      "symbol",
      (symbol) => `input-contract:ambiguous-machine-symbol:symbol:${symbol}`,
    ),
  );
  return diagnostics;
}

function verifyFunctionLocalSubjectAmbiguity(
  functionKey: string,
  machineFunction: AArch64MachineFunction,
): readonly AArch64BackendDiagnostic[] {
  const diagnostics: AArch64BackendDiagnostic[] = [];
  const blockIds = new Map<number, number>();
  const instructionIds = new Map<number, number>();
  const virtualRegisters = new Map<number, number>();
  const frameObjectIds = new Map<number, number>();
  const relocationIds = new Map<number, number>();
  const callSites = new Map<string, number>();
  const machineEdges = new Map<string, number>();
  for (const register of machineFunction.virtualRegisters) {
    increment(virtualRegisters, Number(register.vreg));
  }
  for (const frameObject of machineFunction.frameObjects) {
    increment(frameObjectIds, Number(frameObject.frameObjectId));
  }
  for (const relocation of machineFunction.relocationReferences) {
    increment(relocationIds, Number(relocation.relocationId));
  }
  for (const clobber of machineFunction.callClobbers) {
    increment(callSites, clobber.callKey);
  }
  for (const block of machineFunction.blocks) {
    const blockId = Number(block.blockId);
    increment(blockIds, blockId);
    for (const instruction of block.instructions) {
      addLocalInstructionSubjects(functionKey, blockId, instruction, {
        instructionIds,
        callSites,
        machineEdges,
      });
    }
    if (block.terminator !== undefined) {
      addLocalInstructionSubjects(functionKey, blockId, block.terminator, {
        instructionIds,
        callSites,
        machineEdges,
      });
    }
  }
  diagnostics.push(
    ...duplicateCountDiagnostics(
      blockIds,
      "machine-block",
      (blockId) => `input-contract:ambiguous-machine-block:block:${blockId}`,
    ),
    ...duplicateCountDiagnostics(
      instructionIds,
      "machine-instruction",
      (instructionId) =>
        `input-contract:ambiguous-machine-instruction:instruction:${instructionId}`,
    ),
    ...duplicateCountDiagnostics(
      virtualRegisters,
      "virtual-register",
      (vreg) => `input-contract:ambiguous-machine-vreg:vreg:${vreg}`,
    ),
    ...duplicateCountDiagnostics(
      frameObjectIds,
      "frame-object",
      (frameObjectId) => `input-contract:ambiguous-machine-frame:frame:${frameObjectId}`,
    ),
    ...duplicateCountDiagnostics(
      relocationIds,
      "relocation-reference",
      (relocationId) => `input-contract:ambiguous-machine-relocation:relocation:${relocationId}`,
    ),
    ...duplicateCountDiagnostics(
      callSites,
      "call-site",
      (callKey) => `input-contract:ambiguous-machine-call-site:call:${callKey}`,
    ),
    ...duplicateCountDiagnostics(
      machineEdges,
      "machine-edge",
      (edgeKey) => `input-contract:ambiguous-machine-edge:edge:${edgeKey}`,
    ),
  );
  return diagnostics;
}

function addLocalInstructionSubjects(
  functionKey: string,
  blockId: number,
  instruction: AArch64MachineInstruction,
  known: {
    readonly instructionIds: Map<number, number>;
    readonly callSites: Map<string, number>;
    readonly machineEdges: Map<string, number>;
  },
): void {
  increment(known.instructionIds, Number(instruction.instructionId));
  instruction.operands.forEach((operand) => {
    if (operand.role === "branchTarget" && operand.operand.kind === "block") {
      increment(known.machineEdges, `${functionKey}:${blockId}->${Number(operand.operand.block)}`);
    }
  });
  const callSite = machineCallSiteForInstruction(functionKey, instruction);
  if (callSite !== undefined) increment(known.callSites, callSite.callKey);
}

function duplicateCountDiagnostics<Key>(
  counts: ReadonlyMap<Key, number>,
  ownerKey: string,
  detail: (key: Key) => string,
): readonly AArch64BackendDiagnostic[] {
  const diagnostics: AArch64BackendDiagnostic[] = [];
  for (const [key, count] of counts) {
    if (count > 1) diagnostics.push(diagnostic(String(key), ownerKey, detail(key)));
  }
  return diagnostics;
}

function verifyFactSubjects(input: CompileAArch64ObjectInput): readonly AArch64BackendDiagnostic[] {
  const diagnostics: AArch64BackendDiagnostic[] = [];
  const known = knownMachineSubjects(input);
  const declaredTargetDeclarations = new Set(input.preservedFacts.targetDeclarations);
  for (const record of input.preservedFacts.records) {
    const subjectKey = factSubjectKeyForDiagnostics(record.subject);
    if (record.targetDeclarationKeys.length === 0) {
      diagnostics.push(
        diagnostic(
          record.extensionKey,
          "fact-lineage",
          `input-contract:fact-missing-target-declaration:${record.extensionKey}:${subjectKey}`,
        ),
      );
    }
    for (const targetDeclarationKey of record.targetDeclarationKeys) {
      if (!declaredTargetDeclarations.has(targetDeclarationKey)) {
        diagnostics.push(
          diagnostic(
            record.extensionKey,
            "fact-lineage",
            `input-contract:fact-undeclared-target-declaration:${record.extensionKey}:${subjectKey}:${targetDeclarationKey}`,
          ),
        );
      }
    }
    if (record.upstreamVerifierKey.length === 0) {
      diagnostics.push(
        diagnostic(
          record.extensionKey,
          "fact-lineage",
          `input-contract:fact-missing-upstream-verifier:${record.extensionKey}:${subjectKey}`,
        ),
      );
    }
    const missingDetail = missingFactSubjectDetail(record.subject, known);
    if (missingDetail !== undefined) {
      diagnostics.push(diagnostic(record.extensionKey, "fact-subject", missingDetail));
    }
    const ambiguousDetail = ambiguousFactSubjectDetail(record.subject, known);
    if (ambiguousDetail !== undefined) {
      diagnostics.push(diagnostic(record.extensionKey, "fact-subject", ambiguousDetail));
    }
  }
  return diagnostics;
}

function verifyFactImportContract(
  input: CompileAArch64ObjectInput,
): readonly AArch64BackendDiagnostic[] {
  const imported = importAArch64BackendFacts({ preservedFacts: input.preservedFacts });
  if (imported.kind === "ok") return [];
  return imported.diagnostics.map((factDiagnostic) =>
    diagnostic(
      factDiagnostic.ownerKey,
      "fact-schema",
      `input-contract:fact-schema:${factDiagnostic.stableDetail}`,
    ),
  );
}

function knownMachineSubjects(input: CompileAArch64ObjectInput) {
  const functionIds = new Map<number, number>();
  const blockIds = new Map<number, number>();
  const instructionIds = new Map<number, number>();
  const virtualRegisters = new Map<number, number>();
  const frameObjectIds = new Map<number, number>();
  const symbols = new Map<string, number>();
  const relocationIds = new Map<number, number>();
  const memoryOperandKeys = new Map<string, number>();
  const callSites = new Map<string, number>();
  const machineEdges = new Map<string, number>();
  const targetDeclarations = new Set<string>();
  const droppedFacts = new Set<string>();
  for (const machineFunction of input.machineProgram.functions.entries()) {
    const functionKey = String(machineFunction.symbol);
    increment(functionIds, Number(machineFunction.functionId));
    increment(symbols, functionKey);
    for (const register of machineFunction.virtualRegisters) {
      increment(virtualRegisters, Number(register.vreg));
    }
    for (const frameObject of machineFunction.frameObjects) {
      increment(frameObjectIds, Number(frameObject.frameObjectId));
    }
    for (const relocation of machineFunction.relocationReferences) {
      increment(relocationIds, Number(relocation.relocationId));
    }
    for (const clobber of machineFunction.callClobbers) {
      increment(callSites, clobber.callKey);
    }
    for (const block of machineFunction.blocks) {
      increment(blockIds, Number(block.blockId));
      for (const instruction of block.instructions) {
        addInstructionSubjects(functionKey, Number(block.blockId), instruction, {
          instructionIds,
          memoryOperandKeys,
          callSites,
          machineEdges,
        });
      }
      if (block.terminator !== undefined) {
        addInstructionSubjects(functionKey, Number(block.blockId), block.terminator, {
          instructionIds,
          memoryOperandKeys,
          callSites,
          machineEdges,
        });
      }
    }
  }
  for (const symbol of input.machineProgram.globalSymbols) {
    increment(symbols, String(symbol.symbol));
  }
  for (const targetDeclaration of input.preservedFacts.targetDeclarations) {
    targetDeclarations.add(targetDeclaration);
  }
  for (const droppedFact of input.preservedFacts.droppedFacts) {
    droppedFacts.add(String(droppedFact.optIrFactId));
    droppedFacts.add(droppedFact.reason);
  }
  return {
    functionIds,
    blockIds,
    instructionIds,
    virtualRegisters,
    frameObjectIds,
    symbols,
    relocationIds,
    memoryOperandKeys,
    callSites,
    machineEdges,
    targetDeclarations,
    droppedFacts,
  };
}

function addInstructionSubjects(
  functionKey: string,
  blockId: number,
  instruction: AArch64MachineInstruction,
  known: {
    readonly instructionIds: Map<number, number>;
    readonly memoryOperandKeys: Map<string, number>;
    readonly callSites: Map<string, number>;
    readonly machineEdges: Map<string, number>;
  },
): void {
  increment(known.instructionIds, Number(instruction.instructionId));
  instruction.operands.forEach((operand, operandIndex) => {
    if (isAddressOperand(operand)) {
      increment(known.memoryOperandKeys, `${Number(instruction.instructionId)}:${operandIndex}`);
    }
    if (operand.role === "branchTarget" && operand.operand.kind === "block") {
      increment(known.machineEdges, `${functionKey}:${blockId}->${Number(operand.operand.block)}`);
    }
  });
  const callSite = machineCallSiteForInstruction(functionKey, instruction);
  if (callSite !== undefined) increment(known.callSites, callSite.callKey);
}

function isAddressOperand(operand: AArch64MachineInstruction["operands"][number]): boolean {
  return operand.role === "memoryBase" || operand.role === "memoryIndex";
}

function increment<Key>(counts: Map<Key, number>, key: Key): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function missingFactSubjectDetail(
  subject: CompileAArch64ObjectInput["preservedFacts"]["records"][number]["subject"],
  known: ReturnType<typeof knownMachineSubjects>,
): string | undefined {
  const staleObjectDetail = staleObjectFactSubjectDetail(subject);
  if (staleObjectDetail !== undefined) return staleObjectDetail;
  const counted = countedFactSubject(subject, known);
  if (counted !== undefined && counted.count === 0) {
    return `input-contract:unknown-fact-${counted.diagnosticKind}:${counted.subjectKey}`;
  }
  if (
    subject.kind === "targetDeclaration" &&
    !known.targetDeclarations.has(subject.targetDeclarationKey)
  ) {
    return `input-contract:unknown-fact-target-declaration:target-declaration:${subject.targetDeclarationKey}`;
  }
  if (subject.kind === "droppedFact" && !known.droppedFacts.has(subject.droppedFactKey)) {
    return `input-contract:unknown-fact-dropped-fact:dropped-fact:${subject.droppedFactKey}`;
  }
  return undefined;
}

function staleObjectFactSubjectDetail(subject: unknown): string | undefined {
  if (!isObjectRecord(subject)) return undefined;
  if (subject.kind === "sectionFragment") {
    return `input-contract:stale-object-fact-subject:section-fragment:${stringFieldOrMissing(subject.fragmentKey)}`;
  }
  if (subject.kind === "relocation") {
    return `input-contract:stale-object-fact-subject:relocation:${stringFieldOrMissing(subject.relocationKey)}`;
  }
  if (subject.kind === "literalPool") {
    return `input-contract:stale-object-fact-subject:literal-pool:${stringFieldOrMissing(subject.literalPoolKey)}`;
  }
  if (subject.kind === "veneer") {
    return `input-contract:stale-object-fact-subject:veneer:${stringFieldOrMissing(subject.veneerKey)}`;
  }
  return undefined;
}

function factSubjectKeyForDiagnostics(
  subject: CompileAArch64ObjectInput["preservedFacts"]["records"][number]["subject"],
): string {
  const objectDetail = staleObjectFactSubjectDetail(subject);
  if (objectDetail !== undefined)
    return objectDetail.replace(/^input-contract:stale-object-fact-subject:/, "");
  return machineFactSubjectKey(subject);
}

function ambiguousFactSubjectDetail(
  subject: CompileAArch64ObjectInput["preservedFacts"]["records"][number]["subject"],
  known: ReturnType<typeof knownMachineSubjects>,
): string | undefined {
  const counted = countedFactSubject(subject, known);
  return counted !== undefined && counted.count > 1
    ? `input-contract:ambiguous-fact-${counted.diagnosticKind}:${counted.subjectKey}`
    : undefined;
}

function countedFactSubject(
  subject: CompileAArch64ObjectInput["preservedFacts"]["records"][number]["subject"],
  known: ReturnType<typeof knownMachineSubjects>,
):
  | { readonly diagnosticKind: string; readonly subjectKey: string; readonly count: number }
  | undefined {
  switch (subject.kind) {
    case "machineFunction":
      return countDescriptor(
        "function",
        `function:${subject.functionId}`,
        known.functionIds,
        subject.functionId,
      );
    case "machineBlock":
      return countDescriptor("block", `block:${subject.blockId}`, known.blockIds, subject.blockId);
    case "machineInstruction":
      return countDescriptor(
        "instruction",
        `instruction:${subject.instructionId}`,
        known.instructionIds,
        subject.instructionId,
      );
    case "virtualRegister":
      return countDescriptor("vreg", `vreg:${subject.vreg}`, known.virtualRegisters, subject.vreg);
    case "frameObject":
      return countDescriptor(
        "frame",
        `frame:${subject.frameObjectId}`,
        known.frameObjectIds,
        subject.frameObjectId,
      );
    case "symbol":
      return countDescriptor("symbol", `symbol:${subject.symbol}`, known.symbols, subject.symbol);
    case "relocationReference":
      return countDescriptor(
        "relocation",
        `relocation:${subject.relocationId}`,
        known.relocationIds,
        subject.relocationId,
      );
    case "memoryOperand": {
      const key = `${subject.instructionId}:${subject.operandIndex}`;
      return countDescriptor(
        "memory-operand",
        `memory:${subject.instructionId}:${subject.operandIndex}`,
        known.memoryOperandKeys,
        key,
      );
    }
    case "callSite":
      return countDescriptor(
        "call-site",
        `call:${subject.callKey}`,
        known.callSites,
        subject.callKey,
      );
    case "machineEdge":
      return countDescriptor(
        "edge",
        `edge:${subject.edgeKey}`,
        known.machineEdges,
        subject.edgeKey,
      );
    default:
      return undefined;
  }
}

function countDescriptor<Key>(
  diagnosticKind: string,
  subjectKey: string,
  counts: ReadonlyMap<Key, number>,
  key: Key,
): { readonly diagnosticKind: string; readonly subjectKey: string; readonly count: number } {
  return { diagnosticKind, subjectKey, count: counts.get(key) ?? 0 };
}

function isObjectRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringFieldOrMissing(value: unknown): string {
  return typeof value === "string" ? value : "missing";
}

function diagnostic(
  ownerKey: string,
  rootCauseKey: string,
  stableDetail: string,
): AArch64BackendDiagnostic {
  return aarch64BackendDiagnostic({
    code: "AARCH64_BACKEND_INPUT_CONTRACT_INVALID",
    ownerKey,
    rootCauseKey,
    stableDetail,
  });
}
