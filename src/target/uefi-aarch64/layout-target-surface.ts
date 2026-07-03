import type {
  AbiClassificationUse,
  ClassifyAbiValueInput,
  ClassifyAbiValueResult,
  LayoutAbiLane,
  LayoutAbiPointerProvenance,
  LayoutAbiValueShape,
  LayoutImageProfileCatalog,
  LayoutImageProfileSpec,
  LayoutPrimitiveTypeCatalog,
  LayoutPrimitiveTypeSpec,
  LayoutTargetSurface,
  LayoutTypeFact,
  LayoutTypeKey,
  LayoutWireReadHelperCatalog,
  LayoutWireReadHelperSpec,
  TargetAbiSurface,
  TargetCallConventionId,
  TargetEnumLayoutPolicy,
  TargetWireReadHelperId,
} from "../../layout";
import {
  coreTypeId,
  imageProfileId,
  targetTypeId,
  type CoreTypeId,
  type TargetTypeId,
} from "../../semantic/ids";
import { canonicalUefiAArch64SemanticTargetSurface } from "./platform-catalog";
import type { UefiAArch64TargetDriverSurface } from "./target-driver-surface";

export function productionUefiAArch64LayoutTargetSurface(
  target: UefiAArch64TargetDriverSurface,
): LayoutTargetSurface {
  const coreTypes = primitiveCatalog(uefiLayoutCorePrimitiveTypeSpecs());
  const targetTypes = primitiveCatalog(uefiLayoutTargetPrimitiveTypeSpecs());
  return Object.freeze({
    targetId: canonicalUefiAArch64SemanticTargetSurface().targetId,
    dataModel: Object.freeze({
      endian: "little" as const,
      addressableUnit: "byte" as const,
      pointerWidthBits: 64 as const,
      pointerSizeBytes: 8n,
      pointerAlignmentBytes: 8n,
      sizeType: Object.freeze({ kind: "core" as const, coreTypeId: coreTypeId("usize") }),
      maximumObjectSizeBytes: 1_073_741_824n,
      maximumAlignmentBytes: 16n,
    }),
    validatedBufferHandle: Object.freeze({
      pointerType: Object.freeze({
        kind: "target" as const,
        targetTypeId: targetTypeId("uefi.Ptr"),
      }),
      lengthType: Object.freeze({ kind: "core" as const, coreTypeId: coreTypeId("usize") }),
      pointerFieldName: "__source_ptr" as const,
      lengthFieldName: "__source_len" as const,
    }),
    coreTypes,
    targetTypes,
    deviceSurfaces: emptyDeviceSurfaceCatalog(),
    imageProfiles: uefiLayoutImageProfileCatalog(target),
    wireReadHelpers: uefiLayoutWireReadHelperCatalog(),
    enumPolicy: uefiLayoutEnumPolicy(),
    abi: uefiAArch64LayoutAbiSurface(coreTypes, targetTypes),
  });
}

function uefiLayoutCorePrimitiveTypeSpecs(): readonly LayoutPrimitiveTypeSpec<CoreTypeId>[] {
  return Object.freeze([
    primitiveSpec(coreTypeId("Never"), 0n, 1n, "never"),
    primitiveSpec(coreTypeId("bool"), 1n, 1n, "bool", 8, "integer"),
    primitiveSpec(coreTypeId("u8"), 1n, 1n, "unsignedInteger", 8, "integer"),
    primitiveSpec(coreTypeId("u16"), 2n, 2n, "unsignedInteger", 16, "integer"),
    primitiveSpec(coreTypeId("u32"), 4n, 4n, "unsignedInteger", 32, "integer"),
    primitiveSpec(coreTypeId("u64"), 8n, 8n, "unsignedInteger", 64, "integer"),
    primitiveSpec(coreTypeId("usize"), 8n, 8n, "unsignedInteger", 64, "integer"),
  ]);
}

