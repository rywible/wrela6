import type { MonoFunctionInstance, MonomorphizedHirProgram } from "../mono/mono-hir";
import type { MonoCheckedType } from "../mono/mono-hir";
import type { ImageProfileId } from "../semantic/ids";
import { imageProfileId } from "../semantic/ids";
import { checkedTypeFingerprint } from "../semantic/surface/type-model";
import type { MonoInstanceId } from "../mono/ids";
import type { LayoutBuilderResult } from "./builder-context";
import { layoutDiagnostic, type LayoutDiagnostic } from "./diagnostics";
import { imageEntryFacetOwnerKey, imageOwnerKey } from "./layout-owners";
import type { LayoutTypeResolver } from "./layout-type-resolver";
import type {
  LayoutAbiValueShape,
  LayoutEnumFact,
  LayoutEnumFactTable,
  LayoutImageEntryAbiFact,
  LayoutImageEntryThunkConversion,
  LayoutTypeFactTable,
  LayoutTypeKey,
  TargetLayoutFacts,
} from "./layout-program";
import { seedPrimitiveTypeFacts } from "./primitive-layout";
import { classifySourceAbiParameter, classifySourceAbiReturn } from "./source-function-abi";
import type {
  ClassifyAbiValueInput,
  LayoutImageProfileArgumentSpec,
  LayoutImageProfileSpec,
  LayoutPrimitiveTypeRef,
  LayoutTargetSurface,
} from "./target-layout";
import { layoutDeterministicTable, layoutTypeKeyString } from "./type-key";
import { lookupLayoutForTypeKey } from "./abi-type-layout";
import { buildLayoutTypeResolutionTable } from "./layout-type-resolution";
import { normalizeTargetFactsFromSurface } from "./target-facts";

export interface ComputeImageEntryAbiFactInput {
  readonly program: MonomorphizedHirProgram;
  readonly target: LayoutTargetSurface;
  readonly profileId?: ImageProfileId;
  readonly targetFacts?: TargetLayoutFacts;
  readonly types?: LayoutTypeFactTable;
  readonly enums?: LayoutEnumFactTable;
  readonly resolver?: LayoutTypeResolver;
}

export interface ComputeImageEntryAbiFactValue {
  readonly fact: LayoutImageEntryAbiFact;
}

export interface ClassifyPhysicalImageEntryInput {
  readonly target: LayoutTargetSurface;
  readonly targetFacts: TargetLayoutFacts;
  readonly profile: LayoutImageProfileSpec;
  readonly types: LayoutTypeFactTable;
}

export interface ClassifyPhysicalImageEntryValue {
  readonly arguments: readonly LayoutAbiValueShape[];
  readonly result: LayoutAbiValueShape;
}

export interface ClassifySourceImageEntryInput {
  readonly target: LayoutTargetSurface;
  readonly targetFacts: TargetLayoutFacts;
  readonly entryFunction: MonoFunctionInstance;
  readonly types: LayoutTypeFactTable;
  readonly enums: LayoutEnumFactTable;
  readonly resolver: LayoutTypeResolver;
}

export interface ClassifySourceImageEntryValue {
  readonly arguments: readonly LayoutAbiValueShape[];
  readonly returnValue: LayoutAbiValueShape;
}

export interface BuildImageEntryThunkConversionsInput {
  readonly profile: LayoutImageProfileSpec;
  readonly physicalEntryArguments: readonly LayoutImageProfileArgumentSpec[];
  readonly sourceEntryArguments: readonly LayoutAbiValueShape[];
  readonly entryFunction: MonoFunctionInstance;
}

function imageEntryRootCauseKey(profileId: ImageProfileId): string {
  return `profile:${String(profileId)}`;
}

function imageEntryDiagnostic(
  imageInstanceId: string,
  profileId: ImageProfileId,
  targetId: string,
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
    sourceOrigin: input.sourceOrigin,
    ownerKey: String(imageOwnerKey(imageInstanceId as MonoInstanceId)),
    rootCauseKey: imageEntryRootCauseKey(profileId),
    stableDetail: input.stableDetail,
  });
}

function layoutTypeKeyFromRef(ref: LayoutPrimitiveTypeRef): LayoutTypeKey {
  switch (ref.kind) {
    case "core":
      return { kind: "core", coreTypeId: ref.coreTypeId };
    case "target":
      return { kind: "target", targetTypeId: ref.targetTypeId };
    default: {
      const unreachable: never = ref;
      return unreachable;
    }
  }
}

