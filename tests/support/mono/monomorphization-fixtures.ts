import type {
  HirCertifiedPlatformBindingTable,
  HirConstructorKindRuleRecord,
  HirDeclaration,
  HirDeclarationTable,
  HirFieldRecord,
  HirFieldTable,
  HirFunction,
  HirFunctionTable,
  HirImage,
  HirImageTable,
  HirInstanceEligibilityRuleRecord,
  HirInstanceEligibilityRuleTable,
  HirMonoClosureSurface,
  HirObligation,
  HirResourcePlace,
  HirStatement,
  HirSourceTypeKindRecord,
  HirSourceTypeKindTable,
  HirTargetTypeKindRecord,
  HirTargetTypeKindTable,
  HirTerminalCall,
  HirTypeRecord,
  HirTypeTable,
  HirValidatedBuffer,
  HirValidatedBufferTable,
  TypedHirProgram,
} from "../../../src/hir/hir";
import type { CertifiedPlatformBinding } from "../../../src/semantic/surface/checked-program";
import { HirProofMetadataBuilder } from "../../../src/hir/proof-metadata";
import { hirTable } from "../../../src/hir/hir-table";
import { createHirOriginAllocator, type HirOriginTable } from "../../../src/hir/origin";
import { errorKind, parametricKind } from "../../../src/semantic/surface/resource-kind";
import {
  errorCheckedType,
  genericParameterCheckedType,
} from "../../../src/semantic/surface/type-model";
import type {
  FieldId,
  FunctionId,
  ImageId,
  ItemId,
  PlatformPrimitiveId,
  TypeId,
} from "../../../src/semantic/ids";
import { coreTypeId, functionId, itemId, targetTypeId, typeId } from "../../../src/semantic/ids";
import { fieldId } from "../../../src/semantic/ids";
import {
  concreteKind,
  type CheckedResourceKind,
  type ConcreteResourceKind,
  type TypeParameterKey,
} from "../../../src/semantic/surface/resource-kind";
import {
  appliedType,
  coreCheckedType,
  sourceCheckedType,
  type CheckedType,
  type TypeConstructorId,
} from "../../../src/semantic/surface/type-model";
import {
  hirLocalId,
  hirOriginId,
  ownedBrandId,
  ownedObligationId,
  ownedResourcePlaceId,
  ownedSessionId,
} from "../../../src/hir/ids";
import { type MonoCheckedType, type MonomorphizedHirProgram } from "../../../src/mono/mono-hir";
import type { MonoDiagnostic } from "../../../src/mono/diagnostics";
import { type MonoInstanceId, monoInstanceId } from "../../../src/mono/ids";
import { monoPlatformContractEdgeKey } from "../../../src/mono/mono-hir";
import {
  type MonoTypeNormalizationContext,
  normalizeMonoCheckedType,
} from "../../../src/mono/instantiation-key";
import type { MonoSubstitution } from "../../../src/mono/substitution";
import {
  type ConcretizeFieldKindsResult,
  type FieldKindProvider,
  type MonoResourceKindConcretizationContext,
} from "../../../src/mono/resource-kind-concretizer";
import { lowerTypedHirForTest } from "../hir/typed-hir-fixtures";
import { targetWithCertifiedExit, targetWithSerialDevice } from "../hir/typed-hir-fakes";
import { instantiateMonoFunctionShell } from "../../../src/mono/function-instantiator";
import type { MonoFunctionKey, MonoTypeKey } from "./monomorphization-fakes";
import type { MonoTypeAncestry } from "../../../src/mono/type-instantiator";
import { monoTypeAncestry } from "../../../src/mono/type-instantiator";

export type { MonoFunctionKey, MonoTypeKey } from "./monomorphization-fakes";

export function minimalSelectedImageProgramForMonoTest(options?: {
  readonly images?: readonly HirImage[];
  readonly functions?: readonly HirFunction[];
  readonly types?: readonly HirTypeRecord[];
  readonly fields?: readonly HirFieldRecord[];
}): TypedHirProgram {
  const result = lowerTypedHirForTest([["main.wr", "uefi image Boot:\n    fn main() -> Never\n"]]);
  const program = result.program;
  if (options?.images !== undefined) {
    const images: HirImageTable = hirTable({
      entries: options.images,
      keyOf: (image) => `${image.imageId}`,
      lookupKeyOf: (id) => `${id}`,
    });
    return { ...program, images };
  }
  if (options?.functions !== undefined) {
    const functions: HirFunctionTable = hirTable({
      entries: options.functions,
      keyOf: (func) => `${func.functionId}`,
      lookupKeyOf: (id) => `${id}`,
    });
    return { ...program, functions };
  }
  if (options?.types !== undefined) {
    const types: HirTypeTable = hirTable({
      entries: options.types,
      keyOf: (record) => `${record.typeId}`,
      lookupKeyOf: (id) => `${id}`,
    });
    return { ...program, types };
  }
  if (options?.fields !== undefined) {
    const fields: HirFieldTable = hirTable({
      entries: options.fields,
      keyOf: (record) => `${record.fieldId}`,
      lookupKeyOf: (id) => `${id}`,
    });
    return { ...program, fields };
  }
  return program;
}

export function minimalClosedProgramForMonoTest(): TypedHirProgram {
  const source = ["uefi image Boot:", "    fn main() -> Never:", "        return"].join("\n");
  const result = lowerTypedHirForTest([["main.wr", source]]);
  return result.program;
}

export function genericPacketProgramForMonoTest(): TypedHirProgram {
  const source = [
    "enum PacketKind:",
    "    Arp",
    "    Ipv4",
    "",
    "class Packet:",
    "    kind: PacketKind",
    "    size: u32",
    "    fn sizeValue(self) -> u32:",
    "        return 0",
    "",
    "uefi image Boot:",
    "    fn main() -> Never:",
    "        return",
  ].join("\n");
  const base = lowerTypedHirForTest([["main.wr", source]]).program;
  const packetType = base.types.entries().find((record) => record.sourceKind === "class");
  const method = base.functions.entries().find((func) => func.ownerTypeId === packetType?.typeId);
  if (packetType === undefined || method === undefined) {
    throw new Error("Expected Packet class and sizeValue method in generic packet fixture.");
  }
  return {
    ...base,
    monoClosure: {
      ...base.monoClosure,
      externalEntryRoots: [
        ...base.monoClosure.externalEntryRoots,
        {
          functionId: method.functionId,
          ownerTypeArguments: [],
          functionTypeArguments: [],
          reason: "targetRequired",
          sourceOrigin: method.sourceOrigin,
        },
      ],
    },
  };
}

export function imageDeviceProgramForMonoTest(): TypedHirProgram {
  const source = [
    "class SerialDevice:",
    "uefi image Boot:",
    "    devices:",
    "        serial: SerialDevice",
    "    fn main() -> Never:",
    "        return",
  ].join("\n");
  const result = lowerTypedHirForTest([["main.wr", source]], {
    targetSurface: targetWithSerialDevice(["rx", "tx"]),
  });
  return result.program;
}

