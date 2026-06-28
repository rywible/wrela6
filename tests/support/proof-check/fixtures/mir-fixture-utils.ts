import { buildProofMir } from "../../../../src/proof-mir/proof-mir-builder";
import type { MonoInstantiatedProofId } from "../../../../src/mono/mono-hir";
import type { MonoInstanceId } from "../../../../src/mono/ids";
import { proofMirCanonicalKey } from "../../../../src/proof-mir/canonicalization/canonical-keys";
import { proofMirDeterministicTable } from "../../../../src/proof-mir/canonicalization/canonical-order";
import type { ProofMirBlockId, ProofMirControlEdgeId } from "../../../../src/proof-mir/ids";
import type {
  ProofMirBlock,
  ProofMirControlEdge,
  ProofMirFunction,
} from "../../../../src/proof-mir/model/graph";
import type { ProofMirProgram } from "../../../../src/proof-mir/model/program";
import type { ProofAuthorityFingerprint } from "../../../../src/proof-check/authority/authority-types";
import type { ProofMirRuntimeCatalog } from "../../../../src/runtime/runtime-catalog";
import { compareCodeUnitStrings } from "../../../../src/semantic/surface/deterministic-sort";
import type { ProofMirBuildInput } from "../../proof-mir/proof-mir-build-input";
import { proofAuthorityFingerprintForTest } from "../authority-fakes";

export function targetNameForMir(mir: ProofMirProgram): string {
  return String(mir.layout.target.targetId);
}

export function authorityFingerprintForMir(
  mir: ProofMirProgram,
  authorityKind: ProofAuthorityFingerprint["authorityKind"],
  digestSeed: string,
  version?: string,
): ProofAuthorityFingerprint {
  return proofAuthorityFingerprintForTest({
    authorityKind,
    targetName: targetNameForMir(mir),
    ...(version === undefined ? {} : { version }),
    digestSeed,
  });
}

export function buildProofMirProgram(buildInput: ProofMirBuildInput): ProofMirProgram {
  const result = buildProofMir(buildInput);
  if (result.kind !== "ok") {
    throw new Error(
      `proof-check fixture failed to build Proof MIR: ${result.diagnostics
        .map((diagnostic) => String(diagnostic.code))
        .join(", ")}`,
    );
  }
  return result.mir;
}

export function reachableFunctionIds(mir: ProofMirProgram): readonly MonoInstanceId[] {
  return [...mir.reachableFunctions.entries()]
    .map((entry) => entry.functionInstanceId)
    .sort((left, right) => compareCodeUnitStrings(String(left), String(right)));
}

export function cloneMirProgram(mir: ProofMirProgram): ProofMirProgram {
  return {
    ...mir,
    image: { ...mir.image, externalRoots: [...mir.image.externalRoots] },
    reachableFunctions: {
      get: (key) => mir.reachableFunctions.get(key),
      has: (key) => mir.reachableFunctions.has(key),
      entries: () => mir.reachableFunctions.entries(),
      keyOf: (key) => mir.reachableFunctions.keyOf(key),
      lookupKeyOf: (key) => mir.reachableFunctions.lookupKeyOf(key),
    },
    functions: {
      get: (key) => mir.functions.get(key),
      has: (key) => mir.functions.has(key),
      entries: () => mir.functions.entries(),
      keyOf: (key) => mir.functions.keyOf(key),
      lookupKeyOf: (key) => mir.functions.lookupKeyOf(key),
    },
    layout: mir.layout,
    proofMetadata: mir.proofMetadata,
    origins: mir.origins,
    facts: mir.facts,
    layoutTerms: mir.layoutTerms,
    privateStateGenerations: mir.privateStateGenerations,
    callGraph: mir.callGraph,
    platformEdges: mir.platformEdges,
    runtimeCatalog: mir.runtimeCatalog,
    runtimeCalls: mir.runtimeCalls,
  };
}

export function replaceMirFunctions(
  mir: ProofMirProgram,
  functions: readonly ProofMirFunction[],
): ProofMirProgram {
  const tableResult = proofMirDeterministicTable({
    entries: [...functions],
    keyOf: (functionGraph) => proofMirCanonicalKey(String(functionGraph.functionInstanceId)),
    lookupKeyOf: (functionInstanceId) => proofMirCanonicalKey(String(functionInstanceId)),
    normalizePayload: (functionGraph) => String(functionGraph.functionInstanceId),
  });
  if (tableResult.kind !== "ok") {
    throw new Error("proof-check fixture failed to build function table");
  }
  return {
    ...mir,
    functions: tableResult.table,
  };
}

export function updateFirstReachableFunction(
  mir: ProofMirProgram,
  update: (functionGraph: ProofMirFunction) => ProofMirFunction,
): ProofMirProgram {
  const reachableId = reachableFunctionIds(mir)[0];
  if (reachableId === undefined) {
    return mir;
  }
  const functionGraph = mir.functions.get(reachableId);
  if (functionGraph === undefined) {
    return mir;
  }
  return replaceMirFunctions(mir, [
    update(functionGraph),
    ...mir.functions
      .entries()
      .filter((entry) => String(entry.functionInstanceId) !== String(reachableId)),
  ]);
}

export function blocksTableForTest(
  block: ProofMirBlock,
  blocks: readonly ProofMirBlock[],
): ProofMirFunction["blocks"] {
  return {
    get(key: ProofMirBlockId) {
      return blocks.find((entry) => entry.blockId === key);
    },
    entries: () => blocks,
    has(key: ProofMirBlockId) {
      return blocks.some((entry) => entry.blockId === key);
    },
    keyOf: (entry: ProofMirBlock) => proofMirCanonicalKey(String(entry.blockId)),
    lookupKeyOf: (key: ProofMirBlockId) => proofMirCanonicalKey(String(key)),
  };
}

export function edgesTableForTest(
  edges: readonly ProofMirControlEdge[],
): ProofMirFunction["edges"] {
  return {
    get(key: ProofMirControlEdgeId) {
      return edges.find((entry) => entry.edgeId === key);
    },
    entries: () => edges,
    has(key: ProofMirControlEdgeId) {
      return edges.some((entry) => entry.edgeId === key);
    },
    keyOf: (entry: ProofMirControlEdge) => proofMirCanonicalKey(String(entry.edgeId)),
    lookupKeyOf: (key: ProofMirControlEdgeId) => proofMirCanonicalKey(String(key)),
  };
}

export function withRuntimeCatalogFingerprint(
  runtimeCatalogValue: ProofMirRuntimeCatalog,
  fingerprint: ProofAuthorityFingerprint,
): ProofMirRuntimeCatalog {
  return {
    ...runtimeCatalogValue,
    fingerprint,
  };
}

export function monoProofIdForFunction<THirId>(
  functionInstanceId: MonoInstanceId,
  hirId: THirId,
): MonoInstantiatedProofId<THirId> {
  return {
    owner: { kind: "function", instanceId: functionInstanceId },
    hirId,
    instanceId: functionInstanceId,
  };
}
