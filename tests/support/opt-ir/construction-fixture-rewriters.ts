import type { MonoCheckedType } from "../../../src/mono/mono-hir";
import type { ProofMirBlock, ProofMirValue } from "../../../src/proof-mir/model/graph";
import type { ProofMirFunction } from "../../../src/proof-mir/model/program";
import {
  proofMirBlockId,
  proofMirControlEdgeId,
  proofMirExitEdgeId,
  proofMirTerminatorId,
} from "../../../src/proof-mir/ids";
import {
  proofMirCanonicalKey,
  type ProofMirCanonicalKey,
} from "../../../src/proof-mir/canonicalization/canonical-keys";

export function reachableTwoBlockFunction(function_: ProofMirFunction): ProofMirFunction {
  const entryBlock = function_.blocks.get(function_.entryBlockId) ?? function_.blocks.entries()[0];
  if (entryBlock === undefined) {
    return function_;
  }

  const returnBlockId = proofMirBlockId(9101);
  const jumpEdgeId = proofMirControlEdgeId(9101);
  const returnEdge =
    function_.edges.entries().find((edge) => edge.kind === "returnExit") ??
    function_.edges.entries()[0];
  const returnEdgeId = returnEdge?.edgeId ?? proofMirControlEdgeId(9102);
  const exitId = function_.exits[0]?.exitId ?? proofMirExitEdgeId(9101);
  const origin = entryBlock.origin;
  const rewrittenEntryBlock = {
    ...entryBlock,
    terminator: {
      terminatorId: proofMirTerminatorId(9101),
      kind: {
        kind: "goto" as const,
        target: { edgeId: jumpEdgeId, blockId: returnBlockId },
      },
      outgoingEdges: [jumpEdgeId],
      origin,
    },
    incomingEdges: [],
  };
  const returnBlock = {
    blockId: returnBlockId,
    scopeId: entryBlock.scopeId,
    parameters: [],
    statements: [],
    terminator: {
      terminatorId: proofMirTerminatorId(9102),
      kind: { kind: "return" as const, edgeId: returnEdgeId, exit: exitId },
      outgoingEdges: [returnEdgeId],
      origin,
    },
    incomingEdges: [jumpEdgeId],
    origin,
  };
  const jumpEdge = {
    edgeId: jumpEdgeId,
    fromBlockId: entryBlock.blockId,
    toBlockId: returnBlockId,
    kind: "normal" as const,
    arguments: [],
    facts: [],
    effects: [],
    crossedScopes: [],
    origin,
  };
  const rewrittenReturnEdge = {
    ...(returnEdge ?? jumpEdge),
    edgeId: returnEdgeId,
    fromBlockId: returnBlockId,
    toBlockId: undefined,
    kind: "returnExit" as const,
    arguments: [],
    origin,
  };

  return {
    ...function_,
    blocks: table([rewrittenEntryBlock, returnBlock], (block) => block.blockId),
    edges: table([jumpEdge, rewrittenReturnEdge], (edge) => edge.edgeId),
  };
}

export function replaceFunctionBlock(
  function_: ProofMirFunction,
  block: ProofMirBlock,
): ProofMirFunction {
  return {
    ...function_,
    blocks: table(
      function_.blocks
        .entries()
        .map((candidate) => (candidate.blockId === block.blockId ? block : candidate)),
      (candidate) => candidate.blockId,
    ),
  };
}

export function proofMirRuntimeValue(
  valueId: ProofMirValue["valueId"],
  type: MonoCheckedType,
  origin: ProofMirValue["origin"],
): ProofMirValue {
  return {
    valueId,
    type,
    resourceKind: "Copy" as never,
    representation: { kind: "runtime" },
    origin,
  };
}

export function table<LookupId, Entry>(
  entries: readonly Entry[],
  idOf: (entry: Entry) => LookupId,
): {
  readonly get: (lookupId: LookupId) => Entry | undefined;
  readonly has: (lookupId: LookupId) => boolean;
  readonly keyOf: (entry: Entry) => ProofMirCanonicalKey;
  readonly lookupKeyOf: (lookupId: LookupId) => ProofMirCanonicalKey;
  readonly entries: () => readonly Entry[];
} {
  const byId = new Map(entries.map((entry) => [idOf(entry), entry] as const));
  return {
    get: (lookupId) => byId.get(lookupId),
    has: (lookupId) => byId.has(lookupId),
    keyOf: (entry) => proofMirCanonicalKey(String(idOf(entry))),
    lookupKeyOf: (lookupId) => proofMirCanonicalKey(String(lookupId)),
    entries: () => entries.slice(),
  };
}
