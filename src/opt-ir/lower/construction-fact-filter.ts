import {
  optIrFactSetFromRecords,
  type OptIrFactRecord,
  type OptIrFactSet,
} from "../facts/fact-index";
import type { OptIrProofErasurePreservedFactLineage } from "../facts/fact-lineage";
import type { OptIrFactId, OptIrValueId } from "../ids";
import type { OptIrSkeletonLoweringResult } from "./lowering-types";
import {
  proofMirValueIdFromScopedKey,
  proofMirValueIdsForOptIrValues,
} from "./proof-mir-lowering-support";
import { runProofErasureFactPreservation, type OptIrProofErasureFact } from "./proof-erasure";
import type { ProofMirValueId } from "../../proof-mir/ids";
import { proofMirValueId } from "../../proof-mir/ids";
import type {
  CheckedFactDependency,
  CheckedFactSubject,
} from "../../proof-check/model/fact-packet";

/**
 * Construction runs proof erasure in two stages:
 *
 * 1. Per-function IR erasure via `eraseProofOnlyOptIr` removes proof-only operations
 *    and values from the executable program.
 *
 * 2. Program-wide imported-fact preservation via `filterImportedFactsAfterProofErasure`
 *    reuses `runProofErasureFactPreservation` for value-shaped facts and applies the
 *    same lineage rules to place/edge/call subjects whose `proofMirValue` dependencies
 *    name erased proof-only witnesses.
 *
 * Facts whose subject is itself an erased proof-only value are kept only when an erasure
 * fact supplies lineage. Facts about surviving subjects (for example `noalias` on a live
 * edge justified through an erased proof token) are preserved when lineage exists, because
 * downstream alias queries match by subject key and ignore dependency liveness.
 */
export function filterImportedFactsAfterProofErasure(
  factSet: OptIrFactSet,
  lowering: Extract<OptIrSkeletonLoweringResult, { readonly kind: "ok" }>,
): OptIrFactSet {
  const erasedProofMirValues = proofMirValueIdsForOptIrValues({
    valueIdsByKey: lowering.valueIdsByKey,
    proofOnlyOptIrValueIds: new Set(lowering.proofOnlyValueIds),
  });
  if (erasedProofMirValues.size === 0) {
    return factSet;
  }

  const proofMirToOptIr = buildProofMirToOptIrMap(lowering.valueIdsByKey);
  const optIrToProofMir = invertProofMirToOptIrMap(proofMirToOptIr);
  const erasedProofMirValueKeys = new Set([...erasedProofMirValues].map(String));
  const proofMirLineage = buildProofMirErasureLineage(factSet.records, erasedProofMirValueKeys);

  const convertibleValueRecords: OptIrFactRecord[] = [];
  const proofMirOnlyValueRecords: OptIrFactRecord[] = [];
  const nonValueRecords: OptIrFactRecord[] = [];
  for (const record of factSet.records) {
    if (record.subject.kind !== "value") {
      nonValueRecords.push(record);
      continue;
    }
    if (importedRecordToProofErasureFact(record, proofMirToOptIr) !== undefined) {
      convertibleValueRecords.push(record);
      continue;
    }
    proofMirOnlyValueRecords.push(record);
  }

  const proofErasureFacts = convertibleValueRecords.flatMap((record) => {
    const converted = importedRecordToProofErasureFact(record, proofMirToOptIr);
    return converted === undefined ? [] : [converted];
  });
  const convertibleValueRecordsById = new Map(
    convertibleValueRecords.map((record) => [record.factId, record] as const),
  );
  const preservation = runProofErasureFactPreservation({
    facts: proofErasureFacts,
    erasedValueIds: lowering.proofOnlyValueIds,
    proofOnlyValueIds: lowering.proofOnlyValueIds,
    proofValueFacts: proofValueFactsForErasure(convertibleValueRecords, proofMirToOptIr),
  });
  const preservedValueRecordsById = new Map(
    preservation.facts.map((preservedFact) => {
      const source = convertibleValueRecordsById.get(preservedFact.factId);
      if (source === undefined) {
        throw new RangeError(`Missing imported fact record for ${String(preservedFact.factId)}.`);
      }
      return [
        preservedFact.factId,
        applyPreservationLineage(source, preservedFact, optIrToProofMir),
      ] as const;
    }),
  );
  const preservedConvertibleValueRecords = convertibleValueRecords.flatMap((record) => {
    const preserved = preservedValueRecordsById.get(record.factId);
    return preserved === undefined ? [] : [preserved];
  });

  const preservedProofMirOnlyValueRecords = proofMirOnlyValueRecords.flatMap((record) => {
    const preserved = preserveNonValueImportedFact(
      record,
      erasedProofMirValueKeys,
      proofMirLineage,
    );
    return preserved === undefined ? [] : [preserved];
  });

  const preservedNonValueRecords = nonValueRecords.flatMap((record) => {
    const preserved = preserveNonValueImportedFact(
      record,
      erasedProofMirValueKeys,
      proofMirLineage,
    );
    return preserved === undefined ? [] : [preserved];
  });

  return optIrFactSetFromRecords([
    ...preservedConvertibleValueRecords,
    ...preservedProofMirOnlyValueRecords,
    ...preservedNonValueRecords,
  ]);
}

