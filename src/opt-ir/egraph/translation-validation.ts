import type { OptIrMemoryAccessDescriptor } from "../operations";
import {
  interpretOptIrSlice,
  validateOptIrSliceIsInterpreterComplete,
  type OptIrInterpreterEffectTrace,
  type OptIrInterpreterMemory,
  type OptIrInterpreterResult,
  type OptIrInterpreterSlice,
  type OptIrRuntimeValue,
} from "../interpreter";
import type { OptIrValueId } from "../ids";
import { optIrTypeStableKey, type OptIrType } from "../types";

export interface OptIrTranslationValidationRangeFact {
  readonly valueId: OptIrValueId;
  readonly minimum: bigint;
  readonly maximum: bigint;
}

export interface OptIrTranslationValidationLayoutBound {
  readonly start: bigint;
  readonly endExclusive: bigint;
}

export interface OptIrTranslationValidationOperand {
  readonly valueId: OptIrValueId;
  readonly type: OptIrType;
}

export interface OptIrTranslationValidationContext {
  readonly operandTypes?: readonly OptIrTranslationValidationOperand[];
  readonly constants?: readonly bigint[];
  readonly rangeFacts?: readonly OptIrTranslationValidationRangeFact[];
  readonly layoutBounds?: readonly OptIrTranslationValidationLayoutBound[];
  readonly masks?: readonly bigint[];
}

export interface OptIrTranslationValidationInputCase {
  readonly stableKey: string;
  readonly values: readonly bigint[];
}

export interface OptIrTranslationValidationDisagreement {
  readonly stableKey: string;
  readonly original: OptIrInterpreterResult;
  readonly replacement: OptIrInterpreterResult;
}

export type OptIrTranslationValidationResult =
  | {
      readonly kind: "passed";
      readonly inputSet: readonly OptIrTranslationValidationInputCase[];
    }
  | {
      readonly kind: "failed";
      readonly reason: "interpreter-disagreement" | "unapproved-not-applicable-reason";
      readonly disagreements: readonly OptIrTranslationValidationDisagreement[];
      readonly unapprovedReasons?: readonly string[];
    }
  | {
      readonly kind: "notApplicable";
      readonly reasons: readonly string[];
    };

export interface OptIrTranslationValidationInput {
  readonly original: OptIrInterpreterSlice;
  readonly replacement: OptIrInterpreterSlice;
  readonly validationContext: OptIrTranslationValidationContext;
  readonly memoryFactory?: (
    inputCase: OptIrTranslationValidationInputCase,
  ) => OptIrInterpreterMemory;
  readonly effectsFactory?: (
    inputCase: OptIrTranslationValidationInputCase,
  ) => OptIrInterpreterEffectTrace;
  readonly approvedNotApplicableReasons?: readonly string[];
}

export function validateOptIrEGraphTranslation(
  input: OptIrTranslationValidationInput,
): OptIrTranslationValidationResult {
  const originalCompleteness = validateOptIrSliceIsInterpreterComplete(input.original);
  const replacementCompleteness = validateOptIrSliceIsInterpreterComplete(input.replacement);
  const notApplicableReasons = stableReasons([
    ...(originalCompleteness.kind === "rejected" ? originalCompleteness.reasons : []),
    ...(replacementCompleteness.kind === "rejected" ? replacementCompleteness.reasons : []),
  ]);

  if (notApplicableReasons.length > 0) {
    const approved = new Set(input.approvedNotApplicableReasons ?? []);
    const unapprovedReasons = notApplicableReasons.filter((reason) => !approved.has(reason));
    if (unapprovedReasons.length > 0) {
      return {
        kind: "failed",
        reason: "unapproved-not-applicable-reason",
        disagreements: Object.freeze([]),
        unapprovedReasons: Object.freeze(unapprovedReasons),
      };
    }
    return {
      kind: "notApplicable",
      reasons: Object.freeze(notApplicableReasons),
    };
  }

  const inputSet = deriveOptIrTranslationValidationInputSet(input.validationContext);
  const disagreements: OptIrTranslationValidationDisagreement[] = [];

  for (const inputCase of inputSet) {
    const original = interpretOptIrSlice({
      slice: input.original,
      memory: input.memoryFactory?.(inputCase),
      effects: input.effectsFactory?.(inputCase),
    });
    const replacement = interpretOptIrSlice({
      slice: input.replacement,
      memory: input.memoryFactory?.(inputCase),
      effects: input.effectsFactory?.(inputCase),
    });

    if (stableResultKey(original) !== stableResultKey(replacement)) {
      disagreements.push(
        Object.freeze({
          stableKey: `translation-validation:${inputCase.stableKey}`,
          original,
          replacement,
        }),
      );
    }
  }

  if (disagreements.length > 0) {
    return {
      kind: "failed",
      reason: "interpreter-disagreement",
      disagreements: Object.freeze(disagreements),
    };
  }
  return { kind: "passed", inputSet };
}

