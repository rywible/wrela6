import { expect, test } from "bun:test";
import type {
  AbiClassificationUse,
  AbiScalarKind,
  ComputeRepresentationLayoutFactsInput,
  ComputeRepresentationLayoutFactsResult,
  LayoutAbiHiddenParameterFact,
  LayoutAbiLane,
  LayoutAbiParameterFact,
  LayoutAbiPointerProvenance,
  LayoutAbiPointerShape,
  LayoutAbiReturnFact,
  LayoutAbiStackRequirement,
  LayoutAbiValueShape,
  LayoutAggregateStorageFact,
  LayoutBuilderContext,
  LayoutBuilderDependency,
  LayoutBuilderIssue,
  LayoutBuilderResult,
  LayoutCanonicalKeyString,
  LayoutDerivedCaseCondition,
  LayoutDerivedCaseFact,
  LayoutDeterministicTable,
  LayoutDeviceSurfaceCatalog,
  LayoutDeviceSurfaceSpec,
  LayoutDiagnostic,
  LayoutDiagnosticCode,
  LayoutDiagnosticInput,
  LayoutEnumCaseFact,
  LayoutEnumFact,
  LayoutFactProgram,
  LayoutFieldFact,
  LayoutFieldFactTable,
  LayoutFieldKey,
  LayoutFunctionAbiFact,
  LayoutFunctionAbiFactTable,
  LayoutHiddenStorageField,
  LayoutImageDeviceFact,
  LayoutImageDeviceFactTable,
  LayoutImageDeviceKey,
  LayoutImageEntryAbiFact,
  LayoutImageEntryThunkConversion,
  LayoutImageProfileArgumentSpec,
  LayoutImageProfileCatalog,
  LayoutImageProfileResultSpec,
  LayoutImageProfileSpec,
  LayoutIntegerRange,
  LayoutOwnerKey,
  LayoutPaddingRange,
  LayoutPlatformAbiFact,
  LayoutPlatformAbiFactTable,
  LayoutPrimitiveKind,
  LayoutPrimitiveTypeCatalog,
  LayoutPrimitiveTypeRef,
  LayoutPrimitiveTypeSpec,
  LayoutReadRequirement,
  LayoutTargetSurface,
  LayoutTerm,
  LayoutTermUnit,
  LayoutTypeFact,
  LayoutTypeFactTable,
  LayoutTypeKey,
  LayoutTypeRepresentation,
  LayoutValidatedBufferDerivedFact,
  LayoutValidatedBufferFact,
  LayoutValidatedBufferFactTable,
  LayoutValidatedBufferFieldFact,
  LayoutValidatedBufferValueStorageFact,
  LayoutWireAggregateFieldFact,
  LayoutWireReadHelperCatalog,
  LayoutWireReadHelperSpec,
  LayoutWireReadPolicy,
  LayoutWireReservedRange,
  LayoutWireTypeFact,
  TargetAbiSurface,
  TargetCallConventionId,
  TargetDataModelFacts,
  TargetEnumLayoutPolicy,
  TargetLayoutFacts,
  TargetValidatedBufferHandleLayout,
  TargetWireReadHelperId,
  WireEndian,
  WireIntegerEncoding,
  WireScalarEncoding,
} from "../../../src/layout";
import {
  computeRepresentationLayoutFacts,
  layoutDeterministicTable,
  layoutDiagnostic,
  layoutDiagnosticCode,
  layoutFieldKeyString,
  layoutImageDeviceKeyString,
  layoutTypeFingerprintTable,
  layoutTypeKeyString,
  publishedLayoutTypeKeyToLayoutTypeKey,
  sortLayoutDiagnostics,
  targetDefinitionDiagnostic,
  validateLayoutTargetSurface,
} from "../../../src/layout";
import { monomorphizeWholeImage } from "../../../src/mono/monomorphizer";
import * as wrela from "../../../src";
import { imageProfileId } from "../../../src/semantic/ids";
import {
  layoutImageProfileCatalogFake,
  layoutTargetSurfaceFake,
  targetCallConventionId,
} from "../../support/layout/layout-fakes";
import { genericPacketProgramForMonoTest } from "../../support/layout/layout-fixtures";