export function functionSignatureSourceTypeClosureProgramForMonoTest(): TypedHirProgram {
  const base = minimalClosedProgramForMonoTest();
  const image = base.images.entries()[0];
  if (image?.entryFunctionId === undefined) {
    throw new Error("Expected minimal closed program to have an entry function.");
  }

  const outerTypeId = typeId(40);
  const outerItemId = itemId(40);
  const innerTypeId = typeId(41);
  const innerItemId = itemId(41);
  const innerFieldId = fieldId(400);
  const innerType = sourceCheckedType({ itemId: innerItemId, typeId: innerTypeId });
  const outerType = sourceCheckedType({ itemId: outerItemId, typeId: outerTypeId });

  const outerRecord: HirTypeRecord = {
    typeId: outerTypeId,
    itemId: outerItemId,
    sourceKind: "class",
    declaredTypeParameters: [],
    fieldIds: [innerFieldId],
    enumCases: [],
    resourceKind: concreteKind("Copy"),
    sourceOrigin: hirOriginId(0),
  };
  const innerRecord: HirTypeRecord = {
    typeId: innerTypeId,
    itemId: innerItemId,
    sourceKind: "class",
    declaredTypeParameters: [],
    fieldIds: [],
    enumCases: [],
    resourceKind: concreteKind("UniqueEdgeRoot"),
    sourceOrigin: hirOriginId(0),
  };
  const innerField: HirFieldRecord = {
    fieldId: innerFieldId,
    ownerTypeId: outerTypeId,
    name: "inner",
    type: innerType,
    resourceKind: concreteKind("UniqueEdgeRoot"),
    sourceOrigin: hirOriginId(0),
  };

  const functions = base.functions.entries().map((func) =>
    func.functionId === image.entryFunctionId
      ? {
          ...func,
          signature: {
            ...func.signature,
            returnType: outerType,
            returnKind: concreteKind("Copy"),
          },
        }
      : func,
  );

  const types: HirTypeTable = hirTable<TypeId, HirTypeRecord>({
    entries: [outerRecord, innerRecord],
    keyOf: (entry) => String(entry.typeId).padStart(12, "0"),
    lookupKeyOf: (id) => String(id).padStart(12, "0"),
  });
  const fields: HirFieldTable = hirTable<FieldId, HirFieldRecord>({
    entries: [innerField],
    keyOf: (entry) => String(entry.fieldId).padStart(12, "0"),
    lookupKeyOf: (id) => String(id).padStart(12, "0"),
  });
  const functionTable: HirFunctionTable = hirTable<FunctionId, HirFunction>({
    entries: functions,
    keyOf: (entry) => String(entry.functionId).padStart(12, "0"),
    lookupKeyOf: (id) => String(id).padStart(12, "0"),
  });
  const sourceTypeKinds: HirSourceTypeKindTable = hirTable<TypeId, HirSourceTypeKindRecord>({
    entries: [
      { typeId: outerTypeId, kind: concreteKind("Copy"), sourceOrigin: hirOriginId(0) },
      { typeId: innerTypeId, kind: concreteKind("UniqueEdgeRoot"), sourceOrigin: hirOriginId(0) },
    ],
    keyOf: (entry) => String(entry.typeId).padStart(12, "0"),
    lookupKeyOf: (id) => String(id).padStart(12, "0"),
  });
  const constructorKindRules = hirTable<TypeConstructorId, HirConstructorKindRuleRecord>({
    entries: [
      {
        constructor: { kind: "source", typeId: outerTypeId },
        rule: "fieldAggregation",
        sourceOrigin: hirOriginId(0),
      },
      {
        constructor: { kind: "source", typeId: innerTypeId },
        rule: "fieldAggregation",
        sourceOrigin: hirOriginId(0),
      },
    ],
    keyOf: (entry) => constructorKey(entry.constructor),
    lookupKeyOf: (id) => constructorKey(id),
  });

  return {
    ...base,
    functions: functionTable,
    types,
    fields,
    monoClosure: {
      ...base.monoClosure,
      sourceTypeKinds,
      constructorKindRules,
    },
  };
}

export function unresolvedGenericAtBoundaryProgramForMonoTest(): TypedHirProgram {
  const base = minimalClosedProgramForMonoTest();
  const image = base.images.entries()[0];
  if (image?.entryFunctionId === undefined) {
    throw new Error("Expected minimal closed program to have an entry function.");
  }
  const unresolved = genericParameterCheckedType({
    owner: { kind: "item", itemId: itemId(999) },
    index: 0,
  });
  const functions = base.functions.entries().map((func) =>
    func.functionId === image.entryFunctionId
      ? {
          ...func,
          signature: {
            ...func.signature,
            returnType: unresolved,
            parameters: func.signature.parameters.map((parameter) => ({
              ...parameter,
              type: unresolved,
            })),
          },
        }
      : func,
  );
  return {
    ...base,
    functions: hirTable<FunctionId, HirFunction>({
      entries: functions,
      keyOf: (entry) => String(entry.functionId).padStart(12, "0"),
      lookupKeyOf: (id) => String(id).padStart(12, "0"),
    }),
  };
}

export function genericIdentityFunctionProgramForMonoTest(): TypedHirProgram {
  const source = [
    "fn f0() -> u8",
    "fn f1() -> u8",
    "fn f2() -> u8",
    "fn id[U](value: U) -> U:",
    "    return value",
    "uefi image Boot:",
    "    fn main() -> Never",
  ].join("\n");
  const result = lowerTypedHirForTest([["main.wr", source]]);
  return result.program;
}

export function callIntoGenericFunctionProgramForMonoTest(): TypedHirProgram {
  const source = [
    "fn target[U](value: U) -> U:",
    "    return value",
    "fn caller() -> u32:",
    "    return target[u32](0)",
    "uefi image Boot:",
    "    fn main() -> Never",
  ].join("\n");
  const result = lowerTypedHirForTest([["main.wr", source]]);
  return result.program;
}

export function errorExpressionBodyProgramForMonoTest(): TypedHirProgram {
  const source = [
    "fn f0() -> u8:",
    "    return missing",
    "uefi image Boot:",
    "    fn main() -> Never",
  ].join("\n");
  const result = lowerTypedHirForTest([["main.wr", source]]);
  return result.program;
}

export function twoCallSitesSameGenericInstanceProgramForMonoTest(): TypedHirProgram {
  const source = [
    "fn f0() -> u8",
    "fn f1() -> u8",
    "fn f2() -> u8",
    "fn f3() -> u8",
    "fn f4() -> u8",
    "fn f5() -> u8",
    "fn f6() -> u8",
    "fn f7() -> u8",
    "fn f8() -> u8",
    "fn id[U](value: U) -> U:",
    "    return value",
    "uefi image Boot:",
    "    fn main() -> u32:",
    "        return id[u32](id[u32](0))",
  ].join("\n");
  const result = lowerTypedHirForTest([["main.wr", source]]);
  return result.program;
}

export function mutualFunctionRecursionProgramForMonoTest(): TypedHirProgram {
  const source = [
    "fn ping() -> Never:",
    "    return pong()",
    "fn pong() -> Never:",
    "    return ping()",
    "uefi image Boot:",
    "    fn main() -> Never:",
    "        return ping()",
  ].join("\n");
  const result = lowerTypedHirForTest([["main.wr", source]]);
  return result.program;
}

export function instantiateShellOk(
  program: TypedHirProgram,
  options?: {
    readonly functionId?: FunctionId;
    readonly ownerTypeId?: TypeId;
    readonly ownerTypeArguments?: readonly MonoCheckedType[];
    readonly functionTypeArguments?: readonly MonoCheckedType[];
  },
): {
  readonly instance: import("../../../src/mono/mono-hir").MonoFunctionInstance;
  readonly substitution: import("../../../src/mono/substitution").MonoSubstitution;
  readonly remap: import("../../../src/mono/function-instantiator").MonoFunctionRemap;
} {
  const functions = program.functions.entries();
  if (functions.length === 0) {
    throw new Error("instantiateShellOk requires a program with at least one function");
  }
  const targetFunction =
    options?.functionId !== undefined
      ? functions.find((func) => func.functionId === options.functionId)
      : functions[0];
  if (targetFunction === undefined) {
    throw new Error(
      `instantiateShellOk could not find function ${String(options?.functionId)} in program`,
    );
  }
  const image = program.images.entries()[0];
  const imageId = image?.imageId ?? (0 as never);
  const result = instantiateMonoFunctionShell({
    program,
    key: {
      functionId: targetFunction.functionId,
      ...(options?.ownerTypeId !== undefined ? { ownerTypeId: options.ownerTypeId } : {}),
      ownerTypeArguments: options?.ownerTypeArguments ?? [],
      functionTypeArguments: options?.functionTypeArguments ?? [],
    },
    source: { kind: "image", imageId },
  });
  if (result.kind === "error") {
    throw new Error(
      `instantiateShellOk failed: ${result.diagnostics.map((diagnostic) => String(diagnostic.code)).join(",")}`,
    );
  }
  return {
    instance: result.instance,
    substitution: result.substitution,
    remap: result.remap,
  };
}

