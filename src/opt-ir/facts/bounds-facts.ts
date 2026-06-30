import type { CheckedFactSubject, LayoutFactKey } from "../../proof-check/model/fact-packet";
import type { OptIrBoundsAuthority } from "../operations";
import type { OptIrFactSet } from "./fact-index";
import type { OptIrFactBooleanAnswer } from "./fact-query";
import { layoutRecordForTypedAnswer, layoutSubjectKey } from "./layout-facts";

export type OptIrBoundsSubject = Extract<
  CheckedFactSubject,
  { readonly kind: "value" } | { readonly kind: "edge" } | { readonly kind: "packetSource" }
>;

export interface OptIrBoundsFactQuery {
  provesInBounds(subject: OptIrBoundsSubject): OptIrFactBooleanAnswer;
}

export function optIrBoundsAuthorityIsTrusted(authority: OptIrBoundsAuthority): boolean {
  switch (authority.kind) {
    case "targetContract":
    case "certifiedFact":
    case "constructionSize":
      return true;
    case "runtimeGuard":
    case "passDerivedFact":
    case "layoutFact":
      return false;
  }
}

export function optIrBoundsAuthorityIsProven(
  authority: OptIrBoundsAuthority,
  factSet: OptIrFactSet,
): boolean {
  switch (authority.kind) {
    case "targetContract":
    case "certifiedFact":
    case "constructionSize":
      return true;
    case "runtimeGuard":
      return true;
    case "passDerivedFact": {
      const record = factSet.indexes.byId[authority.factId];
      return record?.typedAnswers.includes("provesInBounds") ?? false;
    }
    case "layoutFact":
      return layoutBoundsFactIsProven(authority.layoutKey, factSet);
  }
}

function layoutBoundsFactIsProven(layoutKey: LayoutFactKey, factSet: OptIrFactSet): boolean {
  return (
    layoutRecordForTypedAnswer(factSet, layoutKey, "provesInBounds") !== undefined ||
    layoutRecordForTypedAnswer(factSet, layoutKey, "layoutOf") !== undefined
  );
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

export function layoutKeyMatchesFactRecord(
  record: OptIrFactSet["records"][number],
  layoutKey: LayoutFactKey,
): boolean {
  const subjectKey = layoutSubjectKey(layoutKey);
  return record.subjectKey === subjectKey || record.scopeKey === subjectKey;
}