function buildImageEntryTypeResolver(program: MonomorphizedHirProgram): LayoutTypeResolver {
  const table = buildLayoutTypeResolutionTable(program).table;
  return {
    get(type: MonoCheckedType) {
      if (type.kind === "core") {
        return { kind: "core", coreTypeId: type.coreTypeId };
      }
      if (type.kind === "target") {
        return { kind: "target", targetTypeId: type.targetTypeId };
      }
      const resolution = table.getByFingerprint(checkedTypeFingerprint(type));
      if (resolution === undefined) {
        return undefined;
      }
      return resolution.key;
    },
    getByFingerprint(fingerprint: string) {
      const resolution = table.getByFingerprint(fingerprint);
      if (resolution === undefined) {
        return undefined;
      }
      return resolution.key;
    },
  };
}

function layoutAbiValueShapeStableDetail(shape: LayoutAbiValueShape): string {
  switch (shape.kind) {
    case "none":
      return `none:${shape.reason}:${shape.proofCarrying}`;
    case "direct":
      return `direct:${shape.lanes.map((lane) => `${lane.kind}:${String(lane.sizeBytes)}`).join(",")}`;
    case "indirect":
      return `indirect:${layoutTypeKeyString(shape.pointee)}:${shape.ownership}`;
    default: {
      const unreachable: never = shape;
      return unreachable;
    }
  }
}

function layoutAbiValueShapesEqual(left: LayoutAbiValueShape, right: LayoutAbiValueShape): boolean {
  return layoutAbiValueShapeStableDetail(left) === layoutAbiValueShapeStableDetail(right);
}

function validateImageEntryReturnCompatibility(input: {
  readonly physical: LayoutAbiValueShape;
  readonly source: LayoutAbiValueShape;
}): LayoutDiagnostic | undefined {
  if (layoutAbiValueShapesEqual(input.physical, input.source)) {
    return undefined;
  }
  if (
    input.physical.kind === "none" &&
    input.physical.reason === "unit" &&
    input.source.kind === "none" &&
    input.source.reason === "never"
  ) {
    return undefined;
  }
  if (directIntegerReturnCompatibleWithNever(input.physical, input.source)) {
    return undefined;
  }
  if (directIntegerReturnCompatible(input.physical, input.source)) {
    return undefined;
  }
  return layoutDiagnostic({
    severity: "error",
    code: "LAYOUT_ABI_CLASSIFICATION_FAILED",
    message: "Source image entry return shape is incompatible with the physical profile result.",
    ownerKey: String(imageEntryFacetOwnerKey("source")),
    rootCauseKey: "image-entry",
    stableDetail: `physical:${layoutAbiValueShapeStableDetail(input.physical)}:source:${layoutAbiValueShapeStableDetail(input.source)}`,
  });
}

function directIntegerReturnCompatibleWithNever(
  physical: LayoutAbiValueShape,
  source: LayoutAbiValueShape,
): boolean {
  if (source.kind !== "none" || source.reason !== "never") return false;
  if (physical.kind !== "direct" || physical.lanes.length !== 1) return false;
  return physical.lanes[0]?.kind === "integer";
}

function directIntegerReturnCompatible(
  physical: LayoutAbiValueShape,
  source: LayoutAbiValueShape,
): boolean {
  if (physical.kind !== "direct" || source.kind !== "direct") return false;
  if (physical.lanes.length !== 1 || source.lanes.length !== 1) return false;
  const physicalLane = physical.lanes[0]!;
  const sourceLane = source.lanes[0]!;
  return (
    physicalLane.kind === "integer" &&
    sourceLane.kind === "integer" &&
    sourceLane.sizeBytes <= physicalLane.sizeBytes
  );
}

function emptyEnumFactTable(): LayoutEnumFactTable {
  const entries: LayoutEnumFact[] = [];
  return layoutDeterministicTable({
    entries,
    keyOf: (entry) => entry.owner,
    keyString: layoutTypeKeyString,
  });
}

