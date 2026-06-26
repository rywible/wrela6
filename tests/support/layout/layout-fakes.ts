import type { CoreTypeId, TargetTypeId } from "../../../src/semantic/ids";
import { coreTypeId, targetId, targetTypeId } from "../../../src/semantic/ids";
import { layoutDiagnostic } from "../../../src/layout/diagnostics";
import type { TargetCallConventionId, TargetWireReadHelperId } from "../../../src/layout/ids";
import type {
  LayoutAbiLane,
  LayoutAbiPointerProvenance,
  LayoutAbiPointerShape,
  LayoutAbiValueShape,
  LayoutTypeFact,
  LayoutTypeKey,
  TargetLayoutFacts,
} from "../../../src/layout/layout-program";
import type {
  AbiClassificationUse,
  ClassifyAbiValueInput,
  ClassifyAbiValueResult,
  LayoutDeviceSurfaceCatalog,
  LayoutDeviceSurfaceSpec,
  LayoutImageProfileCatalog,
  LayoutImageProfileSpec,
  LayoutPrimitiveTypeCatalog,
  LayoutPrimitiveTypeSpec,
  LayoutTargetSurface,
  LayoutWireReadHelperCatalog,
  LayoutWireReadHelperSpec,
  TargetAbiSurface,
  TargetDataModelFacts,
  TargetEnumLayoutPolicy,
  TargetValidatedBufferHandleLayout,
} from "../../../src/layout/target-layout";

export function targetCallConventionId(value: string): TargetCallConventionId {
  return value as TargetCallConventionId;
}

export function pointerShape64(): LayoutAbiPointerShape {
  return {
    widthBits: 64,
    sizeBytes: 8n,
    alignmentBytes: 8n,
  };
}

export function layoutDataModelFake(
  overrides: Partial<TargetDataModelFacts> = {},
): TargetDataModelFacts {
  return {
    endian: "little",
    addressableUnit: "byte",
    pointerWidthBits: 64,
    pointerSizeBytes: 8n,
    pointerAlignmentBytes: 8n,
    sizeType: { kind: "core", coreTypeId: coreTypeId("usize") },
    maximumObjectSizeBytes: 1_073_741_824n,
    maximumAlignmentBytes: 16n,
    ...overrides,
  };
}

export function validatedBufferHandleLayoutFake(
  overrides: Partial<TargetValidatedBufferHandleLayout> = {},
): TargetValidatedBufferHandleLayout {
  return {
    pointerType: { kind: "target", targetTypeId: targetTypeId("Ptr") },
    lengthType: { kind: "core", coreTypeId: coreTypeId("usize") },
    pointerFieldName: "__source_ptr",
    lengthFieldName: "__source_len",
    ...overrides,
  };
}

export function corePrimitiveSpecsFake(): readonly LayoutPrimitiveTypeSpec<CoreTypeId>[] {
  return [
    {
      id: coreTypeId("Never"),
      sizeBytes: 0n,
      alignmentBytes: 1n,
      representation: "never",
    },
    {
      id: coreTypeId("bool"),
      sizeBytes: 1n,
      alignmentBytes: 1n,
      representation: "bool",
      bitWidth: 8,
      abiScalarKind: "integer",
    },
    {
      id: coreTypeId("u8"),
      sizeBytes: 1n,
      alignmentBytes: 1n,
      representation: "unsignedInteger",
      bitWidth: 8,
      abiScalarKind: "integer",
    },
    {
      id: coreTypeId("u16"),
      sizeBytes: 2n,
      alignmentBytes: 2n,
      representation: "unsignedInteger",
      bitWidth: 16,
      abiScalarKind: "integer",
    },
    {
      id: coreTypeId("u32"),
      sizeBytes: 4n,
      alignmentBytes: 4n,
      representation: "unsignedInteger",
      bitWidth: 32,
      abiScalarKind: "integer",
    },
    {
      id: coreTypeId("u64"),
      sizeBytes: 8n,
      alignmentBytes: 8n,
      representation: "unsignedInteger",
      bitWidth: 64,
      abiScalarKind: "integer",
    },
    {
      id: coreTypeId("usize"),
      sizeBytes: 8n,
      alignmentBytes: 8n,
      representation: "unsignedInteger",
      bitWidth: 64,
      abiScalarKind: "integer",
    },
  ];
}

