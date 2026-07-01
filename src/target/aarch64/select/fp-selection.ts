import type { OptIrOperationId } from "../../../opt-ir/ids";
import type { OptIrFpRoundingMode } from "../../../opt-ir/facts/fp-numeric-facts";
import type { AArch64RegisterClass } from "../machine-ir/machine-types";
import { appendAArch64SelectionRecord, type AArch64LoweringState } from "../lower/pipeline-stages";

export type AArch64FpNumericOpcode =
  | "fmadd"
  | "fmla"
  | "fcvt-fp16"
  | "sqrdmulh"
  | "sqrdmlah"
  | "sqadd-saturating"
  | "dotprod";

export interface AArch64FpEnvironmentPolicy {
  readonly rounding: OptIrFpRoundingMode;
  readonly exceptionFlagsObservable: boolean;
  readonly flushToZero: boolean;
  readonly defaultNaN: boolean;
  readonly signedZero: "preserve" | "ignore";
  readonly nanPayload: "preserve" | "default";
}

export const DEFAULT_AARCH64_FP_ENVIRONMENT: AArch64FpEnvironmentPolicy = Object.freeze({
  rounding: "nearestTiesToEven",
  exceptionFlagsObservable: false,
  flushToZero: false,
  defaultNaN: false,
  signedZero: "preserve",
  nanPayload: "preserve",
});

export type AArch64FpNumericSelection =
  | {
      readonly kind: "ok";
      readonly opcode: AArch64FpNumericOpcode;
      readonly factsUsed: readonly number[];
      readonly errataConstraints: readonly string[];
      readonly explanation: readonly string[];
    }
  | {
      readonly kind: "rejected";
      readonly reason: string;
      readonly factsUsed: readonly number[];
      readonly explanation: readonly string[];
    };

export type AArch64FpNumericFactAnswer =
  | ({
      readonly kind: "yes";
      readonly factsUsed: readonly number[];
      readonly explanation: readonly string[];
    } & Readonly<Record<string, unknown>>)
  | {
      readonly kind: "no";
      readonly reason: string;
      readonly factsUsed: readonly number[];
      readonly explanation?: readonly string[];
    }
  | {
      readonly kind: "unknown";
      readonly factsUsed: readonly number[];
      readonly explanation: readonly string[];
    };

export function selectAArch64FusedMultiplyAdd(input: {
  readonly operationId: OptIrOperationId | number;
  readonly factAnswer: AArch64FpNumericFactAnswer;
  readonly fpEnvironment?: AArch64FpEnvironmentPolicy;
  readonly resultRegisterClass?: AArch64RegisterClass;
  readonly sourceRegisterClasses?: readonly AArch64RegisterClass[];
  readonly vectorPolicy?: "scalarOnly" | "ownsVectorState" | "callsVectorHelper";
  readonly numericContract?: Readonly<Record<string, unknown>>;
}): AArch64FpNumericSelection {
  const environment = input.fpEnvironment ?? DEFAULT_AARCH64_FP_ENVIRONMENT;
  const family = numericFamily(input.numericContract);
  if (family !== undefined && family !== "multiplyAdd" && family !== "fma") {
    return rejected(input.factAnswer, `fp-numeric:unsupported-family:${family}`);
  }
  if (input.vectorPolicy === "scalarOnly") {
    return rejected(input.factAnswer, "fp-numeric:vector-policy:scalarOnly");
  }
  if (input.factAnswer.kind !== "yes") {
    return rejected(input.factAnswer, `fp-contraction-missing:${String(input.operationId)}`);
  }
  const contraction = stringPayload(input.factAnswer, "contraction");
  if (contraction !== "allowed" && contraction !== "required") {
    return rejected(input.factAnswer, `fp-contraction-missing:${String(input.operationId)}`);
  }
  const rounding = stringPayload(input.factAnswer, "rounding");
  if (!isFpRoundingMode(rounding)) {
    return rejected(input.factAnswer, `fp-rounding-missing:${String(input.operationId)}`);
  }
  if (rounding !== environment.rounding) {
    return rejected(
      input.factAnswer,
      `fp-rounding-mismatch:${String(input.operationId)}:${rounding}:${environment.rounding}`,
    );
  }
  if (
    booleanPayload(input.factAnswer, "exceptionFlagsObservable") === true ||
    environment.exceptionFlagsObservable
  ) {
    return rejected(input.factAnswer, "fp-exception-flags-observable");
  }
  const registerClasses = [
    input.resultRegisterClass,
    ...(input.sourceRegisterClasses ?? []),
  ].filter((registerClass): registerClass is AArch64RegisterClass => registerClass !== undefined);
  const mismatch = registerClasses.findIndex((registerClass) => registerClass !== "fpScalar");
  if (mismatch >= 0) {
    return rejected(
      input.factAnswer,
      `fp-numeric:register-class-mismatch:${String(input.operationId)}:fmadd:${mismatch}:expected:fpScalar:actual:${registerClasses[mismatch]}`,
    );
  }
  return {
    kind: "ok",
    opcode: "fmadd",
    factsUsed: numberFacts(input.factAnswer),
    errataConstraints: ["fp-contraction-authorized"],
    explanation: Object.freeze([
      `fp-selection:fmadd:${String(input.operationId)}:${rounding}`,
      ...answerExplanation(input.factAnswer),
    ]),
  };
}

