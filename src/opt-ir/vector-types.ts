import {
  optIrRequireLaneCount,
  type OptIrScalarType,
  type OptIrVectorMaskType,
  type OptIrVectorType,
} from "./types";

export type OptIrInactiveLaneBehavior = "passthrough" | "zero" | "undef";

export interface OptIrMaskedVectorOperationTypeRule {
  readonly resultType: OptIrVectorType;
  readonly maskType: OptIrVectorMaskType;
  readonly inactiveLaneBehavior: OptIrInactiveLaneBehavior;
  readonly requiresPassthroughValue: boolean;
}

export function optIrVectorType(laneType: OptIrScalarType, laneCount: number): OptIrVectorType {
  return {
    kind: "vector",
    laneType,
    laneCount: optIrRequireLaneCount(laneCount),
  };
}

export function vectorMaskType(laneCount: number): OptIrVectorMaskType {
  return {
    kind: "vectorMask",
    laneCount: optIrRequireLaneCount(laneCount),
  };
}

export function optIrMaskedVectorOperationTypeRule(input: {
  readonly resultType: OptIrVectorType;
  readonly maskType: OptIrVectorMaskType;
  readonly inactiveLaneBehavior: OptIrInactiveLaneBehavior;
}): OptIrMaskedVectorOperationTypeRule {
  if (input.resultType.laneCount !== input.maskType.laneCount) {
    throw new RangeError("masked vector result and mask lane counts must match.");
  }

  return {
    resultType: input.resultType,
    maskType: input.maskType,
    inactiveLaneBehavior: input.inactiveLaneBehavior,
    requiresPassthroughValue: input.inactiveLaneBehavior === "passthrough",
  };
}