export function bodylessRecoveryFunctionProgramForMonoTest(): TypedHirProgram {
  const source = [
    "fn f0() -> u8",
    "fn f1() -> u8",
    "fn f2() -> u8",
    "fn f3() -> u8",
    "fn bodyless() -> u8",
    "uefi image Boot:",
    "    fn main() -> Never",
  ].join("\n");
  const result = lowerTypedHirForTest([["main.wr", source]]);
  return result.program;
}

export function monoCoreType(name: "u8" | "u32" | "bool" | "Never" | "void"): MonoCheckedType {
  return normalizeOk(coreCheckedType(coreTypeId(name)));
}

export function monoSourceTypeWithKind(kind: ConcreteResourceKind): MonoCheckedType {
  return appliedSourceTypeForMonoTest({
    sourceTypeId: typeId(0),
    argumentKinds: [concreteKind(kind)],
  });
}

export function normalizeOk(type: CheckedType): MonoCheckedType {
  const result = normalizeMonoCheckedType(type, normalizationContextForTypeFake(type));
  if (result.kind === "error") {
    throw new Error(result.diagnostics.map((diagnostic) => String(diagnostic.code)).join(","));
  }
  return result.type;
}

export function monoNormalizationContextFake(
  overrides?: Partial<MonoTypeNormalizationContext>,
): MonoTypeNormalizationContext {
  const emptyTable = {
    get: () => undefined,
    has: () => false,
    entries: () => [],
  };
  return {
    targetTypeKinds: emptyTable,
    constructorKindRules: emptyTable,
    sourceOrigin: hirOriginId(0),
    ...overrides,
  };
}

function normalizationContextForTypeFake(type: CheckedType): MonoTypeNormalizationContext {
  const sourceTypeIds = collectSourceConstructorTypeIds(type);
  if (sourceTypeIds.length === 0) return monoNormalizationContextFake();
  const entries: HirConstructorKindRuleRecord[] = sourceTypeIds.map((sourceTypeId) => ({
    constructor: { kind: "source", typeId: sourceTypeId },
    rule: "fieldAggregation",
    sourceOrigin: hirOriginId(0),
  }));
  return monoNormalizationContextFake({
    constructorKindRules: hirTable({
      entries,
      keyOf: (entry) => constructorKey(entry.constructor),
      lookupKeyOf: (id) => constructorKey(id),
    }),
  });
}

function collectSourceConstructorTypeIds(type: CheckedType): readonly TypeId[] {
  const sourceTypeIds = new Map<string, TypeId>();
  function visit(current: CheckedType): void {
    switch (current.kind) {
      case "source":
        sourceTypeIds.set(String(current.typeId), current.typeId);
        return;
      case "applied":
        if (current.constructor.kind === "source") {
          sourceTypeIds.set(String(current.constructor.typeId), current.constructor.typeId);
        }
        for (const argument of current.arguments) visit(argument);
        return;
      case "core":
      case "target":
      case "genericParameter":
      case "error":
        return;
    }
  }
  visit(type);
  return [...sourceTypeIds.values()];
}

export function monoTypeKeyForTest(input: {
  readonly typeId: TypeId;
  readonly typeArguments: readonly MonoCheckedType[];
}): MonoTypeKey {
  return { typeId: input.typeId, typeArguments: input.typeArguments };
}

export function monoFunctionKeyForTest(input: {
  readonly functionId: FunctionId;
  readonly ownerTypeId?: TypeId;
  readonly ownerTypeArguments: readonly MonoCheckedType[];
  readonly functionTypeArguments: readonly MonoCheckedType[];
}): MonoFunctionKey {
  return {
    functionId: input.functionId,
    ...(input.ownerTypeId !== undefined ? { ownerTypeId: input.ownerTypeId } : {}),
    ownerTypeArguments: input.ownerTypeArguments,
    functionTypeArguments: input.functionTypeArguments,
  };
}

export function monoInstanceIdForTest(key: string): MonoInstanceId {
  return monoInstanceId(key);
}

export function monoSummary(result: {
  readonly kind: "ok" | "error";
  readonly diagnostics: readonly MonoDiagnostic[];
  readonly reachablePlatformPrimitiveIds?: readonly PlatformPrimitiveId[];
  readonly program?: MonomorphizedHirProgram;
}): string {
  return JSON.stringify({
    kind: result.kind,
    diagnostics: stableSummaryValue(result.diagnostics),
    primitiveIds:
      result.kind === "ok" ? stableSummaryValue(result.reachablePlatformPrimitiveIds) : [],
    program:
      result.kind === "ok" && result.program !== undefined
        ? monomorphizedProgramSummary(result.program)
        : undefined,
  });
}

function monomorphizedProgramSummary(program: MonomorphizedHirProgram): unknown {
  return stableSummaryValue({
    image: program.image,
    functions: program.functions.entries(),
    types: program.types.entries(),
    validatedBuffers: program.validatedBuffers.entries(),
    proofMetadata: {
      obligations: program.proofMetadata.obligations.entries(),
      sessions: program.proofMetadata.sessions.entries(),
      brands: program.proofMetadata.brands.entries(),
      resourcePlaces: program.proofMetadata.resourcePlaces.entries(),
      callSiteRequirements: program.proofMetadata.callSiteRequirements.entries(),
      validations: program.proofMetadata.validations.entries(),
      attempts: program.proofMetadata.attempts.entries(),
      terminalCalls: program.proofMetadata.terminalCalls.entries(),
      privateStateTransitions: program.proofMetadata.privateStateTransitions.entries(),
      factOrigins: program.proofMetadata.factOrigins.entries(),
      platformContractEdges: program.proofMetadata.platformContractEdges.entries(),
      imageOrigins: program.proofMetadata.imageOrigins.entries(),
    },
    instantiationGraph: program.instantiationGraph,
    origins: program.origins.originRecords(),
    reachablePlatformPrimitiveIds: program.reachablePlatformPrimitiveIds,
  });
}

function stableSummaryValue(value: unknown): unknown {
  if (typeof value === "bigint") return `${value.toString()}n`;
  if (Array.isArray(value)) return value.map(stableSummaryValue);
  if (value instanceof Map) {
    return [...value.entries()]
      .map(([key, entryValue]) => [stableSummaryValue(key), stableSummaryValue(entryValue)])
      .sort((left, right) => JSON.stringify(left[0]).localeCompare(JSON.stringify(right[0])));
  }
  if (value instanceof Set) {
    return [...value.values()]
      .map(stableSummaryValue)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entryValue]) => entryValue !== undefined && typeof entryValue !== "function")
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, stableSummaryValue(entryValue)]),
    );
  }
  return value;
}

export interface MonoConcretizationContextOverrides {
  readonly constructorRule?: HirConstructorKindRuleRecord;
  readonly sourceTypeKind?: HirSourceTypeKindRecord;
  readonly targetTypeKind?: HirTargetTypeKindRecord;
  readonly fieldKindProvider?: FieldKindProvider;
  readonly substitution?: MonoSubstitution;
  readonly canonicalInstanceKey?: string;
}