function classifyAbiValue(
  target: LayoutTargetSurface,
  input: ClassifyAbiValueInput,
): { readonly shape?: LayoutAbiValueShape; readonly diagnostics: readonly LayoutDiagnostic[] } {
  const result = target.abi.classifyValue(input);
  if (result.kind === "error") {
    return { diagnostics: result.diagnostics };
  }
  return { shape: result.shape, diagnostics: [] };
}

function resolveSelectedProfileId(
  target: LayoutTargetSurface,
  profileId: ImageProfileId | undefined,
): ImageProfileId | undefined {
  if (profileId !== undefined) {
    return profileId;
  }
  const profiles = target.imageProfiles.entries();
  if (profiles.length === 1) {
    return profiles[0]!.profileId;
  }
  const uefiProfile = target.imageProfiles.get(imageProfileId("uefi"));
  return uefiProfile?.profileId;
}

function classifyPhysicalProfileArgument(
  input: ClassifyPhysicalImageEntryInput,
  argument: LayoutImageProfileArgumentSpec,
  index: number,
): { readonly shape?: LayoutAbiValueShape; readonly diagnostics: readonly LayoutDiagnostic[] } {
  const typeKey = layoutTypeKeyFromRef(argument.type);
  const resolved = lookupLayoutForTypeKey(typeKey, input.types, emptyEnumFactTable());
  if (resolved === undefined) {
    return {
      diagnostics: [
        layoutDiagnostic({
          severity: "error",
          code: "LAYOUT_ABI_CLASSIFICATION_FAILED",
          message: "Missing layout fact for physical image entry argument classification.",
          ownerKey: String(imageEntryFacetOwnerKey("physical")),
          rootCauseKey: "image-entry",
          stableDetail: layoutTypeKeyString(typeKey),
        }),
      ],
    };
  }

  return classifyAbiValue(input.target, {
    target: input.targetFacts,
    callConvention: input.profile.physicalEntryCallConvention,
    use: { kind: "imageEntryArgument", index },
    type: typeKey,
    layout: resolved.layout,
    ...(resolved.enumFact !== undefined ? { enumFact: resolved.enumFact } : {}),
  });
}

function classifyPhysicalProfileResult(input: ClassifyPhysicalImageEntryInput): {
  readonly shape?: LayoutAbiValueShape;
  readonly diagnostics: readonly LayoutDiagnostic[];
} {
  const resultSpec = input.profile.physicalEntryResult;
  switch (resultSpec.kind) {
    case "unit":
      return {
        shape: {
          kind: "none",
          reason: "unit",
          proofCarrying: false,
        },
        diagnostics: [],
      };
    case "value": {
      const typeKey = layoutTypeKeyFromRef(resultSpec.type);
      const resolved = lookupLayoutForTypeKey(typeKey, input.types, emptyEnumFactTable());
      if (resolved === undefined) {
        return {
          diagnostics: [
            layoutDiagnostic({
              severity: "error",
              code: "LAYOUT_ABI_CLASSIFICATION_FAILED",
              message: "Missing layout fact for physical image entry result classification.",
              ownerKey: String(imageEntryFacetOwnerKey("physical")),
              rootCauseKey: "image-entry",
              stableDetail: layoutTypeKeyString(typeKey),
            }),
          ],
        };
      }
      return classifyAbiValue(input.target, {
        target: input.targetFacts,
        callConvention: input.profile.physicalEntryCallConvention,
        use: { kind: "imageEntryReturn" },
        type: typeKey,
        layout: resolved.layout,
        ...(resolved.enumFact !== undefined ? { enumFact: resolved.enumFact } : {}),
      });
    }
    default: {
      const unreachable: never = resultSpec;
      return {
        diagnostics: [
          layoutDiagnostic({
            severity: "error",
            code: "LAYOUT_ABI_CLASSIFICATION_FAILED",
            message: `Unsupported physical image entry result spec: ${String(unreachable)}`,
            ownerKey: String(imageEntryFacetOwnerKey("physical")),
            rootCauseKey: "image-entry",
            stableDetail: "unsupported-result-spec",
          }),
        ],
      };
    }
  }
}

