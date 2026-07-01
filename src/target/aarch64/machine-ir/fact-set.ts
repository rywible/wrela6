import type { OptIrFactId } from "../../../opt-ir/ids";
import { aarch64MachineFactId, type AArch64MachineFactId } from "./ids";

export type AArch64MachineFactSubject =
  | { readonly kind: "machineFunction"; readonly functionId: number }
  | { readonly kind: "machineBlock"; readonly blockId: number }
  | { readonly kind: "machineEdge"; readonly edgeKey: string }
  | { readonly kind: "virtualRegister"; readonly vreg: number }
  | { readonly kind: "machineInstruction"; readonly instructionId: number }
  | {
      readonly kind: "memoryOperand";
      readonly instructionId: number;
      readonly operandIndex: number;
    }
  | { readonly kind: "frameObject"; readonly frameObjectId: number }
  | { readonly kind: "symbol"; readonly symbol: string }
  | { readonly kind: "callSite"; readonly callKey: string }
  | { readonly kind: "region"; readonly regionKey: string };

export interface AArch64MachineFactLineage {
  readonly optIrFactIds: readonly OptIrFactId[];
  readonly targetDeclarationKeys: readonly string[];
}

export interface AArch64MachineFactRecord {
  readonly factId: AArch64MachineFactId;
  readonly stableKey: string;
  readonly subject: AArch64MachineFactSubject;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly lineage: AArch64MachineFactLineage;
  readonly manifestGate?: string;
}

export interface AArch64DroppedFactRecord {
  readonly optIrFactId: OptIrFactId;
  readonly reason: string;
}

export interface AArch64PreservedFactSet {
  readonly records: readonly AArch64MachineFactRecord[];
  readonly droppedFacts: readonly AArch64DroppedFactRecord[];
  readonly targetDeclarations: readonly string[];
}

export function aarch64MachineFactRecord(input: {
  readonly factId: AArch64MachineFactId;
  readonly subject: AArch64MachineFactSubject;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly lineage?: Partial<AArch64MachineFactLineage>;
  readonly manifestGate?: string;
}): AArch64MachineFactRecord {
  const optIrFactIds = Object.freeze(
    [...(input.lineage?.optIrFactIds ?? [])].sort((left, right) => left - right),
  );
  const targetDeclarationKeys = Object.freeze(
    [...(input.lineage?.targetDeclarationKeys ?? [])].sort(),
  );
  return Object.freeze({
    factId: input.factId,
    stableKey: machineFactStableKey(
      input.subject,
      optIrFactIds,
      targetDeclarationKeys,
      input.manifestGate,
    ),
    subject: Object.freeze({ ...input.subject }) as AArch64MachineFactSubject,
    payload: Object.freeze({ ...input.payload }),
    lineage: Object.freeze({ optIrFactIds, targetDeclarationKeys }),
    ...(input.manifestGate === undefined ? {} : { manifestGate: input.manifestGate }),
  });
}

export function aarch64PreservedFactSet(input: {
  readonly records?: readonly AArch64MachineFactRecord[];
  readonly droppedFacts?: readonly AArch64DroppedFactRecord[];
  readonly targetDeclarations?: readonly string[];
}): AArch64PreservedFactSet {
  const records = [...(input.records ?? [])].sort((left, right) =>
    left.stableKey.localeCompare(right.stableKey),
  );
  const seen = new Map<string, string>();
  for (const record of records) {
    const serialized = JSON.stringify(record.payload);
    const priorPayload = seen.get(record.stableKey);
    if (priorPayload !== undefined && priorPayload !== serialized) {
      throw new RangeError(`Conflicting AArch64 machine fact stable key ${record.stableKey}.`);
    }
    seen.set(record.stableKey, serialized);
  }
  return Object.freeze({
    records: Object.freeze(records),
    droppedFacts: Object.freeze([...(input.droppedFacts ?? [])]),
    targetDeclarations: Object.freeze([...(input.targetDeclarations ?? [])].sort()),
  });
}

export function emptyAArch64PreservedFactSet(): AArch64PreservedFactSet {
  return aarch64PreservedFactSet({ records: [], droppedFacts: [], targetDeclarations: [] });
}

export function nextAArch64MachineFactId(
  records: readonly AArch64MachineFactRecord[],
): AArch64MachineFactId {
  return aarch64MachineFactId(records.length);
}

function machineFactStableKey(
  subject: AArch64MachineFactSubject,
  optIrFactIds: readonly OptIrFactId[],
  targetDeclarationKeys: readonly string[],
  manifestGate: string | undefined,
): string {
  return [
    machineFactSubjectKey(subject),
    `lineage:${optIrFactIds.map(Number).join(",")}`,
    `target:${targetDeclarationKeys.join(",")}`,
    `gate:${manifestGate ?? ""}`,
  ].join("|");
}

export function machineFactSubjectKey(subject: AArch64MachineFactSubject): string {
  switch (subject.kind) {
    case "machineFunction":
      return `function:${subject.functionId}`;
    case "machineBlock":
      return `block:${subject.blockId}`;
    case "machineEdge":
      return `edge:${subject.edgeKey}`;
    case "virtualRegister":
      return `vreg:${subject.vreg}`;
    case "machineInstruction":
      return `instruction:${subject.instructionId}`;
    case "memoryOperand":
      return `memory:${subject.instructionId}:${subject.operandIndex}`;
    case "frameObject":
      return `frame:${subject.frameObjectId}`;
    case "symbol":
      return `symbol:${subject.symbol}`;
    case "callSite":
      return `call:${subject.callKey}`;
    case "region":
      return `region:${subject.regionKey}`;
  }
}