export function monoConcretizationContextFake(
  overrides: MonoConcretizationContextOverrides = {},
): MonoResourceKindConcretizationContext {
  const program = minimalSelectedImageProgramForMonoTest();
  const constructorKindRules = overrides.constructorRule
    ? hirTable<HirConstructorKindRuleRecord["constructor"], HirConstructorKindRuleRecord>({
        entries: [overrides.constructorRule],
        keyOf: (entry) => constructorKey(entry.constructor),
        lookupKeyOf: (id) => constructorKey(id),
      })
    : emptyHirConstructorKindRuleTable();
  const targetTypeKinds = overrides.targetTypeKind
    ? hirTable<HirTargetTypeKindRecord["targetTypeId"], HirTargetTypeKindRecord>({
        entries: [overrides.targetTypeKind],
        keyOf: (entry) => `${entry.targetTypeId}`,
        lookupKeyOf: (id) => `${id}`,
      })
    : emptyHirTargetTypeKindTable();
  const sourceTypeKinds = overrides.sourceTypeKind
    ? hirTable<HirSourceTypeKindRecord["typeId"], HirSourceTypeKindRecord>({
        entries: [overrides.sourceTypeKind],
        keyOf: (entry) => `${entry.typeId}`,
        lookupKeyOf: (id) => `${id}`,
      })
    : program.monoClosure.sourceTypeKinds;
  const monoClosure = {
    ...program.monoClosure,
    constructorKindRules,
    sourceTypeKinds,
    targetTypeKinds,
  };
  return {
    program: { ...program, monoClosure },
    substitution: overrides.substitution ?? emptyMonoSubstitutionForTest(),
    fieldKindProvider: overrides.fieldKindProvider ?? defaultFieldKindProviderForTest(),
    canonicalInstanceKey: overrides.canonicalInstanceKey ?? "mono-test:instance",
  };
}

export function appliedSourceTypeForMonoTest(input: {
  readonly sourceTypeId: TypeId;
  readonly argumentKinds: readonly CheckedResourceKind[];
  readonly argumentTypes?: readonly MonoCheckedType[];
}): MonoCheckedType {
  const argumentTypes = input.argumentTypes ?? input.argumentKinds.map(() => monoCoreType("u8"));
  const result = normalizeMonoCheckedType(
    appliedType({
      constructor: { kind: "source", typeId: input.sourceTypeId },
      arguments: argumentTypes,
      resourceKind: input.argumentKinds[0] ?? concreteKind("Copy"),
    }),
    monoNormalizationContextFake({
      constructorKindRules: hirTable({
        entries: [
          {
            constructor: { kind: "source", typeId: input.sourceTypeId },
            rule: "appliedConstructor",
            resultKind: input.argumentKinds[0] ?? concreteKind("Copy"),
            sourceOrigin: hirOriginId(0),
          },
        ],
        keyOf: (entry) => constructorKey(entry.constructor),
        lookupKeyOf: (id) => constructorKey(id),
      }),
    }),
  );
  if (result.kind === "error") {
    throw new Error(result.diagnostics.map((diagnostic) => String(diagnostic.code)).join(","));
  }
  return result.type;
}

function emptyMonoSubstitutionForTest(): MonoSubstitution {
  return { map: new Map(), sourceOrigin: hirOriginId(0) };
}

function defaultFieldKindProviderForTest(): FieldKindProvider {
  return {
    fieldKindsForType(): ConcretizeFieldKindsResult {
      return { kind: "ok", fieldKinds: ["Copy"] };
    },
  };
}

function emptyHirConstructorKindRuleTable() {
  return hirTable<TypeConstructorId, HirConstructorKindRuleRecord>({
    entries: [],
    keyOf: (entry) => constructorKey(entry.constructor),
    lookupKeyOf: (id) => constructorKey(id),
  });
}

function emptyHirTargetTypeKindTable() {
  return hirTable<ReturnType<typeof targetTypeId>, HirTargetTypeKindRecord>({
    entries: [],
    keyOf: (entry) => `${entry.targetTypeId}`,
    lookupKeyOf: (id) => `${id}`,
  });
}

function constructorKey(constructor: TypeConstructorId): string {
  switch (constructor.kind) {
    case "source":
      return `source:${constructor.typeId}`;
    case "core":
      return `core:${constructor.coreTypeId}`;
    case "target":
      return `target:${constructor.targetTypeId}`;
  }
}

export function proofMetadataProgramForMonoTest(): TypedHirProgram {
  const functionThreeOwner = { kind: "function" as const, functionId: functionId(3) };
  const resourcePlace: HirResourcePlace = {
    placeId: ownedResourcePlaceId(functionThreeOwner, 0),
    canonicalKey: "function:3/root:local:0/projection:/type:error/kind:error",
    root: { kind: "local", localId: hirLocalId(0) },
    projection: [],
    type: errorCheckedType(),
    resourceKind: errorKind(),
    kind: "local",
    localId: hirLocalId(0),
    sourceOrigin: hirOriginId(0),
  };
  const obligation: HirObligation = {
    obligationId: ownedObligationId(functionThreeOwner.functionId, 0),
    kind: "callRequirement",
    sourceOrigin: hirOriginId(0),
  };
  const proofMetadata = new HirProofMetadataBuilder()
    .addResourcePlace(resourcePlace)
    .addObligation(obligation)
    .build();
  return {
    declarations: emptyDeclarationTableForTest(),
    types: emptyTypeTableForTest(),
    fields: emptyFieldTableForTest(),
    functions: emptyFunctionTableForTest(),
    validatedBuffers: emptyValidatedBufferTableForTest(),
    images: emptyImageTableForTest(),
    proofMetadata,
    monoClosure: emptyMonoClosureSurfaceForTest(),
    origins: emptyOriginTableForTest(),
  };
}

function emptyDeclarationTableForTest(): HirDeclarationTable {
  return hirTable<ItemId, HirDeclaration>({
    entries: [],
    keyOf: (entry) => String(entry.itemId).padStart(12, "0"),
    lookupKeyOf: (id) => String(id).padStart(12, "0"),
  });
}

function emptyTypeTableForTest(): HirTypeTable {
  return hirTable<TypeId, HirTypeRecord>({
    entries: [],
    keyOf: (entry) => String(entry.typeId).padStart(12, "0"),
    lookupKeyOf: (id) => String(id).padStart(12, "0"),
  });
}

function emptyFieldTableForTest(): HirFieldTable {
  return hirTable<FieldId, HirFieldRecord>({
    entries: [],
    keyOf: (entry) => String(entry.fieldId).padStart(12, "0"),
    lookupKeyOf: (id) => String(id).padStart(12, "0"),
  });
}

function emptyFunctionTableForTest(): HirFunctionTable {
  return hirTable<FunctionId, HirFunction>({
    entries: [],
    keyOf: (entry) => String(entry.functionId).padStart(12, "0"),
    lookupKeyOf: (id) => String(id).padStart(12, "0"),
  });
}

function emptyValidatedBufferTableForTest(): HirValidatedBufferTable {
  return hirTable<TypeId, HirValidatedBuffer>({
    entries: [],
    keyOf: (entry) => String(entry.typeId).padStart(12, "0"),
    lookupKeyOf: (id) => String(id).padStart(12, "0"),
  });
}

function emptyImageTableForTest(): HirImageTable {
  return hirTable<ImageId, HirImage>({
    entries: [],
    keyOf: (entry) => String(entry.imageId).padStart(12, "0"),
    lookupKeyOf: (id) => String(id).padStart(12, "0"),
  });
}

function emptyMonoClosureSurfaceForTest(): HirMonoClosureSurface {
  return {
    sourceTypeKinds: emptySourceTypeKindTableForTest(),
    targetTypeKinds: emptyTargetTypeKindTableForTest(),
    constructorKindRules: emptyConstructorKindRuleTableForTest(),
    instanceEligibilityRules: emptyInstanceEligibilityRuleTableForTest(),
    certifiedPlatformBindings: emptyCertifiedPlatformBindingTableForTest(),
    externalEntryRoots: [],
  };
}

function emptyCertifiedPlatformBindingTableForTest(): HirCertifiedPlatformBindingTable {
  return hirTable<FunctionId, CertifiedPlatformBinding>({
    entries: [],
    keyOf: (entry) => String(entry.functionId).padStart(12, "0"),
    lookupKeyOf: (id) => String(id).padStart(12, "0"),
  });
}