export function selectAArch64DotProductNumeric(input: {
  readonly operationId: OptIrOperationId | number;
  readonly factAnswers: readonly AArch64FpNumericFactAnswer[];
  readonly vectorPolicy?: "scalarOnly" | "ownsVectorState" | "callsVectorHelper";
  readonly laneWidthBits: number;
  readonly signedness: "signed" | "unsigned";
}): AArch64FpNumericSelection {
  if (input.vectorPolicy === "scalarOnly") {
    return rejected(firstAnswer(input.factAnswers), "dotprod:vector-policy:scalarOnly");
  }
  const factAnswer = input.factAnswers.find(
    (answer) =>
      answer.kind === "yes" &&
      numberPayload(answer, "laneWidthBits") === input.laneWidthBits &&
      stringPayload(answer, "signedness") === input.signedness &&
      stringPayload(answer, "accumulation") !== undefined &&
      stringPayload(answer, "saturation") !== undefined &&
      numberPayload(answer, "errorBoundUlps") !== undefined &&
      recordPayload(answer, "numericRange") !== undefined,
  );
  if (factAnswer === undefined) {
    return rejected(
      firstAnswer(input.factAnswers),
      `dotprod:numeric-facts-missing:${String(input.operationId)}:${input.laneWidthBits}:${input.signedness}`,
    );
  }
  return {
    kind: "ok",
    opcode: "dotprod",
    factsUsed: numberFacts(factAnswer),
    errataConstraints: ["dotprod-authorized"],
    explanation: Object.freeze([
      `fp-selection:dotprod:${String(input.operationId)}:${input.laneWidthBits}:${input.signedness}`,
      ...answerExplanation(factAnswer),
    ]),
  };
}

export function selectAArch64FactGatedNumericOpcode(input: {
  readonly operationId: OptIrOperationId | number;
  readonly opcode: Exclude<AArch64FpNumericOpcode, "fmadd" | "dotprod">;
  readonly factAnswer: AArch64FpNumericFactAnswer;
  readonly fpEnvironment?: AArch64FpEnvironmentPolicy;
}): AArch64FpNumericSelection {
  const factAnswer = input.factAnswer;
  if (factAnswer.kind !== "yes") {
    return rejected(
      factAnswer,
      `${input.opcode}:numeric-facts-missing:${String(input.operationId)}`,
    );
  }
  const missing = requiredPayloadsForOpcode(input.opcode).find(
    (key) => payloadValue(factAnswer, key) === undefined,
  );
  if (missing !== undefined) {
    return rejected(factAnswer, `${input.opcode}:numeric-fact-missing:${missing}`);
  }
  return {
    kind: "ok",
    opcode: input.opcode,
    factsUsed: numberFacts(factAnswer),
    errataConstraints: constraintsForOpcode(input.opcode),
    explanation: Object.freeze([`fp-selection:${input.opcode}:${String(input.operationId)}`]),
  };
}