export function classifyPhysicalImageEntry(input: ClassifyPhysicalImageEntryInput): {
  readonly value?: ClassifyPhysicalImageEntryValue;
  readonly diagnostics: readonly LayoutDiagnostic[];
} {
  const diagnostics: LayoutDiagnostic[] = [];
  const arguments_: LayoutAbiValueShape[] = [];

  for (const [index, argument] of input.profile.physicalEntryArguments.entries()) {
    const classified = classifyPhysicalProfileArgument(input, argument, index);
    diagnostics.push(...classified.diagnostics);
    if (classified.shape === undefined) {
      return { diagnostics };
    }
    arguments_.push(classified.shape);
  }

  const classifiedResult = classifyPhysicalProfileResult(input);
  diagnostics.push(...classifiedResult.diagnostics);
  if (classifiedResult.shape === undefined) {
    return { diagnostics };
  }

  return {
    value: {
      arguments: arguments_,
      result: classifiedResult.shape,
    },
    diagnostics,
  };
}

export function classifySourceImageEntry(input: ClassifySourceImageEntryInput): {
  readonly value?: ClassifySourceImageEntryValue;
  readonly diagnostics: readonly LayoutDiagnostic[];
} {
  const diagnostics: LayoutDiagnostic[] = [];
  const arguments_: LayoutAbiValueShape[] = [];

  for (const parameter of input.entryFunction.signature.parameters) {
    const typeKey = input.resolver.get(parameter.type);
    if (typeKey === undefined) {
      diagnostics.push(
        layoutDiagnostic({
          severity: "error",
          code: "LAYOUT_ABI_CLASSIFICATION_FAILED",
          message: "Missing layout type key for source image entry argument classification.",
          ownerKey: String(imageEntryFacetOwnerKey("source")),
          rootCauseKey: "image-entry",
          stableDetail: `missing-type-key:${parameter.name}`,
        }),
      );
      return { diagnostics };
    }

    const resolved = lookupLayoutForTypeKey(typeKey, input.types, input.enums);
    if (resolved === undefined) {
      diagnostics.push(
        layoutDiagnostic({
          severity: "error",
          code: "LAYOUT_ABI_CLASSIFICATION_FAILED",
          message: "Missing layout fact for source image entry argument classification.",
          ownerKey: String(imageEntryFacetOwnerKey("source")),
          rootCauseKey: "image-entry",
          stableDetail: layoutTypeKeyString(typeKey),
        }),
      );
      return { diagnostics };
    }

    const classified = classifySourceAbiParameter({
      target: input.target,
      targetFacts: input.targetFacts,
      parameterId: parameter.parameterId,
      mode: parameter.mode,
      type: typeKey,
      layout: resolved.layout,
      ...(resolved.enumFact !== undefined ? { enumFact: resolved.enumFact } : {}),
      sourceOrigin: input.entryFunction.sourceOrigin,
    });
    diagnostics.push(...classified.diagnostics);
    if (classified.fact === undefined) {
      return { diagnostics };
    }
    arguments_.push(classified.fact.shape);
  }

  const returnTypeKey = input.resolver.get(input.entryFunction.signature.returnType);
  if (returnTypeKey === undefined) {
    diagnostics.push(
      layoutDiagnostic({
        severity: "error",
        code: "LAYOUT_ABI_CLASSIFICATION_FAILED",
        message: "Missing layout type key for source image entry return classification.",
        ownerKey: String(imageEntryFacetOwnerKey("source")),
        rootCauseKey: "image-entry",
        stableDetail: "missing-return-type-key",
      }),
    );
    return { diagnostics };
  }

  const returnResolved = lookupLayoutForTypeKey(returnTypeKey, input.types, input.enums);
  if (returnResolved === undefined) {
    diagnostics.push(
      layoutDiagnostic({
        severity: "error",
        code: "LAYOUT_ABI_CLASSIFICATION_FAILED",
        message: "Missing layout fact for source image entry return classification.",
        ownerKey: String(imageEntryFacetOwnerKey("source")),
        rootCauseKey: "image-entry",
        stableDetail: layoutTypeKeyString(returnTypeKey),
      }),
    );
    return { diagnostics };
  }

  const classifiedReturn = classifySourceAbiReturn({
    target: input.target,
    targetFacts: input.targetFacts,
    type: returnTypeKey,
    layout: returnResolved.layout,
    ...(returnResolved.enumFact !== undefined ? { enumFact: returnResolved.enumFact } : {}),
    sourceOrigin: input.entryFunction.sourceOrigin,
  });
  diagnostics.push(...classifiedReturn.diagnostics);
  if (classifiedReturn.fact === undefined) {
    return { diagnostics };
  }

  return {
    value: {
      arguments: arguments_,
      returnValue: classifiedReturn.fact.shape,
    },
    diagnostics,
  };
}