function uefiLayoutTargetPrimitiveTypeSpecs(): readonly LayoutPrimitiveTypeSpec<TargetTypeId>[] {
  return Object.freeze([
    primitiveSpec(targetTypeId("uefi.Ptr"), 8n, 8n, "address", 64, "pointer"),
    primitiveSpec(targetTypeId("uefi.Status"), 8n, 8n, "unsignedInteger", 64, "integer"),
    primitiveSpec(targetTypeId("uefi.U64"), 8n, 8n, "unsignedInteger", 64, "integer"),
    primitiveSpec(targetTypeId("uefi.Utf16Static"), 8n, 8n, "address", 64, "pointer"),
  ]);
}

function primitiveSpec<PrimitiveId>(
  id: PrimitiveId,
  sizeBytes: bigint,
  alignmentBytes: bigint,
  representation: LayoutPrimitiveTypeSpec<PrimitiveId>["representation"],
  bitWidth?: number,
  abiScalarKind?: LayoutPrimitiveTypeSpec<PrimitiveId>["abiScalarKind"],
): LayoutPrimitiveTypeSpec<PrimitiveId> {
  return Object.freeze({
    id,
    sizeBytes,
    alignmentBytes,
    representation,
    ...(bitWidth !== undefined ? { bitWidth } : {}),
    ...(abiScalarKind !== undefined ? { abiScalarKind } : {}),
  });
}

function primitiveCatalog<PrimitiveId>(
  specs: readonly LayoutPrimitiveTypeSpec<PrimitiveId>[],
): LayoutPrimitiveTypeCatalog<PrimitiveId> {
  const entries = Object.freeze(
    [...specs].sort((left, right) => String(left.id).localeCompare(String(right.id))),
  );
  const byId = new Map<PrimitiveId, LayoutPrimitiveTypeSpec<PrimitiveId>>(
    entries.map((spec) => [spec.id, spec]),
  );
  return Object.freeze({
    get(id: PrimitiveId): LayoutPrimitiveTypeSpec<PrimitiveId> | undefined {
      return byId.get(id);
    },
    entries(): readonly LayoutPrimitiveTypeSpec<PrimitiveId>[] {
      return entries;
    },
  });
}

function emptyDeviceSurfaceCatalog(): LayoutTargetSurface["deviceSurfaces"] {
  return Object.freeze({
    get: () => undefined,
    entries: () => Object.freeze([]),
  });
}

function uefiLayoutImageProfileCatalog(
  target: UefiAArch64TargetDriverSurface,
): LayoutImageProfileCatalog {
  const entries: readonly LayoutImageProfileSpec[] = Object.freeze([
    Object.freeze({
      profileId: imageProfileId("uefi"),
      physicalEntryCallConvention: target.entryProfile
        .entryCallConvention as TargetCallConventionId,
      physicalEntryArguments: Object.freeze([
        Object.freeze({
          name: target.entryProfile.imageHandleSourceKey,
          type: Object.freeze({ kind: "target" as const, targetTypeId: targetTypeId("uefi.Ptr") }),
          provenance: "firmware" as const,
        }),
        Object.freeze({
          name: target.entryProfile.systemTableSourceKey,
          type: Object.freeze({ kind: "target" as const, targetTypeId: targetTypeId("uefi.Ptr") }),
          provenance: "firmware" as const,
        }),
      ]),
      physicalEntryResult: Object.freeze({
        kind: "value" as const,
        type: Object.freeze({
          kind: "target" as const,
          targetTypeId: targetTypeId("uefi.Status"),
        }),
      }),
    }),
  ]);
  return Object.freeze({
    get: (profileId: LayoutImageProfileSpec["profileId"]) =>
      entries.find((entry) => entry.profileId === profileId),
    entries: () => entries,
  });
}

function uefiLayoutWireReadHelperCatalog(): LayoutWireReadHelperCatalog {
  const helpers: readonly LayoutWireReadHelperSpec[] = Object.freeze(
    [
      [coreTypeId("u8"), 8],
      [coreTypeId("u16"), 16],
      [coreTypeId("u32"), 32],
      [coreTypeId("u64"), 64],
    ].map(([type, bitWidth]) =>
      Object.freeze({
        helperId: `uefi.read.${String(type)}.le` as TargetWireReadHelperId,
        callConvention: "wrela-source" as TargetCallConventionId,
        encoding: Object.freeze({
          kind: "integer" as const,
          endian: "little" as const,
          bitWidth: bitWidth as number,
          signedness: "unsigned" as const,
        }),
        resultType: Object.freeze({ kind: "core" as const, coreTypeId: type as CoreTypeId }),
        contract: "requiresLayoutReadRequirements" as const,
      }),
    ),
  );
  return Object.freeze({
    get: (helperId: LayoutWireReadHelperSpec["helperId"]) =>
      helpers.find((helper) => helper.helperId === helperId),
    entries: () => helpers,
  });
}

