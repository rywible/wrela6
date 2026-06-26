import type {
  CoreTypeId,
  DeviceSurfaceId,
  ImageProfileId,
  ParameterId,
  TargetId,
  TargetTypeId,
} from "../semantic/ids";
import type { WireEndian, WireIntegerEncoding, WireScalarEncoding } from "../shared/wire-layout";

export type { WireEndian, WireIntegerEncoding, WireScalarEncoding };
import type { LayoutBuilderResult } from "./builder-context";
import { layoutDiagnostic, type LayoutDiagnostic } from "./diagnostics";
import { targetLayoutOwnerKey } from "./layout-owners";
import type { TargetCallConventionId, TargetWireReadHelperId } from "./ids";
import type {
  LayoutAbiPointerProvenance,
  LayoutAbiValueShape,
  LayoutEnumFact,
  LayoutTypeFact,
  LayoutTypeKey,
  TargetLayoutFacts,
} from "./layout-program";
import { layoutTypeKeyFromPrimitiveRef } from "./target-facts";

export type AbiScalarKind = "integer" | "pointer" | "float" | "opaque";

export type LayoutPrimitiveKind =
  | "unit"
  | "bool"
  | "signedInteger"
  | "unsignedInteger"
  | "float"
  | "address"
  | "opaqueScalar"
  | "never";

export type LayoutPrimitiveTypeRef =
  | { readonly kind: "core"; readonly coreTypeId: CoreTypeId }
  | { readonly kind: "target"; readonly targetTypeId: TargetTypeId };

export interface LayoutPrimitiveTypeSpec<PrimitiveId> {
  readonly id: PrimitiveId;
  readonly sizeBytes: bigint;
  readonly alignmentBytes: bigint;
  readonly representation: LayoutPrimitiveKind;
  readonly bitWidth?: number;
  readonly abiScalarKind?: AbiScalarKind;
}

export interface LayoutPrimitiveTypeCatalog<PrimitiveId> {
  get(id: PrimitiveId): LayoutPrimitiveTypeSpec<PrimitiveId> | undefined;
  entries(): readonly LayoutPrimitiveTypeSpec<PrimitiveId>[];
}

export interface TargetDataModelFacts {
  readonly endian: "little" | "big";
  readonly addressableUnit: "byte";
  readonly pointerWidthBits: 32 | 64;
  readonly pointerSizeBytes: bigint;
  readonly pointerAlignmentBytes: bigint;
  readonly sizeType: LayoutPrimitiveTypeRef;
  readonly maximumObjectSizeBytes: bigint;
  readonly maximumAlignmentBytes: bigint;
}

export interface TargetValidatedBufferHandleLayout {
  readonly pointerType: LayoutPrimitiveTypeRef;
  readonly lengthType: LayoutPrimitiveTypeRef;
  readonly pointerFieldName: "__source_ptr";
  readonly lengthFieldName: "__source_len";
}

export interface LayoutDeviceSurfaceSpec {
  readonly deviceSurfaceId: DeviceSurfaceId;
  readonly representation:
    | { readonly kind: "zeroSizedCapability" }
    | { readonly kind: "targetHandle"; readonly type: LayoutPrimitiveTypeRef };
  readonly sourceOrigin?: string;
}

export interface LayoutDeviceSurfaceCatalog {
  get(deviceSurfaceId: DeviceSurfaceId): LayoutDeviceSurfaceSpec | undefined;
  entries(): readonly LayoutDeviceSurfaceSpec[];
}

export interface LayoutImageProfileArgumentSpec {
  readonly name: string;
  readonly type: LayoutPrimitiveTypeRef;
  readonly provenance: LayoutAbiPointerProvenance | "scalarFirmwareValue";
}

export type LayoutImageProfileResultSpec =
  | { readonly kind: "unit" }
  | { readonly kind: "value"; readonly type: LayoutPrimitiveTypeRef };

export interface LayoutImageProfileSpec {
  readonly profileId: ImageProfileId;
  readonly physicalEntryCallConvention: TargetCallConventionId;
  readonly physicalEntryArguments: readonly LayoutImageProfileArgumentSpec[];
  readonly physicalEntryResult: LayoutImageProfileResultSpec;
}

export interface LayoutImageProfileCatalog {
  get(profileId: ImageProfileId): LayoutImageProfileSpec | undefined;
  entries(): readonly LayoutImageProfileSpec[];
}

export interface LayoutWireReadHelperSpec {
  readonly helperId: TargetWireReadHelperId;
  readonly callConvention: TargetCallConventionId;
  readonly encoding: WireScalarEncoding;
  readonly resultType: LayoutPrimitiveTypeRef;
  readonly contract: "requiresLayoutReadRequirements";
}

