import type { CheckedFactSubject } from "../../proof-check/model/fact-packet";
import type { OptIrFactRecord, OptIrFactSet } from "./fact-index";
import type { OptIrFactBooleanAnswer } from "./fact-query";

export type OptIrCapabilityFlowSubject = Extract<
  CheckedFactSubject,
  { readonly kind: "call" } | { readonly kind: "place" } | { readonly kind: "authority" }
>;

export interface OptIrCapabilityFactQuery {
  capabilityFlow(subject: OptIrCapabilityFlowSubject): OptIrFactBooleanAnswer;
}

export function createOptIrCapabilityFactQuery(factSet: OptIrFactSet): OptIrCapabilityFactQuery {
  return Object.freeze({
    capabilityFlow(subject: OptIrCapabilityFlowSubject): OptIrFactBooleanAnswer {
      const subjectKey = capabilitySubjectKey(subject);
      const record = capabilityRecordForSubject(factSet, subjectKey);
      if (record === undefined) {
        return {
          kind: "unknown",
          factsUsed: [],
          explanation: [`No capability flow fact is in scope for ${subjectKey}.`],
        };
      }

      return {
        kind: "yes",
        factsUsed: [record.factId],
        explanation: [`Fact ${Number(record.factId)} proves capability flow for ${subjectKey}.`],
      };
    },
  });
}

function capabilityRecordForSubject(
  factSet: OptIrFactSet,
  subjectKey: string,
): OptIrFactRecord | undefined {
  const factIds = factSet.indexes.byTypedAnswer.capabilityFlow ?? [];
  for (const factId of factIds) {
    const record = factSet.indexes.byId[factId];
    if (record?.subjectKey === subjectKey) {
      return record;
    }
  }
  return undefined;
}

function capabilitySubjectKey(subject: OptIrCapabilityFlowSubject): string {
  switch (subject.kind) {
    case "call":
      return `call:${subject.functionInstanceId}:${String(subject.callId)}`;
    case "place":
      return `place:${String(subject.placeId)}`;
    case "authority":
      return `authority:${subject.fingerprint.digestHex}:${subject.entryKey}`;
  }
}