export function targetPrimitiveSpecsFake(): readonly LayoutPrimitiveTypeSpec<TargetTypeId>[] {
  return [
    {
      id: targetTypeId("Ptr"),
      sizeBytes: 8n,
      alignmentBytes: 8n,
      representation: "address",
      bitWidth: 64,
      abiScalarKind: "pointer",
    },
    {
      id: targetTypeId("i32"),
      sizeBytes: 4n,
      alignmentBytes: 4n,
      representation: "signedInteger",
      bitWidth: 32,
      abiScalarKind: "integer",
    },
    {
      id: targetTypeId("f32"),
      sizeBytes: 4n,
      alignmentBytes: 4n,
      representation: "float",
      bitWidth: 32,
      abiScalarKind: "float",
    },
    {
      id: targetTypeId("f64"),
      sizeBytes: 8n,
      alignmentBytes: 8n,
      representation: "float",
      bitWidth: 64,
      abiScalarKind: "float",
    },
  ];
}

const CORE_PRIMITIVE_CANONICAL_ORDER = [
  "Never",
  "bool",
  "u16",
  "u32",
  "u64",
  "u8",
  "usize",
] as const;

function primitiveCatalogSortKey(id: unknown): string {
  const idText = String(id);
  const canonicalIndex = CORE_PRIMITIVE_CANONICAL_ORDER.indexOf(
    idText as (typeof CORE_PRIMITIVE_CANONICAL_ORDER)[number],
  );
  if (canonicalIndex >= 0) {
    return `${canonicalIndex.toString().padStart(2, "0")}:${idText}`;
  }
  return `99:${idText}`;
}

export function layoutPrimitiveCatalogFake<PrimitiveId>(
  specs: readonly LayoutPrimitiveTypeSpec<PrimitiveId>[],
): LayoutPrimitiveTypeCatalog<PrimitiveId> {
  const sorted = [...specs].sort((left, right) =>
    primitiveCatalogSortKey(left.id).localeCompare(primitiveCatalogSortKey(right.id)),
  );
  const byId = new Map<PrimitiveId, LayoutPrimitiveTypeSpec<PrimitiveId>>(
    sorted.map((spec) => [spec.id, spec]),
  );
  return {
    get: (id) => byId.get(id),
    entries: () => sorted,
  };
}

export function layoutDeviceSurfaceCatalogFake(
  entries: readonly LayoutDeviceSurfaceSpec[] = [],
): LayoutDeviceSurfaceCatalog {
  const sorted = [...entries].sort((left, right) =>
    String(left.deviceSurfaceId).localeCompare(String(right.deviceSurfaceId)),
  );
  const byId = new Map(sorted.map((entry) => [entry.deviceSurfaceId, entry]));
  return {
    get: (deviceSurfaceId) => byId.get(deviceSurfaceId),
    entries: () => sorted,
  };
}

export function layoutImageProfileCatalogFake(
  entries: readonly LayoutImageProfileSpec[] = [],
): LayoutImageProfileCatalog {
  const sorted = [...entries].sort((left, right) =>
    String(left.profileId).localeCompare(String(right.profileId)),
  );
  const byId = new Map(sorted.map((entry) => [entry.profileId, entry]));
  return {
    get: (profileId) => byId.get(profileId),
    entries: () => sorted,
  };
}

export function layoutWireReadHelperCatalogFake(
  entries: readonly LayoutWireReadHelperSpec[] = [],
): LayoutWireReadHelperCatalog {
  const sorted = [...entries].sort((left, right) =>
    String(left.helperId).localeCompare(String(right.helperId)),
  );
  const byId = new Map<TargetWireReadHelperId, LayoutWireReadHelperSpec>(
    sorted.map((entry) => [entry.helperId, entry]),
  );
  return {
    get: (helperId) => byId.get(helperId),
    entries: () => sorted,
  };
}