export function deriveOptIrTranslationValidationInputSet(
  context: OptIrTranslationValidationContext,
): readonly OptIrTranslationValidationInputCase[] {
  const values = new Set<bigint>();
  for (const operand of context.operandTypes ?? []) {
    addTypeEdges(values, operand.type);
  }
  for (const constant of context.constants ?? []) {
    values.add(constant);
    values.add(constant - 1n);
    values.add(constant + 1n);
  }
  for (const rangeFact of context.rangeFacts ?? []) {
    values.add(rangeFact.minimum - 1n);
    values.add(rangeFact.minimum);
    values.add(rangeFact.maximum);
    values.add(rangeFact.maximum + 1n);
  }
  for (const bound of context.layoutBounds ?? []) {
    values.add(bound.start);
    values.add(bound.endExclusive - 1n);
    values.add(bound.endExclusive);
  }
  for (const mask of context.masks ?? []) {
    values.add(mask);
    values.add(mask & (mask - 1n));
  }

  const normalized = [...values].filter((value) => value >= 0n).sort(compareBigint);
  const stableValues = normalized.length === 0 ? [0n] : normalized;
  return Object.freeze([
    Object.freeze({
      stableKey: `case:0:${stableValues.join(",")}`,
      values: Object.freeze(stableValues),
    }),
  ]);
}

export function createFakeOptIrTranslationValidationMemory(input: {
  readonly regionValues: readonly (readonly [string, bigint])[];
  readonly valueType: OptIrType;
}): OptIrInterpreterMemory {
  const values = new Map(input.regionValues);
  return {
    load(access: OptIrMemoryAccessDescriptor) {
      const key = memoryKey(access);
      const value = values.get(key);
      if (value === undefined) {
        return { kind: "trap", reason: `fake-memory-missing:${key}` };
      }
      return { kind: "ok", value: { type: input.valueType, value } };
    },
    store(access: OptIrMemoryAccessDescriptor, value: OptIrRuntimeValue) {
      if (!("value" in value) || typeof value.value !== "bigint") {
        return { kind: "trap", reason: `fake-memory-invalid-store:${memoryKey(access)}` };
      }
      values.set(memoryKey(access), value.value);
      return { kind: "ok" };
    },
    snapshot() {
      return Object.freeze(
        [...values.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, value]) => Object.freeze([key, { type: input.valueType, value }] as const)),
      );
    },
  };
}

export function createFakeOptIrTranslationValidationEffects(): OptIrInterpreterEffectTrace {
  const events: string[] = [];
  return {
    record(event) {
      events.push(`${event.kind}:${event.region}:${event.byteOffset}:${event.byteWidth}`);
    },
    snapshot() {
      return Object.freeze(events.slice());
    },
  };
}

function addTypeEdges(values: Set<bigint>, type: OptIrType): void {
  if (type.kind === "boolean") {
    values.add(0n);
    values.add(1n);
    return;
  }
  if (type.kind !== "integer") {
    values.add(BigInt(optIrTypeStableKey(type).length));
    return;
  }
  const width = BigInt(type.width);
  const maximum = (1n << width) - 1n;
  values.add(0n);
  values.add(1n);
  values.add(maximum >> 1n);
  values.add((maximum >> 1n) + 1n);
  values.add(maximum);
}

function stableReasons(reasons: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(reasons)].sort());
}

function stableResultKey(result: OptIrInterpreterResult): string {
  if (result.kind === "trapped") {
    return `trapped:${result.reason}`;
  }
  return [
    "returned",
    result.values.map(stableRuntimeValueKey).join("|"),
    result.observations.memory
      .map(([key, value]) => `${key}=${stableRuntimeValueKey(value)}`)
      .join("|"),
    result.observations.effects.join("|"),
  ].join(":");
}

function stableRuntimeValueKey(value: OptIrRuntimeValue): string {
  if ("fields" in value) {
    return `fields(${value.fields.map(stableRuntimeValueKey).join(",")})`;
  }
  return `${optIrTypeStableKey(value.type)}=${String(value.value)}`;
}

function memoryKey(access: OptIrMemoryAccessDescriptor): string {
  return `${Number(access.region)}:${access.byteOffset}:${access.byteWidth}`;
}

function compareBigint(left: bigint, right: bigint): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