function emptySourceTypeKindTableForTest(): HirSourceTypeKindTable {
  return hirTable<TypeId, HirSourceTypeKindRecord>({
    entries: [],
    keyOf: (entry) => String(entry.typeId).padStart(12, "0"),
    lookupKeyOf: (id) => String(id).padStart(12, "0"),
  });
}

function emptyTargetTypeKindTableForTest(): HirTargetTypeKindTable {
  return hirTable<ReturnType<typeof targetTypeId>, HirTargetTypeKindRecord>({
    entries: [],
    keyOf: (entry) => `${entry.targetTypeId}`,
    lookupKeyOf: (id) => `${id}`,
  });
}

function emptyConstructorKindRuleTableForTest() {
  return hirTable<TypeConstructorId, HirConstructorKindRuleRecord>({
    entries: [],
    keyOf: (entry) => constructorKey(entry.constructor),
    lookupKeyOf: (id) => constructorKey(id),
  });
}

function emptyInstanceEligibilityRuleTableForTest(): HirInstanceEligibilityRuleTable {
  return hirTable<string, HirInstanceEligibilityRuleRecord>({
    entries: [],
    keyOf: (entry) => eligibilityRuleKey(entry.owner),
    lookupKeyOf: (key) => key,
  });
}

export function eligibilityRuleTableFake(
  records: readonly HirInstanceEligibilityRuleRecord[],
): HirInstanceEligibilityRuleTable {
  return hirTable<string, HirInstanceEligibilityRuleRecord>({
    entries: records,
    keyOf: (entry) => eligibilityRuleKey(entry.owner),
    lookupKeyOf: (key) => key,
  });
}

function eligibilityRuleKey(owner: HirInstanceEligibilityRuleRecord["owner"]): string {
  switch (owner.kind) {
    case "function":
      return `function:${owner.functionId}`;
    case "type":
      return `type:${owner.typeId}`;
  }
}

function emptyOriginTableForTest(): HirOriginTable {
  return createHirOriginAllocator();
}

export function genericBoxProgramForMonoTest(): TypedHirProgram {
  const source = [
    "enum Color:",
    "    Red",
    "class Box[T]:",
    "    value: T",
    "uefi image Boot:",
    "    fn main() -> Never",
  ].join("\n");
  const result = lowerTypedHirForTest([["main.wr", source]]);
  return result.program;
}

export function programWithDanglingTypeFieldForMonoTest(): TypedHirProgram {
  const base = genericBoxProgramForMonoTest();
  const extraType: HirTypeRecord = {
    typeId: 2 as TypeId,
    itemId: 2 as never,
    sourceKind: "class",
    declaredTypeParameters: [],
    fieldIds: [999 as never],
    enumCases: [],
    resourceKind: errorKind(),
    sourceOrigin: hirOriginId(0),
  };
  const typeTable = hirTable<TypeId, HirTypeRecord>({
    entries: [...base.types.entries(), extraType],
    keyOf: (entry) => String(entry.typeId).padStart(12, "0"),
    lookupKeyOf: (id) => String(id).padStart(12, "0"),
  });
  return { ...base, types: typeTable };
}

export function genericValidatedBufferProgramForMonoTest(): TypedHirProgram {
  const base = proofMetadataProgramForMonoTest();
  const itemOwner = { kind: "item" as const, itemId: 10 as ItemId };
  const tParameter: TypeParameterKey = { owner: itemOwner, index: 0 };
  const fieldIdValue: FieldId = 100 as FieldId;
  const field: HirFieldRecord = {
    fieldId: fieldIdValue,
    ownerTypeId: typeId(10),
    name: "value",
    type: genericParameterCheckedType(tParameter),
    resourceKind: parametricKind(tParameter),
    sourceOrigin: hirOriginId(0),
  };
  const typeRecord: HirTypeRecord = {
    typeId: typeId(10),
    itemId: 10 as ItemId,
    sourceKind: "validatedBuffer",
    declaredTypeParameters: [tParameter],
    fieldIds: [fieldIdValue],
    enumCases: [],
    resourceKind: concreteKind("ValidatedBuffer"),
    sourceOrigin: hirOriginId(0),
  };
  const validatedBuffer: HirValidatedBuffer = {
    typeId: typeId(10),
    itemId: 10 as ItemId,
    parameterFields: [fieldIdValue],
    layoutDerivedFieldOrder: [],
    layoutFields: [],
    derivedFields: [],
    requirements: [],
    sourceOrigin: hirOriginId(0),
  };
  const fields: HirFieldTable = hirTable<FieldId, HirFieldRecord>({
    entries: [field],
    keyOf: (entry) => String(entry.fieldId).padStart(12, "0"),
    lookupKeyOf: (id) => String(id).padStart(12, "0"),
  });
  const types: HirTypeTable = hirTable<TypeId, HirTypeRecord>({
    entries: [typeRecord],
    keyOf: (entry) => String(entry.typeId).padStart(12, "0"),
    lookupKeyOf: (id) => String(id).padStart(12, "0"),
  });
  const validatedBuffers: HirValidatedBufferTable = hirTable<TypeId, HirValidatedBuffer>({
    entries: [validatedBuffer],
    keyOf: (entry) => String(entry.typeId).padStart(12, "0"),
    lookupKeyOf: (id) => String(id).padStart(12, "0"),
  });
  const constructorKindRules = hirTable<TypeConstructorId, HirConstructorKindRuleRecord>({
    entries: [
      {
        constructor: { kind: "source", typeId: typeId(10) },
        rule: "appliedConstructor",
        resultKind: concreteKind("ValidatedBuffer"),
        sourceOrigin: hirOriginId(0),
      },
    ],
    keyOf: (entry) => constructorKey(entry.constructor),
    lookupKeyOf: (id) => constructorKey(id),
  });
  return {
    ...base,
    fields,
    types,
    validatedBuffers,
    monoClosure: { ...base.monoClosure, constructorKindRules },
  };
}

export function emptyMonoAncestryForTest(): MonoTypeAncestry {
  return monoTypeAncestry();
}

export function genericFunctionWithObligationProgramForMonoTest(): TypedHirProgram {
  const source = [
    "terminal fn stop() -> Never:",
    "    loop:",
    "        break",
    "fn makeU8() -> u8:",
    "    return 0",
    "fn makeU32() -> u32:",
    "    return 0",
    "fn doStuff[U](value: U) -> u8:",
    "    let _x: U = value",
    "    stop()",
    "    return 0",
    "uefi image Boot:",
    "    fn main() -> u8:",
    "        doStuff[u8](makeU8())",
    "        return doStuff[u32](makeU32())",
  ].join("\n");
  const result = lowerTypedHirForTest([["main.wr", source]]);
  return result.program;
}

export function danglingProofReferenceProgramForMonoTest(): TypedHirProgram {
  const base = genericFunctionWithObligationProgramForMonoTest();
  const functionThreeId = functionId(3);
  const danglingMatchId = {
    owner: { kind: "function" as const, functionId: functionId(99) },
    id: 0 as never,
  };
  const danglingStatement: import("../../../src/hir/hir").HirStatement = {
    statementId: 100 as never,
    kind: {
      kind: "validationMatch",
      statement: {
        validationMatchId: danglingMatchId,
        scrutinee: {
          expressionId: 200 as never,
          kind: { kind: "literal", literal: { kind: "integer", text: "0" } },
          type: coreCheckedType(coreTypeId("u32")),
          resourceKind: concreteKind("Copy"),
          sourceOrigin: hirOriginId(0),
        },
        sourceOrigin: hirOriginId(0),
      },
    },
    sourceOrigin: hirOriginId(0),
  };
  const baseFunctions = base.functions.entries();
  const updatedFunctions: import("../../../src/hir/hir").HirFunction[] = baseFunctions.map(
    (func) => {
      if (func.functionId !== functionThreeId) return func;
      return {
        ...func,
        body:
          func.body !== undefined
            ? {
                statements: [...func.body.statements, danglingStatement],
                sourceOrigin: func.body.sourceOrigin,
              }
            : { statements: [danglingStatement], sourceOrigin: hirOriginId(0) },
      };
    },
  );
  const functionsTable = hirTable<
    (typeof baseFunctions)[number]["functionId"],
    import("../../../src/hir/hir").HirFunction
  >({
    entries: updatedFunctions,
    keyOf: (entry) => String(entry.functionId).padStart(12, "0"),
    lookupKeyOf: (id) => String(id).padStart(12, "0"),
  });
  return { ...base, functions: functionsTable };
}