export function enumLayoutPolicyFake(
  overrides: Partial<TargetEnumLayoutPolicy> = {},
): TargetEnumLayoutPolicy {
  return {
    candidateTagTypes: [
      { kind: "core", coreTypeId: coreTypeId("u8") },
      { kind: "core", coreTypeId: coreTypeId("u16") },
      { kind: "core", coreTypeId: coreTypeId("u32") },
    ],
    emptyEnumPolicy: "reject",
    discriminantStart: 0n,
    chooseTagType: "smallestUnsignedThatFits",
    ...overrides,
  };
}

export interface TargetAbiSurfaceFakeOptions {
  readonly forceClassifierError?: string;
  readonly coreSpecs?: readonly LayoutPrimitiveTypeSpec<CoreTypeId>[];
  readonly targetSpecs?: readonly LayoutPrimitiveTypeSpec<TargetTypeId>[];
}

export function targetAbiSurfaceFake(options: TargetAbiSurfaceFakeOptions = {}): TargetAbiSurface {
  const coreSpecs = options.coreSpecs ?? corePrimitiveSpecsFake();
  const targetSpecs = options.targetSpecs ?? targetPrimitiveSpecsFake();
  const sourceCallConvention = targetCallConventionId("wrela-source");
  const platformCallConvention = targetCallConventionId("wrela-platform");

  return {
    sourceCallConvention,
    platformCallConvention,
    supportsVariadicCalls: false,
    classifyValue(input: ClassifyAbiValueInput): ClassifyAbiValueResult {
      if (options.forceClassifierError !== undefined) {
        return {
          kind: "error",
          diagnostics: [
            layoutDiagnostic({
              severity: "error",
              code: "LAYOUT_ABI_CLASSIFICATION_FAILED",
              message: options.forceClassifierError,
              ownerKey: "abi:classifier",
              rootCauseKey: "abi-classifier",
              stableDetail: options.forceClassifierError,
            }),
          ],
        };
      }
      return classifyAbiValueFake(input, coreSpecs, targetSpecs);
    },
  };
}

export interface LayoutTargetSurfaceFakeOptions extends Partial<LayoutTargetSurface> {
  readonly forceClassifierError?: string;
}

export function layoutTargetSurfaceFake(
  overrides: LayoutTargetSurfaceFakeOptions = {},
): LayoutTargetSurface {
  const targetIdValue = overrides.targetId ?? targetId("test-target");
  const dataModel = overrides.dataModel ?? layoutDataModelFake();
  const coreSpecs = corePrimitiveSpecsFake();
  const targetSpecs = targetPrimitiveSpecsFake();
  const { forceClassifierError, ...surfaceOverrides } = overrides;

  return {
    targetId: targetIdValue,
    dataModel,
    validatedBufferHandle: overrides.validatedBufferHandle ?? validatedBufferHandleLayoutFake(),
    coreTypes: overrides.coreTypes ?? layoutPrimitiveCatalogFake(coreSpecs),
    targetTypes: overrides.targetTypes ?? layoutPrimitiveCatalogFake(targetSpecs),
    deviceSurfaces: overrides.deviceSurfaces ?? layoutDeviceSurfaceCatalogFake([]),
    imageProfiles: overrides.imageProfiles ?? layoutImageProfileCatalogFake([]),
    wireReadHelpers: overrides.wireReadHelpers ?? layoutWireReadHelperCatalogFake([]),
    enumPolicy: overrides.enumPolicy ?? enumLayoutPolicyFake(),
    abi:
      overrides.abi ??
      targetAbiSurfaceFake({
        ...(forceClassifierError !== undefined ? { forceClassifierError } : {}),
        coreSpecs,
        targetSpecs,
      }),
    ...surfaceOverrides,
  };
}