export function selectAArch64FpNumericStageState(
  state: AArch64LoweringState,
): AArch64LoweringState {
  return appendAArch64SelectionRecord(state, {
    stageKey: "select-fp-numeric",
    subjectKey: "program",
    patternId: "fp.numeric-fact-gated",
    tier: "helper",
    factsUsed: state.facts.records
      .filter((record) => record.extensionKey === "fp-numeric")
      .map((record) => Number(record.factId)),
    emittedOpcodes: [],
    explanation: ["select-fp-numeric:fp-environment-gates-recorded"],
  });
}

function requiredPayloadsForOpcode(
  opcode: Exclude<AArch64FpNumericOpcode, "fmadd" | "dotprod">,
): readonly string[] {
  switch (opcode) {
    case "fmla":
      return ["contraction", "rounding"];
    case "fcvt-fp16":
      return ["precision", "rounding", "errorBoundUlps"];
    case "sqrdmulh":
    case "sqrdmlah":
      return ["laneWidthBits", "signedness", "saturation", "errorBoundUlps", "numericRange"];
    case "sqadd-saturating":
      return ["laneWidthBits", "signedness", "saturation", "numericRange"];
  }
}

function constraintsForOpcode(opcode: AArch64FpNumericOpcode): readonly string[] {
  switch (opcode) {
    case "fmadd":
    case "fmla":
      return ["fp-contraction-authorized"];
    case "fcvt-fp16":
      return ["fp16-narrowing-authorized"];
    case "sqrdmulh":
    case "sqrdmlah":
      return ["rdm-authorized", "saturation-authorized", "numeric-error-bound-authorized"];
    case "sqadd-saturating":
      return ["saturation-authorized"];
    case "dotprod":
      return ["dotprod-authorized"];
  }
}

function rejected(
  answer: AArch64FpNumericFactAnswer | undefined,
  reason: string,
): Extract<AArch64FpNumericSelection, { readonly kind: "rejected" }> {
  return {
    kind: "rejected",
    reason,
    factsUsed: answer === undefined ? [] : numberFacts(answer),
    explanation: Object.freeze(
      answer === undefined ? [reason] : [reason, ...answerExplanation(answer)],
    ),
  };
}

function firstAnswer(
  answers: readonly AArch64FpNumericFactAnswer[],
): AArch64FpNumericFactAnswer | undefined {
  return answers[0];
}

function numberFacts(answer: AArch64FpNumericFactAnswer): readonly number[] {
  return Object.freeze(answer.factsUsed.map((factId) => Number(factId)));
}

function answerExplanation(answer: AArch64FpNumericFactAnswer): readonly string[] {
  return answer.explanation === undefined ? [] : Object.freeze([...answer.explanation]);
}

function numericFamily(
  contract: Readonly<Record<string, unknown>> | undefined,
): string | undefined {
  const family = contract?.family ?? contract?.kind ?? contract?.operation;
  return typeof family === "string" ? family : undefined;
}

function payloadValue(answer: AArch64FpNumericFactAnswer, key: string): unknown {
  return answer.kind === "yes" ? answer[key] : undefined;
}

function stringPayload(answer: AArch64FpNumericFactAnswer, key: string): string | undefined {
  const value = payloadValue(answer, key);
  return typeof value === "string" ? value : undefined;
}

function numberPayload(answer: AArch64FpNumericFactAnswer, key: string): number | undefined {
  const value = payloadValue(answer, key);
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanPayload(answer: AArch64FpNumericFactAnswer, key: string): boolean | undefined {
  const value = payloadValue(answer, key);
  return typeof value === "boolean" ? value : undefined;
}

function recordPayload(
  answer: AArch64FpNumericFactAnswer,
  key: string,
): Readonly<Record<string, unknown>> | undefined {
  const value = payloadValue(answer, key);
  return typeof value === "object" && value !== null
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function isFpRoundingMode(value: string | undefined): value is OptIrFpRoundingMode {
  return (
    value === "nearestTiesToEven" ||
    value === "towardZero" ||
    value === "towardPositive" ||
    value === "towardNegative"
  );
}
