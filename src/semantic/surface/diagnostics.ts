import type { SourceSpan, SourceText } from "../../frontend";
import type { ModuleId } from "../ids";
import { compareCodeUnitStrings } from "./deterministic-sort";

export type SemanticSurfaceDiagnosticCode =
  | "SURFACE_INVALID_TYPE_REFERENCE"
  | "SURFACE_NON_TYPE_REFERENCE"
  | "SURFACE_WRONG_GENERIC_ARGUMENT_COUNT"
  | "SURFACE_DUPLICATE_GENERIC_PARAMETER"
  | "SURFACE_INVALID_GENERIC_BOUND"
  | "SURFACE_INVALID_INTERFACE_CONSTRAINT"
  | "SURFACE_GENERIC_BOUND_CYCLE"
  | "SURFACE_RESOURCE_KIND_MISMATCH"
  | "SURFACE_INVALID_RECEIVER"
  | "SURFACE_INVALID_PARAMETER_MODE"
  | "SURFACE_INVALID_RETURN_TYPE"
  | "SURFACE_ILLEGAL_FUNCTION_MODIFIERS"
  | "SURFACE_ILLEGAL_PLATFORM_SHAPE"
  | "SURFACE_MISSING_PLATFORM_BINDING"
  | "SURFACE_PLATFORM_CATALOG_ENTRY_MISSING"
  | "SURFACE_PLATFORM_SIGNATURE_MISMATCH"
  | "SURFACE_PLATFORM_CONTRACT_NOT_EXACT"
  | "SURFACE_TARGET_UNAVAILABLE_PLATFORM_PRIMITIVE"
  | "SURFACE_MISSING_IMAGE_ROOT"
  | "SURFACE_AMBIGUOUS_IMAGE_ROOT"
  | "SURFACE_INVALID_IMAGE_ROOT_SELECTION"
  | "SURFACE_MALFORMED_DEVICES_SECTION"
  | "SURFACE_INVALID_IMAGE_DEVICE_TYPE"
  | "SURFACE_DUPLICATE_UNIQUE_EDGE_ROOT"
  | "SURFACE_TARGET_UNAVAILABLE_IMAGE_DEVICE"
  | "SURFACE_INVALID_IMAGE_ENTRY_SHAPE"
  | "SURFACE_INVALID_IMAGE_ENTRY_SIGNATURE"
  | "SURFACE_UNRESOLVED_DEFERRED_MEMBER"
  | "SURFACE_AMBIGUOUS_DEFERRED_MEMBER"
  | "SURFACE_INVALID_WIRE_ENCODING";

export interface DiagnosticRelatedInformation {
  readonly message: string;
  readonly span?: SourceSpan;
  readonly source?: SourceText;
}

export interface SemanticSurfaceDiagnosticOrder {
  readonly moduleId: ModuleId;
  readonly span: SourceSpan;
  readonly codeTieBreaker: string;
}

export interface SemanticSurfaceDiagnostic {
  readonly code: SemanticSurfaceDiagnosticCode;
  readonly message: string;
  readonly severity: "error";
  readonly source?: SourceText;
  readonly span?: SourceSpan;
  readonly relatedInformation?: readonly DiagnosticRelatedInformation[];
  readonly order: SemanticSurfaceDiagnosticOrder;
}

export function sortSemanticSurfaceDiagnostics(
  diagnostics: readonly SemanticSurfaceDiagnostic[],
): readonly SemanticSurfaceDiagnostic[] {
  return [...diagnostics].sort((diagA, diagB) => {
    const pathA = diagA.source?.name ?? "";
    const pathB = diagB.source?.name ?? "";
    const pathCmp = compareCodeUnitStrings(pathA, pathB);
    if (pathCmp !== 0) return pathCmp;

    const moduleCmp = (diagA.order.moduleId as number) - (diagB.order.moduleId as number);
    if (moduleCmp !== 0) return moduleCmp;

    const aStart = diagA.span?.start ?? 0;
    const bStart = diagB.span?.start ?? 0;
    if (aStart !== bStart) return aStart - bStart;

    const aEnd = diagA.span?.end ?? 0;
    const bEnd = diagB.span?.end ?? 0;
    if (aEnd !== bEnd) return aEnd - bEnd;

    const codeCmp = compareCodeUnitStrings(diagA.code, diagB.code);
    if (codeCmp !== 0) return codeCmp;

    const msgCmp = compareCodeUnitStrings(diagA.message, diagB.message);
    if (msgCmp !== 0) return msgCmp;

    return compareCodeUnitStrings(diagA.order.codeTieBreaker, diagB.order.codeTieBreaker);
  });
}

