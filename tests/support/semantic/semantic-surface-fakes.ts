import type { ParsedModuleGraph } from "../../../src/frontend";
import { buildItemIndex } from "../../../src/semantic/item-index";
import { ItemIndex } from "../../../src/semantic/item-index";
import { CoreTypeCatalog, resolveNames } from "../../../src/semantic/names";
import type { ResolvedPlatformBindings, ResolvedReferences } from "../../../src/semantic/names";
import { buildSurfaceReferenceLookup } from "../../../src/semantic/surface/reference-lookup";
import type { SurfaceReferenceLookup } from "../../../src/semantic/surface/reference-lookup";
import { platformPrimitiveNameCatalogFake } from "./name-resolution-fakes";
import { parseModuleGraphForTest } from "../../support/frontend/module-graph-test-support";
import type {
  DeviceSurfaceSpec,
  ImageProfileSpec,
  PlatformPrimitiveSpec,
  SemanticTargetSurface,
} from "../../../src/semantic/surface/platform-surface";
import {
  platformPrimitiveCatalog,
  semanticTargetSurface,
} from "../../../src/semantic/surface/platform-surface";
import { concreteKind, resourceKindFingerprint } from "../../../src/semantic/surface/resource-kind";

import type { ResourceKindContext } from "../../../src/semantic/surface/resource-kind-checker";
import {
  emptyKindContext as surfaceEmptyKindContext,
  resourceKindForType,
} from "../../../src/semantic/surface/resource-kind-checker";
import { checkedTypeFingerprint, coreCheckedType } from "../../../src/semantic/surface/type-model";
import type {
  CheckedFieldRecord,
  CheckedFieldTable,
} from "../../../src/semantic/surface/checked-program";
import { checkTypeReference } from "../../../src/semantic/surface/type-reference-checker";
import {
  checkSemanticSurface,
  type CheckSemanticSurfaceResult,
} from "../../../src/semantic/surface/semantic-surface-checker";
import type { ImageRootSelection } from "../../../src/semantic/surface/image-root-selection";
import {
  coreTypeId,
  deviceSurfaceId,
  imageProfileId,
  platformContractId,
  platformPrimitiveId,
  targetId,
  uniqueEdgeRootKey,
} from "../../../src/semantic/ids";

// ── CoreTypeCatalog ─────────────────────────────────────────
export function coreTypeCatalogDefault(): CoreTypeCatalog {
  return CoreTypeCatalog.default();
}

// ── Fake helpers ────────────────────────────────────────────

export function emptyProofContract() {
  return { requiredFacts: [] as const, ensuredFacts: [] as const };
}

export function voidTargetSignature() {
  return {
    genericArity: 0,
    receiver: undefined,
    parameters: [] as const,
    returnType: coreCheckedType(coreTypeId("void")),
    returnKind: concreteKind("Copy"),
    requiredModifiers: [] as const,
    forbiddenModifiers: [] as const,
  };
}

export function uefiImageProfileFake(overrides?: { entryFunctionName?: string }): ImageProfileSpec {
  return {
    profileId: imageProfileId("uefi"),
    name: "uefi",
    declarationKind: "uefi" as const,
    entryFunctionName: overrides?.entryFunctionName ?? "main",
    entrySignature: {
      genericArity: 0,
      receiver: undefined,
      parameters: [],
      returnType: coreCheckedType(coreTypeId("Never")),
      returnKind: concreteKind("Never"),
      requiredModifiers: [],
      forbiddenModifiers: [],
    },
    availableDeviceSurfaces: [],
    availablePlatformFamilies: [],
  };
}

export function primitiveSpecFake(overrides?: {
  name?: string;
  signature?: import("../../../src/semantic/surface/platform-surface").TargetFunctionSignature;
  proofContract?: import("../../../src/semantic/surface/platform-surface").TargetProofContractSurface;
  primitiveFamilyId?: import("../../../src/semantic/ids").PlatformPrimitiveFamilyId;
}): PlatformPrimitiveSpec {
  const name = overrides?.name ?? "test_primitive";
  return {
    primitiveId: platformPrimitiveId(name),
    contractId: platformContractId(`${name}_contract`),
    availability: {
      targetId: targetId("uefi-aarch64"),
      profiles: [imageProfileId("uefi")],
      features: [],
    },
    primitiveFamilyId: overrides?.primitiveFamilyId,
    signature: overrides?.signature ?? voidTargetSignature(),
    proofContract: overrides?.proofContract ?? emptyProofContract(),
  };
}