function uefiLayoutEnumPolicy(): TargetEnumLayoutPolicy {
  return Object.freeze({
    candidateTagTypes: Object.freeze([
      Object.freeze({ kind: "core" as const, coreTypeId: coreTypeId("u8") }),
      Object.freeze({ kind: "core" as const, coreTypeId: coreTypeId("u16") }),
      Object.freeze({ kind: "core" as const, coreTypeId: coreTypeId("u32") }),
      Object.freeze({ kind: "core" as const, coreTypeId: coreTypeId("u64") }),
    ]),
    emptyEnumPolicy: "reject" as const,
    discriminantStart: 0n,
    chooseTagType: "smallestUnsignedThatFits" as const,
  });
}

function uefiAArch64LayoutAbiSurface(
  coreTypes: LayoutPrimitiveTypeCatalog<CoreTypeId>,
  targetTypes: LayoutPrimitiveTypeCatalog<TargetTypeId>,
): TargetAbiSurface {
  return Object.freeze({
    sourceCallConvention: "wrela-source" as TargetCallConventionId,
    platformCallConvention: "uefi-aapcs64" as TargetCallConventionId,
    supportsVariadicCalls: false as const,
    classifyValue(input: ClassifyAbiValueInput): ClassifyAbiValueResult {
      return classifyUefiAArch64AbiValue(input, coreTypes, targetTypes);
    },
  });
}

function classifyUefiAArch64AbiValue(
  input: ClassifyAbiValueInput,
  coreTypes: LayoutPrimitiveTypeCatalog<CoreTypeId>,
  targetTypes: LayoutPrimitiveTypeCatalog<TargetTypeId>,
): ClassifyAbiValueResult {
  const layout = input.layout;
  if (layout.representation.kind === "never") {
    return classificationOk({ kind: "none", reason: "never", proofCarrying: false });
  }
  if (layout.representation.kind === "zeroSized") {
    return classificationOk({
      kind: "none",
      reason: layout.representation.reason === "capabilityToken" ? "zeroSizedCapability" : "unit",
      proofCarrying: layout.representation.reason === "capabilityToken",
    });
  }
  if (layout.representation.kind === "enum") {
    if (input.enumFact === undefined) {
      return classificationOk(indirectShape(input.type, layout, input.use));
    }
    const tagLayout = primitiveLayoutFactForType(input.enumFact.tagType, coreTypes, targetTypes);
    return tagLayout === undefined
      ? classificationOk(indirectShape(input.type, layout, input.use))
      : classifyUefiAArch64AbiValue(
          { ...input, type: input.enumFact.tagType, layout: tagLayout, enumFact: undefined },
          coreTypes,
          targetTypes,
        );
  }
  if (layout.representation.kind === "primitive") {
    switch (layout.representation.primitive) {
      case "unit":
        return classificationOk({ kind: "none", reason: "unit", proofCarrying: false });
      case "never":
        return classificationOk({ kind: "none", reason: "never", proofCarrying: false });
      case "bool":
      case "unsignedInteger":
        return classificationOk(integerShape(layout, "unsigned", "none"));
      case "signedInteger":
        return classificationOk(integerShape(layout, "signed", "sign"));
      case "address":
        return classificationOk(pointerShape(input.use));
      case "float":
        return classificationOk(floatShape(layout));
      case "opaqueScalar":
        return classificationOk(opaqueShape(layout));
    }
  }
  return classificationOk(
    layout.sizeBytes <= 16n ? opaqueShape(layout) : indirectShape(input.type, layout, input.use),
  );
}

function classificationOk(shape: LayoutAbiValueShape): ClassifyAbiValueResult {
  return Object.freeze({ kind: "ok" as const, shape });
}

