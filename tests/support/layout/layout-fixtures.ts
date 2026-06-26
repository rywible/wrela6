import fastCheck from "fast-check";
import type { TypedHirProgram } from "../../../src/hir/hir";
import type {
  ComputeRepresentationLayoutFactsInput,
  ComputeRepresentationLayoutFactsResult,
  LayoutFieldFact,
  LayoutTargetSurface,
  LayoutTerm,
  LayoutTypeFact,
  LayoutTypeKey,
  TargetLayoutFacts,
  LayoutTypeFactTable,
} from "../../../src/layout";
import { normalizeTargetFactsFromSurface } from "../../../src/layout/target-facts";
import type { MonoInstanceId } from "../../../src/mono/ids";
import { monoInstanceId } from "../../../src/mono/ids";
import type { MonoCheckedType, MonomorphizedHirProgram } from "../../../src/mono/mono-hir";
import { monomorphizeWholeImage } from "../../../src/mono/monomorphizer";
import type {
  LayoutTypeResolution,
  LayoutTypeResolutionTable,
} from "../../../src/layout/layout-type-resolution";
import { buildLayoutTypeResolutionTable } from "../../../src/layout/layout-type-resolution";
import type { LayoutTypeResolver } from "../../../src/layout/layout-type-resolver";
import {
  buildLayoutTypeResolver,
  buildLayoutTypeResolverWithResolutions,
} from "../../../src/layout/layout-type-resolver";
import { seedPrimitiveTypeFacts } from "../../../src/layout/primitive-layout";
import { checkedTypeFingerprint } from "../../../src/semantic/surface/type-model";
import { genericPacketProgramForMonoTest as monoGenericPacketProgramForMonoTest } from "../mono/monomorphization-fixtures";
export function layoutTypeResolutionTableForTest(
  program: MonomorphizedHirProgram,
): LayoutTypeResolutionTable {
  return buildLayoutTypeResolutionTable(program).table;
}

export function layoutTypeResolutionsForTest(
  program: MonomorphizedHirProgram,
): readonly LayoutTypeResolution[] {
  return layoutTypeResolutionTableForTest(program).entries();
}

