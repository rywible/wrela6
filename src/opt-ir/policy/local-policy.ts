export type OptIrPolicyEffectBoundaryKind =
  | "pure"
  | "readonly"
  | "localMutation"
  | "runtime"
  | "platform"
  | "externalUnknown";

export interface OptIrPolicyFeatureVector {
  readonly operationCount?: number;
  readonly estimatedByteSize?: number;
  readonly loopDepth?: number;
  readonly knownColdStructuralContext?: boolean;
  readonly externalRootReachable?: boolean;
  readonly callbackReachable?: boolean;
  readonly effectBoundaryKind?: OptIrPolicyEffectBoundaryKind;
  readonly regionKind?: string;
  readonly regionVolatility?: string;
  readonly estimatedLiveScalarValues?: number;
  readonly estimatedLiveVectorValues?: number;
  readonly availableTargetFeatures?: readonly string[];
  readonly factAnswers?: readonly OptIrPolicyFactAnswer[];
}

export interface OptIrPolicyFactAnswer {
  readonly factKey: string;
  readonly answer: "known" | "unknown" | "contradiction";
  readonly uncertainty: "none" | "conservative" | "missingFact";
}

export function policyFeatureVectorForTest(
  input: Record<string, unknown>,
): OptIrPolicyFeatureVector {
  return optIrPolicyFeatureVector(input);
}

export function optIrPolicyFeatureVector(input: Record<string, unknown>): OptIrPolicyFeatureVector {
  validatePolicyFeatureInput(input);
  const vector: OptIrPolicyFeatureVector = {
    ...(input.operationCount === undefined
      ? {}
      : { operationCount: featureInteger(input.operationCount, "operationCount") }),
    ...(input.estimatedByteSize === undefined
      ? {}
      : { estimatedByteSize: featureInteger(input.estimatedByteSize, "estimatedByteSize") }),
    ...(input.loopDepth === undefined
      ? {}
      : { loopDepth: featureInteger(input.loopDepth, "loopDepth") }),
    ...(input.knownColdStructuralContext === undefined
      ? {}
      : {
          knownColdStructuralContext: featureBoolean(
            input.knownColdStructuralContext,
            "knownColdStructuralContext",
          ),
        }),
    ...(input.externalRootReachable === undefined
      ? {}
      : {
          externalRootReachable: featureBoolean(
            input.externalRootReachable,
            "externalRootReachable",
          ),
        }),
    ...(input.callbackReachable === undefined
      ? {}
      : { callbackReachable: featureBoolean(input.callbackReachable, "callbackReachable") }),
    ...(input.effectBoundaryKind === undefined
      ? {}
      : { effectBoundaryKind: effectBoundaryKind(input.effectBoundaryKind) }),
    ...(input.regionKind === undefined
      ? {}
      : { regionKind: featureString(input.regionKind, "regionKind") }),
    ...(input.regionVolatility === undefined
      ? {}
      : { regionVolatility: featureString(input.regionVolatility, "regionVolatility") }),
    ...(input.estimatedLiveScalarValues === undefined
      ? {}
      : {
          estimatedLiveScalarValues: featureInteger(
            input.estimatedLiveScalarValues,
            "estimatedLiveScalarValues",
          ),
        }),
    ...(input.estimatedLiveVectorValues === undefined
      ? {}
      : {
          estimatedLiveVectorValues: featureInteger(
            input.estimatedLiveVectorValues,
            "estimatedLiveVectorValues",
          ),
        }),
    ...(input.availableTargetFeatures === undefined
      ? {}
      : { availableTargetFeatures: sortStrings(input.availableTargetFeatures) }),
    ...(input.factAnswers === undefined ? {} : { factAnswers: sortFactAnswers(input.factAnswers) }),
  };
  return Object.freeze(vector);
}

function validatePolicyFeatureInput(input: Record<string, unknown>): void {
  for (const key of Object.keys(input)) {
    if (!ALLOWED_POLICY_FEATURE_KEYS.has(key)) {
      rejectForbiddenPolicyFeature(key);
    }
  }
}

function rejectForbiddenPolicyFeature(key: string): never {
  if (key === "wallClockMs") {
    throw new Error("wall-clock time is not an OptIR policy feature");
  }
  const forbidden = new Set([
    "hostCpuCounters",
    "scorecardBaseline",
    "benchmarkLabel",
    "previousSuccessfulCompilationChoice",
    "sourceName",
  ]);
  if (forbidden.has(key)) {
    throw new Error(`${key} is not an OptIR policy feature`);
  }
  throw new Error(`${key} is not a recognized OptIR policy feature`);
}

function sortStrings(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    throw new Error("availableTargetFeatures must be a deterministic string list");
  }
  if (!value.every((entry) => typeof entry === "string" && entry.length > 0)) {
    throw new Error("availableTargetFeatures must be a deterministic string list");
  }
  return Object.freeze([...value].sort());
}

function sortFactAnswers(value: unknown): readonly OptIrPolicyFactAnswer[] {
  if (!Array.isArray(value)) {
    throw new Error("factAnswers must be a deterministic fact-answer list");
  }
  if (!value.every(isPolicyFactAnswer)) {
    throw new Error("factAnswers must be a deterministic fact-answer list");
  }
  return Object.freeze(
    value
      .map((answer) => Object.freeze({ ...answer }))
      .sort((left, right) => left.factKey.localeCompare(right.factKey)),
  );
}

function isPolicyFactAnswer(value: unknown): value is OptIrPolicyFactAnswer {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as {
    readonly factKey?: unknown;
    readonly answer?: unknown;
    readonly uncertainty?: unknown;
  };
  return (
    typeof candidate.factKey === "string" &&
    candidate.factKey.length > 0 &&
    (candidate.answer === "known" ||
      candidate.answer === "unknown" ||
      candidate.answer === "contradiction") &&
    (candidate.uncertainty === "none" ||
      candidate.uncertainty === "conservative" ||
      candidate.uncertainty === "missingFact")
  );
}

const ALLOWED_POLICY_FEATURE_KEYS = new Set([
  "operationCount",
  "estimatedByteSize",
  "loopDepth",
  "knownColdStructuralContext",
  "externalRootReachable",
  "callbackReachable",
  "effectBoundaryKind",
  "regionKind",
  "regionVolatility",
  "estimatedLiveScalarValues",
  "estimatedLiveVectorValues",
  "availableTargetFeatures",
  "factAnswers",
]);

const EFFECT_BOUNDARY_KINDS = new Set<string>([
  "pure",
  "readonly",
  "localMutation",
  "runtime",
  "platform",
  "externalUnknown",
]);

function featureInteger(value: unknown, key: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`${key} must be a non-negative integer policy feature`);
  }
  return value as number;
}

function featureBoolean(value: unknown, key: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${key} must be a boolean policy feature`);
  }
  return value;
}

function featureString(value: unknown, key: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${key} must be a non-empty string policy feature`);
  }
  return value;
}

function effectBoundaryKind(value: unknown): OptIrPolicyEffectBoundaryKind {
  if (typeof value !== "string" || !EFFECT_BOUNDARY_KINDS.has(value)) {
    throw new Error("effectBoundaryKind must be a known static policy feature");
  }
  return value as OptIrPolicyEffectBoundaryKind;
}
