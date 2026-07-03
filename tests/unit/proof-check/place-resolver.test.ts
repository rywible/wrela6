import { expect, test } from "bun:test";

import { monoInstanceId, type MonoInstanceId } from "../../../src/mono/ids";
import { proofMirCanonicalKey, type ProofMirCanonicalKey } from "../../../src/proof-mir";
import { proofMirOriginId, proofMirPlaceId } from "../../../src/proof-mir/ids";
import type { ProofMirDeterministicTable } from "../../../src/proof-mir/canonicalization/canonical-order";
import type {
  ProofMirBlock,
  ProofMirControlEdge,
  ProofMirExitEdge,
  ProofMirFunction,
  ProofMirLocal,
  ProofMirPlace,
  ProofMirScope,
  ProofMirValue,
} from "../../../src/proof-mir/model/graph";
import type { ProofMirProgram } from "../../../src/proof-mir/model/program";
import { parameterId } from "../../../src/semantic/ids";
import {
  canonicalProofCheckPlaceKey,
  createProofCheckPlaceResolverForFunction,
} from "../../../src/proof-check/kernel/registry/transition-helpers";

test("function-scoped place resolver does not leak parameter aliases across functions", () => {
  const parameterFunctionInstanceId = monoInstanceId("fn:parameter");
  const temporaryFunctionInstanceId = monoInstanceId("fn:temporary");
  const mir = proofMirProgramForResolverTest([
    functionForResolverTest({
      functionInstanceId: parameterFunctionInstanceId,
      place: {
        placeId: proofMirPlaceId(0),
        root: { kind: "parameter", parameterId: parameterId(0) },
        projection: [],
        type: { kind: "primitive", name: "unit" } as never,
        resourceKind: "Copy",
        origin: proofMirOriginId(0),
      },
      parameters: [{ parameterId: parameterId(0), resourceKind: "Copy", mode: "observe" }],
    }),
    functionForResolverTest({
      functionInstanceId: temporaryFunctionInstanceId,
      place: {
        placeId: proofMirPlaceId(0),
        root: { kind: "temporary", ordinal: 0 },
        projection: [],
        type: { kind: "primitive", name: "unit" } as never,
        resourceKind: "Copy",
        origin: proofMirOriginId(0),
      },
      parameters: [],
    }),
  ]);

  const parameterResolver = createProofCheckPlaceResolverForFunction({
    mir,
    functionInstanceId: parameterFunctionInstanceId,
  });
  const temporaryResolver = createProofCheckPlaceResolverForFunction({
    mir,
    functionInstanceId: temporaryFunctionInstanceId,
  });

  expect(canonicalProofCheckPlaceKey("proofMirPlace:0", parameterResolver)).toBe("parameter:0:0");
  expect(canonicalProofCheckPlaceKey("parameter:0", parameterResolver)).toBe("parameter:0:0");
  expect(canonicalProofCheckPlaceKey("proofMirPlace:0", temporaryResolver)).toBe("proofMirPlace:0");
});

function functionForResolverTest(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly place: ProofMirPlace;
  readonly parameters: readonly {
    readonly parameterId: ReturnType<typeof parameterId>;
    readonly resourceKind: "Copy";
    readonly mode: "observe";
  }[];
}): ProofMirFunction {
  return {
    functionInstanceId: input.functionInstanceId,
    sourceFunctionId: 0 as never,
    signature: {
      functionId: 0 as never,
      itemId: 0 as never,
      parameters: input.parameters.map((parameter) => ({
        ...parameter,
        name: "parameter",
        type: { kind: "primitive", name: "unit" } as never,
        sourceSpan: { start: 0, end: 0 } as never,
      })),
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
    entryBlockId: 0 as never,
    blocks: tableForTest((block: ProofMirBlock) => block.blockId),
    edges: tableForTest((edge: ProofMirControlEdge) => edge.edgeId),
    values: tableForTest((value: ProofMirValue) => value.valueId),
    locals: tableForTest((local: ProofMirLocal) => local.localId),
    places: tableForTest((place: ProofMirPlace) => place.placeId, input.place),
    scopes: tableForTest((scope: ProofMirScope) => scope.scopeId),
    exits: [] as readonly ProofMirExitEdge[],
    origin: proofMirOriginId(0),
  };
}

function proofMirProgramForResolverTest(functions: readonly ProofMirFunction[]): ProofMirProgram {
  return {
    functions: tableForTest(
      (functionGraph: ProofMirFunction) => functionGraph.functionInstanceId,
      ...functions,
    ),
  } as ProofMirProgram;
}

function tableForTest<Entry, Identifier>(
  keyOf: (entry: Entry) => Identifier,
  ...entries: readonly Entry[]
): ProofMirDeterministicTable<Identifier, Entry> {
  const canonicalKeyOf = (entryId: Identifier): ProofMirCanonicalKey =>
    proofMirCanonicalKey(String(entryId));
  const byKey = new Map(entries.map((entry) => [String(keyOf(entry)), entry]));
  return {
    get(entryId) {
      return byKey.get(String(entryId));
    },
    has(entryId) {
      return byKey.has(String(entryId));
    },
    entries() {
      return [...entries];
    },
    keyOf(entry) {
      return canonicalKeyOf(keyOf(entry));
    },
    lookupKeyOf(id) {
      return canonicalKeyOf(id);
    },
  };
}