export function resolverForReachableTypesFromProgram(
  program: MonomorphizedHirProgram,
): LayoutTypeResolver {
  const table = layoutTypeResolutionTableForTest(program);
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

export function monoProgramWithoutTypeInstance(
  program: MonomorphizedHirProgram,
  instanceId: MonoInstanceId,
): MonomorphizedHirProgram {
  const types = program.types
    .entries()
    .filter((entry) => String(entry.instanceId) !== String(instanceId));
  return {
    ...program,
    types: {
      get: (id) => types.find((entry) => String(entry.instanceId) === String(id)),
      entries: () => types,
    },
  };
}

export function layoutTypeResolverForMonoProgram(input: {
  readonly program: MonomorphizedHirProgram;
  readonly target?: LayoutTargetSurface;
}): { readonly targetFacts: TargetLayoutFacts; readonly resolver: LayoutTypeResolver } {
  const target = input.target ?? layoutTargetSurfaceFake();
  const targetFacts = normalizeTargetFactsForTest(target);
  const primitiveResult = seedPrimitiveTypeFacts(target);
  if (primitiveResult.kind !== "ok") {
    throw new Error("seedPrimitiveTypeFacts failed for layout test resolver.");
  }
  const resolverResult = buildLayoutTypeResolver({
    program: input.program,
    targetFacts,
    primitiveTypes: primitiveResult.value.types,
  });
  if (resolverResult.kind !== "ok") {
    throw new Error(
      `buildLayoutTypeResolver failed: ${resolverResult.diagnostics.map((diagnostic) => diagnostic.code).join(",")}`,
    );
  }
  return { targetFacts, resolver: resolverResult.value.resolver };
}

export function buildLayoutTypeResolverForTest(
  input: Parameters<typeof buildLayoutTypeResolverWithResolutions>[0],
) {
  return buildLayoutTypeResolverWithResolutions(input);
}

export function monoProgramWithLayoutResolutions(
  program: MonomorphizedHirProgram,
  _resolutions: readonly LayoutTypeResolution[],
): MonomorphizedHirProgram {
  return program;
}

export function layoutTypeResolverWithResolutions(
  program: MonomorphizedHirProgram,
  resolutions: readonly LayoutTypeResolution[],
  targetFacts: TargetLayoutFacts,
  primitiveTypes?: LayoutTypeFactTable,
) {
  return buildLayoutTypeResolverWithResolutions({
    program,
    targetFacts,
    resolutions,
    ...(primitiveTypes !== undefined ? { primitiveTypes } : {}),
  });
}

import {
  coreTypeId,
  fieldId,
  imageProfileId,
  parameterId,
  targetId,
  targetTypeId,
  typeId,
} from "../../../src/semantic/ids";
import type { FieldId } from "../../../src/semantic/ids";
import { concreteKind } from "../../../src/semantic/surface/resource-kind";
import { coreCheckedType, type CheckedType } from "../../../src/semantic/surface/type-model";
import { lowerTypedHirForTest } from "../hir/typed-hir-fixtures";
import {
  platformVoidTargetSignature,
  primitiveSpecFake,
  semanticTargetSurfaceFake,
  deviceSurfaceFake,
} from "../semantic/semantic-surface-fakes";
import { targetWithSerialDevice } from "../hir/typed-hir-fakes";
import { monoCoreType, normalizeOk } from "../mono/monomorphization-fixtures";
import {
  corePrimitiveSpecsFake,
  layoutImageProfileCatalogFake,
  layoutTargetSurfaceFake,
  targetCallConventionId,
  layoutPrimitiveCatalogFake,
} from "./layout-fakes";

export function layoutTargetWithUefiProfile(
  overrides: Partial<LayoutTargetSurface> = {},
): LayoutTargetSurface {
  return layoutTargetSurfaceFake({
    imageProfiles: layoutImageProfileCatalogFake([
      {
        profileId: imageProfileId("uefi"),
        physicalEntryCallConvention: targetCallConventionId("wrela-source"),
        physicalEntryArguments: [],
        physicalEntryResult: { kind: "unit" },
      },
    ]),
    ...overrides,
  });
}

export {
  corePrimitiveSpecsFake,
  enumLayoutPolicyFake,
  layoutDataModelFake,
  layoutDeviceSurfaceCatalogFake,
  layoutImageProfileCatalogFake,
  layoutPrimitiveCatalogFake,
  layoutTargetSurfaceFake,
  layoutWireReadHelperCatalogFake,
  pointerShape64,
  targetAbiSurfaceFake,
  targetCallConventionId,
  targetPrimitiveSpecsFake,
  validatedBufferHandleLayoutFake,
} from "./layout-fakes";

export type FixtureMonoLayoutExpression =
  | {
      readonly kind: "integerLiteral";
      readonly value: bigint;
      readonly width:
        | { readonly kind: "targetSize" }
        | { readonly kind: "type"; readonly type: MonoCheckedType };
      readonly sourceOrigin: string;
    }
  | {
      readonly kind: "sourceLength";
      readonly width: { readonly kind: "targetSize" };
      readonly sourceOrigin: string;
    }
  | {
      readonly kind: "add" | "subtract" | "multiply";
      readonly left: FixtureMonoLayoutExpression;
      readonly right: FixtureMonoLayoutExpression;
      readonly width:
        | { readonly kind: "targetSize" }
        | { readonly kind: "type"; readonly type: MonoCheckedType };
      readonly sourceOrigin: string;
    }
  | Extract<
      import("../../../src/mono/mono-hir").MonoLayoutExpression,
      { readonly kind: "fieldValue" }
    >;

const FIXTURE_SOURCE_ORIGIN = "layout-fixture:0:0";

export function normalizeTargetFactsForTest(target: LayoutTargetSurface): TargetLayoutFacts {
  return normalizeTargetFactsFromSurface(target);
}

export function typedHirProgramForLayoutIntegration(): TypedHirProgram {
  const source = [
    "enum PacketKind:",
    "    Arp",
    "    Ipv4",
    "    Ipv6",
    "",
    "class Packet:",
    "    kind: PacketKind",
    "    size: u32",
    "",
    "validated buffer PacketBuffer:",
    "    params:",
    "        expected_len: u16",
    "    layout:",
    "        kind: u8 @ 0",
    "        size: le u32 @ 1",
    "",
    "class SerialDevice:",
    "",
    "platform fn exit() -> Never",
    "",
    "fn caller() -> Never:",
    "    exit()",
    "",
    "uefi image Boot:",
    "    devices:",
    "        serial: SerialDevice",
    "    fn main() -> Never:",
    "        caller()",
  ].join("\n");

  const targetSurface = semanticTargetSurfaceFake({
    primitives: [
      primitiveSpecFake({
        name: "exit",
        signature: platformVoidTargetSignature(),
      }),
    ],
    devices: [
      deviceSurfaceFake({
        name: "serial",
        sourceTypeName: "SerialDevice",
        resourceKind: "UniqueEdgeRoot",
        uniqueEdgeRoots: ["rx", "tx"],
      }),
    ],
  });

  return lowerTypedHirForTest([["main.wr", source]], {
    platformNames: ["exit"],
    targetSurface,
  }).program;
}

export function genericPacketProgramForMonoTest(): TypedHirProgram {
  return monoGenericPacketProgramForMonoTest();
}

export function closedMonoProgramWithPacketType(): MonomorphizedHirProgram {
  const result = monomorphizeWholeImage({ program: typedHirProgramForLayoutIntegration() });
  if (result.kind !== "ok") {
    throw new Error(
      `closedMonoProgramWithPacketType failed: ${result.diagnostics.map((diagnostic) => String(diagnostic.code)).join(",")}`,
    );
  }
  return result.program;
}

export function monoProgramWithSourceLayoutResolutions(): MonomorphizedHirProgram {
  const result = monomorphizeWholeImage({ program: genericPacketProgramForMonoTest() });
  if (result.kind !== "ok") {
    throw new Error(
      `monoProgramWithSourceLayoutResolutions failed: ${result.diagnostics.map((diagnostic) => String(diagnostic.code)).join(",")}`,
    );
  }
  return result.program;
}

export interface AggregateProgramLayoutFixtureOptions {
  readonly program?: MonomorphizedHirProgram;
  readonly target?: LayoutTargetSurface;
}

export function aggregateProgramLayoutFixture(
  options: AggregateProgramLayoutFixtureOptions = {},
): ComputeRepresentationLayoutFactsInput {
  return {
    program: options.program ?? closedMonoProgramWithPacketType(),
    target: options.target ?? layoutTargetWithUefiProfile(),
  };
}

export interface ValidatedBufferProgramFixtureOptions {
  readonly layoutSource?: readonly string[];
  readonly deriveSource?: readonly string[];
  readonly program?: MonomorphizedHirProgram;
  readonly target?: LayoutTargetSurface;
}

export function validatedBufferHirForLayoutFixture(input: {
  readonly layoutSource: readonly string[];
  readonly deriveSource?: readonly string[];
}): TypedHirProgram {
  const layoutLines = input.layoutSource.map((line) => `        ${line}`).join("\n");
  const deriveSection =
    input.deriveSource === undefined
      ? []
      : ["    derive:", ...input.deriveSource.map((line) => `        ${line}`), ""];
  const source = [
    "validated buffer Packet:",
    "    params:",
    "        expected_len: u16",
    ...deriveSection,
    "    layout:",
    layoutLines,
    "",
    "fn touch(_: Packet) -> Never:",
    "    return",
    "uefi image Boot:",
    "    fn main() -> Never:",
    "        return",
  ].join("\n");

  const program = lowerTypedHirForTest([["main.wr", source]]).program;
  const touch = program.functions.entries().find((func) => func.signature.parameters.length === 1);
  if (touch === undefined) {
    return program;
  }

  return {
    ...program,
    monoClosure: {
      ...program.monoClosure,
      externalEntryRoots: [
        ...program.monoClosure.externalEntryRoots,
        {
          functionId: touch.functionId,
          ownerTypeArguments: [],
          functionTypeArguments: [],
          reason: "targetRequired",
          sourceOrigin: touch.sourceOrigin,
        },
      ],
    },
  };
}

export function validatedBufferProgramFixture(
  options: ValidatedBufferProgramFixtureOptions = {},
): ComputeRepresentationLayoutFactsInput {
  if (options.layoutSource !== undefined || options.deriveSource !== undefined) {
    const monoResult = monomorphizeWholeImage({
      program: validatedBufferHirForLayoutFixture({
        layoutSource: options.layoutSource ?? [],
        ...(options.deriveSource !== undefined ? { deriveSource: options.deriveSource } : {}),
      }),
    });
    if (monoResult.kind !== "ok") {
      throw new Error(
        `validatedBufferProgramFixture failed: ${monoResult.diagnostics.map((diagnostic) => String(diagnostic.code)).join(",")}`,
      );
    }
    return {
      program: monoResult.program,
      target: options.target ?? layoutTargetSurfaceFake(),
    };
  }

  return aggregateProgramLayoutFixture({
    ...(options.program !== undefined ? { program: options.program } : {}),
    ...(options.target !== undefined ? { target: options.target } : {}),
  });
}

export interface PlatformEdgeProgramFixtureOptions {
  readonly edgeTargetId?: ReturnType<typeof targetId>;
  readonly layoutTarget?: LayoutTargetSurface;
  readonly program?: MonomorphizedHirProgram;
}

export function platformEdgeProgramFixture(
  options: PlatformEdgeProgramFixtureOptions = {},
): ComputeRepresentationLayoutFactsInput {
  const layoutTarget =
    options.layoutTarget ??
    layoutTargetSurfaceFake({
      targetId: targetId("selected-target"),
    });

  if (options.program !== undefined) {
    return {
      program: options.program,
      target: layoutTarget,
    };
  }

  const source = [
    "platform fn exit() -> Never",
    "fn caller() -> Never:",
    "    exit()",
    "uefi image Boot:",
    "    fn main() -> Never:",
    "        caller()",
  ].join("\n");

  const targetSurface = semanticTargetSurfaceFake({
    primitives: [
      primitiveSpecFake({
        name: "exit",
        signature: platformVoidTargetSignature(),
      }),
    ],
  });

  const monoResult = monomorphizeWholeImage({
    program: lowerTypedHirForTest([["main.wr", source]], {
      platformNames: ["exit"],
      targetSurface,
    }).program,
  });
  if (monoResult.kind !== "ok") {
    throw new Error(
      `platformEdgeProgramFixture failed: ${monoResult.diagnostics.map((diagnostic) => String(diagnostic.code)).join(",")}`,
    );
  }

  return {
    program: monoResult.program,
    target: layoutTarget,
  };
}

export function validatedBufferFieldFactsInputWithBuffer(
  buffer: import("../../../src/mono/mono-hir").MonoValidatedBuffer,
  layoutSource: readonly string[] = ["kind: u8 @ 0"],
): import("../../../src/layout/validated-buffer-fields").ComputeValidatedBufferFieldFactsInput {
  const fixture = validatedBufferProgramFixture({ layoutSource });
  const { targetFacts, resolver } = layoutTypeResolverForMonoProgram(fixture);
  return {
    buffer,
    target: fixture.target,
    program: fixture.program,
    targetFacts,
    typeResolver: resolver,
  };
}

export function computeValidatedBufferFieldFactsInputForLayoutSource(
  layoutSource: readonly string[],
  options: { readonly deriveSource?: readonly string[] } = {},
): import("../../../src/layout/validated-buffer-fields").ComputeValidatedBufferFieldFactsInput {
  const fixture = validatedBufferProgramFixture({
    layoutSource,
    ...(options.deriveSource !== undefined ? { deriveSource: options.deriveSource } : {}),
  });
  const buffer = fixture.program.validatedBuffers.entries()[0];
  if (buffer === undefined) {
    throw new Error("expected validated buffer in layout field facts fixture");
  }
  const { targetFacts, resolver } = layoutTypeResolverForMonoProgram(fixture);
  return {
    buffer,
    target: fixture.target,
    program: fixture.program,
    targetFacts,
    typeResolver: resolver,
  };
}

export function deterministicLayoutProgramFixture(): ComputeRepresentationLayoutFactsInput {
  return platformEdgeProgramFixture();
}

export interface AggregateLayoutFixtureField {
  readonly name: string;
  readonly type: CheckedType;
}

export const AGGREGATE_LAYOUT_FIXTURE_SOURCE_ORIGIN = "aggregate-layout:0:0";
export const AGGREGATE_LAYOUT_FIXTURE_OWNER: LayoutTypeKey & { readonly kind: "source" } = {
  kind: "source",
  instanceId: monoInstanceId("type:AggregateFixture"),
};

export interface AggregateLayoutFixtureInput {
  readonly fields: readonly AggregateLayoutFixtureField[];
  readonly target?: LayoutTargetSurface;
  readonly targetFacts?: TargetLayoutFacts;
  readonly owner?: LayoutTypeKey & { readonly kind: "source" };
  readonly sourceKind?: import("../../../src/semantic/item-index/item-records").SourceItemKind;
  readonly sourceOrigin?: string;
}

export function aggregateLayoutFixture(
  options: AggregateLayoutFixtureInput,
): import("../../../src/layout/aggregate-layout").ComputeSourceAggregateLayoutInput {
  const target = options.target ?? layoutTargetSurfaceFake();
  return {
    fields: options.fields,
    target,
    targetFacts: options.targetFacts ?? normalizeTargetFactsForTest(target),
    owner: options.owner ?? AGGREGATE_LAYOUT_FIXTURE_OWNER,
    sourceKind: options.sourceKind ?? "class",
    sourceOrigin: options.sourceOrigin ?? AGGREGATE_LAYOUT_FIXTURE_SOURCE_ORIGIN,
  };
}

export const LAYOUT_FIXTURE_SOURCE_ORIGIN = "layout-fixture:0:0";
export const VALIDATED_BUFFER_LAYOUT_FIXTURE_INSTANCE_ID =
  monoInstanceId("validated-buffer:Packet");
export const VALIDATED_BUFFER_LAYOUT_FIXTURE_FIELD_ID = fieldId(0);
export const VALIDATED_BUFFER_WIRE_FIXTURE_FIELD_ID = fieldId(1);
export const DERIVED_FIELD_FIXTURE_FIELD_ID = fieldId(10);
export const DERIVED_FIELD_FIXTURE_SOURCE_FIELD_ID = fieldId(1);
export const DERIVED_FIELD_FIXTURE_NAME = "derived";
export const DERIVED_FIELD_FIXTURE_TYPE: LayoutTypeKey = {
  kind: "core",
  coreTypeId: coreTypeId("u32"),
};

export interface TermTranslationFixtureOptions {
  readonly expression: FixtureMonoLayoutExpression;
  readonly unit: LayoutTerm["unit"];
  readonly target?: LayoutTargetSurface;
  readonly instanceId?: MonoInstanceId;
  readonly fieldId?: FieldId;
  readonly derivedFieldRangeByFieldId?: ReadonlyMap<
    FieldId,
    import("../../../src/layout/layout-program").LayoutIntegerRange
  >;
}

export function termTranslationFixture(
  options: TermTranslationFixtureOptions,
): import("../../../src/layout/validated-buffer-terms").TranslateLayoutTermInput {
  const target = options.target ?? layoutTargetSurfaceFake();
  return {
    expression: options.expression,
    unit: options.unit,
    target,
    targetFacts: normalizeTargetFactsForTest(target),
    instanceId: options.instanceId ?? VALIDATED_BUFFER_LAYOUT_FIXTURE_INSTANCE_ID,
    fieldId: options.fieldId ?? VALIDATED_BUFFER_LAYOUT_FIXTURE_FIELD_ID,
    ...(options.derivedFieldRangeByFieldId !== undefined
      ? { derivedFieldRangeByFieldId: options.derivedFieldRangeByFieldId }
      : {}),
  };
}

export interface WireTypeFixtureOptions {
  readonly type: MonoCheckedType;
  readonly wireEncoding?: import("../../../src/shared/wire-layout").WireScalarEncoding;
  readonly target?: LayoutTargetSurface;
  readonly fieldId?: FieldId;
  readonly sourceOrigin?: string;
}

export function wireTypeFixture(
  options: WireTypeFixtureOptions,
): import("../../../src/layout/validated-buffer-wire").ComputeWireTypeFactInput {
  return {
    type: options.type,
    wireEncoding: options.wireEncoding,
    target: options.target ?? layoutTargetSurfaceFake(),
    fieldId: options.fieldId ?? VALIDATED_BUFFER_WIRE_FIXTURE_FIELD_ID,
    sourceOrigin: options.sourceOrigin ?? LAYOUT_FIXTURE_SOURCE_ORIGIN,
  };
}

export interface DerivedFieldFixtureCase {
  readonly condition: FixtureMonoLayoutExpression | { readonly kind: "otherwise" };
  readonly result: FixtureMonoLayoutExpression;
}

export interface DerivedFieldFixtureOptions {
  readonly cases: readonly DerivedFieldFixtureCase[];
  readonly target?: LayoutTargetSurface;
  readonly instanceId?: MonoInstanceId;
  readonly fieldId?: FieldId;
  readonly name?: string;
  readonly type?: LayoutTypeKey;
  readonly sourceOrigin?: string;
  readonly unit?: LayoutTerm["unit"];
  readonly dependencyContext?: import("../../../src/layout/validated-buffer-derived").DerivedFieldDependencyContext;
}

export function derivedFieldLayoutSourceExpression(): import("../../../src/mono/mono-hir").MonoLayoutExpression {
  return {
    kind: "fieldValue",
    fieldId: DERIVED_FIELD_FIXTURE_SOURCE_FIELD_ID,
    fieldKind: "layout",
    type: monoCoreType("u8"),
    sourceOrigin: LAYOUT_FIXTURE_SOURCE_ORIGIN,
  };
}

export function derivedFieldFixture(
  options: DerivedFieldFixtureOptions,
): import("../../../src/layout/validated-buffer-derived").ComputeDerivedFieldFactsInput {
  const target = options.target ?? layoutTargetSurfaceFake();
  return {
    cases: options.cases,
    target,
    targetFacts: normalizeTargetFactsForTest(target),
    instanceId: options.instanceId ?? VALIDATED_BUFFER_LAYOUT_FIXTURE_INSTANCE_ID,
    fieldId: options.fieldId ?? DERIVED_FIELD_FIXTURE_FIELD_ID,
    name: options.name ?? DERIVED_FIELD_FIXTURE_NAME,
    type: options.type ?? DERIVED_FIELD_FIXTURE_TYPE,
    sourceOrigin: options.sourceOrigin ?? LAYOUT_FIXTURE_SOURCE_ORIGIN,
    unit: options.unit ?? "scalarValue",
    source: derivedFieldLayoutSourceExpression(),
    dependencyContext: options.dependencyContext ?? {
      parameterFieldIds: new Set<string>(),
      availableLayoutFieldIds: new Set([String(DERIVED_FIELD_FIXTURE_SOURCE_FIELD_ID)]),
      availableDerivedFieldIds: new Set<string>(),
    },
  };
}

export interface EnumLayoutFixtureOptions {
  readonly cases?: readonly string[];
  readonly candidateTagTypes?: readonly ReturnType<typeof coreTypeId>[];
  readonly discriminantStart?: bigint;
  readonly target?: LayoutTargetSurface;
}

export function enumLayoutFixture(options: EnumLayoutFixtureOptions = {}): {
  readonly cases: readonly string[];
  readonly candidateTagTypes: readonly ReturnType<typeof coreTypeId>[];
  readonly discriminantStart: bigint;
  readonly target: LayoutTargetSurface;
} {
  return {
    cases: options.cases ?? ["Arp", "Ipv4", "Ipv6"],
    candidateTagTypes: options.candidateTagTypes ?? [coreTypeId("u8"), coreTypeId("u16")],
    discriminantStart: options.discriminantStart ?? 0n,
    target: options.target ?? layoutTargetSurfaceFake(),
  };
}

export interface ImageDeviceLayoutFixtureOptions {
  readonly representation?:
    | { readonly kind: "zeroSizedCapability" }
    | { readonly kind: "targetHandle"; readonly targetTypeId?: ReturnType<typeof targetTypeId> };
  readonly target?: LayoutTargetSurface;
}

export function imageDeviceLayoutFixture(options: ImageDeviceLayoutFixtureOptions = {}): {
  readonly program: MonomorphizedHirProgram;
  readonly target: LayoutTargetSurface;
  readonly representation: ImageDeviceLayoutFixtureOptions["representation"];
} {
  const program = monomorphizeWholeImage({
    program: lowerTypedHirForTest(
      [
        [
          "main.wr",
          [
            "class SerialDevice:",
            "uefi image Boot:",
            "    devices:",
            "        serial: SerialDevice",
            "    fn main() -> Never:",
            "        return",
          ].join("\n"),
        ],
      ],
      { targetSurface: targetWithSerialDevice(["rx", "tx"]) },
    ).program,
  });
  if (program.kind !== "ok") {
    throw new Error(
      `imageDeviceLayoutFixture failed: ${program.diagnostics.map((diagnostic) => String(diagnostic.code)).join(",")}`,
    );
  }

  return {
    program: program.program,
    target: options.target ?? layoutTargetSurfaceFake(),
    representation: options.representation ?? { kind: "zeroSizedCapability" },
  };
}

export function validatedBufferLayoutFixture(
  options: ValidatedBufferProgramFixtureOptions = {},
): ComputeRepresentationLayoutFactsInput {
  return validatedBufferProgramFixture(options);
}

export interface FunctionAbiFixtureOptions {
  readonly parameterMode?: "observe" | "consume";
  readonly classifierShape?: LayoutAbiValueShapeRef;
  readonly target?: LayoutTargetSurface;
}

export type LayoutAbiValueShapeRef =
  import("../../../src/layout/layout-program").LayoutAbiValueShape;

export function functionAbiFixture(
  options: FunctionAbiFixtureOptions = {},
): FunctionAbiFixtureOptions {
  return {
    parameterMode: options.parameterMode ?? "observe",
    classifierShape: options.classifierShape,
    target: options.target ?? layoutTargetSurfaceFake(),
  };
}

export function imageEntryMonoProgramForLayoutFixture(): MonomorphizedHirProgram {
  const source = [
    "platform fn exit() -> Never",
    "",
    "fn caller() -> Never:",
    "    exit()",
    "",
    "uefi image Boot:",
    "    fn main(firmware: usize) -> Never:",
    "        caller()",
  ].join("\n");

  const targetSurface = semanticTargetSurfaceFake({
    primitives: [
      primitiveSpecFake({
        name: "exit",
        signature: platformVoidTargetSignature(),
      }),
    ],
  });

  const monoResult = monomorphizeWholeImage({
    program: lowerTypedHirForTest([["main.wr", source]], {
      platformNames: ["exit"],
      targetSurface,
    }).program,
  });
  if (monoResult.kind !== "ok") {
    throw new Error(
      `imageEntryMonoProgramForLayoutFixture failed: ${monoResult.diagnostics.map((diagnostic) => String(diagnostic.code)).join(",")}`,
    );
  }
  return monoResult.program;
}

export function imageEntryAbiFixture(options: { readonly target?: LayoutTargetSurface } = {}): {
  readonly program: MonomorphizedHirProgram;
  readonly target: LayoutTargetSurface;
} {
  const target =
    options.target ??
    layoutTargetSurfaceFake({
      imageProfiles: layoutImageProfileCatalogFake([
        {
          profileId: imageProfileId("uefi"),
          physicalEntryCallConvention: targetCallConventionId("uefi-aarch64"),
          physicalEntryArguments: [
            {
              name: "firmwareArgument",
              type: { kind: "target", targetTypeId: targetTypeId("Ptr") },
              provenance: "firmware",
            },
          ],
          physicalEntryResult: { kind: "unit" },
        },
      ]),
    });

  const program = imageEntryMonoProgramForLayoutFixture();
  return { program, target };
}

export function monoIntegerLiteral(value: bigint): FixtureMonoLayoutExpression {
  return {
    kind: "integerLiteral",
    value,
    width: { kind: "type", type: monoCoreType("u32") },
    sourceOrigin: FIXTURE_SOURCE_ORIGIN,
  };
}

export function monoSourceLength(): FixtureMonoLayoutExpression {
  return {
    kind: "sourceLength",
    width: { kind: "targetSize" },
    sourceOrigin: FIXTURE_SOURCE_ORIGIN,
  };
}

export function monoSubtract(
  left: FixtureMonoLayoutExpression,
  right: FixtureMonoLayoutExpression,
): FixtureMonoLayoutExpression {
  return {
    kind: "subtract",
    left,
    right,
    width: { kind: "targetSize" },
    sourceOrigin: FIXTURE_SOURCE_ORIGIN,
  };
}

export function constantLayoutTerm(value: bigint, unit: LayoutTerm["unit"]): LayoutTerm {
  return {
    kind: "constant",
    value,
    unit,
    range: {
      minimum: value,
      maximum: value,
      provenance: "constant",
    },
  };
}

export function sourceLengthLayoutTermForTest(
  target: LayoutTargetSurface = layoutTargetSurfaceFake(),
): LayoutTerm {
  const targetFacts = normalizeTargetFactsForTest(target);
  return {
    kind: "sourceLength",
    unit: "byteLength",
    type: targetFacts.sizeType,
    range: {
      minimum: 0n,
      maximum: targetFacts.maximumObjectSizeBytes,
      provenance: "sourceLength",
    },
  };
}

export function sourceLayoutTypeKey(name: string): LayoutTypeKey & { readonly kind: "source" } {
  return {
    kind: "source",
    instanceId: monoInstanceId(`type:${name}`),
  };
}

export function stableLayoutProjection(result: ComputeRepresentationLayoutFactsResult): unknown {
  return stableJsonValue(result);
}

function stableJsonValue(value: unknown): unknown {
  if (typeof value === "bigint") return `${value.toString()}n`;
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (value instanceof Map) {
    return [...value.entries()]
      .map(([key, entryValue]) => [stableJsonValue(key), stableJsonValue(entryValue)])
      .sort((left, right) => JSON.stringify(left[0]).localeCompare(JSON.stringify(right[0])));
  }
  if (value !== null && typeof value === "object") {
    if (
      "entries" in value &&
      typeof (value as { readonly entries?: unknown }).entries === "function"
    ) {
      return stableJsonValue((value as { entries: () => readonly unknown[] }).entries());
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entryValue]) => entryValue !== undefined && typeof entryValue !== "function")
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, stableJsonValue(entryValue)]),
    );
  }
  return value;
}

