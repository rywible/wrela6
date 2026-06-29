export interface StaticTripLoop {
  readonly tripCount: number;
  readonly bodyOperationCount: number;
  readonly isStaticTripStructure: boolean;
}

export type BoundedUnrollDecision =
  | {
      readonly kind: "accepted";
      readonly unrolledIterations: number;
      readonly estimatedGrowth: number;
    }
  | { readonly kind: "denied"; readonly reason: "dynamic-trip-structure" | "unroll-budget" };

export function decideBoundedUnroll(input: {
  readonly loop: StaticTripLoop;
  readonly maxUnrollFactor: number;
  readonly remainingBudget: number;
}): BoundedUnrollDecision {
  if (!input.loop.isStaticTripStructure) {
    return Object.freeze({ kind: "denied", reason: "dynamic-trip-structure" });
  }
  const estimatedGrowth = input.loop.tripCount * input.loop.bodyOperationCount;
  if (input.loop.tripCount > input.maxUnrollFactor || estimatedGrowth > input.remainingBudget) {
    return Object.freeze({ kind: "denied", reason: "unroll-budget" });
  }
  return Object.freeze({
    kind: "accepted",
    unrolledIterations: input.loop.tripCount,
    estimatedGrowth,
  });
}