export interface LayoutWireReadHelperCatalog {
  get(helperId: TargetWireReadHelperId): LayoutWireReadHelperSpec | undefined;
  entries(): readonly LayoutWireReadHelperSpec[];
}

export interface TargetEnumLayoutPolicy {
  readonly candidateTagTypes: readonly LayoutPrimitiveTypeRef[];
  readonly emptyEnumPolicy: "reject";
  readonly discriminantStart: bigint;
  readonly chooseTagType: "smallestUnsignedThatFits";
}

export type AbiClassificationUse =
  | { readonly kind: "receiver"; readonly mode: "observe" | "consume" }
  | {
      readonly kind: "parameter";
      readonly parameterId: ParameterId;
      readonly mode: "observe" | "consume";
    }
  | { readonly kind: "return" }
  | {
      readonly kind: "platformArgument";
      readonly index: number;
      readonly mode: "observe" | "consume";
    }
  | { readonly kind: "platformReturn" }
  | { readonly kind: "imageEntryArgument"; readonly index: number }
  | { readonly kind: "imageEntryReturn" };

export interface ClassifyAbiValueInput {
  readonly target: TargetLayoutFacts;
  readonly callConvention: TargetCallConventionId;
  readonly use: AbiClassificationUse;
  readonly type: LayoutTypeKey;
  readonly layout: LayoutTypeFact;
  readonly enumFact?: LayoutEnumFact;
}

export type ClassifyAbiValueResult =
  | { readonly kind: "ok"; readonly shape: LayoutAbiValueShape }
  | { readonly kind: "error"; readonly diagnostics: readonly LayoutDiagnostic[] };

export interface TargetAbiSurface {
  readonly sourceCallConvention: TargetCallConventionId;
  readonly platformCallConvention: TargetCallConventionId;
  readonly supportsVariadicCalls: false;
  classifyValue(input: ClassifyAbiValueInput): ClassifyAbiValueResult;
}

export interface LayoutTargetSurface {
  readonly targetId: TargetId;
  readonly dataModel: TargetDataModelFacts;
  readonly validatedBufferHandle: TargetValidatedBufferHandleLayout;
  readonly coreTypes: LayoutPrimitiveTypeCatalog<CoreTypeId>;
  readonly targetTypes: LayoutPrimitiveTypeCatalog<TargetTypeId>;
  readonly deviceSurfaces: LayoutDeviceSurfaceCatalog;
  readonly imageProfiles: LayoutImageProfileCatalog;
  readonly wireReadHelpers: LayoutWireReadHelperCatalog;
  readonly enumPolicy: TargetEnumLayoutPolicy;
  readonly abi: TargetAbiSurface;
}

export function targetDefinitionDiagnostic(
  target: LayoutTargetSurface,
  input: {
    readonly code: string;
    readonly message: string;
    readonly stableDetail: string;
    readonly sourceOrigin?: string;
  },
): LayoutDiagnostic {
  return layoutDiagnostic({
    severity: "error",
    code: input.code,
    message: input.message,
    ownerKey: String(targetLayoutOwnerKey(String(target.targetId))),
    rootCauseKey: "target-definition",
    stableDetail: input.stableDetail,
    ...(input.sourceOrigin !== undefined ? { sourceOrigin: input.sourceOrigin } : {}),
  });
}

function isPositivePowerOfTwo(value: bigint): boolean {
  if (value <= 0n) {
    return false;
  }
  return (value & (value - 1n)) === 0n;
}

function expectedPointerSizeBytes(pointerWidthBits: 32 | 64): bigint {
  return BigInt(pointerWidthBits / 8);
}

function primitiveSpecForRef(
  target: LayoutTargetSurface,
  ref: LayoutPrimitiveTypeRef,
): LayoutPrimitiveTypeSpec<CoreTypeId> | LayoutPrimitiveTypeSpec<TargetTypeId> | undefined {
  switch (ref.kind) {
    case "core":
      return target.coreTypes.get(ref.coreTypeId);
    case "target":
      return target.targetTypes.get(ref.targetTypeId);
    default: {
      const unreachable: never = ref;
      return unreachable;
    }
  }
}

function isValidPointerWidthBits(value: number): value is 32 | 64 {
  return value === 32 || value === 64;
}

