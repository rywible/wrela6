import type { OptIrFactRecord } from "../../../opt-ir/facts/fact-index";
import type { OptIrOperationId, OptIrValueId } from "../../../opt-ir/ids";
import type { OptIrOperation } from "../../../opt-ir/operations";
import { aarch64MachineBlock } from "../machine-ir/machine-block";
import {
  aarch64MachineFunction,
  type AArch64MachineFunction,
} from "../machine-ir/machine-function";
import {
  aarch64MachineInstruction,
  type AArch64MachineInstruction,
} from "../machine-ir/machine-instruction";
import { aarch64MachineProgram } from "../machine-ir/machine-program";
import { aarch64SecurityMetadata, type AArch64SecurityMetadata } from "../machine-ir/security";
import {
  aarch64VirtualRegister,
  type AArch64VirtualRegister,
} from "../machine-ir/virtual-register";
import type { AArch64LoweringState } from "./pipeline-stages";
import { recordAArch64StagePlanning } from "./stage-helpers";

export interface AArch64SecurityPropagationResult {
  readonly vregSecurity: ReadonlyMap<number, AArch64SecurityMetadata>;
  readonly instructionSecurity: ReadonlyMap<number, AArch64SecurityMetadata>;
}

export function propagateAArch64SecurityLabels(input: {
  readonly mappings: readonly {
    readonly optIrValue: number;
    readonly machineVregs: readonly number[];
    readonly machineInstructions: readonly number[];
    readonly labels: readonly string[];
  }[];
}): AArch64SecurityPropagationResult {
  const vregSecurity = new Map<number, AArch64SecurityMetadata>();
  const instructionSecurity = new Map<number, AArch64SecurityMetadata>();
  for (const mapping of input.mappings) {
    const metadata = metadataFromLabels(mapping.labels);
    for (const vreg of mapping.machineVregs) vregSecurity.set(vreg, metadata);
    for (const instruction of mapping.machineInstructions)
      instructionSecurity.set(instruction, metadata);
  }
  return Object.freeze({ vregSecurity, instructionSecurity });
}

export function checkAArch64ConstantTimeBranchLegality(input: {
  readonly terminatorKind: "branch" | "jump-table" | "return";
  readonly scrutineeSecret: boolean;
}):
  | { readonly kind: "ok" }
  | {
      readonly kind: "rejected";
      readonly reason: "secret-dependent-control:branch" | "secret-dependent-control:jump-table";
    } {
  if (!input.scrutineeSecret) return { kind: "ok" };
  return {
    kind: "rejected",
    reason:
      input.terminatorKind === "jump-table"
        ? "secret-dependent-control:jump-table"
        : "secret-dependent-control:branch",
  };
}

export function propagateAArch64SecurityLabelsStageState(
  state: AArch64LoweringState,
): AArch64LoweringState {
  if (state.machineProgram === undefined) {
    return recordAArch64StagePlanning(
      state,
      "propagate-security-labels",
      "security-labels-propagated",
    );
  }
  const securityFacts = securityFactsBySubject(state.facts.records);
  const machineProgram = aarch64MachineProgram({
    programId: state.machineProgram.programId,
    functions: state.machineProgram.functions
      .entries()
      .map((machineFunction) =>
        applySecurityToFunction(machineFunction, securityFacts, state.operations),
      ),
    globalSymbols: state.machineProgram.globalSymbols,
    entrySymbol: state.machineProgram.entrySymbol,
    targetFingerprint: state.machineProgram.targetFingerprint,
    consultedSubsurfaceFingerprints: state.machineProgram.consultedSubsurfaceFingerprints,
    provenance: state.machineProgram.provenance,
  });
  return recordAArch64StagePlanning(
    Object.freeze({ ...state, machineProgram }),
    "propagate-security-labels",
    "security-labels-propagated",
  );
}

function applySecurityToFunction(
  machineFunction: AArch64MachineFunction,
  securityFacts: ReadonlyMap<string, readonly string[]>,
  operations: ReadonlyMap<OptIrOperationId, OptIrOperation>,
): AArch64MachineFunction {
  const operationResultLabels = operationResultSecurityFacts(securityFacts, operations);
  const secureRegisters = new Map<number, AArch64SecurityMetadata>();
  const virtualRegisters = machineFunction.virtualRegisters.map((register) => {
    const labels = labelsForRegister(register, securityFacts, operationResultLabels);
    if (labels.length === 0) return register;
    const metadata = metadataFromLabels(labels);
    secureRegisters.set(Number(register.vreg), metadata);
    return aarch64VirtualRegister({
      vreg: register.vreg,
      registerClass: register.registerClass,
      type: register.type,
      securityLabels: metadata.labels,
      ...(register.origin === undefined ? {} : { origin: register.origin }),
    });
  });
  return aarch64MachineFunction({
    functionId: machineFunction.functionId,
    symbol: machineFunction.symbol,
    virtualRegisters,
    parameters: machineFunction.parameters,
    returns: machineFunction.returns,
    frameObjects: machineFunction.frameObjects,
    blocks: machineFunction.blocks.map((block) =>
      aarch64MachineBlock({
        blockId: block.blockId,
        parameters: block.parameters,
        frequency: block.frequency,
        instructions: block.instructions.map((instruction) =>
          applySecurityToInstruction(instruction, securityFacts, secureRegisters),
        ),
        ...(block.terminator === undefined
          ? {}
          : {
              terminator: applySecurityToInstruction(
                block.terminator,
                securityFacts,
                secureRegisters,
              ),
            }),
      }),
    ),
    callClobbers: machineFunction.callClobbers,
    relocationReferences: machineFunction.relocationReferences,
    literalPoolPlan: machineFunction.literalPoolPlan,
    rematerializationPlan: machineFunction.rematerializationPlan,
    jumpTablePlan: machineFunction.jumpTablePlan,
    schedulePlan: machineFunction.schedulePlan,
    provenance: machineFunction.provenance,
  });
}