export function primitiveFieldListArbitrary(): fastCheck.Arbitrary<
  readonly AggregateLayoutFixtureField[]
> {
  const primitiveTypes = [
    coreCheckedType(coreTypeId("u8")),
    coreCheckedType(coreTypeId("u16")),
    coreCheckedType(coreTypeId("u32")),
    coreCheckedType(coreTypeId("u64")),
    coreCheckedType(coreTypeId("bool")),
  ] as const;

  return fastCheck
    .array(
      fastCheck.record({
        name: fastCheck.stringMatching(/^[a-z][a-z0-9]{0,7}$/),
        type: fastCheck.constantFrom(...primitiveTypes),
      }),
      { minLength: 1, maxLength: 8 },
    )
    .map((fields) =>
      fields.map((field, index) => ({
        name: fields.slice(0, index).some((other) => other.name === field.name)
          ? `${field.name}${index}`
          : field.name,
        type: field.type,
      })),
    );
}

export function fieldOffsetProjection(field: LayoutFieldFact): readonly [string, bigint] {
  return [field.fieldName, field.offsetBytes];
}

export function aggregateOffsetOracle(
  fields: readonly AggregateLayoutFixtureField[],
): readonly (readonly [string, bigint])[] {
  const target = layoutTargetSurfaceFake();
  const targetFacts = normalizeTargetFactsForTest(target);
  const primitiveCatalog = layoutPrimitiveCatalogFake(corePrimitiveSpecsFake());

  let offset = 0n;
  const result: (readonly [string, bigint])[] = [];

  for (const field of fields) {
    if (field.type.kind !== "core") {
      throw new Error("aggregateOffsetOracle supports core primitive fields only.");
    }
    const spec = primitiveCatalog.get(field.type.coreTypeId);
    if (spec === undefined) {
      throw new Error(`aggregateOffsetOracle missing primitive ${String(field.type.coreTypeId)}.`);
    }
    const alignment = spec.alignmentBytes;
    const remainder = offset % alignment;
    if (remainder !== 0n) {
      offset += alignment - remainder;
    }
    result.push([field.name, offset]);
    offset += spec.sizeBytes;
  }

  if (offset > 0n) {
    const aggregateAlignment = fields.reduce((current, field) => {
      if (field.type.kind !== "core") return current;
      const spec = primitiveCatalog.get(field.type.coreTypeId);
      return spec === undefined
        ? current
        : spec.alignmentBytes > current
          ? spec.alignmentBytes
          : current;
    }, 1n);
    const remainder = offset % aggregateAlignment;
    if (remainder !== 0n) {
      offset += aggregateAlignment - remainder;
    }
  }

  void targetFacts;
  return result;
}

