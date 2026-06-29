import type { CheckedFactSubject } from "../../proof-check/model/fact-packet";
import type { OptIrFactRecord, OptIrFactSet } from "./fact-index";
import type { OptIrFactBooleanAnswer, OptIrFactQueryTypedAnswer } from "./fact-query";

export type OptIrOwnershipSubject = Extract<
  CheckedFactSubject,
  { readonly kind: "place" } | { readonly kind: "value" }
>;

export type OptIrNoaliasSubject = Extract<
  CheckedFactSubject,
  { readonly kind: "place" } | { readonly kind: "value" } | { readonly kind: "edge" }
>;

export type OptIrFieldDisjointnessSubject = Extract<CheckedFactSubject, { readonly kind: "place" }>;

export interface OptIrAliasFactQuery {
  owns(subject: OptIrOwnershipSubject): OptIrFactBooleanAnswer;
  mustNotAlias(subject: OptIrNoaliasSubject): OptIrFactBooleanAnswer;
  fieldsDisjoint(subject: OptIrFieldDisjointnessSubject): OptIrFactBooleanAnswer;
}

export function createOptIrAliasFactQuery(factSet: OptIrFactSet): OptIrAliasFactQuery {
  return Object.freeze({
    owns(subject: OptIrOwnershipSubject): OptIrFactBooleanAnswer {
      return answerFromAliasRecord({
        factSet,
        subjectKey: aliasSubjectKey(subject),
        typedAnswer: "owns",
        yesDescription: "ownership",
        unknownDescription: "ownership",
      });
    },
    mustNotAlias(subject: OptIrNoaliasSubject): OptIrFactBooleanAnswer {
      return answerFromAliasRecord({
        factSet,
        subjectKey: aliasSubjectKey(subject),
        typedAnswer: "mustNotAlias",
        yesDescription: "noalias",
        unknownDescription: "noalias",
      });
    },
    fieldsDisjoint(subject: OptIrFieldDisjointnessSubject): OptIrFactBooleanAnswer {
      return answerFromAliasRecord({
        factSet,
        subjectKey: aliasSubjectKey(subject),
        typedAnswer: "fieldsDisjoint",
        yesDescription: "field disjointness",
        unknownDescription: "field disjointness",
      });
    },
  });
}

function answerFromAliasRecord(input: {
  readonly factSet: OptIrFactSet;
  readonly subjectKey: string;
  readonly typedAnswer: OptIrFactQueryTypedAnswer;
  readonly yesDescription: string;
  readonly unknownDescription: string;
}): OptIrFactBooleanAnswer {
  const record = aliasRecordForTypedAnswer(input.factSet, input.subjectKey, input.typedAnswer);
  if (record === undefined) {
    return {
      kind: "unknown",
      factsUsed: [],
      explanation: [`No ${input.unknownDescription} fact is in scope for ${input.subjectKey}.`],
    };
  }

  return {
    kind: "yes",
    factsUsed: [record.factId],
    explanation: [
      `Fact ${Number(record.factId)} proves ${input.yesDescription} for ${input.subjectKey}.`,
    ],
  };
}

function aliasRecordForTypedAnswer(
  factSet: OptIrFactSet,
  subjectKey: string,
  typedAnswer: OptIrFactQueryTypedAnswer,
): OptIrFactRecord | undefined {
  const factIds = factSet.indexes.byTypedAnswer[typedAnswer] ?? [];
  for (const factId of factIds) {
    const record = factSet.indexes.byId[factId];
    if (record?.subjectKey === subjectKey) {
      return record;
    }
  }
  return undefined;
}

function aliasSubjectKey(subject: OptIrOwnershipSubject | OptIrNoaliasSubject): string {
  switch (subject.kind) {
    case "place":
      return `place:${String(subject.placeId)}`;
    case "value":
      return `value:${String(subject.valueId)}`;
    case "edge":
      return `edge:${subject.functionInstanceId}:${String(subject.edgeId)}`;
  }
}