function classifyAbiValueFake(
  input: ClassifyAbiValueInput,
  coreSpecs: readonly LayoutPrimitiveTypeSpec<CoreTypeId>[],
  targetSpecs: readonly LayoutPrimitiveTypeSpec<TargetTypeId>[],
): ClassifyAbiValueResult {
  const { layout, enumFact, use, target } = input;

  if (layout.representation.kind === "never") {
    return classificationOk({
      kind: "none",
      reason: "never",
      proofCarrying: false,
    });
  }

  if (layout.representation.kind === "zeroSized") {
    const reason =
      layout.representation.reason === "capabilityToken"
        ? "zeroSizedCapability"
        : layout.representation.reason === "emptyAggregate"
          ? "emptyAggregate"
          : "unit";
    return classificationOk({
      kind: "none",
      reason,
      proofCarrying: reason === "zeroSizedCapability",
    });
  }

  if (layout.representation.kind === "enum") {
    if (enumFact === undefined) {
      return classificationError("enum layout requires enumFact");
    }
    const tagLayout = layoutFactForTypeKey(enumFact.tagType, coreSpecs, targetSpecs, target);
    if (tagLayout === undefined) {
      return classificationError("missing enum tag layout");
    }
    return classifyAbiValueFake(
      { ...input, type: enumFact.tagType, layout: tagLayout, enumFact: undefined },
      coreSpecs,
      targetSpecs,
    );
  }

  if (layout.representation.kind === "primitive") {
    switch (layout.representation.primitive) {
      case "unsignedInteger":
      case "bool":
        return classificationOk(directUnsignedIntegerShape(layout));
      case "signedInteger":
        return classificationOk(directSignedIntegerShape(layout));
      case "address":
        return classificationOk(directPointerShape(layout, target, pointerProvenanceForUse(use)));
      case "float":
        return classificationOk(directFloatShape(layout));
      case "unit":
        return classificationOk({
          kind: "none",
          reason: "unit",
          proofCarrying: false,
        });
      case "never":
        return classificationOk({
          kind: "none",
          reason: "never",
          proofCarrying: false,
        });
      case "opaqueScalar":
        return classificationOk(directOpaqueLanes(layout, target));
      default: {
        const _exhaustive: never = layout.representation.primitive;
        return classificationError(`unsupported primitive ${String(_exhaustive)}`);
      }
    }
  }

  if (layout.representation.kind === "aggregate") {
    if (layout.sizeBytes <= 16n) {
      return classificationOk(directOpaqueLanes(layout, target));
    }
    return classificationOk(indirectShape(input.type, layout, target, use));
  }

  return classificationError("unsupported layout representation");
}

function classificationOk(shape: LayoutAbiValueShape): ClassifyAbiValueResult {
  return { kind: "ok", shape };
}

function classificationError(message: string): ClassifyAbiValueResult {
  return {
    kind: "error",
    diagnostics: [
      layoutDiagnostic({
        severity: "error",
        code: "LAYOUT_ABI_CLASSIFICATION_FAILED",
        message,
        ownerKey: "abi:classifier",
        rootCauseKey: "abi-classifier",
        stableDetail: message,
      }),
    ],
  };
}

function directUnsignedIntegerShape(layout: LayoutTypeFact): LayoutAbiValueShape {
  return {
    kind: "direct",
    lanes: [
      {
        kind: "integer",
        sizeBytes: layout.sizeBytes,
        alignmentBytes: layout.alignmentBytes,
        signedness: "unsigned",
        extension: "none",
      },
    ],
  };
}

function directSignedIntegerShape(layout: LayoutTypeFact): LayoutAbiValueShape {
  return {
    kind: "direct",
    lanes: [
      {
        kind: "integer",
        sizeBytes: layout.sizeBytes,
        alignmentBytes: layout.alignmentBytes,
        signedness: "signed",
        extension: "sign",
      },
    ],
  };
}

