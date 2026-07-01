import type { OptIrFactId } from "../../../opt-ir/ids";
import { compareCodeUnitStrings } from "../../../shared/deterministic-sort";
import { stableJson } from "../../../shared/stable-json";
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
  | { readonly kind: "region"; readonly regionKey: string }
  | { readonly kind: "relocationReference"; readonly relocationId: number }
  | { readonly kind: "targetDeclaration"; readonly targetDeclarationKey: string }
  | { readonly kind: "droppedFact"; readonly droppedFactKey: string };

export interface AArch64MachineFactLineage {
  readonly optIrFactIds: readonly OptIrFactId[];
  readonly targetDeclarationKeys: readonly string[];
}

export interface AArch64MachineFactRecord {
  readonly factId: AArch64MachineFactId;
  readonly extensionKey: string;
  readonly stableKey: string;
  readonly subject: AArch64MachineFactSubject;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly lineage: AArch64MachineFactLineage;
  readonly upstreamVerifierKey: string;
  readonly targetDeclarationKeys: readonly string[];
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
  readonly extensionKey?: string;
  readonly subject: AArch64MachineFactSubject;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly lineage?: Partial<AArch64MachineFactLineage>;
  readonly upstreamVerifierKey?: string;
  readonly targetDeclarationKeys?: readonly string[];
  readonly manifestGate?: string;
}): AArch64MachineFactRecord {
  const optIrFactIds = Object.freeze(
    [...(input.lineage?.optIrFactIds ?? [])].sort((left, right) => left - right),
  );
  const targetDeclarationKeys = Object.freeze(
    [...(input.targetDeclarationKeys ?? input.lineage?.targetDeclarationKeys ?? [])].sort(
      compareCodeUnitStrings,
    ),
  );
  const extensionKey = input.extensionKey ?? "legacy.machine-fact";
  const upstreamVerifierKey = input.upstreamVerifierKey ?? "legacy.opt-ir-fact-preservation";
  return Object.freeze({
    factId: input.factId,
    extensionKey,
    stableKey: machineFactStableKey(
      input.subject,
      extensionKey,
      input.payload ?? {},
      optIrFactIds,
      targetDeclarationKeys,
      input.manifestGate,
    ),
    subject: Object.freeze({ ...input.subject }) as AArch64MachineFactSubject,
    payload: Object.freeze({ ...input.payload }),
    lineage: Object.freeze({ optIrFactIds, targetDeclarationKeys }),
    upstreamVerifierKey,
    targetDeclarationKeys,
    ...(input.manifestGate === undefined ? {} : { manifestGate: input.manifestGate }),
  });
}

export function aarch64PreservedFactSet(input: {
  readonly records?: readonly AArch64MachineFactRecord[];
  readonly droppedFacts?: readonly AArch64DroppedFactRecord[];
  readonly targetDeclarations?: readonly string[];
}): AArch64PreservedFactSet {
  const records = [...(input.records ?? [])].sort((left, right) =>
    compareCodeUnitStrings(left.stableKey, right.stableKey),
  );
  assertNoStableKeyConflicts(records);
  return Object.freeze({
    records: Object.freeze(records),
    droppedFacts: Object.freeze([...(input.droppedFacts ?? [])]),
    targetDeclarations: Object.freeze(
      [...(input.targetDeclarations ?? [])].sort(compareCodeUnitStrings),
    ),
  });
}

function assertNoStableKeyConflicts(records: readonly AArch64MachineFactRecord[]): void {
  const payloadByStableKey = new Map<string, string>();
  for (const record of records) {
    const fingerprint = stableJson({
      extensionKey: record.extensionKey,
      subject: record.subject,
      payload: record.payload,
      upstreamVerifierKey: record.upstreamVerifierKey,
      targetDeclarationKeys: record.targetDeclarationKeys,
      manifestGate: record.manifestGate,
    });
    const existing = payloadByStableKey.get(record.stableKey);
    if (existing !== undefined && existing !== fingerprint) {
      throw new RangeError(`AArch64 preserved fact stable-key conflict: ${record.stableKey}`);
    }
    payloadByStableKey.set(record.stableKey, fingerprint);
  }
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
  extensionKey: string,
  payload: Readonly<Record<string, unknown>>,
  optIrFactIds: readonly OptIrFactId[],
  targetDeclarationKeys: readonly string[],
  manifestGate: string | undefined,
): string {
  return [
    machineFactSubjectKey(subject),
    `extension:${extensionKey}`,
    `payload:${stableJson(payload)}`,
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
    case "relocationReference":
      return `relocation:${subject.relocationId}`;
    case "targetDeclaration":
      return `target-declaration:${subject.targetDeclarationKey}`;
    case "droppedFact":
      return `dropped-fact:${subject.droppedFactKey}`;
  }
}
