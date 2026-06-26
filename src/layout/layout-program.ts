import type { BrandId, HirPlatformContractEdgeId } from "../hir/ids";
import type {
  CoreTypeId,
  DeviceSurfaceId,
  FieldId,
  FunctionId,
  ImageProfileId,
  ItemId,
  ParameterId,
  PlatformContractId,
  PlatformPrimitiveId,
  TargetId,
  TargetTypeId,
} from "../semantic/ids";
import type { SourceItemKind } from "../semantic/item-index/item-records";
import type { MonoInstanceId } from "../mono/ids";
import type { MonoInstantiatedProofId, MonomorphizedHirProgram } from "../mono/mono-hir";
import type {
  LayoutCanonicalKeyString,
  TargetCallConventionId,
  TargetWireReadHelperId,
} from "./ids";
import type {
  LayoutImageProfileSpec,
  LayoutPrimitiveKind,
  LayoutTargetSurface,
  WireIntegerEncoding,
  WireScalarEncoding,
} from "./target-layout";
import type { LayoutDiagnostic } from "./diagnostics";

export interface ComputeRepresentationLayoutFactsInput {
  readonly program: MonomorphizedHirProgram;
  readonly target: LayoutTargetSurface;
}

export type ComputeRepresentationLayoutFactsResult =
  | {
      readonly kind: "ok";
      readonly facts: LayoutFactProgram;
      readonly diagnostics: readonly LayoutDiagnostic[];
    }
  | {
      readonly kind: "error";
      readonly diagnostics: readonly LayoutDiagnostic[];
    };

export interface LayoutFactProgram {
  readonly target: TargetLayoutFacts;
  readonly types: LayoutTypeFactTable;
  readonly fields: LayoutFieldFactTable;
  readonly enums: LayoutEnumFactTable;
  readonly validatedBuffers: LayoutValidatedBufferFactTable;
  readonly imageDevices: LayoutImageDeviceFactTable;
  readonly functions: LayoutFunctionAbiFactTable;
  readonly platformEdges: LayoutPlatformAbiFactTable;
  readonly imageEntry: LayoutImageEntryAbiFact;
}

export interface TargetLayoutFacts {
  readonly targetId: TargetId;
  readonly endian: "little" | "big";
  readonly addressableUnit: "byte";
  readonly pointerWidthBits: 32 | 64;
  readonly pointerSizeBytes: bigint;
  readonly pointerAlignmentBytes: bigint;
  readonly sizeType: LayoutTypeKey;
  readonly maximumObjectSizeBytes: bigint;
  readonly maximumAlignmentBytes: bigint;
}

export type LayoutTypeKey =
  | { readonly kind: "source"; readonly instanceId: MonoInstanceId }
  | { readonly kind: "core"; readonly coreTypeId: CoreTypeId }
  | { readonly kind: "target"; readonly targetTypeId: TargetTypeId };

export interface LayoutFieldKey {
  readonly owner: LayoutTypeKey & { readonly kind: "source" };
  readonly fieldId: FieldId;
}

export interface LayoutImageDeviceKey {
  readonly imageInstanceId: MonoInstanceId;
  readonly fieldId: FieldId;
}

export interface LayoutDeterministicTable<Key, Value> {
  get(key: Key): Value | undefined;
  has(key: Key): boolean;
  entries(): readonly Value[];
  keyString(key: Key): LayoutCanonicalKeyString;
}

export type LayoutTypeFactTable = LayoutDeterministicTable<LayoutTypeKey, LayoutTypeFact>;
export type LayoutFieldFactTable = LayoutDeterministicTable<LayoutFieldKey, LayoutFieldFact>;
export type LayoutEnumFactTable = LayoutDeterministicTable<
  LayoutTypeKey & { readonly kind: "source" },
  LayoutEnumFact
>;
export type LayoutValidatedBufferFactTable = LayoutDeterministicTable<
  MonoInstanceId,
  LayoutValidatedBufferFact
>;
export type LayoutImageDeviceFactTable = LayoutDeterministicTable<
  LayoutImageDeviceKey,
  LayoutImageDeviceFact
>;
export type LayoutFunctionAbiFactTable = LayoutDeterministicTable<
  MonoInstanceId,
  LayoutFunctionAbiFact
>;
export type LayoutPlatformAbiFactTable = LayoutDeterministicTable<
  MonoInstantiatedProofId<HirPlatformContractEdgeId>,
  LayoutPlatformAbiFact
>;

export interface LayoutTypeFact {
  readonly key: LayoutTypeKey;
  readonly sizeBytes: bigint;
  readonly alignmentBytes: bigint;
  readonly strideBytes: bigint;
  readonly representation: LayoutTypeRepresentation;
  readonly aggregateStorage?: LayoutAggregateStorageFact;
  readonly sourceOrigin?: string;
}