type PublicLayoutModelSmoke = {
  readonly abiClassificationUse?: AbiClassificationUse;
  readonly abiScalarKind?: AbiScalarKind;
  readonly computeRepresentationLayoutFactsInput?: ComputeRepresentationLayoutFactsInput;
  readonly computeRepresentationLayoutFactsResult?: ComputeRepresentationLayoutFactsResult;
  readonly layoutAbiHiddenParameterFact?: LayoutAbiHiddenParameterFact;
  readonly layoutAbiLane?: LayoutAbiLane;
  readonly layoutAbiParameterFact?: LayoutAbiParameterFact;
  readonly layoutAbiPointerProvenance?: LayoutAbiPointerProvenance;
  readonly layoutAbiPointerShape?: LayoutAbiPointerShape;
  readonly layoutAbiReturnFact?: LayoutAbiReturnFact;
  readonly layoutAbiStackRequirement?: LayoutAbiStackRequirement;
  readonly layoutAbiValueShape?: LayoutAbiValueShape;
  readonly layoutAggregateStorageFact?: LayoutAggregateStorageFact;
  readonly layoutBuilderContext?: LayoutBuilderContext;
  readonly layoutBuilderDependency?: LayoutBuilderDependency;
  readonly layoutBuilderIssue?: LayoutBuilderIssue;
  readonly layoutBuilderResult?: LayoutBuilderResult<unknown>;
  readonly layoutCanonicalKeyString?: LayoutCanonicalKeyString;
  readonly layoutDerivedCaseCondition?: LayoutDerivedCaseCondition;
  readonly layoutDerivedCaseFact?: LayoutDerivedCaseFact;
  readonly layoutDeterministicTable?: LayoutDeterministicTable<unknown, unknown>;
  readonly layoutDeviceSurfaceCatalog?: LayoutDeviceSurfaceCatalog;
  readonly layoutDeviceSurfaceSpec?: LayoutDeviceSurfaceSpec;
  readonly layoutDiagnostic?: LayoutDiagnostic;
  readonly layoutDiagnosticCode?: LayoutDiagnosticCode;
  readonly layoutDiagnosticInput?: LayoutDiagnosticInput;
  readonly layoutEnumCaseFact?: LayoutEnumCaseFact;
  readonly layoutEnumFact?: LayoutEnumFact;
  readonly layoutFactProgram?: LayoutFactProgram;
  readonly layoutFieldFact?: LayoutFieldFact;
  readonly layoutFieldFactTable?: LayoutFieldFactTable;
  readonly layoutFieldKey?: LayoutFieldKey;
  readonly layoutFunctionAbiFact?: LayoutFunctionAbiFact;
  readonly layoutFunctionAbiFactTable?: LayoutFunctionAbiFactTable;
  readonly layoutHiddenStorageField?: LayoutHiddenStorageField;
  readonly layoutImageDeviceFact?: LayoutImageDeviceFact;
  readonly layoutImageDeviceFactTable?: LayoutImageDeviceFactTable;
  readonly layoutImageDeviceKey?: LayoutImageDeviceKey;
  readonly layoutImageEntryAbiFact?: LayoutImageEntryAbiFact;
  readonly layoutImageEntryThunkConversion?: LayoutImageEntryThunkConversion;
  readonly layoutImageProfileArgumentSpec?: LayoutImageProfileArgumentSpec;
  readonly layoutImageProfileCatalog?: LayoutImageProfileCatalog;
  readonly layoutImageProfileResultSpec?: LayoutImageProfileResultSpec;
  readonly layoutImageProfileSpec?: LayoutImageProfileSpec;
  readonly layoutIntegerRange?: LayoutIntegerRange;
  readonly layoutOwnerKey?: LayoutOwnerKey;
  readonly layoutPaddingRange?: LayoutPaddingRange;
  readonly layoutPlatformAbiFact?: LayoutPlatformAbiFact;
  readonly layoutPlatformAbiFactTable?: LayoutPlatformAbiFactTable;
  readonly layoutPrimitiveKind?: LayoutPrimitiveKind;
  readonly layoutPrimitiveTypeCatalog?: LayoutPrimitiveTypeCatalog<unknown>;
  readonly layoutPrimitiveTypeRef?: LayoutPrimitiveTypeRef;
  readonly layoutPrimitiveTypeSpec?: LayoutPrimitiveTypeSpec<unknown>;
  readonly layoutReadRequirement?: LayoutReadRequirement;
  readonly layoutTargetSurface?: LayoutTargetSurface;
  readonly layoutTerm?: LayoutTerm;
  readonly layoutTermUnit?: LayoutTermUnit;
  readonly layoutTypeFact?: LayoutTypeFact;
  readonly layoutTypeFactTable?: LayoutTypeFactTable;
  readonly layoutTypeKey?: LayoutTypeKey;
  readonly layoutTypeRepresentation?: LayoutTypeRepresentation;
  readonly layoutValidatedBufferDerivedFact?: LayoutValidatedBufferDerivedFact;
  readonly layoutValidatedBufferFact?: LayoutValidatedBufferFact;
  readonly layoutValidatedBufferFactTable?: LayoutValidatedBufferFactTable;
  readonly layoutValidatedBufferFieldFact?: LayoutValidatedBufferFieldFact;
  readonly layoutValidatedBufferValueStorageFact?: LayoutValidatedBufferValueStorageFact;
  readonly layoutWireAggregateFieldFact?: LayoutWireAggregateFieldFact;
  readonly layoutWireReadHelperCatalog?: LayoutWireReadHelperCatalog;
  readonly layoutWireReadHelperSpec?: LayoutWireReadHelperSpec;
  readonly layoutWireReadPolicy?: LayoutWireReadPolicy;
  readonly layoutWireReservedRange?: LayoutWireReservedRange;
  readonly layoutWireTypeFact?: LayoutWireTypeFact;
  readonly targetAbiSurface?: TargetAbiSurface;
  readonly targetCallConventionId?: TargetCallConventionId;
  readonly targetDataModelFacts?: TargetDataModelFacts;
  readonly targetEnumLayoutPolicy?: TargetEnumLayoutPolicy;
  readonly targetLayoutFacts?: TargetLayoutFacts;
  readonly targetValidatedBufferHandleLayout?: TargetValidatedBufferHandleLayout;
  readonly targetWireReadHelperId?: TargetWireReadHelperId;
  readonly wireEndian?: WireEndian;
  readonly wireIntegerEncoding?: WireIntegerEncoding;
  readonly wireScalarEncoding?: WireScalarEncoding;
};

