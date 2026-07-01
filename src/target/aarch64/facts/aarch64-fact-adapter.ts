import type {
  OptIrEdgeId,
  OptIrFactId,
  OptIrCallId,
  OptIrOperationId,
  OptIrValueId,
} from "../../../opt-ir/ids";
import type { OptIrFactRecord, OptIrFactSet } from "../../../opt-ir/facts/fact-index";
import { createOptIrLayoutFactQuery } from "../../../opt-ir/facts/layout-facts";
import type { LayoutFactKey } from "../../../proof-check/model/fact-packet";

export interface AArch64FactMachineRekeyingRule {
  readonly subjectKind: string;
  readonly machineSubjectKind: string;
}

export interface AArch64OptIrFactAdapter {
  readonly adapterKey: string;
  readonly optIrExtensionKey: string;
  readonly targetQueryNamespace: (
    input: AArch64FactQueryNamespaceInput,
  ) => Readonly<Record<string, unknown>>;
  readonly machineRekeyingRules: readonly AArch64FactMachineRekeyingRule[];
  readonly targetProfileFingerprintInputs: readonly string[];
}

export interface AArch64FactQueryNamespaceInput {
  readonly factSet: OptIrFactSet;
  readonly records: readonly OptIrFactRecord[];
}

export interface AArch64FactAdapterRegistry {
  readonly adapterKeys: () => readonly string[];
  readonly targetProfileFingerprintInputs: () => Readonly<Record<string, readonly string[]>>;
}

export function createAArch64FactAdapterRegistryForTest(
  adapters: readonly AArch64OptIrFactAdapter[],
): AArch64FactAdapterRegistry {
  return createAArch64FactAdapterRegistry(adapters);
}

export function createAArch64FactAdapterRegistry(
  adapters: readonly AArch64OptIrFactAdapter[],
): AArch64FactAdapterRegistry {
  const sortedAdapters = [...adapters].sort((left, right) =>
    left.adapterKey.localeCompare(right.adapterKey),
  );
  const byKey = new Map<string, AArch64OptIrFactAdapter>();
  for (const adapter of sortedAdapters) {
    if (adapter.adapterKey.length === 0 || adapter.optIrExtensionKey.length === 0) {
      throw new RangeError("AArch64 fact adapter keys must be non-empty.");
    }
    if (byKey.has(adapter.adapterKey)) {
      throw new RangeError(`Duplicate AArch64 fact adapter key ${adapter.adapterKey}.`);
    }
    byKey.set(adapter.adapterKey, freezeAdapter(adapter));
  }
  return Object.freeze({
    adapterKeys() {
      return Object.freeze([...byKey.keys()]);
    },
    targetProfileFingerprintInputs() {
      return Object.freeze(
        Object.fromEntries(
          [...byKey.values()].map((adapter) => [
            adapter.adapterKey,
            adapter.targetProfileFingerprintInputs,
          ]),
        ),
      );
    },
  });
}

export interface AArch64FactQuery {
  readonly memoryOrderForOperation: (operationId: OptIrOperationId) => AArch64FactAnswer;
  readonly securityForValue: (valueId: OptIrValueId) => AArch64FactAnswer;
  readonly branchProbabilityForEdge: (edgeId: OptIrEdgeId) => AArch64FactAnswer;
  readonly fpContractionForOperation: (operationId: OptIrOperationId) => AArch64FactAnswer;
  readonly vectorStateForOperation: (operationId: OptIrOperationId) => AArch64FactAnswer;
  readonly callClobberForCall: (callId: OptIrCallId) => AArch64FactAnswer;
  readonly layoutByteRangeForKey: (layoutKey: LayoutFactKey) => AArch64FactAnswer;
  readonly provesDereferenceableFootprint: (input: {
    readonly region: unknown;
    readonly start: bigint;
    readonly endExclusive: bigint;
  }) => AArch64FactAnswer;
}

export type AArch64FactAnswer =
  | ({
      readonly kind: "yes";
      readonly factsUsed: readonly OptIrFactId[];
      readonly explanation: readonly string[];
    } & Readonly<Record<string, unknown>>)
  | {
      readonly kind: "no";
      readonly reason: string;
      readonly factsUsed: readonly OptIrFactId[];
      readonly explanation?: readonly string[];
    }
  | {
      readonly kind: "unknown";
      readonly factsUsed: readonly OptIrFactId[];
      readonly explanation: readonly string[];
    };

