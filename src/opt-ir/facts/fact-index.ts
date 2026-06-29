import type {
  CheckedFactDependency,
  CheckedFactInvalidation,
  CheckedFactKindId,
  CheckedFactPacket,
  CheckedFactPacketEntry,
  CheckedFactScope,
  CheckedFactSubject,
  CheckedPacketFactId,
  CheckedPacketFactKind,
} from "../../proof-check/model/fact-packet";
import type { CheckedOptIrHandoff } from "../../proof-check/model/opt-ir-handoff";
import {
  optIrDiagnosticCode,
  optIrDiagnosticOrderKey,
  sortOptIrDiagnostics,
  type OptIrDiagnostic,
} from "../diagnostics";
import { optIrFactId, type OptIrFactId } from "../ids";
import {
  validateCheckedFactImportSchema,
  type CheckedFactImportLayoutFacts,
  type CheckedFactImportProofMirLookups,
  type OptIrFactImportTypedAnswer,
} from "./fact-import-schema";
import type { OptIrFactLineage } from "./fact-lineage";

export interface OptIrFactSet {
  readonly records: readonly OptIrFactRecord[];
  readonly indexes: OptIrFactIndexes;
}

export interface OptIrFactRecord {
  readonly factId: OptIrFactId;
  readonly packetFactId: CheckedPacketFactId;
  readonly packetKind: CheckedPacketFactKind;
  readonly subject: CheckedFactSubject;
  readonly subjectKey: string;
  readonly scope: CheckedFactScope;
  readonly scopeKey: string;
  readonly certificate: CheckedFactPacketEntry<
    CheckedFactPacketEntryKind,
    CheckedFactSubject
  >["certificate"];
  readonly dependencies: readonly CheckedFactDependency[];
  readonly dependencyKeys: readonly string[];
  readonly invalidations: readonly CheckedFactInvalidation[];
  readonly origin: CheckedFactPacketEntry<CheckedFactPacketEntryKind, CheckedFactSubject>["origin"];
  readonly typedAnswers: readonly OptIrFactImportTypedAnswer[];
  readonly explanation: OptIrFactExplanation;
  readonly lineage: OptIrFactLineage;
}

export interface OptIrFactExplanation {
  readonly answerKinds: readonly OptIrFactImportTypedAnswer[];
  readonly dependencyKinds: readonly CheckedFactDependency["kind"][];
  readonly dependencyExplanations: readonly string[];
  readonly certificateExplanation: string;
}

export interface OptIrFactIndexes {
  readonly byId: Readonly<Record<number, OptIrFactRecord>>;
  readonly byPacketFactId: Readonly<Record<string, OptIrFactId>>;
  readonly byPacketKind: Readonly<Record<string, readonly OptIrFactId[]>>;
  readonly bySubjectKey: Readonly<Record<string, readonly OptIrFactId[]>>;
  readonly byScopeKey: Readonly<Record<string, readonly OptIrFactId[]>>;
  readonly byTypedAnswer: Readonly<Record<string, readonly OptIrFactId[]>>;
  readonly byDependencyKind: Readonly<Record<string, readonly OptIrFactId[]>>;
}

export type OptIrFactSetImportResult =
  | { readonly kind: "ok"; readonly factSet: OptIrFactSet }
  | { readonly kind: "error"; readonly diagnostics: readonly OptIrDiagnostic[] };

export interface ImportCheckedFactPacketIntoOptIrFactSetInput {
  readonly handoff: CheckedOptIrHandoff;
  readonly packet: CheckedFactPacket;
  readonly proofMirLookups: CheckedFactImportProofMirLookups;
  readonly layoutFacts: CheckedFactImportLayoutFacts;
}

type CheckedFactPacketEntryKind = CheckedFactKindId;

const PACKET_FACT_FIELDS = [
  ["ownership", "ownership"],
  ["noalias", "noalias"],
  ["fieldDisjointness", "fieldDisjointness"],
  ["erasure", "erasures"],
  ["validatedBuffer", "validatedBuffers"],
  ["packetSource", "packetSources"],
  ["privateState", "privateState"],
  ["platformEffect", "platformEffects"],
  ["capabilityFlow", "capabilityFlow"],
  ["terminalClosure", "terminalClosure"],
  ["exitClosure", "exitClosure"],
  ["layoutAbi", "layoutAbi"],
  ["origin", "origins"],
] as const satisfies readonly (readonly [CheckedPacketFactKind, keyof CheckedFactPacket])[];