const acceptPublicLayoutModel = (model: PublicLayoutModelSmoke): PublicLayoutModelSmoke => model;

test("layout public API computes facts from closed mono program", () => {
  const monoResult = monomorphizeWholeImage({ program: genericPacketProgramForMonoTest() });
  expect(monoResult.kind).toBe("ok");
  if (monoResult.kind !== "ok") return;

  const layoutResult = computeRepresentationLayoutFacts({
    program: monoResult.program,
    target: layoutTargetSurfaceFake({
      imageProfiles: layoutImageProfileCatalogFake([
        {
          profileId: imageProfileId("uefi"),
          physicalEntryCallConvention: targetCallConventionId("wrela-source"),
          physicalEntryArguments: [],
          physicalEntryResult: { kind: "unit" },
        },
      ]),
    }),
  });

  expect(layoutResult.kind).toBe("ok");
});

test("layout public API is exported from src/layout and src root namespace", () => {
  expect(typeof computeRepresentationLayoutFacts).toBe("function");
  expect(typeof wrela.layout.computeRepresentationLayoutFacts).toBe("function");
  expect(typeof layoutDeterministicTable).toBe("function");
  expect(typeof wrela.layout.layoutDeterministicTable).toBe("function");
  expect(typeof layoutDiagnostic).toBe("function");
  expect(typeof layoutDiagnosticCode).toBe("function");
  expect(typeof sortLayoutDiagnostics).toBe("function");
  expect(typeof targetDefinitionDiagnostic).toBe("function");
  expect(typeof validateLayoutTargetSurface).toBe("function");
  expect(typeof layoutTypeKeyString).toBe("function");
  expect(typeof layoutFieldKeyString).toBe("function");
  expect(typeof layoutImageDeviceKeyString).toBe("function");
  expect(typeof publishedLayoutTypeKeyToLayoutTypeKey).toBe("function");
  expect(typeof layoutTypeFingerprintTable).toBe("function");
  expect(acceptPublicLayoutModel({})).toEqual({});
});

test("layout public API does not expose layout fact builder internals", () => {
  expect("createLayoutFactBuilderContext" in wrela.layout).toBe(false);
  expect("recordBuilderResult" in wrela.layout).toBe(false);
  expect("computeEnumLayout" in wrela.layout).toBe(false);
  expect("buildLayoutTypeResolver" in wrela.layout).toBe(false);
  expect("seedPrimitiveTypeFacts" in wrela.layout).toBe(false);
});