export interface InvalidTypeReferenceInput {
  readonly source: SourceText | undefined;
  readonly span: SourceSpan;
  readonly order: SemanticSurfaceDiagnosticOrder;
  readonly typeName: string;
  readonly relatedInformation?: readonly DiagnosticRelatedInformation[];
}

export function invalidTypeReference(input: InvalidTypeReferenceInput): SemanticSurfaceDiagnostic {
  const message =
    input.relatedInformation !== undefined && input.relatedInformation.length > 0
      ? `Ambiguous type reference '${input.typeName}'.`
      : `Invalid type reference '${input.typeName}'.`;
  return {
    code: "SURFACE_INVALID_TYPE_REFERENCE",
    message,
    severity: "error",
    source: input.source,
    span: input.span,
    order: input.order,
    ...(input.relatedInformation !== undefined
      ? { relatedInformation: input.relatedInformation }
      : {}),
  };
}

export interface PlatformPrimitiveSignatureMismatchInput {
  readonly source: SourceText | undefined;
  readonly span: SourceSpan;
  readonly order: SemanticSurfaceDiagnosticOrder;
  readonly functionName: string;
  readonly reason: string;
}

export function platformPrimitiveSignatureMismatch(
  input: PlatformPrimitiveSignatureMismatchInput,
): SemanticSurfaceDiagnostic {
  return {
    code: "SURFACE_PLATFORM_SIGNATURE_MISMATCH",
    message: `Platform primitive signature mismatch for '${input.functionName}': ${input.reason}.`,
    severity: "error",
    source: input.source,
    span: input.span,
    order: input.order,
  };
}

export function duplicateGenericParameter(
  name: string,
  span: SourceSpan,
  source: SourceText | undefined,
  order: SemanticSurfaceDiagnosticOrder,
): SemanticSurfaceDiagnostic {
  return {
    code: "SURFACE_DUPLICATE_GENERIC_PARAMETER",
    message: `Duplicate generic parameter '${name}'.`,
    severity: "error",
    source,
    span,
    order,
  };
}

export function invalidGenericBound(
  boundName: string,
  span: SourceSpan,
  source: SourceText | undefined,
  order: SemanticSurfaceDiagnosticOrder,
): SemanticSurfaceDiagnostic {
  return {
    code: "SURFACE_INVALID_GENERIC_BOUND",
    message: `Invalid generic bound '${boundName}'.`,
    severity: "error",
    source,
    span,
    order,
  };
}

export function nonTypeReference(
  name: string,
  span: SourceSpan,
  source: SourceText | undefined,
  order: SemanticSurfaceDiagnosticOrder,
): SemanticSurfaceDiagnostic {
  return {
    code: "SURFACE_NON_TYPE_REFERENCE",
    message: `'${name}' is not a type.`,
    severity: "error",
    source,
    span,
    order,
  };
}

export function wrongGenericArgumentCount(
  name: string,
  expected: number,
  actual: number,
  span: SourceSpan,
  source: SourceText | undefined,
  order: SemanticSurfaceDiagnosticOrder,
): SemanticSurfaceDiagnostic {
  return {
    code: "SURFACE_WRONG_GENERIC_ARGUMENT_COUNT",
    message: `Wrong number of generic arguments for '${name}': expected ${expected}, got ${actual}.`,
    severity: "error",
    source,
    span,
    order,
  };
}

export function invalidInterfaceConstraint(
  name: string,
  span: SourceSpan,
  source: SourceText | undefined,
  order: SemanticSurfaceDiagnosticOrder,
): SemanticSurfaceDiagnostic {
  return {
    code: "SURFACE_INVALID_INTERFACE_CONSTRAINT",
    message: `Invalid interface constraint '${name}'.`,
    severity: "error",
    source,
    span,
    order,
  };
}

export function genericBoundCycle(
  name: string,
  span: SourceSpan,
  source: SourceText | undefined,
  order: SemanticSurfaceDiagnosticOrder,
): SemanticSurfaceDiagnostic {
  return {
    code: "SURFACE_GENERIC_BOUND_CYCLE",
    message: `Generic bound cycle involving '${name}'.`,
    severity: "error",
    source,
    span,
    order,
  };
}

export function resourceKindMismatch(
  expected: string,
  actual: string,
  span: SourceSpan,
  source: SourceText | undefined,
  order: SemanticSurfaceDiagnosticOrder,
): SemanticSurfaceDiagnostic {
  return {
    code: "SURFACE_RESOURCE_KIND_MISMATCH",
    message: `Resource kind mismatch: expected '${expected}', got '${actual}'.`,
    severity: "error",
    source,
    span,
    order,
  };
}