export function importCheckedFactPacketIntoOptIrFactSet(
  input: ImportCheckedFactPacketIntoOptIrFactSetInput,
): OptIrFactSetImportResult {
  const diagnostics: OptIrDiagnostic[] = [];
  const pendingRecords: OptIrFactRecord[] = [];
  const seenPacketFactIds = new Set<string>();

  for (const [packetKind, field] of PACKET_FACT_FIELDS) {
    for (const entry of input.packet[field]) {
      const packetFactIdKey = String(entry.factId);
      if (seenPacketFactIds.has(packetFactIdKey)) {
        diagnostics.push(
          factImportDiagnostic(
            packetKind,
            entry,
            "OPT_IR_FACT_IMPORT_DUPLICATE_PACKET_FACT_ID",
            `duplicatePacketFactId:${packetFactIdKey}`,
          ),
        );
        continue;
      }
      seenPacketFactIds.add(packetFactIdKey);

      const validation = validateCheckedFactImportSchema({
        entry,
        handoff: input.handoff,
        packet: input.packet,
        proofMirLookups: input.proofMirLookups,
        layoutFacts: input.layoutFacts,
      });

      if (validation.kind === "error") {
        diagnostics.push(
          ...validation.diagnostics.map((diagnostic) =>
            factImportDiagnostic(packetKind, entry, diagnostic.code, diagnostic.stableDetail),
          ),
        );
        continue;
      }

      const factId = optIrFactId(pendingRecords.length);
      pendingRecords.push({
        factId,
        packetFactId: entry.factId,
        packetKind,
        subject: entry.subject,
        subjectKey: subjectKey(entry.subject),
        scope: entry.scope,
        scopeKey: scopeKey(entry.scope),
        certificate: entry.certificate,
        dependencies: entry.dependencies,
        dependencyKeys: entry.dependencies.map(dependencyKey),
        invalidations: entry.invalidatedBy,
        origin: entry.origin,
        typedAnswers: validation.typedAnswers,
        explanation: {
          answerKinds: validation.typedAnswers,
          dependencyKinds: entry.dependencies.map((dependency) => dependency.kind),
          dependencyExplanations: entry.dependencies.map(dependencyExplanation),
          certificateExplanation: `${entry.certificate.kind}:${String(entry.certificate.id)}`,
        },
        lineage: {
          kind: "checkedPacket",
          packetKind,
          packetKindId: entry.kind,
          packetFactId: entry.factId,
        },
      });
    }
  }

  if (diagnostics.length > 0) {
    return { kind: "error", diagnostics: sortOptIrDiagnostics(diagnostics) };
  }

  return {
    kind: "ok",
    factSet: freezeFactSet(pendingRecords),
  };
}

function freezeFactSet(records: readonly OptIrFactRecord[]): OptIrFactSet {
  const frozenRecords = Object.freeze(records.map(freezeFactRecord));
  return Object.freeze({ records: frozenRecords, indexes: buildIndexes(frozenRecords) });
}

export function optIrFactSetFromRecords(records: readonly OptIrFactRecord[]): OptIrFactSet {
  return freezeFactSet(records);
}

function freezeFactRecord(record: OptIrFactRecord): OptIrFactRecord {
  return Object.freeze({
    ...record,
    dependencies: Object.freeze([...record.dependencies]),
    dependencyKeys: Object.freeze([...record.dependencyKeys]),
    invalidations: Object.freeze([...record.invalidations]),
    typedAnswers: Object.freeze([...record.typedAnswers]),
    explanation: Object.freeze({
      ...record.explanation,
      answerKinds: Object.freeze([...record.explanation.answerKinds]),
      dependencyKinds: Object.freeze([...record.explanation.dependencyKinds]),
      dependencyExplanations: Object.freeze([...record.explanation.dependencyExplanations]),
    }),
  });
}

function buildIndexes(records: readonly OptIrFactRecord[]): OptIrFactIndexes {
  const byId: Record<number, OptIrFactRecord> = {};
  const byPacketFactId: Record<string, OptIrFactId> = {};
  const byPacketKind: Record<string, OptIrFactId[]> = {};
  const bySubjectKey: Record<string, OptIrFactId[]> = {};
  const byScopeKey: Record<string, OptIrFactId[]> = {};
  const byTypedAnswer: Record<string, OptIrFactId[]> = {};
  const byDependencyKind: Record<string, OptIrFactId[]> = {};

  for (const record of records) {
    byId[record.factId] = record;
    byPacketFactId[String(record.packetFactId)] = record.factId;
    pushIndex(byPacketKind, record.packetKind, record.factId);
    pushIndex(bySubjectKey, record.subjectKey, record.factId);
    pushIndex(byScopeKey, record.scopeKey, record.factId);
    for (const typedAnswer of record.typedAnswers) {
      pushIndex(byTypedAnswer, typedAnswer, record.factId);
    }
    for (const dependency of record.dependencies) {
      pushIndex(byDependencyKind, dependency.kind, record.factId);
    }
  }

  return {
    byId: Object.freeze({ ...byId }),
    byPacketFactId: Object.freeze({ ...byPacketFactId }),
    byPacketKind: freezeIdListIndex(byPacketKind),
    bySubjectKey: freezeIdListIndex(bySubjectKey),
    byScopeKey: freezeIdListIndex(byScopeKey),
    byTypedAnswer: freezeIdListIndex(byTypedAnswer),
    byDependencyKind: freezeIdListIndex(byDependencyKind),
  };
}

