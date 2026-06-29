import type { CheckedFactSubject } from "../../proof-check/model/fact-packet";
import type { OptIrFactSet } from "./fact-index";
import type { OptIrFactBooleanAnswer } from "./fact-query";

export type OptIrBoundsSubject = Extract<
  CheckedFactSubject,
  { readonly kind: "value" } | { readonly kind: "edge" } | { readonly kind: "packetSource" }
>;

export interface OptIrBoundsFactQuery {
  provesInBounds(subject: OptIrBoundsSubject): OptIrFactBooleanAnswer;
}

export function createOptIrBoundsFactQuery(factSet: OptIrFactSet): OptIrBoundsFactQuery {
  return Object.freeze({
    provesInBounds(subject: OptIrBoundsSubject): OptIrFactBooleanAnswer {
      const subjectKey = boundsSubjectKey(subject);
      const factIds = factSet.indexes.byTypedAnswer.provesInBounds ?? [];
      for (const factId of factIds) {
        const record = factSet.indexes.byId[factId];
        if (record?.subjectKey === subjectKey) {
          return {
            kind: "yes",
            factsUsed: [record.factId],
            explanation: [
              `Fact ${Number(record.factId)} proves validated buffer bounds for ${subjectKey}.`,
            ],
          };
        }
      }
      return {
        kind: "unknown",
        factsUsed: [],
        explanation: [`No in-bounds fact is in scope for ${subjectKey}.`],
      };
    },
  });
}

function boundsSubjectKey(subject: OptIrBoundsSubject): string {
  switch (subject.kind) {
    case "value":
      return `value:${String(subject.valueId)}`;
    case "edge":
      return `edge:${subject.functionInstanceId}:${String(subject.edgeId)}`;
    case "packetSource":
      return `packetSource:${String(subject.packet)}:${String(subject.source)}`;
  }
}