export type LayoutTypeRepresentation =
  | { readonly kind: "primitive"; readonly primitive: LayoutPrimitiveKind }
  | { readonly kind: "aggregate"; readonly sourceKind: SourceItemKind }
  | { readonly kind: "enum" }
  | {
      readonly kind: "zeroSized";
      readonly reason: "unit" | "emptyAggregate" | "capabilityToken";
    }
  | { readonly kind: "never" };

export interface LayoutPaddingRange {
  readonly offsetBytes: bigint;
  readonly sizeBytes: bigint;
  readonly kind: "interField" | "trailing";
}

export interface LayoutHiddenStorageField {
  readonly name: string;
  readonly type: LayoutTypeKey;
  readonly offsetBytes: bigint;
  readonly sizeBytes: bigint;
  readonly alignmentBytes: bigint;
}

export interface LayoutAggregateStorageFact {
  readonly hiddenFields: readonly LayoutHiddenStorageField[];
  readonly paddingRanges: readonly LayoutPaddingRange[];
  readonly transitivePaddingRanges: readonly LayoutPaddingRange[];
  readonly trailingPaddingBytes: bigint;
  readonly paddingExposurePolicy: "fieldwiseCopyOnlyUntilInitialized";
}

export interface LayoutFieldFact {
  readonly owner: LayoutTypeKey & { readonly kind: "source" };
  readonly fieldId: FieldId;
  readonly fieldName: string;
  readonly fieldType: LayoutTypeKey;
  readonly offsetBytes: bigint;
  readonly sizeBytes: bigint;
  readonly alignmentBytes: bigint;
  readonly index: number;
  readonly paddingBeforeBytes: bigint;
  readonly sourceOrigin: string;
}

export interface LayoutEnumFact {
  readonly owner: LayoutTypeKey & { readonly kind: "source" };
  readonly tagType: LayoutTypeKey;
  readonly tagOffsetBytes: bigint;
  readonly cases: readonly LayoutEnumCaseFact[];
  readonly sourceOrigin: string;
}

export interface LayoutEnumCaseFact {
  readonly itemId: ItemId;
  readonly name: string;
  readonly ordinal: number;
  readonly discriminant: bigint;
  readonly sourceOrigin: string;
}

export interface LayoutValidatedBufferFact {
  readonly instanceId: MonoInstanceId;
  readonly typeKey: LayoutTypeKey & { readonly kind: "source" };
  readonly valueStorage: LayoutValidatedBufferValueStorageFact;
  readonly sourceLengthTerm: LayoutTerm;
  readonly layoutFields: readonly LayoutValidatedBufferFieldFact[];
  readonly derivedFields: readonly LayoutValidatedBufferDerivedFact[];
  readonly fixedEndBytes?: bigint;
  readonly sourceOrigin: string;
}

export interface LayoutValidatedBufferValueStorageFact {
  readonly sourcePointer: LayoutHiddenStorageField;
  readonly sourceLength: LayoutHiddenStorageField;
  readonly parameterFieldsStartOffsetBytes: bigint;
}

export interface LayoutValidatedBufferFieldFact {
  readonly fieldId: FieldId;
  readonly name: string;
  readonly elementType: LayoutTypeKey;
  readonly elementValueSizeBytes: bigint;
  readonly wire: LayoutWireTypeFact;
  readonly offset: LayoutTerm;
  readonly elementCount: LayoutTerm;
  readonly byteLength: LayoutTerm;
  readonly end: LayoutTerm;
  readonly readPolicy: LayoutWireReadPolicy;
  readonly readRequires: readonly LayoutReadRequirement[];
  readonly sourceOrigin: string;
}

export type LayoutWireTypeFact =
  | {
      readonly kind: "scalar";
      readonly type: LayoutTypeKey;
      readonly scalarEncoding: WireScalarEncoding;
      readonly wireSizeBytes: bigint;
      readonly wireStrideBytes: bigint;
      readonly wireCompatible: true;
      readonly reason: "scalar" | "targetProvided";
    }
  | {
      readonly kind: "aggregate";
      readonly type: LayoutTypeKey;
      readonly wireSizeBytes: bigint;
      readonly wireStrideBytes: bigint;
      readonly wireCompatible: true;
      readonly fields: readonly LayoutWireAggregateFieldFact[];
      readonly reservedRanges: readonly LayoutWireReservedRange[];
      readonly reason: "packedAggregate" | "targetProvided";
    };

export interface LayoutWireAggregateFieldFact {
  readonly fieldId: FieldId;
  readonly name: string;
  readonly type: LayoutTypeKey;
  readonly offsetBytes: bigint;
  readonly wire: LayoutWireTypeFact;
  readonly sourceOrigin: string;
}