function freezeIdListIndex(
  index: Record<string, OptIrFactId[]>,
): Readonly<Record<string, readonly OptIrFactId[]>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(index).map(([key, factIds]) => [
        key,
        Object.freeze([...factIds].sort((left, right) => left - right)),
      ]),
    ),
  );
}

function pushIndex(index: Record<string, OptIrFactId[]>, key: string, factId: OptIrFactId): void {
  const existing = index[key];
  if (existing === undefined) {
    index[key] = [factId];
    return;
  }
  existing.push(factId);
}

function factImportDiagnostic(
  packetKind: CheckedPacketFactKind,
  entry: CheckedFactPacketEntry<CheckedFactPacketEntryKind, CheckedFactSubject>,
  importCode: string,
  importDetail: string,
): OptIrDiagnostic {
  const stableDetail = `${packetKind}:${String(entry.factId)}:${importCode}:${importDetail}`;
  const code = optIrDiagnosticCode("OPT_IR_FACT_IMPORT_SCHEMA_MISMATCH");
  return {
    severity: "error",
    code,
    messageTemplate: "Checked fact packet entry failed OptIR fact import schema validation.",
    arguments: {
      packetKind,
      packetFactId: Number(entry.factId),
      importCode,
    },
    ownerKey: `fact:${packetKind}:${String(entry.factId)}`,
    rootCauseKey: importCode,
    stableDetail,
    orderKey: optIrDiagnosticOrderKey({
      originKey: entry.origin.originKey,
      functionKey: "fact-set",
      code,
      ownerKey: `fact:${packetKind}:${String(entry.factId)}`,
      rootCauseKey: importCode,
      stableDetail,
    }),
  };
}

function subjectKey(subject: CheckedFactSubject): string {
  switch (subject.kind) {
    case "place":
      return `place:${String(subject.placeId)}`;
    case "value":
      return `value:${String(subject.valueId)}`;
    case "function":
      return `function:${subject.functionInstanceId}`;
    case "block":
      return `block:${subject.functionInstanceId}:${String(subject.blockId)}`;
    case "edge":
      return `edge:${subject.functionInstanceId}:${String(subject.edgeId)}`;
    case "call":
      return `call:${subject.functionInstanceId}:${String(subject.callId)}`;
    case "layout":
      return `layout:${subject.layoutKey}`;
    case "authority":
      return `authority:${subject.fingerprint.digestHex}:${subject.entryKey}`;
    case "packetSource":
      return `packetSource:${String(subject.packet)}:${String(subject.source)}`;
    case "privateState":
      return `privateState:${String(subject.placeId)}:${String(subject.generation)}`;
    case "terminal":
      return `terminal:${subject.terminalKey}`;
    case "mirOrigin":
      return `mirOrigin:${String(subject.proofMirOriginId)}`;
  }
}

function scopeKey(scope: CheckedFactScope): string {
  switch (scope.kind) {
    case "wholeImage":
      return "wholeImage";
    case "function":
      return `function:${scope.functionInstanceId}`;
    case "blockEntry":
      return `blockEntry:${scope.functionInstanceId}:${String(scope.blockId)}`;
    case "edge":
      return `edge:${scope.functionInstanceId}:${String(scope.edgeId)}`;
    case "afterStatement":
      return `afterStatement:${scope.functionInstanceId}:${String(scope.statementId)}`;
    case "callResult":
      return `callResult:${scope.functionInstanceId}:${String(scope.callId)}`;
    case "path":
      return `path:${String(scope.certificateId)}`;
  }
}

function dependencyKey(dependency: CheckedFactDependency): string {
  switch (dependency.kind) {
    case "proofMirFact":
      return `proofMirFact:${String(dependency.factId)}`;
    case "proofMirPlace":
      return `proofMirPlace:${String(dependency.placeId)}`;
    case "proofMirValue":
      return `proofMirValue:${String(dependency.valueId)}`;
    case "proofMirEdge":
      return `proofMirEdge:${String(dependency.edgeId)}`;
    case "proofMirCall":
      return `proofMirCall:${String(dependency.callId)}`;
    case "layoutFact":
      return `layoutFact:${dependency.layoutKey}`;
    case "authorityEntry":
      return `authorityEntry:${dependency.fingerprint.digestHex}:${dependency.entryKey}`;
    case "coreCertificate":
      return `coreCertificate:${String(dependency.certificateId)}`;
    case "semanticsCertificate":
      return `semanticsCertificate:${String(dependency.certificateId)}`;
    case "summaryInstantiation":
      return `summaryInstantiation:${String(dependency.certificateId)}`;
    case "packetSource":
      return `packetSource:${String(dependency.packet)}:${String(dependency.source)}`;
    case "privateGeneration":
      return `privateGeneration:${String(dependency.generation)}`;
  }
}

function dependencyExplanation(dependency: CheckedFactDependency): string {
  return `${dependency.kind}:${dependencyKey(dependency)}`;
}
