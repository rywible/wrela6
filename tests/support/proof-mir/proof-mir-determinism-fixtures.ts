import type { TargetId } from "../../../src/semantic/ids";
import { proofMirRuntimeCatalogFake } from "./proof-mir-fakes";
import { closedProofMirFixture, type ProofMirBuildInput } from "./proof-mir-build-input";
import type { HirOrigin, HirOriginTable } from "../../../src/hir/origin";
import type { MonoProofMetadata, MonomorphizedHirProgram } from "../../../src/mono/mono-hir";
import { buildMonoTable, proofMetadataIdKey } from "../../../src/mono/proof-metadata-tables";
import type { LayoutFactProgram } from "../../../src/layout";
import {
  layoutEnumKeyString,
  layoutFunctionKeyString,
  layoutPlatformEdgeKeyString,
  layoutValidatedBufferKeyString,
} from "../../../src/layout/layout-fact-builder-support";
import {
  layoutDeterministicTable,
  layoutFieldKeyString,
  layoutImageDeviceKeyString,
  layoutTypeKeyString,
} from "../../../src/layout/type-key";

export interface ShuffledProofMirInputFixtureOptions {
  readonly shuffle: string;
  readonly targetId?: TargetId;
}

function seedFromShuffleString(shuffle: string): number {
  let hash = 0;
  for (let index = 0; index < shuffle.length; index += 1) {
    hash = (hash * 31 + shuffle.charCodeAt(index)) >>> 0;
  }
  return hash;
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

function shuffledOriginTable(origins: HirOriginTable, seed: number): HirOriginTable {
  const records = shuffleDeterministically(origins.originRecords(), seed);
  return {
    get(originId) {
      return origins.get(originId);
    },
    originRecords(): readonly HirOrigin[] {
      return records;
    },
  };
}

function shuffledMonoProofMetadata(
  proofMetadata: MonoProofMetadata,
  seed: number,
): MonoProofMetadata {
  const shuffle = <Entry>(entries: readonly Entry[], offset: number): readonly Entry[] =>
    shuffleDeterministically(entries, seed + offset);

  return {
    obligations: buildMonoTable(
      shuffle(proofMetadata.obligations.entries(), 1),
      (entry) => proofMetadataIdKey(entry.obligationId),
      (id) => proofMetadataIdKey(id),
    ),
    sessions: buildMonoTable(
      shuffle(proofMetadata.sessions.entries(), 2),
      (entry) => proofMetadataIdKey(entry.sessionId),
      (id) => proofMetadataIdKey(id),
    ),
    brands: buildMonoTable(
      shuffle(proofMetadata.brands.entries(), 3),
      (entry) => proofMetadataIdKey(entry.brandId),
      (id) => proofMetadataIdKey(id),
    ),
    resourcePlaces: buildMonoTable(
      shuffle(proofMetadata.resourcePlaces.entries(), 4),
      (entry) => proofMetadataIdKey(entry.placeId),
      (id) => proofMetadataIdKey(id),
    ),
    callSiteRequirements: buildMonoTable(
      shuffle(proofMetadata.callSiteRequirements.entries(), 5),
      (entry) => proofMetadataIdKey(entry.callSiteRequirementId),
      (id) => proofMetadataIdKey(id),
    ),
    validations: buildMonoTable(
      shuffle(proofMetadata.validations.entries(), 6),
      (entry) => proofMetadataIdKey(entry.validationId),
      (id) => proofMetadataIdKey(id),
    ),
    attempts: buildMonoTable(
      shuffle(proofMetadata.attempts.entries(), 7),
      (entry) => proofMetadataIdKey(entry.attemptId),
      (id) => proofMetadataIdKey(id),
    ),
    terminalCalls: buildMonoTable(
      shuffle(proofMetadata.terminalCalls.entries(), 8),
      (entry) => proofMetadataIdKey(entry.terminalCallId),
      (id) => proofMetadataIdKey(id),
    ),
    privateStateTransitions: buildMonoTable(
      shuffle(proofMetadata.privateStateTransitions.entries(), 9),
      (entry) => proofMetadataIdKey(entry.transitionId),
      (id) => proofMetadataIdKey(id),
    ),
    factOrigins: buildMonoTable(
      shuffle(proofMetadata.factOrigins.entries(), 10),
      (entry) => proofMetadataIdKey(entry.factOriginId),
      (id) => proofMetadataIdKey(id),
    ),
    platformContractEdges: buildMonoTable(
      shuffle(proofMetadata.platformContractEdges.entries(), 11),
      (entry) => proofMetadataIdKey(entry.edgeId),
      (id) => proofMetadataIdKey(id),
    ),
    imageOrigins: buildMonoTable(
      shuffle(proofMetadata.imageOrigins.entries(), 12),
      (entry) => proofMetadataIdKey(entry.imageOriginId),
      (id) => proofMetadataIdKey(id),
    ),
  };
}

function shuffledMonoProgram(
  program: MonomorphizedHirProgram,
  seed: number,
): MonomorphizedHirProgram {
  const shuffle = <Entry>(entries: readonly Entry[], offset: number): readonly Entry[] =>
    shuffleDeterministically(entries, seed + offset);

  return {
    ...program,
    externalRoots: shuffle(program.externalRoots, 1),
    reachablePlatformPrimitiveIds: shuffle(program.reachablePlatformPrimitiveIds, 2),
    instantiationGraph: {
      edges: shuffle(program.instantiationGraph.edges, 3),
    },
    functions: buildMonoTable(
      shuffle(program.functions.entries(), 10),
      (entry) => String(entry.instanceId),
      (id) => String(id),
    ),
    types: buildMonoTable(
      shuffle(program.types.entries(), 11),
      (entry) => String(entry.instanceId),
      (id) => String(id),
    ),
    validatedBuffers: buildMonoTable(
      shuffle(program.validatedBuffers.entries(), 12),
      (entry) => String(entry.instanceId),
      (id) => String(id),
    ),
    proofMetadata: shuffledMonoProofMetadata(program.proofMetadata, seed + 20),
    origins: shuffledOriginTable(program.origins, seed + 30),
  };
}

function shuffledLayoutFacts(layout: LayoutFactProgram, seed: number): LayoutFactProgram {
  const shuffle = <Entry>(entries: readonly Entry[], offset: number): readonly Entry[] =>
    shuffleDeterministically(entries, seed + offset);

  return {
    ...layout,
    types: layoutDeterministicTable({
      entries: shuffle(layout.types.entries(), 1),
      keyOf: (entry) => entry.key,
      keyString: layoutTypeKeyString,
    }),
    fields: layoutDeterministicTable({
      entries: shuffle(layout.fields.entries(), 2),
      keyOf: (entry) => ({ owner: entry.owner, fieldId: entry.fieldId }),
      keyString: layoutFieldKeyString,
    }),
    enums: layoutDeterministicTable({
      entries: shuffle(layout.enums.entries(), 3),
      keyOf: (entry) => entry.owner,
      keyString: layoutEnumKeyString,
    }),
    validatedBuffers: layoutDeterministicTable({
      entries: shuffle(layout.validatedBuffers.entries(), 4),
      keyOf: (entry) => entry.instanceId,
      keyString: layoutValidatedBufferKeyString,
    }),
    imageDevices: layoutDeterministicTable({
      entries: shuffle(layout.imageDevices.entries(), 5),
      keyOf: (entry) => entry.key,
      keyString: layoutImageDeviceKeyString,
    }),
    functions: layoutDeterministicTable({
      entries: shuffle(layout.functions.entries(), 6),
      keyOf: (entry) => entry.functionInstanceId,
      keyString: layoutFunctionKeyString,
    }),
    platformEdges: layoutDeterministicTable({
      entries: shuffle(layout.platformEdges.entries(), 7),
      keyOf: (entry) => entry.edgeId,
      keyString: layoutPlatformEdgeKeyString,
    }),
  };
}

export function shuffledProofMirInputFixture(
  options: ShuffledProofMirInputFixtureOptions,
): ProofMirBuildInput {
  const base = closedProofMirFixture();
  const seed = seedFromShuffleString(options.shuffle);
  const targetIdOverride = options.targetId;

  return {
    program: shuffledMonoProgram(base.program, seed),
    layout: shuffledLayoutFacts(base.layout, seed + 100),
    target:
      targetIdOverride === undefined
        ? base.target
        : {
            ...base.target,
            targetId: targetIdOverride,
            runtimeCatalog: proofMirRuntimeCatalogFake({
              targetId: targetIdOverride,
              features: base.target.features,
              operations: base.target.runtimeCatalog.entries(),
            }),
          },
  };
}