export function deviceSurfaceFake(overrides?: {
  name?: string;
  sourceTypeName?: string;
  resourceKind?: import("../../../src/semantic/surface/resource-kind").ConcreteResourceKind;
  uniqueEdgeRoots?: readonly string[];
}): DeviceSurfaceSpec {
  const name = overrides?.name ?? "test_device";
  return {
    deviceSurfaceId: deviceSurfaceId(name),
    name,
    sourceTypeName: overrides?.sourceTypeName ?? name,
    availability: {
      targetId: targetId("uefi-aarch64"),
      profiles: [imageProfileId("uefi")],
      features: [],
    },
    resourceKind: overrides?.resourceKind ?? "UniqueEdgeRoot",
    uniqueEdgeRoots: (overrides?.uniqueEdgeRoots ?? []).map((key) => uniqueEdgeRootKey(key)),
  };
}

export function semanticTargetSurfaceFake(input?: {
  readonly primitives?: readonly PlatformPrimitiveSpec[];
  readonly devices?: readonly DeviceSurfaceSpec[];
  readonly profiles?: readonly ImageProfileSpec[];
}): SemanticTargetSurface {
  return semanticTargetSurface({
    targetId: targetId("uefi-aarch64"),
    platformPrimitives: platformPrimitiveCatalog(input?.primitives ?? []),
    imageProfiles: input?.profiles ?? [uefiImageProfileFake()],
    deviceSurfaces: input?.devices ?? [],
  });
}

// ── Resource kind context ───────────────────────────────────

function fallbackIndex(): ItemIndex {
  return new ItemIndex({
    modules: [],
    items: [],
    types: [],
    functions: [],
    images: [],
    fields: [],
    typeParameters: [],
    parameters: [],
  });
}

export function emptyKindContext(
  coreTypes?: CoreTypeCatalog,
  index?: ItemIndex,
): ResourceKindContext {
  return {
    coreTypes: coreTypes ?? CoreTypeCatalog.default(),
    index: index ?? fallbackIndex(),
    sourceTypeKinds: new Map(),
    targetTypeKinds: new Map(),
  };
}

// ── Surface fixture ─────────────────────────────────────────

export interface SemanticSurfaceFixture {
  readonly graph: ParsedModuleGraph;
  readonly index: ItemIndex;
  readonly references: ResolvedReferences;
  readonly referenceLookup: SurfaceReferenceLookup;
  readonly platformBindings: ResolvedPlatformBindings;
  readonly coreTypes: CoreTypeCatalog;
  readonly targetSurface: SemanticTargetSurface;
  readonly checkedFields: CheckedFieldTable;
  readonly kindContext: ResourceKindContext;
  readonly diagnostics: readonly any[];
}

function checkedFieldTableForFixture(input: {
  readonly index: ItemIndex;
  readonly referenceLookup: SurfaceReferenceLookup;
  readonly coreTypes: CoreTypeCatalog;
}): CheckedFieldTable {
  const context = surfaceEmptyKindContext(input.coreTypes, input.index);
  const records: CheckedFieldRecord[] = [];
  for (const item of input.index.items()) {
    for (const field of input.index.fieldsForItem(item.id)) {
      const result =
        field.type !== undefined
          ? checkTypeReference({
              moduleId: item.moduleId,
              view: field.type,
              index: input.index,
              referenceLookup: input.referenceLookup,
              coreTypes: input.coreTypes,
            })
          : { type: { kind: "error" } as const };
      records.push({
        fieldId: field.id,
        itemId: item.id,
        name: field.name,
        type: result.type,
        resourceKind: resourceKindForType({ type: result.type, context }),
        sourceSpan: field.span,
      });
    }
  }
  const sorted = records.sort(
    (left, right) => (left.fieldId as number) - (right.fieldId as number),
  );
  const byId = new Map(sorted.map((record) => [record.fieldId, record]));
  return {
    get: (fieldId) => byId.get(fieldId),
    entries: () => [...sorted],
  };
}