export function nestedDanglingProofReferenceProgramForMonoTest(): TypedHirProgram {
  const base = genericFunctionWithObligationProgramForMonoTest();
  const functionThreeId = functionId(3);
  const danglingMatchId = {
    owner: { kind: "function" as const, functionId: functionId(99) },
    id: 0 as never,
  };
  const nestedDanglingStatement: import("../../../src/hir/hir").HirStatement = {
    statementId: 101 as never,
    kind: {
      kind: "validationMatch",
      statement: {
        validationMatchId: danglingMatchId,
        scrutinee: {
          expressionId: 201 as never,
          kind: { kind: "literal", literal: { kind: "integer", text: "0" } },
          type: coreCheckedType(coreTypeId("u32")),
          resourceKind: concreteKind("Copy"),
          sourceOrigin: hirOriginId(0),
        },
        sourceOrigin: hirOriginId(0),
      },
    },
    sourceOrigin: hirOriginId(0),
  };
  const blockStatement: import("../../../src/hir/hir").HirStatement = {
    statementId: 102 as never,
    kind: {
      kind: "block",
      block: { statements: [nestedDanglingStatement], sourceOrigin: hirOriginId(0) },
    },
    sourceOrigin: hirOriginId(0),
  };
  const baseFunctions = base.functions.entries();
  const updatedFunctions: import("../../../src/hir/hir").HirFunction[] = baseFunctions.map(
    (func) => {
      if (func.functionId !== functionThreeId) return func;
      return {
        ...func,
        body:
          func.body !== undefined
            ? {
                statements: [...func.body.statements, blockStatement],
                sourceOrigin: func.body.sourceOrigin,
              }
            : { statements: [blockStatement], sourceOrigin: hirOriginId(0) },
      };
    },
  );
  const functionsTable = hirTable<
    (typeof baseFunctions)[number]["functionId"],
    import("../../../src/hir/hir").HirFunction
  >({
    entries: updatedFunctions,
    keyOf: (entry) => String(entry.functionId).padStart(12, "0"),
    lookupKeyOf: (id) => String(id).padStart(12, "0"),
  });
  return { ...base, functions: functionsTable };
}

function copyProofMetadataBuilder(
  program: TypedHirProgram,
  overrides: { readonly terminalCalls?: readonly HirTerminalCall[] } = {},
): HirProofMetadataBuilder {
  const builder = new HirProofMetadataBuilder();
  for (const obligation of program.proofMetadata.obligations.entries()) {
    builder.addObligation(obligation);
  }
  for (const session of program.proofMetadata.sessions.entries()) {
    builder.addSession(session);
  }
  for (const brand of program.proofMetadata.brands.entries()) {
    builder.addBrand(brand);
  }
  for (const place of program.proofMetadata.resourcePlaces.entries()) {
    builder.addResourcePlace(place);
  }
  for (const requirement of program.proofMetadata.callSiteRequirements.entries()) {
    builder.addCallSiteRequirement(requirement);
  }
  for (const validation of program.proofMetadata.validations.entries()) {
    builder.addValidation(validation);
  }
  for (const attempt of program.proofMetadata.attempts.entries()) {
    builder.addAttempt(attempt);
  }
  for (const terminalCall of overrides.terminalCalls ??
    program.proofMetadata.terminalCalls.entries()) {
    builder.addTerminalCall(terminalCall);
  }
  for (const transition of program.proofMetadata.privateStateTransitions.entries()) {
    builder.addPrivateStateTransition(transition);
  }
  for (const factOrigin of program.proofMetadata.factOrigins.entries()) {
    builder.addFactOrigin(factOrigin);
  }
  for (const platformEdge of program.proofMetadata.platformContractEdges.entries()) {
    builder.addPlatformContractEdge(platformEdge);
  }
  for (const imageOrigin of program.proofMetadata.imageOrigins.entries()) {
    builder.addImageOrigin(imageOrigin);
  }
  return builder;
}

export function terminalCallDanglingClosureObligationProgramForMonoTest(): TypedHirProgram {
  const base = genericFunctionWithObligationProgramForMonoTest();
  const terminalCall = base.proofMetadata.terminalCalls.entries()[0];
  if (terminalCall === undefined) {
    throw new Error("Expected generic obligation fixture to include a terminal call.");
  }
  return {
    ...base,
    proofMetadata: copyProofMetadataBuilder(base, {
      terminalCalls: [
        {
          ...terminalCall,
          closureObligationId: ownedObligationId(functionId(3), 999),
        },
      ],
    }).build(),
  };
}

export function inlineStreamDanglingProofReferenceProgramForMonoTest(): TypedHirProgram {
  const base = genericFunctionWithObligationProgramForMonoTest();
  const functionThreeId = functionId(3);
  const owner = { kind: "function" as const, functionId: functionThreeId };
  const streamStatement: HirStatement = {
    statementId: 300 as never,
    kind: {
      kind: "for",
      statement: {
        iterable: {
          expressionId: 301 as never,
          kind: { kind: "literal", literal: { kind: "integer", text: "0" } },
          type: coreCheckedType(coreTypeId("u32")),
          resourceKind: concreteKind("Copy"),
          sourceOrigin: hirOriginId(0),
        },
        iteration: {
          kind: "stream",
          sessionId: ownedSessionId(owner, 999),
          itemBrandId: ownedBrandId(owner, 999),
          closureObligationId: ownedObligationId(functionThreeId, 999),
          itemType: coreCheckedType(coreTypeId("u32")),
          itemResourceKind: concreteKind("Copy"),
        },
        body: { statements: [], sourceOrigin: hirOriginId(0) },
      },
    },
    sourceOrigin: hirOriginId(0),
  };
  const baseFunctions = base.functions.entries();
  const updatedFunctions: HirFunction[] = baseFunctions.map((func) => {
    if (func.functionId !== functionThreeId) return func;
    return {
      ...func,
      body:
        func.body !== undefined
          ? {
              statements: [...func.body.statements, streamStatement],
              sourceOrigin: func.body.sourceOrigin,
            }
          : { statements: [streamStatement], sourceOrigin: hirOriginId(0) },
    };
  });
  return {
    ...base,
    functions: hirTable<FunctionId, HirFunction>({
      entries: updatedFunctions,
      keyOf: (entry) => String(entry.functionId).padStart(12, "0"),
      lookupKeyOf: (id) => String(id).padStart(12, "0"),
    }),
  };
}