export function invalidReceiver(
  details: string,
  span: SourceSpan,
  source: SourceText | undefined,
  order: SemanticSurfaceDiagnosticOrder,
): SemanticSurfaceDiagnostic {
  return {
    code: "SURFACE_INVALID_RECEIVER",
    message: `Invalid receiver: ${details}.`,
    severity: "error",
    source,
    span,
    order,
  };
}

export function invalidParameterMode(
  name: string,
  details: string,
  span: SourceSpan,
  source: SourceText | undefined,
  order: SemanticSurfaceDiagnosticOrder,
): SemanticSurfaceDiagnostic {
  return {
    code: "SURFACE_INVALID_PARAMETER_MODE",
    message: `Invalid parameter mode for '${name}': ${details}.`,
    severity: "error",
    source,
    span,
    order,
  };
}

export function invalidReturnType(
  details: string,
  span: SourceSpan,
  source: SourceText | undefined,
  order: SemanticSurfaceDiagnosticOrder,
): SemanticSurfaceDiagnostic {
  return {
    code: "SURFACE_INVALID_RETURN_TYPE",
    message: `Invalid return type: ${details}.`,
    severity: "error",
    source,
    span,
    order,
  };
}

export function illegalFunctionModifiers(
  details: string,
  span: SourceSpan,
  source: SourceText | undefined,
  order: SemanticSurfaceDiagnosticOrder,
): SemanticSurfaceDiagnostic {
  return {
    code: "SURFACE_ILLEGAL_FUNCTION_MODIFIERS",
    message: `Illegal function modifier combination: ${details}.`,
    severity: "error",
    source,
    span,
    order,
  };
}

export function illegalPlatformShape(
  details: string,
  span: SourceSpan,
  source: SourceText | undefined,
  order: SemanticSurfaceDiagnosticOrder,
): SemanticSurfaceDiagnostic {
  return {
    code: "SURFACE_ILLEGAL_PLATFORM_SHAPE",
    message: `Illegal platform function shape: ${details}.`,
    severity: "error",
    source,
    span,
    order,
  };
}

export function missingPlatformBinding(
  functionName: string,
  span: SourceSpan,
  source: SourceText | undefined,
  order: SemanticSurfaceDiagnosticOrder,
): SemanticSurfaceDiagnostic {
  return {
    code: "SURFACE_MISSING_PLATFORM_BINDING",
    message: `Missing platform binding for '${functionName}'.`,
    severity: "error",
    source,
    span,
    order,
  };
}

export function platformPrimitiveCatalogEntryMissing(
  primitiveId: string,
  functionName: string,
  span: SourceSpan,
  source: SourceText | undefined,
  order: SemanticSurfaceDiagnosticOrder,
): SemanticSurfaceDiagnostic {
  return {
    code: "SURFACE_PLATFORM_CATALOG_ENTRY_MISSING",
    message: `Platform primitive '${primitiveId}' not found in target catalog for '${functionName}'.`,
    severity: "error",
    source,
    span,
    order,
  };
}

export function platformContractNotExact(
  functionName: string,
  details: string,
  span: SourceSpan,
  source: SourceText | undefined,
  order: SemanticSurfaceDiagnosticOrder,
): SemanticSurfaceDiagnostic {
  return {
    code: "SURFACE_PLATFORM_CONTRACT_NOT_EXACT",
    message: `Platform contract for '${functionName}' is not exact: ${details}.`,
    severity: "error",
    source,
    span,
    order,
  };
}

export function targetUnavailablePlatformPrimitive(
  functionName: string,
  primitiveId: string,
  span: SourceSpan,
  source: SourceText | undefined,
  order: SemanticSurfaceDiagnosticOrder,
): SemanticSurfaceDiagnostic {
  return {
    code: "SURFACE_TARGET_UNAVAILABLE_PLATFORM_PRIMITIVE",
    message: `Platform primitive '${primitiveId}' is unavailable for the selected target in '${functionName}'.`,
    severity: "error",
    source,
    span,
    order,
  };
}

export function missingImageRoot(
  span: SourceSpan | undefined,
  source: SourceText | undefined,
  order: SemanticSurfaceDiagnosticOrder,
): SemanticSurfaceDiagnostic {
  return {
    code: "SURFACE_MISSING_IMAGE_ROOT",
    message: "No image declaration found.",
    severity: "error",
    source,
    span,
    order,
  };
}

export function ambiguousImageRoot(
  candidates: readonly string[],
  span: SourceSpan | undefined,
  source: SourceText | undefined,
  order: SemanticSurfaceDiagnosticOrder,
): SemanticSurfaceDiagnostic {
  return {
    code: "SURFACE_AMBIGUOUS_IMAGE_ROOT",
    message: `Multiple image declarations found: ${candidates.join(", ")}. Use an explicit selection.`,
    severity: "error",
    span,
    source,
    order,
  };
}

