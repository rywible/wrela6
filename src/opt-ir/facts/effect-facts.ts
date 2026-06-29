import type { CheckedFactSubject } from "../../proof-check/model/fact-packet";
import type { OptIrFactRecord, OptIrFactSet } from "./fact-index";
import type { OptIrFactBooleanAnswer, OptIrFactQueryTypedAnswer } from "./fact-query";

export type OptIrEffectSubject = Extract<
  CheckedFactSubject,
  { readonly kind: "call" } | { readonly kind: "authority" }
>;

export type OptIrTerminalBehaviorSubject = Extract<
  CheckedFactSubject,
  | { readonly kind: "terminal" }
  | { readonly kind: "function" }
  | { readonly kind: "block" }
  | { readonly kind: "edge" }
>;

export type OptIrImpossibleSubject = Extract<
  CheckedFactSubject,
  | { readonly kind: "value" }
  | { readonly kind: "edge" }
  | { readonly kind: "packetSource" }
  | { readonly kind: "terminal" }
  | { readonly kind: "function" }
  | { readonly kind: "block" }
>;

export interface OptIrEffectFactQuery {
  callEffects(subject: OptIrEffectSubject): OptIrFactBooleanAnswer;
  volatilityOf(subject: OptIrEffectSubject): OptIrFactBooleanAnswer;
  terminalBehavior(subject: OptIrTerminalBehaviorSubject): OptIrFactBooleanAnswer;
  provesImpossible(subject: OptIrImpossibleSubject): OptIrFactBooleanAnswer;
}

export function createOptIrEffectFactQuery(factSet: OptIrFactSet): OptIrEffectFactQuery {
  return Object.freeze({
    callEffects(subject: OptIrEffectSubject): OptIrFactBooleanAnswer {
      return answerFromEffectRecord({
        factSet,
        subjectKey: effectSubjectKey(subject),
        typedAnswer: "callEffects",
        yesDescription: "call effects",
        unknownDescription: "call effects",
      });
    },
    volatilityOf(subject: OptIrEffectSubject): OptIrFactBooleanAnswer {
      return answerFromEffectRecord({
        factSet,
        subjectKey: effectSubjectKey(subject),
        typedAnswer: "volatilityOf",
        yesDescription: "volatility",
        unknownDescription: "volatility",
      });
    },
    terminalBehavior(subject: OptIrTerminalBehaviorSubject): OptIrFactBooleanAnswer {
      return answerFromEffectRecord({
        factSet,
        subjectKey: effectSubjectKey(subject),
        typedAnswer: "terminalBehavior",
        yesDescription: "terminal behavior",
        unknownDescription: "terminal behavior",
      });
    },
    provesImpossible(subject: OptIrImpossibleSubject): OptIrFactBooleanAnswer {
      return answerFromEffectRecord({
        factSet,
        subjectKey: effectSubjectKey(subject),
        typedAnswer: "provesImpossible",
        yesDescription: "impossibility",
        unknownDescription: "impossibility",
      });
    },
  });
}

function answerFromEffectRecord(input: {
  readonly factSet: OptIrFactSet;
  readonly subjectKey: string;
  readonly typedAnswer: OptIrFactQueryTypedAnswer;
  readonly yesDescription: string;
  readonly unknownDescription: string;
}): OptIrFactBooleanAnswer {
  const record = effectRecordForTypedAnswer(input.factSet, input.subjectKey, input.typedAnswer);
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

function effectRecordForTypedAnswer(
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

function effectSubjectKey(
  subject: OptIrEffectSubject | OptIrTerminalBehaviorSubject | OptIrImpossibleSubject,
): string {
  switch (subject.kind) {
    case "call":
      return `call:${subject.functionInstanceId}:${String(subject.callId)}`;
    case "authority":
      return `authority:${subject.fingerprint.digestHex}:${subject.entryKey}`;
    case "terminal":
      return `terminal:${subject.terminalKey}`;
    case "function":
      return `function:${subject.functionInstanceId}`;
    case "block":
      return `block:${subject.functionInstanceId}:${String(subject.blockId)}`;
    case "edge":
      return `edge:${subject.functionInstanceId}:${String(subject.edgeId)}`;
    case "value":
      return `value:${String(subject.valueId)}`;
    case "packetSource":
      return `packetSource:${String(subject.packet)}:${String(subject.source)}`;
  }
}