export function duplicatePlatformEdgesProgramForMonoTest(): TypedHirProgram {
  const source = [
    "platform fn exit() -> Never",
    "fn caller() -> Never:",
    "    exit()",
    "uefi image Boot:",
    "    fn main() -> Never:",
    "        caller()",
  ].join("\n");
  const result = lowerTypedHirForTest([["main.wr", source]], {
    platformNames: ["exit"],
    targetSurface: targetWithCertifiedExit(),
  });
  const program = result.program;
  const existingEdge = program.proofMetadata.platformContractEdges.entries()[0];
  if (existingEdge === undefined) {
    throw new Error(
      "Expected HIR program to produce at least one platform contract edge for duplicate test.",
    );
  }
  const builder = new HirProofMetadataBuilder();
  for (const obligation of program.proofMetadata.obligations.entries()) {
    builder.addObligation(obligation);
  }
  for (const session of program.proofMetadata.sessions.entries()) {
    builder.addSession(session);
  }
  for (const brand of program.proofMetadata.brands.entries()) {
    builder.addBrand(brand);
  }
  for (const place of program.proofMetadata.resourcePlaces.entries()) {
    builder.addResourcePlace(place);
  }
  for (const requirement of program.proofMetadata.callSiteRequirements.entries()) {
    builder.addCallSiteRequirement(requirement);
  }
  for (const validation of program.proofMetadata.validations.entries()) {
    builder.addValidation(validation);
  }
  for (const attempt of program.proofMetadata.attempts.entries()) {
    builder.addAttempt(attempt);
  }
  for (const terminalCall of program.proofMetadata.terminalCalls.entries()) {
    builder.addTerminalCall(terminalCall);
  }
  for (const transition of program.proofMetadata.privateStateTransitions.entries()) {
    builder.addPrivateStateTransition(transition);
  }
  for (const factOrigin of program.proofMetadata.factOrigins.entries()) {
    builder.addFactOrigin(factOrigin);
  }
  for (const platformEdge of program.proofMetadata.platformContractEdges.entries()) {
    builder.addPlatformContractEdge(platformEdge);
  }
  for (const imageOrigin of program.proofMetadata.imageOrigins.entries()) {
    builder.addImageOrigin(imageOrigin);
  }
  const duplicateEdge: import("../../../src/hir/hir").HirPlatformContractEdge = {
    edgeId: {
      owner: existingEdge.edgeId.owner,
      id: (Number(existingEdge.edgeId.id) + 1) as unknown as never,
    },
    sourceFunctionId: existingEdge.sourceFunctionId,
    primitiveId: existingEdge.primitiveId,
    contractId: existingEdge.contractId,
    targetId: existingEdge.targetId,
    ...(existingEdge.certificate !== undefined ? { certificate: existingEdge.certificate } : {}),
    ...(existingEdge.sourceRequirementIds !== undefined
      ? { sourceRequirementIds: existingEdge.sourceRequirementIds }
      : {}),
    ...(existingEdge.callExpressionId !== undefined
      ? { callExpressionId: existingEdge.callExpressionId }
      : {}),
    ...(existingEdge.callOrigin !== undefined ? { callOrigin: existingEdge.callOrigin } : {}),
    ensuredFacts: existingEdge.ensuredFacts,
    sourceOrigin: existingEdge.sourceOrigin,
  };
  builder.addPlatformContractEdge(duplicateEdge);
  return { ...program, proofMetadata: builder.build() };
}

export function platformPrimitiveReachabilityProgramForMonoTest(): TypedHirProgram {
  const source = [
    "platform fn exit() -> Never",
    "fn caller() -> Never:",
    "    exit()",
    "uefi image Boot:",
    "    fn main() -> Never:",
    "        caller()",
  ].join("\n");
  const result = lowerTypedHirForTest([["main.wr", source]], {
    platformNames: ["exit"],
    targetSurface: targetWithCertifiedExit(),
  });
  return result.program;
}

export function vendoredStdlibReachabilityProgramForMonoTest(): TypedHirProgram {
  return ordinaryReachabilityProgramWithTargetFunctionId({
    targetFunctionId: 700,
    targetName: "vendoredStdlibFn",
  });
}

export function replacementStdlibReachabilityProgramForMonoTest(): TypedHirProgram {
  return ordinaryReachabilityProgramWithTargetFunctionId({
    targetFunctionId: 710,
    targetName: "replacementStdlibFn",
  });
}

export function packageModuleReachabilityProgramForMonoTest(): TypedHirProgram {
  return ordinaryReachabilityProgramWithTargetFunctionId({
    targetFunctionId: 720,
    targetName: "packageModuleFn",
  });
}

export function ownerMethodInstantiationProgramForMonoTest(): TypedHirProgram {
  const source = [
    "class Box[T]:",
    "    value: T",
    "    fn tag(self) -> u8:",
    "        return 0",
    "uefi image Boot:",
    "    fn main() -> Never:",
    "        return",
  ].join("\n");
  const result = lowerTypedHirForTest([["main.wr", source]]);
  const program = result.program;
  const method = program.functions.entries().find((func) => func.ownerTypeId !== undefined);
  const ownerTypeId = method?.ownerTypeId;
  if (method === undefined || ownerTypeId === undefined) {
    throw new Error("Expected owner method fixture to lower a method with owner type id.");
  }
  return {
    ...program,
    monoClosure: {
      ...program.monoClosure,
      externalEntryRoots: [
        ...program.monoClosure.externalEntryRoots,
        {
          functionId: method.functionId,
          ownerTypeArguments: [coreCheckedType(coreTypeId("u8"))],
          functionTypeArguments: [],
          reason: "targetRequired",
          sourceOrigin: method.sourceOrigin,
        },
      ],
    },
  };
}

export function shuffledClosedProgramForMonoTest(seed: number): TypedHirProgram {
  const base = twoCallSitesSameGenericInstanceProgramForMonoTest();
  return {
    ...base,
    declarations: hirTable<ItemId, HirDeclaration>({
      entries: shuffleDeterministically(base.declarations.entries(), seed + 1),
      keyOf: (entry) => String(entry.itemId).padStart(12, "0"),
      lookupKeyOf: (id) => String(id).padStart(12, "0"),
    }),
    functions: hirTable<FunctionId, HirFunction>({
      entries: shuffleDeterministically(base.functions.entries(), seed + 2),
      keyOf: (entry) => String(entry.functionId).padStart(12, "0"),
      lookupKeyOf: (id) => String(id).padStart(12, "0"),
    }),
    types: hirTable<TypeId, HirTypeRecord>({
      entries: shuffleDeterministically(base.types.entries(), seed + 3),
      keyOf: (entry) => String(entry.typeId).padStart(12, "0"),
      lookupKeyOf: (id) => String(id).padStart(12, "0"),
    }),
    fields: hirTable<FieldId, HirFieldRecord>({
      entries: shuffleDeterministically(base.fields.entries(), seed + 4),
      keyOf: (entry) => String(entry.fieldId).padStart(12, "0"),
      lookupKeyOf: (id) => String(id).padStart(12, "0"),
    }),
    images: hirTable<ImageId, HirImage>({
      entries: shuffleDeterministically(base.images.entries(), seed + 5),
      keyOf: (entry) => String(entry.imageId).padStart(12, "0"),
      lookupKeyOf: (id) => String(id).padStart(12, "0"),
    }),
    validatedBuffers: hirTable<TypeId, HirValidatedBuffer>({
      entries: shuffleDeterministically(base.validatedBuffers.entries(), seed + 6),
      keyOf: (entry) => String(entry.typeId).padStart(12, "0"),
      lookupKeyOf: (id) => String(id).padStart(12, "0"),
    }),
    proofMetadata: shuffledProofMetadataForMonoTest(base, seed + 7),
    monoClosure: shuffledMonoClosureForMonoTest(base.monoClosure, seed + 20),
  };
}