export interface LayoutWireReservedRange {
  readonly offsetBytes: bigint;
  readonly sizeBytes: bigint;
  readonly meaning: "reservedProtocolBytes";
}

export type LayoutWireReadPolicy =
  | {
      readonly alignment: "unalignedSafe";
      readonly lowering: "bytewiseAssemble" | "targetSafeUnalignedLoad";
    }
  | {
      readonly alignment: "unalignedSafe";
      readonly lowering: "targetProvided";
      readonly helperId: TargetWireReadHelperId;
    };

export type LayoutTermUnit = "byteOffset" | "byteLength" | "elementCount" | "scalarValue";

export interface LayoutIntegerRange {
  readonly minimum: bigint;
  readonly maximum: bigint;
  readonly provenance:
    | "constant"
    | "checkedType"
    | "wireEncoding"
    | "sourceLength"
    | "derivedCases"
    | "arithmetic";
}

export type LayoutTerm =
  | {
      readonly kind: "constant";
      readonly value: bigint;
      readonly unit: LayoutTermUnit;
      readonly range: LayoutIntegerRange;
    }
  | {
      readonly kind: "sourceLength";
      readonly unit: "byteLength";
      readonly type: LayoutTypeKey;
      readonly range: LayoutIntegerRange;
    }
  | {
      readonly kind: "fieldValue";
      readonly fieldId: FieldId;
      readonly source: "parameter";
      readonly type: LayoutTypeKey;
      readonly unit: "scalarValue" | "elementCount" | "byteOffset" | "byteLength";
      readonly range: LayoutIntegerRange;
    }
  | {
      readonly kind: "fieldValue";
      readonly fieldId: FieldId;
      readonly source: "layout";
      readonly type: LayoutTypeKey;
      readonly unit: "scalarValue" | "elementCount" | "byteOffset" | "byteLength";
      readonly encoding: WireIntegerEncoding;
      readonly range: LayoutIntegerRange;
    }
  | {
      readonly kind: "fieldValue";
      readonly fieldId: FieldId;
      readonly source: "derived";
      readonly type: LayoutTypeKey;
      readonly unit: "scalarValue" | "elementCount" | "byteOffset" | "byteLength";
      readonly range: LayoutIntegerRange;
    }
  | {
      readonly kind: "derivedValue";
      readonly fieldId: FieldId;
      readonly type: LayoutTypeKey;
      readonly unit: LayoutTermUnit;
      readonly range: LayoutIntegerRange;
    }
  | {
      readonly kind: "add" | "subtract" | "multiply";
      readonly left: LayoutTerm;
      readonly right: LayoutTerm;
      readonly unit: LayoutTermUnit;
      readonly range: LayoutIntegerRange;
    };

export type LayoutReadRequirement =
  | { readonly kind: "layoutFits"; readonly end: LayoutTerm }
  | { readonly kind: "payloadEnd"; readonly end: LayoutTerm }
  | { readonly kind: "fieldAvailable"; readonly fieldId: FieldId }
  | {
      readonly kind: "rangeConstraint";
      readonly left: LayoutTerm;
      readonly relation: "<=" | "<" | ">=" | ">";
      readonly right: LayoutTerm;
      readonly width: LayoutTypeKey;
    }
  | {
      readonly kind: "noUnsignedOverflow";
      readonly expression: LayoutTerm;
      readonly width: LayoutTypeKey;
    };

export interface LayoutValidatedBufferDerivedFact {
  readonly fieldId: FieldId;
  readonly name: string;
  readonly type: LayoutTypeKey;
  readonly source: LayoutTerm;
  readonly cases: readonly LayoutDerivedCaseFact[];
  readonly sourceOrigin: string;
}

export interface LayoutDerivedCaseFact {
  readonly condition: LayoutDerivedCaseCondition;
  readonly result: LayoutTerm;
  readonly sourceOrigin: string;
}

export type LayoutDerivedCaseCondition =
  | { readonly kind: "equals"; readonly value: LayoutTerm }
  | { readonly kind: "otherwise" };

export interface LayoutImageDeviceFact {
  readonly key: LayoutImageDeviceKey;
  readonly deviceSurfaceId: DeviceSurfaceId;
  readonly deviceType: LayoutTypeKey;
  readonly representation:
    | { readonly kind: "zeroSizedCapability" }
    | {
        readonly kind: "targetHandle";
        readonly type: LayoutTypeKey;
        readonly layout: LayoutTypeFact;
      };
  readonly brandIds: readonly MonoInstantiatedProofId<BrandId>[];
  readonly sourceOrigin: string;
}

export interface LayoutFunctionAbiFact {
  readonly functionInstanceId: MonoInstanceId;
  readonly sourceFunctionId: FunctionId;
  readonly hiddenParameters: readonly LayoutAbiHiddenParameterFact[];
  readonly receiver?: LayoutAbiParameterFact;
  readonly parameters: readonly LayoutAbiParameterFact[];
  readonly returnValue: LayoutAbiReturnFact;
  readonly callConvention: TargetCallConventionId;
  readonly sourceOrigin: string;
}