function integerShape(
  layout: LayoutTypeFact,
  signedness: "signed" | "unsigned",
  extension: "sign" | "zero" | "none",
): LayoutAbiValueShape {
  return Object.freeze({
    kind: "direct" as const,
    lanes: Object.freeze([
      Object.freeze({
        kind: "integer" as const,
        sizeBytes: layout.sizeBytes,
        alignmentBytes: layout.alignmentBytes,
        signedness,
        extension,
      }),
    ]),
  });
}

function pointerShape(use: AbiClassificationUse): LayoutAbiValueShape {
  return Object.freeze({
    kind: "direct" as const,
    lanes: Object.freeze([
      Object.freeze({
        kind: "pointer" as const,
        sizeBytes: 8n,
        alignmentBytes: 8n,
        provenance: pointerProvenanceForUse(use),
      }),
    ]),
  });
}

function floatShape(layout: LayoutTypeFact): LayoutAbiValueShape {
  return Object.freeze({
    kind: "direct" as const,
    lanes: Object.freeze([
      Object.freeze({
        kind: "float" as const,
        sizeBytes: layout.sizeBytes,
        alignmentBytes: layout.alignmentBytes,
        format: layout.sizeBytes === 4n ? "ieee754-binary32" : "ieee754-binary64",
      }),
    ]),
  });
}

function opaqueShape(layout: LayoutTypeFact): LayoutAbiValueShape {
  const lanes: LayoutAbiLane[] = [];
  let remaining = layout.sizeBytes;
  while (remaining > 0n) {
    const sizeBytes = remaining >= 8n ? 8n : remaining;
    lanes.push(
      Object.freeze({
        kind: "opaque" as const,
        sizeBytes,
        alignmentBytes: sizeBytes < 8n ? sizeBytes : 8n,
      }),
    );
    remaining -= sizeBytes;
  }
  return Object.freeze({ kind: "direct" as const, lanes: Object.freeze(lanes) });
}

function indirectShape(
  pointee: LayoutTypeKey,
  _layout: LayoutTypeFact,
  use: AbiClassificationUse,
): LayoutAbiValueShape {
  return Object.freeze({
    kind: "indirect" as const,
    pointer: Object.freeze({ widthBits: 64 as const, sizeBytes: 8n, alignmentBytes: 8n }),
    pointee,
    ownership: indirectOwnershipForUse(use),
  });
}

function primitiveLayoutFactForType(
  type: LayoutTypeKey,
  coreTypes: LayoutPrimitiveTypeCatalog<CoreTypeId>,
  targetTypes: LayoutPrimitiveTypeCatalog<TargetTypeId>,
): LayoutTypeFact | undefined {
  const spec =
    type.kind === "core"
      ? coreTypes.get(type.coreTypeId)
      : type.kind === "target"
        ? targetTypes.get(type.targetTypeId)
        : undefined;
  if (spec === undefined) return undefined;
  return Object.freeze({
    key: type,
    sizeBytes: spec.sizeBytes,
    alignmentBytes: spec.alignmentBytes,
    strideBytes:
      spec.sizeBytes === 0n
        ? 0n
        : ((spec.sizeBytes + spec.alignmentBytes - 1n) / spec.alignmentBytes) * spec.alignmentBytes,
    representation: Object.freeze({ kind: "primitive" as const, primitive: spec.representation }),
  });
}

function pointerProvenanceForUse(use: AbiClassificationUse): LayoutAbiPointerProvenance {
  switch (use.kind) {
    case "imageEntryArgument":
    case "imageEntryReturn":
      return "firmware";
    case "platformArgument":
    case "platformReturn":
      return "platformPrimitive";
    case "receiver":
    case "parameter":
    case "return":
      return "ordinaryAddress";
  }
}

function indirectOwnershipForUse(
  use: AbiClassificationUse,
): "borrowed" | "calleeAllocated" | "callerAllocated" {
  switch (use.kind) {
    case "receiver":
    case "parameter":
    case "platformArgument":
      return use.mode === "observe" ? "borrowed" : "callerAllocated";
    case "return":
    case "platformReturn":
    case "imageEntryArgument":
    case "imageEntryReturn":
      return "callerAllocated";
  }
}