export function invalidImageRootSelection(
  details: string,
  span: SourceSpan | undefined,
  source: SourceText | undefined,
  order: SemanticSurfaceDiagnosticOrder,
): SemanticSurfaceDiagnostic {
  return {
    code: "SURFACE_INVALID_IMAGE_ROOT_SELECTION",
    message: `Invalid image root selection: ${details}.`,
    severity: "error",
    span,
    source,
    order,
  };
}

export function malformedDevicesSection(
  details: string,
  span: SourceSpan,
  source: SourceText | undefined,
  order: SemanticSurfaceDiagnosticOrder,
): SemanticSurfaceDiagnostic {
  return {
    code: "SURFACE_MALFORMED_DEVICES_SECTION",
    message: `Malformed devices section: ${details}.`,
    severity: "error",
    source,
    span,
    order,
  };
}

export function invalidImageDeviceType(
  fieldName: string,
  details: string,
  span: SourceSpan,
  source: SourceText | undefined,
  order: SemanticSurfaceDiagnosticOrder,
): SemanticSurfaceDiagnostic {
  return {
    code: "SURFACE_INVALID_IMAGE_DEVICE_TYPE",
    message: `Invalid image device type for '${fieldName}': ${details}.`,
    severity: "error",
    source,
    span,
    order,
  };
}

export function duplicateUniqueEdgeRoot(
  rootKey: string,
  fieldName: string,
  previousFieldName: string,
  span: SourceSpan,
  previousSpan: SourceSpan,
  source: SourceText | undefined,
  order: SemanticSurfaceDiagnosticOrder,
): SemanticSurfaceDiagnostic {
  return {
    code: "SURFACE_DUPLICATE_UNIQUE_EDGE_ROOT",
    message: `Duplicate unique edge root '${rootKey}' bound by '${fieldName}'.`,
    severity: "error",
    source,
    span,
    order,
    relatedInformation: [
      { message: `First bound by '${previousFieldName}'.`, span: previousSpan, source },
    ],
  };
}

export function targetUnavailableImageDevice(
  deviceName: string,
  details: string,
  span: SourceSpan,
  source: SourceText | undefined,
  order: SemanticSurfaceDiagnosticOrder,
): SemanticSurfaceDiagnostic {
  return {
    code: "SURFACE_TARGET_UNAVAILABLE_IMAGE_DEVICE",
    message: `Image device '${deviceName}' is unavailable: ${details}.`,
    severity: "error",
    source,
    span,
    order,
  };
}

export function invalidImageEntryShape(
  details: string,
  span: SourceSpan | undefined,
  source: SourceText | undefined,
  order: SemanticSurfaceDiagnosticOrder,
): SemanticSurfaceDiagnostic {
  return {
    code: "SURFACE_INVALID_IMAGE_ENTRY_SHAPE",
    message: `Invalid image entry shape: ${details}.`,
    severity: "error",
    span,
    source,
    order,
  };
}

export function invalidImageEntrySignature(
  functionName: string,
  details: string,
  span: SourceSpan,
  source: SourceText | undefined,
  order: SemanticSurfaceDiagnosticOrder,
): SemanticSurfaceDiagnostic {
  return {
    code: "SURFACE_INVALID_IMAGE_ENTRY_SIGNATURE",
    message: `Invalid entry signature for '${functionName}': ${details}.`,
    severity: "error",
    source,
    span,
    order,
  };
}

export function unresolvedDeferredMember(
  memberName: string,
  span: SourceSpan,
  source: SourceText | undefined,
  order: SemanticSurfaceDiagnosticOrder,
): SemanticSurfaceDiagnostic {
  return {
    code: "SURFACE_UNRESOLVED_DEFERRED_MEMBER",
    message: `Unresolved deferred member '${memberName}'.`,
    severity: "error",
    source,
    span,
    order,
  };
}

export function ambiguousDeferredMember(
  memberName: string,
  span: SourceSpan,
  source: SourceText | undefined,
  order: SemanticSurfaceDiagnosticOrder,
): SemanticSurfaceDiagnostic {
  return {
    code: "SURFACE_AMBIGUOUS_DEFERRED_MEMBER",
    message: `Ambiguous deferred member '${memberName}'.`,
    severity: "error",
    source,
    span,
    order,
  };
}

export function invalidWireEncoding(
  fieldName: string,
  details: string,
  span: SourceSpan,
  source: SourceText | undefined,
  order: SemanticSurfaceDiagnosticOrder,
): SemanticSurfaceDiagnostic {
  return {
    code: "SURFACE_INVALID_WIRE_ENCODING",
    message: `Invalid wire encoding for layout field '${fieldName}': ${details}.`,
    severity: "error",
    source,
    span,
    order,
  };
}