function buildProofMirToOptIrMap(
  valueIdsByKey: ReadonlyMap<string, OptIrValueId>,
): ReadonlyMap<string, OptIrValueId> {
  const map = new Map<string, OptIrValueId>();
  for (const [valueKey, valueId] of valueIdsByKey) {
    const proofMirValue = proofMirValueIdFromScopedKey(valueKey);
    if (proofMirValue === undefined) {
      continue;
    }
    map.set(String(proofMirValue), valueId);
  }
  return map;
}

function invertProofMirToOptIrMap(
  proofMirToOptIr: ReadonlyMap<string, OptIrValueId>,
): ReadonlyMap<string, ProofMirValueId> {
  return new Map(
    [...proofMirToOptIr.entries()].map(([proofMirValueKey, optIrValueId]) => [
      String(optIrValueId),
      proofMirValueId(Number(proofMirValueKey)),
    ]),
  );
}

function buildProofMirErasureLineage(
  records: readonly OptIrFactRecord[],
  erasedProofMirValues: ReadonlySet<string>,
): ReadonlyMap<string, readonly OptIrFactId[]> {
  const lineage = new Map<string, OptIrFactId[]>();
  for (const record of records) {
    if (record.packetKind !== "erasure" || record.subject.kind !== "value") {
      continue;
    }
    const proofMirValueKey = String(record.subject.valueId);
    if (!erasedProofMirValues.has(proofMirValueKey)) {
      continue;
    }
    appendProofMirLineageFact(lineage, proofMirValueKey, record.factId);
  }
  return lineage;
}

function appendProofMirLineageFact(
  lineage: Map<string, OptIrFactId[]>,
  proofMirValueKey: string,
  factId: OptIrFactId,
): void {
  const existing = lineage.get(proofMirValueKey);
  if (existing === undefined) {
    lineage.set(proofMirValueKey, [factId]);
    return;
  }
  existing.push(factId);
}

function proofValueFactsForErasure(
  records: readonly OptIrFactRecord[],
  proofMirToOptIr: ReadonlyMap<string, OptIrValueId>,
): readonly (readonly [OptIrValueId, OptIrFactId])[] {
  return Object.freeze(
    records.flatMap((record) => {
      if (record.packetKind !== "erasure" || record.subject.kind !== "value") {
        return [];
      }
      const optIrValueId = proofMirToOptIr.get(String(record.subject.valueId));
      if (optIrValueId === undefined) {
        return [];
      }
      return [[optIrValueId, record.factId] as const];
    }),
  );
}