function validateDataModel(target: LayoutTargetSurface, diagnostics: LayoutDiagnostic[]): void {
  const dataModel = target.dataModel;

  if (dataModel.addressableUnit !== "byte") {
    diagnostics.push(
      targetDefinitionDiagnostic(target, {
        code: "LAYOUT_INVALID_TARGET_DATA_MODEL",
        message: "layout target addressable unit must be byte",
        stableDetail: `addressableUnit:${dataModel.addressableUnit}`,
      }),
    );
  }

  if (!isValidPointerWidthBits(dataModel.pointerWidthBits)) {
    diagnostics.push(
      targetDefinitionDiagnostic(target, {
        code: "LAYOUT_INVALID_TARGET_DATA_MODEL",
        message: "layout target pointer width must be 32 or 64 bits",
        stableDetail: `pointerWidthBits:${String(dataModel.pointerWidthBits)}`,
      }),
    );
  }

  if (dataModel.endian !== "little" && dataModel.endian !== "big") {
    diagnostics.push(
      targetDefinitionDiagnostic(target, {
        code: "LAYOUT_INVALID_TARGET_DATA_MODEL",
        message: "layout target endian must be little or big",
        stableDetail: `endian:${String(dataModel.endian)}`,
      }),
    );
  }

  if (isValidPointerWidthBits(dataModel.pointerWidthBits)) {
    const expectedPointerSize = expectedPointerSizeBytes(dataModel.pointerWidthBits);
    if (dataModel.pointerSizeBytes !== expectedPointerSize) {
      diagnostics.push(
        targetDefinitionDiagnostic(target, {
          code: "LAYOUT_INVALID_TARGET_DATA_MODEL",
          message: "layout target pointer size must match pointer width",
          stableDetail: `pointerSizeBytes:${String(dataModel.pointerSizeBytes)}:expected:${String(expectedPointerSize)}`,
        }),
      );
    }
  }

  if (!isPositivePowerOfTwo(dataModel.pointerAlignmentBytes)) {
    diagnostics.push(
      targetDefinitionDiagnostic(target, {
        code: "LAYOUT_INVALID_TARGET_DATA_MODEL",
        message: "layout target pointer alignment must be a positive power of two",
        stableDetail: `pointerAlignmentBytes:${String(dataModel.pointerAlignmentBytes)}`,
      }),
    );
  }

  if (dataModel.maximumObjectSizeBytes < 0n) {
    diagnostics.push(
      targetDefinitionDiagnostic(target, {
        code: "LAYOUT_INVALID_TARGET_DATA_MODEL",
        message: "layout target maximum object size must be non-negative",
        stableDetail: `maximumObjectSizeBytes:${String(dataModel.maximumObjectSizeBytes)}`,
      }),
    );
  }

  if (
    dataModel.maximumAlignmentBytes <= 0n ||
    !isPositivePowerOfTwo(dataModel.maximumAlignmentBytes)
  ) {
    diagnostics.push(
      targetDefinitionDiagnostic(target, {
        code: "LAYOUT_INVALID_TARGET_DATA_MODEL",
        message: "layout target maximum alignment must be a positive power of two",
        stableDetail: `maximumAlignmentBytes:${String(dataModel.maximumAlignmentBytes)}`,
      }),
    );
  }
}