function directPointerShape(
  layout: LayoutTypeFact,
  target: TargetLayoutFacts,
  provenance: LayoutAbiPointerProvenance,
): LayoutAbiValueShape {
  return {
    kind: "direct",
    lanes: [
      {
        kind: "pointer",
        sizeBytes: target.pointerSizeBytes,
        alignmentBytes: target.pointerAlignmentBytes,
        provenance,
      },
    ],
  };
}

function directFloatShape(layout: LayoutTypeFact): LayoutAbiValueShape {
  const format = layout.sizeBytes === 4n ? "ieee754-binary32" : "ieee754-binary64";
  return {
    kind: "direct",
    lanes: [
      {
        kind: "float",
        sizeBytes: layout.sizeBytes,
        alignmentBytes: layout.alignmentBytes,
        format,
      },
    ],
  };
}

function directOpaqueLanes(layout: LayoutTypeFact, target: TargetLayoutFacts): LayoutAbiValueShape {
  const lanes: LayoutAbiLane[] = [];
  let remaining = layout.sizeBytes;
  while (remaining > 0n) {
    const laneSize = remaining >= target.pointerSizeBytes ? target.pointerSizeBytes : remaining;
    lanes.push({
      kind: "opaque",
      sizeBytes: laneSize,
      alignmentBytes:
        laneSize < target.pointerAlignmentBytes ? laneSize : target.pointerAlignmentBytes,
    });
    remaining -= laneSize;
  }
  return { kind: "direct", lanes };
}

function indirectShape(
  pointee: LayoutTypeKey,
  layout: LayoutTypeFact,
  target: TargetLayoutFacts,
  use: AbiClassificationUse,
): LayoutAbiValueShape {
  return {
    kind: "indirect",
    pointer: pointerShape64(),
    pointee,
    ownership: indirectOwnershipForUse(use),
  };
}

function indirectOwnershipForUse(
  use: AbiClassificationUse,
): "callerAllocated" | "calleeAllocated" | "borrowed" {
  switch (use.kind) {
    case "receiver":
    case "parameter":
      return use.mode === "observe" ? "borrowed" : "callerAllocated";
    case "return":
      return "callerAllocated";
    case "platformArgument":
      return use.mode === "observe" ? "borrowed" : "callerAllocated";
    case "platformReturn":
    case "imageEntryArgument":
    case "imageEntryReturn":
      return "callerAllocated";
  }
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

function layoutFactForTypeKey(
  key: LayoutTypeKey,
  coreSpecs: readonly LayoutPrimitiveTypeSpec<CoreTypeId>[],
  targetSpecs: readonly LayoutPrimitiveTypeSpec<TargetTypeId>[],
  target: TargetLayoutFacts,
): LayoutTypeFact | undefined {
  if (key.kind === "core") {
    const spec = coreSpecs.find((entry) => entry.id === key.coreTypeId);
    if (spec === undefined) return undefined;
    return primitiveLayoutFact(key, spec);
  }
  if (key.kind === "target") {
    const spec = targetSpecs.find((entry) => entry.id === key.targetTypeId);
    if (spec === undefined) return undefined;
    return primitiveLayoutFact(key, spec);
  }
  if (key.kind === "source") {
    return {
      key,
      sizeBytes: target.pointerSizeBytes,
      alignmentBytes: target.pointerAlignmentBytes,
      strideBytes: target.pointerSizeBytes,
      representation: { kind: "aggregate", sourceKind: "class" },
    };
  }
  return undefined;
}

function primitiveLayoutFact(
  key: LayoutTypeKey,
  spec: LayoutPrimitiveTypeSpec<CoreTypeId> | LayoutPrimitiveTypeSpec<TargetTypeId>,
): LayoutTypeFact {
  const strideBytes =
    spec.sizeBytes === 0n
      ? 0n
      : ((spec.sizeBytes + spec.alignmentBytes - 1n) / spec.alignmentBytes) * spec.alignmentBytes;
  return {
    key,
    sizeBytes: spec.sizeBytes,
    alignmentBytes: spec.alignmentBytes,
    strideBytes,
    representation: { kind: "primitive", primitive: spec.representation },
  };
}
