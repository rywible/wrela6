import { compareCodeUnitStrings } from "../../../../shared/deterministic-sort";
import type { AArch64MachineFactRecord } from "../../machine-ir/fact-set";
import { backendFactSubjectKey, type AArch64BackendFactSubject } from "./backend-fact-subjects";

export interface AArch64ImportedBackendFact {
  readonly family: string;
  readonly subject: AArch64BackendFactSubject;
  readonly subjectKey: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly lineageOptIrFactIds: readonly number[];
  readonly upstreamVerifierKey: string;
  readonly sourceStableKey: string;
}

export interface AArch64BackendFactIndex {
  readonly allFacts: () => readonly AArch64ImportedBackendFact[];
  readonly factsForFamily: (family: string) => readonly AArch64ImportedBackendFact[];
  readonly factsForSubject: (
    subject: AArch64BackendFactSubject,
  ) => readonly AArch64ImportedBackendFact[];
  readonly security: {
    readonly noSpillForVirtualRegister: (vreg: number) => AArch64ImportedBackendFact | undefined;
    readonly wipeOnSpillForVirtualRegister: (
      vreg: number,
    ) => AArch64ImportedBackendFact | undefined;
    readonly noSpillFacts: () => readonly AArch64ImportedBackendFact[];
  };
  readonly calls: {
    readonly internalEligibilityForCallSite: (
      callKey: string,
    ) => AArch64ImportedBackendFact | undefined;
  };
  readonly rematerialization: {
    readonly authorityForVirtualRegister: (vreg: number) => readonly AArch64ImportedBackendFact[];
  };
}

export function createAArch64BackendFactIndex(
  records: readonly AArch64ImportedBackendFact[],
): AArch64BackendFactIndex {
  const sorted = sortImportedFacts(records);
  const byFamily = groupImportedFacts(sorted, (fact) => fact.family);
  const bySubject = groupImportedFacts(sorted, (fact) => fact.subjectKey);

  function firstFor(family: string, subject: AArch64BackendFactSubject) {
    return sorted.find(
      (fact) => fact.family === family && fact.subjectKey === backendFactSubjectKey(subject),
    );
  }

  return Object.freeze({
    allFacts() {
      return sorted;
    },
    factsForFamily(family: string) {
      return byFamily.get(family) ?? [];
    },
    factsForSubject(subject: AArch64BackendFactSubject) {
      return bySubject.get(backendFactSubjectKey(subject)) ?? [];
    },
    security: Object.freeze({
      noSpillForVirtualRegister(vreg: number) {
        return firstFor("security.no-spill", { kind: "virtualRegister", vreg });
      },
      wipeOnSpillForVirtualRegister(vreg: number) {
        return firstFor("security.wipe-on-spill", { kind: "virtualRegister", vreg });
      },
      noSpillFacts() {
        return byFamily.get("security.no-spill") ?? [];
      },
    }),
    calls: Object.freeze({
      internalEligibilityForCallSite(callKey: string) {
        return firstFor("internal-call-eligibility", { kind: "callSite", callKey });
      },
    }),
    rematerialization: Object.freeze({
      authorityForVirtualRegister(vreg: number) {
        return sorted.filter(
          (fact) =>
            fact.family === "rematerialization-authority" && fact.subjectKey === `vreg:${vreg}`,
        );
      },
    }),
  });
}

export function importedBackendFactFromMachineRecord(
  record: AArch64MachineFactRecord,
): AArch64ImportedBackendFact {
  return Object.freeze({
    family: record.extensionKey,
    subject: record.subject,
    subjectKey: backendFactSubjectKey(record.subject),
    payload: record.payload,
    lineageOptIrFactIds: Object.freeze(record.lineage.optIrFactIds.map(Number)),
    upstreamVerifierKey: record.upstreamVerifierKey,
    sourceStableKey: record.stableKey,
  });
}

function sortImportedFacts(
  records: readonly AArch64ImportedBackendFact[],
): readonly AArch64ImportedBackendFact[] {
  return Object.freeze(
    [...records].sort((left, right) => {
      for (const [leftPart, rightPart] of [
        [left.family, right.family],
        [left.subjectKey, right.subjectKey],
        [left.sourceStableKey, right.sourceStableKey],
      ] as const) {
        const order = compareCodeUnitStrings(leftPart, rightPart);
        if (order !== 0) return order;
      }
      return 0;
    }),
  );
}

function groupImportedFacts<RecordValue>(
  records: readonly RecordValue[],
  keyOf: (record: RecordValue) => string,
): ReadonlyMap<string, readonly RecordValue[]> {
  const groups = new Map<string, RecordValue[]>();
  for (const record of records) {
    const key = keyOf(record);
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, [record]);
    } else {
      existing.push(record);
    }
  }
  return new Map([...groups].map(([key, value]) => [key, Object.freeze([...value])]));
}
