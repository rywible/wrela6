import type { CheckedFactSubject } from "../../proof-check/model/fact-packet";
import type { OptIrFactRecord, OptIrFactSet } from "./fact-index";
import type { OptIrFactBooleanAnswer, OptIrFactQueryTypedAnswer } from "./fact-query";

export type OptIrPrivateStateGenerationSubject = Extract<
  CheckedFactSubject,
  { readonly kind: "privateState" }
>;

export type OptIrErasureSubject = Extract<
  CheckedFactSubject,
  { readonly kind: "place" } | { readonly kind: "value" }
>;

export interface OptIrPrivateStateFactQuery {
  privateStateGeneration(subject: OptIrPrivateStateGenerationSubject): OptIrFactBooleanAnswer;
  erasureOf(subject: OptIrErasureSubject): OptIrFactBooleanAnswer;
}

export function createOptIrPrivateStateFactQuery(
  factSet: OptIrFactSet,
): OptIrPrivateStateFactQuery {
  return Object.freeze({
    privateStateGeneration(subject: OptIrPrivateStateGenerationSubject): OptIrFactBooleanAnswer {
      return answerFromPrivateStateRecord({
        factSet,
        subjectKey: privateStateSubjectKey(subject),
        typedAnswer: "privateStateGeneration",
        yesDescription: "private-state generation",
        unknownDescription: "private-state generation",
      });
    },
    erasureOf(subject: OptIrErasureSubject): OptIrFactBooleanAnswer {
      return answerFromPrivateStateRecord({
        factSet,
        subjectKey: privateStateSubjectKey(subject),
        typedAnswer: "erasureOf",
        yesDescription: "erasure",
        unknownDescription: "erasure",
      });
    },
  });
}

function answerFromPrivateStateRecord(input: {
  readonly factSet: OptIrFactSet;
  readonly subjectKey: string;
  readonly typedAnswer: OptIrFactQueryTypedAnswer;
  readonly yesDescription: string;
  readonly unknownDescription: string;
}): OptIrFactBooleanAnswer {
  const record = privateStateRecordForTypedAnswer(
    input.factSet,
    input.subjectKey,
    input.typedAnswer,
  );
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

function privateStateRecordForTypedAnswer(
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

function privateStateSubjectKey(
  subject: OptIrPrivateStateGenerationSubject | OptIrErasureSubject,
): string {
  switch (subject.kind) {
    case "privateState":
      return `privateState:${String(subject.placeId)}:${String(subject.generation)}`;
    case "place":
      return `place:${String(subject.placeId)}`;
    case "value":
      return `value:${String(subject.valueId)}`;
  }
}
