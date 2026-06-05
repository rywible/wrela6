import type { ParsedModuleGraph } from "../../../src/frontend";
import { buildItemIndex } from "../../../src/semantic/item-index";
import type { ItemIndex } from "../../../src/semantic/item-index";
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
import type { CheckedResourceKind } from "../../../src/semantic/surface/resource-kind";
import { concreteKind, resourceKindFingerprint } from "../../../src/semantic/surface/resource-kind";

import { checkedTypeFingerprint, coreCheckedType } from "../../../src/semantic/surface/type-model";
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
    signature: overrides?.signature ?? voidTargetSignature(),
    proofContract: overrides?.proofContract ?? emptyProofContract(),
  };
}

export function deviceSurfaceFake(overrides?: {
  name?: string;
  uniqueEdgeRoots?: readonly string[];
}): DeviceSurfaceSpec {
  const name = overrides?.name ?? "test_device";
  return {
    deviceSurfaceId: deviceSurfaceId(name),
    name,
    availability: {
      targetId: targetId("uefi-aarch64"),
      profiles: [imageProfileId("uefi")],
      features: [],
    },
    resourceKind: "UniqueEdgeRoot",
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

export interface ResourceKindContext {
  readonly coreTypes: CoreTypeCatalog;
  readonly sourceTypeKinds: ReadonlyMap<number, CheckedResourceKind>;
  readonly targetTypeKinds: ReadonlyMap<string, CheckedResourceKind>;
  readonly constructorRules: ReadonlyMap<string, string>;
}

export function emptyKindContext(coreTypes?: CoreTypeCatalog): ResourceKindContext {
  return {
    coreTypes: coreTypes ?? CoreTypeCatalog.default(),
    sourceTypeKinds: new Map(),
    targetTypeKinds: new Map(),
    constructorRules: new Map(),
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
  readonly kindContext: ResourceKindContext;
  readonly diagnostics: readonly any[];
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

  return {
    graph,
    index: itemIndexResult.index,
    references: names.references,
    referenceLookup: buildSurfaceReferenceLookup(names.references),
    platformBindings: names.platformBindings,
    coreTypes,
    targetSurface: options?.targetSurface ?? semanticTargetSurfaceFake(),
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

export function shuffledSemanticTargetSurfaceFake(_seed: number): SemanticTargetSurface {
  return semanticTargetSurfaceFake();
}