export function layoutTypeFactForTest(input: {
  readonly key: LayoutTypeKey;
  readonly representation: LayoutTypeFact["representation"];
  readonly sizeBytes: bigint;
  readonly alignmentBytes: bigint;
}): LayoutTypeFact {
  const strideBytes =
    input.sizeBytes === 0n
      ? 0n
      : ((input.sizeBytes + input.alignmentBytes - 1n) / input.alignmentBytes) *
        input.alignmentBytes;
  return {
    key: input.key,
    sizeBytes: input.sizeBytes,
    alignmentBytes: input.alignmentBytes,
    strideBytes,
    representation: input.representation,
  };
}

export function classifyAbiInputForTest(input: {
  readonly layout: LayoutTypeFact;
  readonly use: import("../../../src/layout/target-layout").AbiClassificationUse;
  readonly enumFact?: import("../../../src/layout/layout-program").LayoutEnumFact;
  readonly type?: LayoutTypeKey;
  readonly target?: LayoutTargetSurface;
}): import("../../../src/layout/target-layout").ClassifyAbiValueInput {
  const targetSurface = input.target ?? layoutTargetSurfaceFake();
  return {
    target: normalizeTargetFactsForTest(targetSurface),
    callConvention: targetCallConventionId("wrela-source"),
    use: input.use,
    type: input.type ?? input.layout.key,
    layout: input.layout,
    ...(input.enumFact !== undefined ? { enumFact: input.enumFact } : {}),
  };
}