export function parseAndResolveSurfaceFixture(
  files: readonly [string, string][],
  options?: {
    readonly platformNames?: readonly string[];
    readonly targetSurface?: SemanticTargetSurface;
  },
): SemanticSurfaceFixture {
  const graph = parseModuleGraphForTest(files);
  const itemIndexResult = buildItemIndex({ graph });
  const coreTypes = CoreTypeCatalog.default();
  const names = resolveNames({
    graph,
    index: itemIndexResult.index,
    coreTypes,
    platformPrimitiveNames: platformPrimitiveNameCatalogFake(options?.platformNames ?? []),
  });

  const referenceLookup = buildSurfaceReferenceLookup(names.references);
  const checkedFields = checkedFieldTableForFixture({
    index: itemIndexResult.index,
    referenceLookup,
    coreTypes,
  });

  return {
    graph,
    index: itemIndexResult.index,
    references: names.references,
    referenceLookup,
    platformBindings: names.platformBindings,
    coreTypes,
    targetSurface: options?.targetSurface ?? semanticTargetSurfaceFake(),
    checkedFields,
    kindContext: emptyKindContext(coreTypes),
    diagnostics: [...itemIndexResult.diagnostics, ...names.diagnostics],
  };
}

// ── Summary serializers ─────────────────────────────────────

export function checkSemanticSurfaceForTest(
  files: readonly [string, string][],
  options?: {
    readonly platformNames?: readonly string[];
    readonly targetSurface?: SemanticTargetSurface;
    readonly imageRoot?: ImageRootSelection;
  },
): CheckSemanticSurfaceResult {
  const targetSurface = options?.targetSurface ?? semanticTargetSurfaceFake();
  const fixture = parseAndResolveSurfaceFixture(files, { ...options, targetSurface });
  return checkSemanticSurface({
    graph: fixture.graph,
    index: fixture.index,
    references: fixture.references,
    platformBindings: fixture.platformBindings,
    coreTypes: fixture.coreTypes,
    targetSurface,
    imageRoot: options?.imageRoot,
  });
}

export function semanticSurfaceSummary(result: CheckSemanticSurfaceResult): string {
  return JSON.stringify({
    diagnostics: result.diagnostics.map((entry) => ({
      code: entry.code,
      message: entry.message,
      path: entry.source?.name ?? null,
      start: entry.span?.start ?? null,
      end: entry.span?.end ?? null,
      related:
        entry.relatedInformation?.map((info) => ({
          message: info.message,
        })) ?? [],
    })),
    types: result.program.types.entries().map((type) => ({
      typeId: type.typeId,
      fingerprint: checkedTypeFingerprint(type.type),
    })),
    functions: result.program.functions.entries().map((sig) => ({
      functionId: sig.functionId,
      returnType: checkedTypeFingerprint(sig.returnType),
      returnKind: resourceKindFingerprint(sig.returnKind),
    })),
    fields: result.program.fields.entries().map((field) => ({
      fieldId: field.fieldId,
      type: checkedTypeFingerprint(field.type),
      resourceKind: resourceKindFingerprint(field.resourceKind),
    })),
    genericParameters: result.program.genericParameters.entries().map((param) => ({
      owner: `${param.key.owner.kind}:${
        param.key.owner.kind === "item" ? param.key.owner.itemId : param.key.owner.functionId
      }`,
      index: param.key.index,
      name: param.name,
    })),
    platform: result.program.certifiedPlatformBindings.entries().map((binding) => ({
      functionId: binding.functionId,
      primitiveId: binding.primitiveId,
      contractId: binding.contractId,
      signatureFingerprint: binding.certificate.signatureFingerprint,
      proofContractFingerprint: binding.certificate.proofContractFingerprint,
    })),
    image: result.image
      ? {
          imageId: result.image.imageId,
          profileId: result.image.profileId,
          entryFunctionId: result.image.entryFunctionId,
          devices: result.image.devices.map((device) => ({
            fieldId: device.fieldId,
            deviceSurfaceId: device.deviceSurfaceId,
            type: checkedTypeFingerprint(device.type),
            resourceKind: resourceKindFingerprint(device.resourceKind),
          })),
        }
      : null,
  });
}

export function shuffledSemanticTargetSurfaceFake(seed: number): SemanticTargetSurface {
  const base = semanticTargetSurfaceFake();
  const shuffle = <Entry>(items: readonly Entry[]): Entry[] => {
    let state = seed || 1;
    const result = [...items];
    for (let index = result.length - 1; index > 0; index--) {
      state = (state * 1664525 + 1013904223) >>> 0;
      const swapIndex = state % (index + 1);
      [result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!];
    }
    return result;
  };
  const profiles = shuffle(base.imageProfiles);
  const devices = shuffle(base.deviceSurfaces);
  return semanticTargetSurface({
    targetId: base.targetId,
    platformPrimitives: platformPrimitiveCatalog(shuffle(base.platformPrimitives.entries())),
    imageProfiles: profiles,
    deviceSurfaces: devices,
  });
}