function isCompilerMaterializedProofCapability(shape: LayoutAbiValueShape): boolean {
  return shape.kind === "none" && shape.proofCarrying;
}

export function buildImageEntryThunkConversions(
  input: BuildImageEntryThunkConversionsInput,
): readonly LayoutImageEntryThunkConversion[] {
  const conversions: LayoutImageEntryThunkConversion[] = [];
  const mappedSourceParameterIndices = new Set<number>();
  let sourceParameterIndex = 0;

  for (const [physicalIndex, physicalArgument] of input.physicalEntryArguments.entries()) {
    if (physicalArgument.name !== "firmwareArgument") {
      continue;
    }

    const sourceShape = input.sourceEntryArguments[sourceParameterIndex];
    if (sourceShape === undefined) {
      continue;
    }

    const sourceParameter = input.entryFunction.signature.parameters[sourceParameterIndex];
    conversions.push({
      source: "firmwareArgument",
      targetParameterIndex: physicalIndex,
      ...(sourceParameter !== undefined
        ? { sourceEntryParameterId: sourceParameter.parameterId }
        : {}),
      shape: sourceShape,
    });
    mappedSourceParameterIndices.add(sourceParameterIndex);
    sourceParameterIndex += 1;
  }

  for (let index = 0; index < input.sourceEntryArguments.length; index += 1) {
    const shape = input.sourceEntryArguments[index]!;
    if (isCompilerMaterializedProofCapability(shape)) {
      continue;
    }
    if (mappedSourceParameterIndices.has(index)) {
      continue;
    }
    const sourceParameter = input.entryFunction.signature.parameters[index];
    conversions.push({
      source: "compilerInitializedCapability",
      targetParameterIndex: index,
      ...(sourceParameter !== undefined
        ? { sourceEntryParameterId: sourceParameter.parameterId }
        : {}),
      shape,
    });
  }

  return conversions;
}