function validatePrimitiveSpec(
  target: LayoutTargetSurface,
  spec: LayoutPrimitiveTypeSpec<CoreTypeId> | LayoutPrimitiveTypeSpec<TargetTypeId>,
  catalog: "core" | "target",
): LayoutDiagnostic[] {
  const diagnostics: LayoutDiagnostic[] = [];
  const primitiveId = String(spec.id);
  const detailPrefix = `${catalog}:${primitiveId}`;

  if (spec.sizeBytes < 0n) {
    diagnostics.push(
      targetDefinitionDiagnostic(target, {
        code: "LAYOUT_INVALID_TARGET_PRIMITIVE",
        message: "layout target primitive size must be non-negative",
        stableDetail: `${detailPrefix}:sizeBytes:${String(spec.sizeBytes)}`,
      }),
    );
  }

  if (spec.alignmentBytes <= 0n || !isPositivePowerOfTwo(spec.alignmentBytes)) {
    diagnostics.push(
      targetDefinitionDiagnostic(target, {
        code: "LAYOUT_INVALID_TARGET_PRIMITIVE",
        message: "layout target primitive alignment must be a positive power of two",
        stableDetail: `${detailPrefix}:alignmentBytes:${String(spec.alignmentBytes)}`,
      }),
    );
  }

  if (spec.representation === "never") {
    if (spec.sizeBytes !== 0n || spec.alignmentBytes !== 1n) {
      diagnostics.push(
        targetDefinitionDiagnostic(target, {
          code: "LAYOUT_INVALID_TARGET_PRIMITIVE",
          message: "layout target Never primitive must be zero-sized with alignment 1",
          stableDetail: `${detailPrefix}:never-layout`,
        }),
      );
    }
  }

  if (spec.representation === "unit") {
    if (spec.sizeBytes !== 0n || spec.alignmentBytes !== 1n) {
      diagnostics.push(
        targetDefinitionDiagnostic(target, {
          code: "LAYOUT_INVALID_TARGET_PRIMITIVE",
          message: "layout target unit primitive must be zero-sized with alignment 1",
          stableDetail: `${detailPrefix}:unit-layout`,
        }),
      );
    }
  }

  if (spec.sizeBytes === 0n && spec.representation !== "never" && spec.representation !== "unit") {
    if (spec.alignmentBytes !== 1n) {
      diagnostics.push(
        targetDefinitionDiagnostic(target, {
          code: "LAYOUT_INVALID_TARGET_PRIMITIVE",
          message: "layout target zero-sized primitive must have alignment 1",
          stableDetail: `${detailPrefix}:zero-sized-alignment`,
        }),
      );
    }
  }

  if (spec.representation === "address") {
    const dataModel = target.dataModel;
    if (
      spec.sizeBytes !== dataModel.pointerSizeBytes ||
      spec.alignmentBytes !== dataModel.pointerAlignmentBytes
    ) {
      diagnostics.push(
        targetDefinitionDiagnostic(target, {
          code: "LAYOUT_INVALID_TARGET_PRIMITIVE",
          message: "layout target address primitive must match pointer size and alignment",
          stableDetail: `${detailPrefix}:address-pointer-mismatch`,
        }),
      );
    }
    if (spec.abiScalarKind !== "pointer") {
      diagnostics.push(
        targetDefinitionDiagnostic(target, {
          code: "LAYOUT_INVALID_TARGET_PRIMITIVE",
          message: "layout target address primitive must use pointer ABI scalar kind",
          stableDetail: `${detailPrefix}:address-abi-scalar`,
        }),
      );
    }
  }

  if (spec.representation === "float" && spec.abiScalarKind !== "float") {
    diagnostics.push(
      targetDefinitionDiagnostic(target, {
        code: "LAYOUT_INVALID_TARGET_PRIMITIVE",
        message: "layout target float primitive must use float ABI scalar kind",
        stableDetail: `${detailPrefix}:float-abi-scalar`,
      }),
    );
  }

  if (
    (spec.representation === "signedInteger" ||
      spec.representation === "unsignedInteger" ||
      spec.representation === "bool") &&
    spec.abiScalarKind !== undefined &&
    spec.abiScalarKind !== "integer"
  ) {
    diagnostics.push(
      targetDefinitionDiagnostic(target, {
        code: "LAYOUT_INVALID_TARGET_PRIMITIVE",
        message: "layout target integer primitive must use integer ABI scalar kind",
        stableDetail: `${detailPrefix}:integer-abi-scalar`,
      }),
    );
  }

  return diagnostics;
}

function validateEnumPolicy(target: LayoutTargetSurface, diagnostics: LayoutDiagnostic[]): void {
  const policy = target.enumPolicy;

  if (policy.emptyEnumPolicy !== "reject") {
    diagnostics.push(
      targetDefinitionDiagnostic(target, {
        code: "LAYOUT_INVALID_ENUM_POLICY",
        message: "layout target enum policy must reject empty enums",
        stableDetail: `emptyEnumPolicy:${policy.emptyEnumPolicy}`,
      }),
    );
  }

  if (policy.chooseTagType !== "smallestUnsignedThatFits") {
    diagnostics.push(
      targetDefinitionDiagnostic(target, {
        code: "LAYOUT_INVALID_ENUM_POLICY",
        message: "layout target enum policy must use smallestUnsignedThatFits tag selection",
        stableDetail: `chooseTagType:${policy.chooseTagType}`,
      }),
    );
  }

  if (policy.candidateTagTypes.length === 0) {
    diagnostics.push(
      targetDefinitionDiagnostic(target, {
        code: "LAYOUT_INVALID_ENUM_POLICY",
        message: "layout target enum policy must declare candidate tag types",
        stableDetail: "candidateTagTypes:empty",
      }),
    );
  }

  for (const candidate of policy.candidateTagTypes) {
    const spec = primitiveSpecForRef(target, candidate);
    if (spec === undefined) {
      diagnostics.push(
        targetDefinitionDiagnostic(target, {
          code: "LAYOUT_MISSING_PRIMITIVE_TYPE",
          message: "layout target enum candidate tag type is missing from primitive catalogs",
          stableDetail: `enum-candidate:${candidate.kind}:${String(candidate.kind === "core" ? candidate.coreTypeId : candidate.targetTypeId)}`,
        }),
      );
      continue;
    }
    if (spec.representation !== "unsignedInteger") {
      diagnostics.push(
        targetDefinitionDiagnostic(target, {
          code: "LAYOUT_INVALID_ENUM_POLICY",
          message: "layout target enum candidate tag type must be an unsigned integer primitive",
          stableDetail: `enum-candidate:${String(spec.id)}:${spec.representation}`,
        }),
      );
    }
  }
}