function importedRecordToProofErasureFact(
  record: OptIrFactRecord,
  proofMirToOptIr: ReadonlyMap<string, OptIrValueId>,
): OptIrProofErasureFact | undefined {
  if (record.subject.kind !== "value") {
    return undefined;
  }
  const subjectValueId = proofMirToOptIr.get(String(record.subject.valueId));
  if (subjectValueId === undefined) {
    return undefined;
  }
  const dependencies = record.dependencies.flatMap((dependency) => {
    const converted = proofErasureDependency(dependency, proofMirToOptIr);
    return converted === undefined ? [] : [converted];
  });
  return {
    factId: record.factId,
    subject: { kind: "value", valueId: subjectValueId },
    dependencies,
    lineage: { kind: "imported" },
  };
}

function proofErasureDependency(
  dependency: CheckedFactDependency,
  proofMirToOptIr: ReadonlyMap<string, OptIrValueId>,
): OptIrProofErasureFact["dependencies"][number] | undefined {
  if (dependency.kind !== "proofMirValue") {
    return undefined;
  }
  const valueId = proofMirToOptIr.get(String(dependency.valueId));
  if (valueId === undefined) {
    return undefined;
  }
  return { kind: "value", valueId };
}

function applyPreservationLineage(
  record: OptIrFactRecord,
  preserved: OptIrProofErasureFact,
  optIrToProofMir: ReadonlyMap<string, ProofMirValueId>,
): OptIrFactRecord {
  if (preserved.lineage.kind !== "proofErasurePreserved") {
    return record;
  }
  const lineage: OptIrProofErasurePreservedFactLineage = {
    kind: "proofErasurePreserved",
    sourceFactId: preserved.lineage.sourceFactId,
    erasedProofMirValueIds: Object.freeze(
      preserved.lineage.erasedValueIds.flatMap((valueId) => {
        const proofMirValue = optIrToProofMir.get(String(valueId));
        return proofMirValue === undefined ? [] : [proofMirValue];
      }),
    ),
  };
  return Object.freeze({ ...record, lineage });
}

function preserveNonValueImportedFact(
  record: OptIrFactRecord,
  erasedProofMirValues: ReadonlySet<string>,
  lineage: ReadonlyMap<string, readonly OptIrFactId[]>,
): OptIrFactRecord | undefined {
  const erasedDependencies = erasedProofMirValueDependencies(record, erasedProofMirValues);
  if (erasedDependencies.length === 0) {
    return record;
  }
  const uniqueErasedDependencies = [...new Set(erasedDependencies)];
  const hasLineage = uniqueErasedDependencies.every(
    (proofMirValueKey) => (lineage.get(proofMirValueKey) ?? []).length > 0,
  );
  if (!hasLineage) {
    return undefined;
  }
  const preservedLineage: OptIrProofErasurePreservedFactLineage = {
    kind: "proofErasurePreserved",
    sourceFactId: record.factId,
    erasedProofMirValueIds: Object.freeze(
      uniqueErasedDependencies.map((proofMirValueKey) => proofMirValueId(Number(proofMirValueKey))),
    ),
  };
  return Object.freeze({ ...record, lineage: preservedLineage });
}

function erasedProofMirValueDependencies(
  record: OptIrFactRecord,
  erasedProofMirValues: ReadonlySet<string>,
): readonly string[] {
  return [
    ...subjectProofMirValueKeys(record.subject, erasedProofMirValues),
    ...record.dependencies.flatMap((dependency) =>
      dependencyProofMirValueKeys(dependency, erasedProofMirValues),
    ),
  ];
}

function subjectProofMirValueKeys(
  subject: CheckedFactSubject,
  erasedProofMirValues: ReadonlySet<string>,
): readonly string[] {
  if (subject.kind !== "value") {
    return [];
  }
  const proofMirValueKey = String(subject.valueId);
  return erasedProofMirValues.has(proofMirValueKey) ? [proofMirValueKey] : [];
}

function dependencyProofMirValueKeys(
  dependency: CheckedFactDependency,
  erasedProofMirValues: ReadonlySet<string>,
): readonly string[] {
  if (dependency.kind !== "proofMirValue") {
    return [];
  }
  const proofMirValueKey = String(dependency.valueId);
  return erasedProofMirValues.has(proofMirValueKey) ? [proofMirValueKey] : [];
}