export function enumFactForTest(input: {
  readonly tagType: LayoutTypeKey;
  readonly owner?: LayoutTypeKey & { readonly kind: "source" };
}): import("../../../src/layout/layout-program").LayoutEnumFact {
  return {
    owner: input.owner ?? sourceLayoutTypeKey("Enum"),
    tagType: input.tagType,
    tagOffsetBytes: 0n,
    cases: [],
    sourceOrigin: FIXTURE_SOURCE_ORIGIN,
  };
}

export function parameterObserveUse(
  parameter: number,
): import("../../../src/layout/target-layout").AbiClassificationUse {
  return {
    kind: "parameter",
    parameterId: parameterId(parameter),
    mode: "observe",
  };
}

export function parameterConsumeUse(
  parameter: number,
): import("../../../src/layout/target-layout").AbiClassificationUse {
  return {
    kind: "parameter",
    parameterId: parameterId(parameter),
    mode: "consume",
  };
}

export function returnUse(): import("../../../src/layout/target-layout").AbiClassificationUse {
  return { kind: "return" };
}

export function monoInstanceIdForLayoutTest(key: string): MonoInstanceId {
  return monoInstanceId(key);
}

export function coreMonoType(
  name: "u8" | "u16" | "u32" | "u64" | "bool" | "Never",
): MonoCheckedType {
  return normalizeOk(coreCheckedType(coreTypeId(name)));
}

export function fieldIdForLayoutTest(value: number): FieldId {
  return fieldId(value);
}

export function typeIdForLayoutTest(value: number): ReturnType<typeof typeId> {
  return typeId(value);
}

export function concreteCopyKind() {
  return concreteKind("Copy");
}