export function createAArch64FactQuery(factSet: OptIrFactSet): AArch64FactQuery {
  const layoutQuery = createOptIrLayoutFactQuery(factSet);
  return Object.freeze({
    memoryOrderForOperation(operationId: OptIrOperationId): AArch64FactAnswer {
      const record = extensionRecordForSubject(factSet, "memory-order", `operation:${operationId}`);
      if (record === undefined) {
        return unknownAnswer(`No memory-order fact is in scope for operation:${operationId}.`);
      }
      const payload = extensionPayload(record);
      return yesAnswer(record, {
        accessKind: payload.accessKind,
        order: payload.order,
        publicationShape: payload.publicationShape,
      });
    },
    securityForValue(valueId: OptIrValueId): AArch64FactAnswer {
      const record = extensionRecordForSubject(factSet, "security", `value:${valueId}`);
      if (record === undefined) {
        return unknownAnswer(`No security fact is in scope for value:${valueId}.`);
      }
      const payload = extensionPayload(record);
      const labels = Array.isArray(payload.labels) ? payload.labels.map(String) : [];
      return yesAnswer(record, {
        constantTime: payload.constantTime,
        domain: payload.domain,
        secret: labels.includes("secret"),
        spillPolicy: labels.includes("noSpill")
          ? "noSpill"
          : labels.includes("wipeOnSpill")
            ? "wipeOnSpill"
            : "ordinary",
      });
    },
    branchProbabilityForEdge(edgeId: OptIrEdgeId): AArch64FactAnswer {
      const record =
        extensionRecordForSubject(factSet, "branch", `edge:${edgeId}`) ??
        extensionRecordForSubject(factSet, "branch-probability", `edge:${edgeId}`);
      if (record === undefined) {
        return unknownAnswer(`No branch probability fact is in scope for edge:${edgeId}.`);
      }
      return yesAnswer(record, extensionPayload(record));
    },
    fpContractionForOperation(operationId: OptIrOperationId): AArch64FactAnswer {
      const record = extensionRecordForSubject(factSet, "fp-numeric", `operation:${operationId}`);
      if (record === undefined) {
        return unknownAnswer(`No FP numeric fact is in scope for operation:${operationId}.`);
      }
      return yesAnswer(record, extensionPayload(record));
    },
    vectorStateForOperation(operationId: OptIrOperationId): AArch64FactAnswer {
      const record = extensionRecordForSubject(factSet, "vector-state", `operation:${operationId}`);
      if (record === undefined) {
        return unknownAnswer(`No vector-state fact is in scope for operation:${operationId}.`);
      }
      return yesAnswer(record, extensionPayload(record));
    },
    callClobberForCall(callId: OptIrCallId): AArch64FactAnswer {
      const record = extensionRecordForSubject(factSet, "call-clobber", `call:${callId}`);
      if (record === undefined) {
        return unknownAnswer(`No call-clobber fact is in scope for call:${callId}.`);
      }
      return yesAnswer(record, extensionPayload(record));
    },
    layoutByteRangeForKey(layoutKey: LayoutFactKey): AArch64FactAnswer {
      const answer = layoutQuery.byteRangeForLayout(layoutKey);
      if (answer.kind !== "yes") {
        return {
          kind: answer.kind,
          reason: `layout-byte-range:${String(layoutKey)}:${answer.kind}`,
          factsUsed: Object.freeze([...answer.factsUsed]),
          explanation: Object.freeze([...answer.explanation]),
        };
      }
      return {
        kind: "yes",
        offsetBytes: answer.value.offsetBytes,
        sizeBytes: answer.value.sizeBytes,
        factsUsed: Object.freeze([...answer.factsUsed]),
        explanation: Object.freeze([...answer.explanation]),
      };
    },
    provesDereferenceableFootprint(input: {
      readonly region: unknown;
      readonly start: bigint;
      readonly endExclusive: bigint;
    }): AArch64FactAnswer {
      const records = factSet.records.filter((record) => record.extensionKey === "footprint");
      for (const record of records) {
        const payload = extensionPayload(record);
        const start = parsePayloadBigInt(payload.start ?? 0);
        const endExclusive = parsePayloadBigInt(payload.endExclusive ?? 0);
        if (start === undefined || endExclusive === undefined) {
          continue;
        }
        if (
          String(payload.region) === String(input.region) &&
          start <= input.start &&
          endExclusive >= input.endExclusive
        ) {
          return yesAnswer(record, {
            access: payload.access,
            alignment: payload.alignment,
            dereferenceable: true,
          });
        }
      }
      return {
        kind: "no",
        reason: "missingCompleteFootprint",
        factsUsed: Object.freeze(records.map((record) => record.factId)),
      };
    },
  });
}

function parsePayloadBigInt(value: unknown): bigint | undefined {
  try {
    return BigInt(String(value));
  } catch {
    return undefined;
  }
}

function extensionRecordForSubject(
  factSet: OptIrFactSet,
  extensionKey: string,
  subjectKey: string,
): OptIrFactRecord | undefined {
  return factSet.records.find(
    (record) => record.extensionKey === extensionKey && record.subjectKey === subjectKey,
  );
}

function extensionPayload(record: OptIrFactRecord): Readonly<Record<string, unknown>> {
  if (record.extensionPayload !== undefined && typeof record.extensionPayload === "object") {
    return record.extensionPayload as Readonly<Record<string, unknown>>;
  }
  return {};
}

function yesAnswer(
  record: OptIrFactRecord,
  values: Readonly<Record<string, unknown>>,
): AArch64FactAnswer {
  return Object.freeze({
    kind: "yes",
    ...values,
    factsUsed: Object.freeze([record.factId]),
    explanation: Object.freeze([
      `Fact ${Number(record.factId)} supplies ${record.extensionKey} for ${record.subjectKey}.`,
    ]),
  });
}

function unknownAnswer(explanation: string): AArch64FactAnswer {
  return {
    kind: "unknown",
    factsUsed: Object.freeze([]),
    explanation: Object.freeze([explanation]),
  };
}

function freezeAdapter(adapter: AArch64OptIrFactAdapter): AArch64OptIrFactAdapter {
  return Object.freeze({
    adapterKey: adapter.adapterKey,
    optIrExtensionKey: adapter.optIrExtensionKey,
    targetQueryNamespace: adapter.targetQueryNamespace,
    machineRekeyingRules: Object.freeze(
      adapter.machineRekeyingRules.map((rule) => Object.freeze({ ...rule })),
    ),
    targetProfileFingerprintInputs: Object.freeze([...adapter.targetProfileFingerprintInputs]),
  });
}
