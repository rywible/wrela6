import {
  optIrOperationId,
  type OptIrFunctionId,
  type OptIrOperationId,
  type OptIrRewriteRegionId,
  type OptimizationPassId,
} from "./ids";

export type OptIrPassCreatedIdRole =
  | "replacementOperation"
  | "temporaryValue"
  | "derivedFact"
  | "splitBlock"
  | "clonedRegion";

export interface OptIrPassIdNamespaceInput {
  readonly optimizationProfileVersion: string;
  readonly pipelineIndex: number;
  readonly passId: OptimizationPassId;
  readonly functionId: OptIrFunctionId;
  readonly rewriteRegionId: OptIrRewriteRegionId;
  readonly creationRole: OptIrPassCreatedIdRole;
}

export interface OptIrPassIdNamespace extends OptIrPassIdNamespaceInput {
  readonly key: string;
}

export function optIrPassIdNamespace(input: OptIrPassIdNamespaceInput): OptIrPassIdNamespace {
  if (input.optimizationProfileVersion.length === 0) {
    throw new RangeError("optimizationProfileVersion must be non-empty.");
  }
  if (!Number.isInteger(input.pipelineIndex) || input.pipelineIndex < 0) {
    throw new RangeError(
      `pipelineIndex must be a non-negative integer, got ${input.pipelineIndex}.`,
    );
  }
  const key = [
    `profile:${input.optimizationProfileVersion}`,
    `pipeline:${input.pipelineIndex}`,
    `pass:${input.passId}`,
    `function:${input.functionId}`,
    `rewriteRegion:${input.rewriteRegionId}`,
    `role:${input.creationRole}`,
  ].join("/");

  return { ...input, key };
}

export function optIrOperationIdFromNamespace(
  _namespace: OptIrPassIdNamespace,
  ordinal: number,
): OptIrOperationId {
  return optIrOperationId(ordinal);
}
