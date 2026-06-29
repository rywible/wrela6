export type OptIrProgramId = number & { readonly __brand: "OptIrProgramId" };
export type OptIrOriginId = number & { readonly __brand: "OptIrOriginId" };
export type OptIrFunctionId = number & { readonly __brand: "OptIrFunctionId" };
export type OptIrBlockId = number & { readonly __brand: "OptIrBlockId" };
export type OptIrRegionId = number & { readonly __brand: "OptIrRegionId" };
export type OptIrRewriteRegionId = number & { readonly __brand: "OptIrRewriteRegionId" };
export type OptIrEdgeId = number & { readonly __brand: "OptIrEdgeId" };
export type OptIrValueId = number & { readonly __brand: "OptIrValueId" };
export type OptIrConstantId = number & { readonly __brand: "OptIrConstantId" };
export type OptIrOperationId = number & { readonly __brand: "OptIrOperationId" };
export type OptIrCallId = number & { readonly __brand: "OptIrCallId" };
export type OptIrFactId = number & { readonly __brand: "OptIrFactId" };
export type OptIrPathCertificateId = number & {
  readonly __brand: "OptIrPathCertificateId";
};
export type OptIrCfgEditId = number & { readonly __brand: "OptIrCfgEditId" };
export type OptIrMemoryVersionId = number & { readonly __brand: "OptIrMemoryVersionId" };
export type OptIrAliasClassId = number & { readonly __brand: "OptIrAliasClassId" };
export type OptIrCanonicalFormId = number & { readonly __brand: "OptIrCanonicalFormId" };

export type OptIrTypeRuleId = string & { readonly __brand: "OptIrTypeRuleId" };
export type OptIrEffectRuleId = string & { readonly __brand: "OptIrEffectRuleId" };
export type OptIrSemanticsRuleId = string & { readonly __brand: "OptIrSemanticsRuleId" };
export type OptIrInterpreterRuleId = string & { readonly __brand: "OptIrInterpreterRuleId" };
export type OptimizationPassId = string & { readonly __brand: "OptimizationPassId" };

function denseId(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer, got ${value}.`);
  }
  return value;
}

function stringId(value: string, label: string): string {
  if (value.length === 0) {
    throw new RangeError(`${label} must be non-empty.`);
  }
  return value;
}

export function optIrProgramId(value: number): OptIrProgramId {
  return denseId(value, "OptIrProgramId") as OptIrProgramId;
}

export function optIrOriginId(value: number): OptIrOriginId {
  return denseId(value, "OptIrOriginId") as OptIrOriginId;
}

export function optIrFunctionId(value: number): OptIrFunctionId {
  return denseId(value, "OptIrFunctionId") as OptIrFunctionId;
}

export function optIrBlockId(value: number): OptIrBlockId {
  return denseId(value, "OptIrBlockId") as OptIrBlockId;
}

export function optIrRegionId(value: number): OptIrRegionId {
  return denseId(value, "OptIrRegionId") as OptIrRegionId;
}

export function optIrRewriteRegionId(value: number): OptIrRewriteRegionId {
  return denseId(value, "OptIrRewriteRegionId") as OptIrRewriteRegionId;
}

export function optIrEdgeId(value: number): OptIrEdgeId {
  return denseId(value, "OptIrEdgeId") as OptIrEdgeId;
}

export function optIrValueId(value: number): OptIrValueId {
  return denseId(value, "OptIrValueId") as OptIrValueId;
}

export function optIrConstantId(value: number): OptIrConstantId {
  return denseId(value, "OptIrConstantId") as OptIrConstantId;
}

export function optIrOperationId(value: number): OptIrOperationId {
  return denseId(value, "OptIrOperationId") as OptIrOperationId;
}

export function optIrCallId(value: number): OptIrCallId {
  return denseId(value, "OptIrCallId") as OptIrCallId;
}

export function optIrFactId(value: number): OptIrFactId {
  return denseId(value, "OptIrFactId") as OptIrFactId;
}

export function optIrPathCertificateId(value: number): OptIrPathCertificateId {
  return denseId(value, "OptIrPathCertificateId") as OptIrPathCertificateId;
}

export function optIrCfgEditId(value: number): OptIrCfgEditId {
  return denseId(value, "OptIrCfgEditId") as OptIrCfgEditId;
}

export function optIrMemoryVersionId(value: number): OptIrMemoryVersionId {
  return denseId(value, "OptIrMemoryVersionId") as OptIrMemoryVersionId;
}

export function optIrAliasClassId(value: number): OptIrAliasClassId {
  return denseId(value, "OptIrAliasClassId") as OptIrAliasClassId;
}

export function optIrCanonicalFormId(value: number): OptIrCanonicalFormId {
  return denseId(value, "OptIrCanonicalFormId") as OptIrCanonicalFormId;
}

export function optIrTypeRuleId(value: string): OptIrTypeRuleId {
  return stringId(value, "OptIrTypeRuleId") as OptIrTypeRuleId;
}

export function optIrEffectRuleId(value: string): OptIrEffectRuleId {
  return stringId(value, "OptIrEffectRuleId") as OptIrEffectRuleId;
}

export function optIrSemanticsRuleId(value: string): OptIrSemanticsRuleId {
  return stringId(value, "OptIrSemanticsRuleId") as OptIrSemanticsRuleId;
}

export function optIrInterpreterRuleId(value: string): OptIrInterpreterRuleId {
  return stringId(value, "OptIrInterpreterRuleId") as OptIrInterpreterRuleId;
}

export function optimizationPassId(value: string): OptimizationPassId {
  return stringId(value, "OptimizationPassId") as OptimizationPassId;
}
