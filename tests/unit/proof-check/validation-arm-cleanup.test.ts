import { expect, test } from "bun:test";

import { monoInstanceId } from "../../../src/mono/ids";
import {
  proofMirBlockId,
  proofMirControlEdgeId,
  proofMirExitEdgeId,
  proofMirOriginId,
  proofMirPlaceId,
  proofMirScopeId,
} from "../../../src/proof-mir/ids";
import type {
  ProofMirBlock,
  ProofMirControlEdge,
  ProofMirExitEdge,
  ProofMirFunction,
  ProofMirPlace,
  ProofMirScope,
} from "../../../src/proof-mir/model/graph";
import { validationArmCleanupPlaceKeys } from "../../../src/proof-check/domains/validation-arm-cleanup";

test("validation arm cleanup ignores ordinary crossed scopes", () => {
  const functionScope = proofMirScopeId(0);
  const ordinaryScope = proofMirScopeId(1);
  const introducedPlace = proofMirPlaceId(0);
  const functionGraph = functionWithCleanupCandidate({
    targetScope: scopeForTest(ordinaryScope, "block", functionScope),
    crossedScopes: [ordinaryScope],
    introducedPlace,
  });

  expect(validationArmCleanupPlaceKeys({ functionGraph, exit: functionGraph.exits[0]! })).toEqual(
    [],
  );
});

test("validation arm cleanup returns places introduced into crossed validation arms", () => {
  const functionScope = proofMirScopeId(0);
  const validationScope = proofMirScopeId(2);
  const introducedPlace = proofMirPlaceId(0);
  const functionGraph = functionWithCleanupCandidate({
    targetScope: scopeForTest(validationScope, "validationArm", functionScope),
    crossedScopes: [validationScope],
    introducedPlace,
  });

  expect(validationArmCleanupPlaceKeys({ functionGraph, exit: functionGraph.exits[0]! })).toEqual([
    "proofMirPlace:0",
  ]);
});

function functionWithCleanupCandidate(input: {
  readonly targetScope: ProofMirScope;
  readonly crossedScopes: readonly ReturnType<typeof proofMirScopeId>[];
  readonly introducedPlace: ReturnType<typeof proofMirPlaceId>;
}): ProofMirFunction {
  const functionScope = scopeForTest(proofMirScopeId(0), "function");
  const entryBlockId = proofMirBlockId(0);
  const targetBlockId = proofMirBlockId(1);
  const edgeId = proofMirControlEdgeId(0);
  const exitId = proofMirExitEdgeId(0);
  return {
    functionInstanceId: monoInstanceId("validation-arm-cleanup"),
    sourceFunctionId: 0 as never,
    signature: {
      functionId: 0 as never,
      itemId: 0 as never,
      parameters: [],
      returnType: { kind: "primitive", name: "unit" } as never,
      returnKind: "Copy",
      modifiers: {
        isPlatform: false,
        isTerminal: false,
        isPredicate: false,
        isConstructor: false,
        isPrivate: false,
      },
      sourceSpan: { start: 0, end: 0 } as never,
    },
    entryBlockId,
    blocks: tableForTest(
      (block) => block.blockId,
      blockForTest(entryBlockId, functionScope.scopeId),
      blockForTest(targetBlockId, input.targetScope.scopeId),
    ) as never,
    edges: tableForTest((edge) => edge.edgeId, {
      edgeId,
      fromBlockId: entryBlockId,
      toBlockId: targetBlockId,
      kind: "validationOk",
      arguments: [],
      facts: [],
      effects: [{ kind: "introducePlace", placeId: input.introducedPlace }],
      crossedScopes: [],
      origin: proofMirOriginId(0),
    } satisfies ProofMirControlEdge) as never,
    values: tableForTest((value: never) => value) as never,
    locals: tableForTest((local: never) => local) as never,
    places: tableForTest((place) => place.placeId, {
      placeId: input.introducedPlace,
      root: { kind: "temporary", ordinal: 0 },
      projection: [],
      type: { kind: "primitive", name: "unit" } as never,
      resourceKind: "Linear",
      origin: proofMirOriginId(0),
    } satisfies ProofMirPlace) as never,
    scopes: tableForTest((scope) => scope.scopeId, functionScope, input.targetScope) as never,
    exits: [
      {
        exitId,
        fromBlockId: entryBlockId,
        kind: "ordinaryReturn",
        boundary: { kind: "function", unwind: "none" },
        crossedScopes: input.crossedScopes,
        closure: {
          kind: "functionExit",
          requireNoLiveLoans: true,
          requireNoOpenObligations: true,
          requireNoLiveSessionMembers: true,
          requireNoPendingValidationResults: true,
          terminalReachability: "notRequired",
        },
        origin: proofMirOriginId(0),
      } satisfies ProofMirExitEdge,
    ],
    origin: proofMirOriginId(0),
  };
}

function tableForTest<Entry, Identifier>(
  keyOf: (entry: Entry) => Identifier,
  ...entries: readonly Entry[]
): { get(entryId: Identifier): Entry | undefined; entries(): readonly Entry[] } {
  const byKey = new Map(entries.map((entry) => [String(keyOf(entry)), entry]));
  return {
    get(entryId) {
      return byKey.get(String(entryId));
    },
    entries() {
      return [...entries];
    },
  };
}

function blockForTest(
  blockId: ReturnType<typeof proofMirBlockId>,
  scopeId: ReturnType<typeof proofMirScopeId>,
): ProofMirBlock {
  return {
    blockId,
    scopeId,
    parameters: [],
    statements: [],
    terminator: {
      terminatorId: 0 as never,
      kind: { kind: "unreachable", reason: "unreachableSource" },
      outgoingEdges: [],
      origin: proofMirOriginId(0),
    },
    incomingEdges: [],
    origin: proofMirOriginId(0),
  };
}

function scopeForTest(
  scopeId: ReturnType<typeof proofMirScopeId>,
  kind: ProofMirScope["kind"],
  parentScopeId?: ReturnType<typeof proofMirScopeId>,
): ProofMirScope {
  return {
    scopeId,
    ...(parentScopeId === undefined ? {} : { parentScopeId }),
    kind,
    ownedLocals: [],
    openedObligations: [],
    openedSessionMembers: [],
    origin: proofMirOriginId(0),
  };
}