export interface LayoutAbiParameterFact {
  readonly parameterId: ParameterId;
  readonly mode: "observe" | "consume";
  readonly type: LayoutTypeKey;
  readonly layout: LayoutTypeFact;
  readonly shape: LayoutAbiValueShape;
  readonly sourceOrigin: string;
}

export interface LayoutAbiReturnFact {
  readonly type: LayoutTypeKey;
  readonly layout: LayoutTypeFact;
  readonly shape: LayoutAbiValueShape;
  readonly sourceOrigin: string;
}

export interface LayoutAbiHiddenParameterFact {
  readonly kind: "sret" | "context" | "imageEntryThunk";
  readonly physicalIndex: number;
  readonly type: LayoutTypeKey;
  readonly shape: LayoutAbiPointerShape;
  readonly source: "targetAbi" | "imageProfile" | "platformPrimitive";
}

export interface LayoutAbiStackRequirement {
  readonly slotSizeBytes: bigint;
  readonly alignmentBytes: bigint;
  readonly paddingPolicy: "targetOwned";
}

export type LayoutAbiPointerProvenance =
  | "ordinaryAddress"
  | "validatedBufferSource"
  | "imageDevice"
  | "firmware"
  | "platformPrimitive";

export interface LayoutAbiPointerShape {
  readonly widthBits: 32 | 64;
  readonly sizeBytes: bigint;
  readonly alignmentBytes: bigint;
}

export type LayoutAbiLane =
  | {
      readonly kind: "integer";
      readonly sizeBytes: bigint;
      readonly alignmentBytes: bigint;
      readonly signedness: "signed" | "unsigned";
      readonly extension: "none" | "sign" | "zero";
    }
  | {
      readonly kind: "pointer";
      readonly sizeBytes: bigint;
      readonly alignmentBytes: bigint;
      readonly provenance: LayoutAbiPointerProvenance;
    }
  | {
      readonly kind: "float";
      readonly sizeBytes: bigint;
      readonly alignmentBytes: bigint;
      readonly format: "ieee754-binary32" | "ieee754-binary64" | "targetDefined";
    }
  | { readonly kind: "opaque"; readonly sizeBytes: bigint; readonly alignmentBytes: bigint };

export type LayoutAbiValueShape =
  | {
      readonly kind: "none";
      readonly reason: "unit" | "never" | "emptyAggregate" | "zeroSizedCapability";
      readonly proofCarrying: boolean;
    }
  | {
      readonly kind: "direct";
      readonly lanes: readonly LayoutAbiLane[];
      readonly stack?: LayoutAbiStackRequirement;
    }
  | {
      readonly kind: "indirect";
      readonly pointer: LayoutAbiPointerShape;
      readonly pointee: LayoutTypeKey;
      readonly ownership: "callerAllocated" | "calleeAllocated" | "borrowed";
      readonly hiddenParameter?: LayoutAbiHiddenParameterFact;
      readonly stack?: LayoutAbiStackRequirement;
    };

export interface LayoutPlatformAbiFact {
  readonly edgeId: MonoInstantiatedProofId<HirPlatformContractEdgeId>;
  readonly primitiveId: PlatformPrimitiveId;
  readonly contractId: PlatformContractId;
  readonly targetId: TargetId;
  readonly hiddenParameters: readonly LayoutAbiHiddenParameterFact[];
  readonly arguments: readonly LayoutAbiValueShape[];
  readonly result: LayoutAbiValueShape;
  readonly callConvention: TargetCallConventionId;
  readonly sourceOrigin: string;
}

export interface LayoutImageEntryAbiFact {
  readonly imageInstanceId: MonoInstanceId;
  readonly entryFunctionInstanceId?: MonoInstanceId;
  readonly profileId: ImageProfileId;
  readonly physicalProfile: LayoutImageProfileSpec;
  readonly physicalEntryArguments: readonly LayoutAbiValueShape[];
  readonly sourceEntryArguments: readonly LayoutAbiValueShape[];
  readonly sourceEntryReturn: LayoutAbiValueShape;
  readonly thunkConversions: readonly LayoutImageEntryThunkConversion[];
  readonly result: LayoutAbiValueShape;
  readonly physicalCallConvention: TargetCallConventionId;
  readonly sourceCallConvention: TargetCallConventionId;
  readonly sourceOrigin: string;
}

export interface LayoutImageEntryThunkConversion {
  readonly source: "firmwareArgument" | "compilerInitializedCapability";
  readonly targetParameterIndex: number;
  readonly sourceEntryParameterId?: ParameterId;
  readonly shape: LayoutAbiValueShape;
}