export function computeImageEntryAbiFact(
  input: ComputeImageEntryAbiFactInput,
): LayoutBuilderResult<ComputeImageEntryAbiFactValue> {
  const image = input.program.image;
  const ownerKey = imageOwnerKey(image.instanceId);
  const targetFacts = input.targetFacts ?? normalizeTargetFactsFromSurface(input.target);
  const selectedProfileId = resolveSelectedProfileId(input.target, input.profileId);

  if (selectedProfileId === undefined) {
    return {
      kind: "error",
      ownerKey,
      dependencies: [{ ownerKey, reason: "abi" }],
      diagnostics: [
        layoutDiagnostic({
          severity: "error",
          code: "LAYOUT_MISSING_IMAGE_PROFILE",
          message: "No target image profile is available for image entry ABI classification.",
          ownerKey: String(imageOwnerKey(image.instanceId)),
          rootCauseKey: "profile:unknown",
          stableDetail: `${String(targetFacts.targetId)}:unknown`,
        }),
      ],
    };
  }

  const profile = input.target.imageProfiles.get(selectedProfileId);
  if (profile === undefined) {
    return {
      kind: "error",
      ownerKey,
      dependencies: [{ ownerKey, reason: "abi" }],
      diagnostics: [
        imageEntryDiagnostic(
          String(image.instanceId),
          selectedProfileId,
          String(targetFacts.targetId),
          {
            code: "LAYOUT_MISSING_IMAGE_PROFILE",
            message: "Missing target image profile for the selected image entry boundary.",
            stableDetail: `${String(targetFacts.targetId)}:${String(selectedProfileId)}`,
            sourceOrigin: image.sourceOrigin,
          },
        ),
      ],
    };
  }

  if (image.entryFunctionInstanceId === undefined) {
    return {
      kind: "error",
      ownerKey,
      dependencies: [{ ownerKey, reason: "abi" }],
      diagnostics: [
        layoutDiagnostic({
          severity: "error",
          code: "LAYOUT_MISSING_IMAGE_ENTRY",
          message: "Mono image has no entry function for image entry ABI classification.",
          ownerKey: String(imageOwnerKey(image.instanceId)),
          rootCauseKey: imageEntryRootCauseKey(selectedProfileId),
          stableDetail: `${String(targetFacts.targetId)}:${String(selectedProfileId)}:missing-entry`,
          sourceOrigin: image.sourceOrigin,
        }),
      ],
    };
  }

  const entryFunction = input.program.functions.get(image.entryFunctionInstanceId);
  if (entryFunction === undefined) {
    return {
      kind: "error",
      ownerKey,
      dependencies: [{ ownerKey, reason: "abi" }],
      diagnostics: [
        layoutDiagnostic({
          severity: "error",
          code: "LAYOUT_MISSING_IMAGE_ENTRY",
          message:
            "Missing monomorphized entry function instance for image entry ABI classification.",
          ownerKey: String(imageOwnerKey(image.instanceId)),
          rootCauseKey: imageEntryRootCauseKey(selectedProfileId),
          stableDetail: `${String(image.entryFunctionInstanceId)}:missing-instance`,
          sourceOrigin: image.sourceOrigin,
        }),
      ],
    };
  }

  const primitiveResult =
    input.types === undefined ? seedPrimitiveTypeFacts(input.target) : undefined;
  const types =
    input.types ?? (primitiveResult?.kind === "ok" ? primitiveResult.value.types : undefined);
  if (types === undefined) {
    return {
      kind: "error",
      ownerKey,
      dependencies: [{ ownerKey, reason: "abi" }],
      diagnostics: primitiveResult?.diagnostics ?? [
        layoutDiagnostic({
          severity: "error",
          code: "LAYOUT_ABI_CLASSIFICATION_FAILED",
          message: "Missing primitive layout facts for image entry ABI classification.",
          ownerKey: String(imageOwnerKey(image.instanceId)),
          rootCauseKey: imageEntryRootCauseKey(selectedProfileId),
          stableDetail: "missing-primitive-facts",
        }),
      ],
    };
  }

  let resolver = input.resolver;
  if (resolver === undefined) {
    resolver = buildImageEntryTypeResolver(input.program);
  }

  const enums = input.enums ?? emptyEnumFactTable();
  const diagnostics: LayoutDiagnostic[] = [];

  const physical = classifyPhysicalImageEntry({
    target: input.target,
    targetFacts,
    profile,
    types,
  });
  diagnostics.push(...physical.diagnostics);
  if (physical.value === undefined) {
    return {
      kind: "error",
      ownerKey,
      dependencies: [{ ownerKey, reason: "abi" }],
      diagnostics,
    };
  }

  const source = classifySourceImageEntry({
    target: input.target,
    targetFacts,
    entryFunction,
    types,
    enums,
    resolver,
  });
  diagnostics.push(...source.diagnostics);
  if (source.value === undefined) {
    return {
      kind: "error",
      ownerKey,
      dependencies: [{ ownerKey, reason: "abi" }],
      diagnostics,
    };
  }

  const returnCompatibility = validateImageEntryReturnCompatibility({
    physical: physical.value.result,
    source: source.value.returnValue,
  });
  if (returnCompatibility !== undefined) {
    diagnostics.push(returnCompatibility);
    return {
      kind: "error",
      ownerKey,
      dependencies: [{ ownerKey, reason: "abi" }],
      diagnostics,
    };
  }

  const thunkConversions = buildImageEntryThunkConversions({
    profile,
    physicalEntryArguments: profile.physicalEntryArguments,
    sourceEntryArguments: source.value.arguments,
    entryFunction,
  });

  const fact: LayoutImageEntryAbiFact = {
    imageInstanceId: image.instanceId,
    entryFunctionInstanceId: image.entryFunctionInstanceId,
    profileId: selectedProfileId,
    physicalProfile: profile,
    physicalEntryArguments: physical.value.arguments,
    sourceEntryArguments: source.value.arguments,
    sourceEntryReturn: source.value.returnValue,
    thunkConversions,
    result: physical.value.result,
    physicalCallConvention: profile.physicalEntryCallConvention,
    sourceCallConvention: input.target.abi.sourceCallConvention,
    sourceOrigin: image.sourceOrigin,
  };

  return {
    kind: "ok",
    ownerKey,
    dependencies: [{ ownerKey, reason: "abi" }],
    value: { fact },
    diagnostics,
  };
}