function applySecurityToInstruction(
  instruction: AArch64MachineInstruction,
  securityFacts: ReadonlyMap<string, readonly string[]>,
  secureRegisters: ReadonlyMap<number, AArch64SecurityMetadata>,
): AArch64MachineInstruction {
  const labels = [
    ...labelsForOperation(instruction, securityFacts),
    ...instruction.operands.flatMap((operand) =>
      operand.operand.kind === "vreg"
        ? [...(secureRegisters.get(Number(operand.operand.register.vreg))?.labels ?? [])].map(
            (label) => label.key,
          )
        : [],
    ),
  ];
  if (labels.length === 0 && instruction.security === undefined) {
    return instruction;
  }
  const metadata = metadataFromLabels([
    ...labels,
    ...(instruction.security?.labels.map((label) => label.key) ?? []),
  ]);
  return aarch64MachineInstruction({
    instructionId: instruction.instructionId,
    opcode: instruction.opcode,
    operands: instruction.operands,
    flags: instruction.flags,
    origin: instruction.origin,
    schedule: instruction.schedule,
    ...(instruction.memoryOrdering === undefined
      ? {}
      : { memoryOrdering: instruction.memoryOrdering }),
    security: metadata,
  });
}

function labelsForRegister(
  register: AArch64VirtualRegister,
  securityFacts: ReadonlyMap<string, readonly string[]>,
  operationResultLabels: ReadonlyMap<string, readonly string[]>,
): readonly string[] {
  if (register.origin?.kind !== "optIrValue") return [];
  return uniqueSortedLabels([
    ...(securityFacts.get(valueSubjectKey(register.origin.valueId)) ?? []),
    ...(operationResultLabels.get(valueSubjectKey(register.origin.valueId)) ?? []),
  ]);
}

function labelsForOperation(
  instruction: AArch64MachineInstruction,
  securityFacts: ReadonlyMap<string, readonly string[]>,
): readonly string[] {
  const operationId = operationIdFromInstruction(instruction);
  return operationId === undefined
    ? []
    : (securityFacts.get(`operation:${String(operationId)}`) ?? []);
}

function operationIdFromInstruction(
  instruction: AArch64MachineInstruction,
): OptIrOperationId | undefined {
  if (instruction.origin.kind !== "syntheticLowering") return undefined;
  const match = /^(?:opt-ir|opt-ir-terminator):(\d+):/.exec(instruction.origin.stableKey);
  return match?.[1] === undefined ? undefined : (Number(match[1]) as OptIrOperationId);
}

function securityFactsBySubject(
  records: readonly OptIrFactRecord[],
): ReadonlyMap<string, readonly string[]> {
  const labelsBySubject = new Map<string, string[]>();
  for (const record of records) {
    if (record.extensionKey !== "security") continue;
    const labels = labelsFromPayload(record.extensionPayload);
    const existing = labelsBySubject.get(record.subjectKey) ?? [];
    labelsBySubject.set(record.subjectKey, [...new Set([...existing, ...labels])].sort());
  }
  return labelsBySubject;
}

function operationResultSecurityFacts(
  securityFacts: ReadonlyMap<string, readonly string[]>,
  operations: ReadonlyMap<OptIrOperationId, OptIrOperation>,
): ReadonlyMap<string, readonly string[]> {
  const labelsByValue = new Map<string, readonly string[]>();
  for (const operation of operations.values()) {
    const labels = securityFacts.get(`operation:${String(operation.operationId)}`) ?? [];
    if (labels.length === 0) continue;
    for (const valueId of operation.resultIds) {
      const key = valueSubjectKey(valueId);
      labelsByValue.set(key, uniqueSortedLabels([...(labelsByValue.get(key) ?? []), ...labels]));
    }
  }
  return labelsByValue;
}

function labelsFromPayload(payload: unknown): readonly string[] {
  if (
    payload === undefined ||
    payload === null ||
    typeof payload !== "object" ||
    !("labels" in payload)
  ) {
    return [];
  }
  const labels = (payload as { readonly labels?: unknown }).labels;
  const normalizedLabels = Array.isArray(labels) ? labels.map(String) : [];
  const constantTime =
    "constantTime" in payload &&
    (payload as { readonly constantTime?: unknown }).constantTime === true
      ? ["constantTimeRequired"]
      : [];
  return uniqueSortedLabels([...normalizedLabels, ...constantTime]);
}

function valueSubjectKey(valueId: OptIrValueId): string {
  return `value:${String(valueId)}`;
}

function metadataFromLabels(labels: readonly string[]): AArch64SecurityMetadata {
  return aarch64SecurityMetadata({
    labels: labels.map((label) => ({ kind: labelKind(label), key: label })),
    constantTime: labels.includes("constantTimeRequired") || labels.includes("secret"),
    spillPolicy: labels.includes("noSpill")
      ? "noSpill"
      : labels.includes("wipeOnSpill")
        ? "wipeOnSpill"
        : "ordinary",
    ...(labels.includes("zeroizationStore")
      ? { zeroization: { required: true, reason: "zeroizationStore" } }
      : {}),
  });
}

function uniqueSortedLabels(labels: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(labels)].sort());
}

function labelKind(
  label: string,
): Parameters<typeof aarch64SecurityMetadata>[0]["labels"][number]["kind"] {
  if (label === "noSpill" || label === "wipeOnSpill" || label === "zeroization") return label;
  if (label === "zeroizationStore") return "zeroization";
  if (label === "constantTimeRequired") return "constantTime";
  if (label === "secret") return "secret";
  return "keyLifetime";
}