function validateValidatedBufferHandle(
  target: LayoutTargetSurface,
  diagnostics: LayoutDiagnostic[],
): void {
  const handle = target.validatedBufferHandle;

  if (handle.pointerFieldName !== "__source_ptr") {
    diagnostics.push(
      targetDefinitionDiagnostic(target, {
        code: "LAYOUT_INVALID_VALIDATED_BUFFER_HANDLE",
        message: "layout target validated-buffer pointer field must be __source_ptr",
        stableDetail: `pointerFieldName:${handle.pointerFieldName}`,
      }),
    );
  }

  if (handle.lengthFieldName !== "__source_len") {
    diagnostics.push(
      targetDefinitionDiagnostic(target, {
        code: "LAYOUT_INVALID_VALIDATED_BUFFER_HANDLE",
        message: "layout target validated-buffer length field must be __source_len",
        stableDetail: `lengthFieldName:${handle.lengthFieldName}`,
      }),
    );
  }

  for (const [role, ref] of [
    ["pointer", handle.pointerType] as const,
    ["length", handle.lengthType] as const,
  ]) {
    const spec = primitiveSpecForRef(target, ref);
    if (spec === undefined) {
      diagnostics.push(
        targetDefinitionDiagnostic(target, {
          code: "LAYOUT_MISSING_PRIMITIVE_TYPE",
          message: `layout target validated-buffer ${role} type is missing from primitive catalogs`,
          stableDetail: `validated-buffer-handle:${role}:${ref.kind}:${String(ref.kind === "core" ? ref.coreTypeId : ref.targetTypeId)}`,
        }),
      );
    }
  }
}

function resolveSizeTypeKey(
  target: LayoutTargetSurface,
  diagnostics: LayoutDiagnostic[],
): LayoutTypeKey | undefined {
  const ref = target.dataModel.sizeType;
  const spec = primitiveSpecForRef(target, ref);
  if (spec === undefined) {
    diagnostics.push(
      targetDefinitionDiagnostic(target, {
        code: "LAYOUT_MISSING_PRIMITIVE_TYPE",
        message: "layout target size type is missing from primitive catalogs",
        stableDetail: `sizeType:${ref.kind}:${String(ref.kind === "core" ? ref.coreTypeId : ref.targetTypeId)}`,
      }),
    );
    return undefined;
  }
  return layoutTypeKeyFromPrimitiveRef(ref);
}

export function validateLayoutTargetSurface(
  target: LayoutTargetSurface,
): LayoutBuilderResult<TargetLayoutFacts> {
  const ownerKey = targetLayoutOwnerKey(String(target.targetId));
  const diagnostics: LayoutDiagnostic[] = [];

  validateDataModel(target, diagnostics);

  for (const spec of target.coreTypes.entries()) {
    diagnostics.push(...validatePrimitiveSpec(target, spec, "core"));
  }
  for (const spec of target.targetTypes.entries()) {
    diagnostics.push(...validatePrimitiveSpec(target, spec, "target"));
  }

  validateEnumPolicy(target, diagnostics);
  validateValidatedBufferHandle(target, diagnostics);

  const sizeType = resolveSizeTypeKey(target, diagnostics);
  const hasError = diagnostics.some((diagnostic) => diagnostic.severity === "error");

  if (hasError || sizeType === undefined) {
    return {
      kind: "error",
      ownerKey,
      dependencies: [],
      diagnostics,
    };
  }

  const dataModel = target.dataModel;
  return {
    kind: "ok",
    ownerKey,
    dependencies: [],
    value: {
      targetId: target.targetId,
      endian: dataModel.endian,
      addressableUnit: dataModel.addressableUnit,
      pointerWidthBits: dataModel.pointerWidthBits,
      pointerSizeBytes: dataModel.pointerSizeBytes,
      pointerAlignmentBytes: dataModel.pointerAlignmentBytes,
      sizeType,
      maximumObjectSizeBytes: dataModel.maximumObjectSizeBytes,
      maximumAlignmentBytes: dataModel.maximumAlignmentBytes,
    },
    diagnostics,
  };
}