function shuffledProofMetadataForMonoTest(program: TypedHirProgram, seed: number) {
  const builder = new HirProofMetadataBuilder();
  for (const obligation of shuffleDeterministically(
    program.proofMetadata.obligations.entries(),
    seed + 1,
  )) {
    builder.addObligation(obligation);
  }
  for (const session of shuffleDeterministically(
    program.proofMetadata.sessions.entries(),
    seed + 2,
  )) {
    builder.addSession(session);
  }
  for (const brand of shuffleDeterministically(program.proofMetadata.brands.entries(), seed + 3)) {
    builder.addBrand(brand);
  }
  for (const place of shuffleDeterministically(
    program.proofMetadata.resourcePlaces.entries(),
    seed + 4,
  )) {
    builder.addResourcePlace(place);
  }
  for (const requirement of shuffleDeterministically(
    program.proofMetadata.callSiteRequirements.entries(),
    seed + 5,
  )) {
    builder.addCallSiteRequirement(requirement);
  }
  for (const validation of shuffleDeterministically(
    program.proofMetadata.validations.entries(),
    seed + 6,
  )) {
    builder.addValidation(validation);
  }
  for (const attempt of shuffleDeterministically(
    program.proofMetadata.attempts.entries(),
    seed + 7,
  )) {
    builder.addAttempt(attempt);
  }
  for (const terminalCall of shuffleDeterministically(
    program.proofMetadata.terminalCalls.entries(),
    seed + 8,
  )) {
    builder.addTerminalCall(terminalCall);
  }
  for (const transition of shuffleDeterministically(
    program.proofMetadata.privateStateTransitions.entries(),
    seed + 9,
  )) {
    builder.addPrivateStateTransition(transition);
  }
  for (const factOrigin of shuffleDeterministically(
    program.proofMetadata.factOrigins.entries(),
    seed + 10,
  )) {
    builder.addFactOrigin(factOrigin);
  }
  for (const platformEdge of shuffleDeterministically(
    program.proofMetadata.platformContractEdges.entries(),
    seed + 11,
  )) {
    builder.addPlatformContractEdge(platformEdge);
  }
  for (const imageOrigin of shuffleDeterministically(
    program.proofMetadata.imageOrigins.entries(),
    seed + 12,
  )) {
    builder.addImageOrigin(imageOrigin);
  }
  return builder.build();
}

function shuffledMonoClosureForMonoTest(
  monoClosure: HirMonoClosureSurface,
  seed: number,
): HirMonoClosureSurface {
  return {
    sourceTypeKinds: hirTable<TypeId, HirSourceTypeKindRecord>({
      entries: shuffleDeterministically(monoClosure.sourceTypeKinds.entries(), seed + 1),
      keyOf: (entry) => String(entry.typeId).padStart(12, "0"),
      lookupKeyOf: (id) => String(id).padStart(12, "0"),
    }),
    targetTypeKinds: hirTable<ReturnType<typeof targetTypeId>, HirTargetTypeKindRecord>({
      entries: shuffleDeterministically(monoClosure.targetTypeKinds.entries(), seed + 2),
      keyOf: (entry) => `${entry.targetTypeId}`,
      lookupKeyOf: (id) => `${id}`,
    }),
    constructorKindRules: hirTable<TypeConstructorId, HirConstructorKindRuleRecord>({
      entries: shuffleDeterministically(monoClosure.constructorKindRules.entries(), seed + 3),
      keyOf: (entry) => constructorKey(entry.constructor),
      lookupKeyOf: (id) => constructorKey(id),
    }),
    instanceEligibilityRules: hirTable<string, HirInstanceEligibilityRuleRecord>({
      entries: shuffleDeterministically(monoClosure.instanceEligibilityRules.entries(), seed + 4),
      keyOf: (entry) => eligibilityRuleKey(entry.owner),
      lookupKeyOf: (key) => key,
    }),
    certifiedPlatformBindings: hirTable<FunctionId, CertifiedPlatformBinding>({
      entries: shuffleDeterministically(monoClosure.certifiedPlatformBindings.entries(), seed + 5),
      keyOf: (entry) => String(entry.functionId).padStart(12, "0"),
      lookupKeyOf: (id) => String(id).padStart(12, "0"),
    }),
    externalEntryRoots: shuffleDeterministically(monoClosure.externalEntryRoots, seed + 6),
  };
}

function shuffleDeterministically<Entry>(
  entries: readonly Entry[],
  seed: number,
): readonly Entry[] {
  const shuffled = [...entries];
  let state = seed >>> 0;
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const swapIndex = state % (index + 1);
    const current = shuffled[index]!;
    shuffled[index] = shuffled[swapIndex]!;
    shuffled[swapIndex] = current;
  }
  return shuffled;
}

function ordinaryReachabilityProgramWithTargetFunctionId(input: {
  readonly targetFunctionId: number;
  readonly targetName: string;
}): TypedHirProgram {
  const padding = Array.from(
    { length: input.targetFunctionId },
    (_unusedValue, index) => `fn _pad${index}() -> u8`,
  );
  const source = [
    ...padding,
    `fn ${input.targetName}() -> u8:`,
    "    return 0",
    "uefi image Boot:",
    "    fn main() -> u8:",
    `        return ${input.targetName}()`,
  ].join("\n");
  const result = lowerTypedHirForTest([["main.wr", source]]);
  return result.program;
}

export function monomorphizedProgramWithPlatformEdgesForTest(
  primitiveIds: readonly string[],
): MonomorphizedHirProgram {
  const edges: import("../../../src/mono/mono-hir").MonoPlatformContractEdge[] = primitiveIds.map(
    (idString, index) => {
      const primitiveId = idString as PlatformPrimitiveId;
      const edgeIdId = (index + 1) as never;
      const callerInstanceId = monoInstanceId("fn:caller");
      const contractId = `${idString}_contract` as never;
      const targetId = "uefi-aarch64" as never;
      const callExpressionId = {
        hirId: (index + 100) as never,
        instanceId: callerInstanceId,
      };
      return {
        edgeId: {
          owner: { kind: "function", instanceId: callerInstanceId },
          hirId: edgeIdId,
          instanceId: callerInstanceId,
        },
        sourceFunctionId: functionId(1),
        primitiveId,
        contractId,
        targetId,
        callExpressionId,
        instantiatedOwnerTypeArguments: [],
        instantiatedFunctionTypeArguments: [],
        monomorphicEdgeKey: monoPlatformContractEdgeKey(
          `caller:${callerInstanceId}|call:${index + 100}|callee:${String(functionId(1)).padStart(12, "0")}|owner:<>|fn:<>`,
        ),
        abi: {
          targetId,
          primitiveId,
          contractId,
        },
        ensuredFacts: [],
        sourceOrigin: "test:0:0",
      };
    },
  );
  const imageInstanceId = monoInstanceId("image:0");
  const platformContractEdges: import("../../../src/mono/mono-hir").MonoDeterministicTable<
    import("../../../src/mono/mono-hir").MonoInstantiatedProofId<never>,
    import("../../../src/mono/mono-hir").MonoPlatformContractEdge
  > = {
    get: (id) => edges.find((edge) => String(edge.edgeId) === String(id)),
    entries: () => edges,
  };
  return {
    image: {
      instanceId: imageInstanceId,
      imageId: 0 as never,
      itemId: 0 as never,
      devices: [],
      sourceOrigin: "test:0:0",
    },
    externalRoots: [],
    reachableFunctions: {
      get: () => undefined,
      has: () => false,
      entries: () => [],
    },
    functions: {
      get: () => undefined,
      entries: () => [],
    },
    types: {
      get: () => undefined,
      entries: () => [],
    },
    validatedBuffers: {
      get: () => undefined,
      entries: () => [],
    },
    proofMetadata: {
      obligations: { get: () => undefined, entries: () => [] },
      sessions: { get: () => undefined, entries: () => [] },
      brands: { get: () => undefined, entries: () => [] },
      resourcePlaces: { get: () => undefined, entries: () => [] },
      callSiteRequirements: { get: () => undefined, entries: () => [] },
      validations: { get: () => undefined, entries: () => [] },
      attempts: { get: () => undefined, entries: () => [] },
      terminalCalls: { get: () => undefined, entries: () => [] },
      privateStateTransitions: { get: () => undefined, entries: () => [] },
      factOrigins: { get: () => undefined, entries: () => [] },
      platformContractEdges,
      imageOrigins: { get: () => undefined, entries: () => [] },
    },
    instantiationGraph: { edges: [] },
    origins: createHirOriginAllocator(),
    resolvedCallTargets: {
      get: () => undefined,
      entries: () => [],
    },
    reachablePlatformPrimitiveIds: [...new Set(primitiveIds)]
      .sort()
      .map((id) => id as PlatformPrimitiveId),
  };
}
