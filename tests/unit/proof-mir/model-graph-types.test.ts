import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { MonoInstantiatedProofId } from "../../../src/mono/mono-hir";
import type { HirPlatformContractEdgeId } from "../../../src/hir/ids";
import { hirPlatformContractEdgeId } from "../../../src/hir/ids";
import type { LayoutTypeKey } from "../../../src/layout";
import {
  proofMirBlockId,
  proofMirCallId,
  proofMirControlEdgeId,
  proofMirLayoutTermBindingId,
  proofMirOriginId,
  proofMirOwnedCallId,
  proofMirOwnedControlEdgeId,
  proofMirOwnedLayoutTermBindingId,
  proofMirOwnedPlaceId,
  proofMirOwnedValueId,
  proofMirPlaceId,
  proofMirRuntimeCallId,
  proofMirRuntimeOperationId,
  proofMirScopeId,
  proofMirTerminatorId,
  proofMirValueId,
} from "../../../src/proof-mir/ids";
import type {
  ProofMirBlock,
  ProofMirBlockTarget,
  ProofMirControlEdge,
  ProofMirFunction,
  ProofMirStatementExtension,
  ProofMirTakeStart,
  ProofMirTerminatorKind,
} from "../../../src/proof-mir/model/graph";
import type {
  ProofMirConsumedOperand,
  ProofMirObservedOperand,
  ProofMirOperand,
} from "../../../src/proof-mir/model/operands";
import { proofMirDeterministicTable } from "../../../src/proof-mir/canonicalization/canonical-order";
import { proofMirCanonicalKey } from "../../../src/proof-mir/canonicalization/canonical-keys";
import { monoInstanceId } from "../../../src/mono/ids";
import type { MonoFunctionSignature } from "../../../src/mono/mono-hir";
import { functionId, itemId, platformPrimitiveId } from "../../../src/semantic/ids";
import { SourceSpan } from "../../../src/shared/source-span";

const modelDir = join(import.meta.dir, "../../../src/proof-mir/model");

function proofMirFunctionGraphModelFake(input: {
  readonly functionInstanceId: ReturnType<typeof monoInstanceId>;
}): ProofMirFunction {
  const origin = proofMirOriginId(0);
  const entryBlockId = proofMirBlockId(0);
  const scopeId = proofMirScopeId(0);
  const edgeId = proofMirControlEdgeId(0);

  const entryBlock = {
    blockId: entryBlockId,
    scopeId,
    parameters: [],
    statements: [],
    terminator: {
      terminatorId: proofMirTerminatorId(0),
      kind: { kind: "unreachable", reason: "unreachableSource" },
      outgoingEdges: [],
      origin,
    },
    incomingEdges: [edgeId],
    origin,
  } satisfies ProofMirBlock;

  const blocks = proofMirDeterministicTable({
    entries: [entryBlock],
    keyOf: (block) => proofMirCanonicalKey(`block:${String(block.blockId)}`),
    lookupKeyOf: (id) => proofMirCanonicalKey(`block:${String(id)}`),
    normalizePayload: (block) => String(block.blockId),
  });
  if (blocks.kind !== "ok") {
    throw new Error("block table failed");
  }

  const edges = proofMirDeterministicTable({
    entries: [
      {
        edgeId,
        fromBlockId: entryBlockId,
        toBlockId: entryBlockId,
        kind: "normal",
        arguments: [proofMirValueId(0)],
        facts: [],
        effects: [],
        crossedScopes: [],
        origin,
      } satisfies ProofMirControlEdge,
    ],
    keyOf: (edge) => proofMirCanonicalKey(`edge:${String(edge.edgeId)}`),
    lookupKeyOf: (id) => proofMirCanonicalKey(`edge:${String(id)}`),
    normalizePayload: (edge) => String(edge.edgeId),
  });
  if (edges.kind !== "ok") {
    throw new Error("edge table failed");
  }

  const emptyTable = <LookupId, Entry>(prefix: string) => {
    const result = proofMirDeterministicTable<LookupId, Entry>({
      entries: [],
      keyOf: (entry) => proofMirCanonicalKey(`${prefix}:${JSON.stringify(entry)}`),
      lookupKeyOf: (id) => proofMirCanonicalKey(`${prefix}:${String(id)}`),
      normalizePayload: () => "",
    });
    if (result.kind !== "ok") {
      throw new Error(`${prefix} table failed`);
    }
    return result.table;
  };

  const signature = {
    functionId: functionId(0),
    itemId: itemId(0),
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
    sourceSpan: SourceSpan.from(0, 0),
  } satisfies MonoFunctionSignature;

  return {
    functionInstanceId: input.functionInstanceId,
    sourceFunctionId: functionId(0),
    signature,
    entryBlockId,
    blocks: blocks.table,
    edges: edges.table,
    values: emptyTable("value"),
    locals: emptyTable("local"),
    places: emptyTable("place"),
    scopes: emptyTable("scope"),
    exits: [],
    origin,
  };
}

describe("Proof MIR graph model types", () => {
  test("function graph keeps local IDs function-scoped", () => {
    const func = proofMirFunctionGraphModelFake({
      functionInstanceId: monoInstanceId("fn:main"),
    });

    expect(func.entryBlockId).toBe(proofMirBlockId(0));
    expect(func.blocks.entries()[0]?.blockId).toBe(proofMirBlockId(0));
    expect(func.edges.entries()[0]?.arguments).toEqual([proofMirValueId(0)]);
  });

  test("ProofMirOperand distinguishes value-only, place-only, and value-and-place forms", () => {
    const valueOnly: ProofMirOperand = { kind: "value", value: proofMirValueId(1) };
    const placeOnly: ProofMirOperand = { kind: "place", place: proofMirPlaceId(2) };
    const valueAndPlace: ProofMirOperand = {
      kind: "valueAndPlace",
      value: proofMirValueId(3),
      place: proofMirPlaceId(4),
    };

    expect(valueOnly.kind).toBe("value");
    expect(placeOnly.kind).toBe("place");
    expect(valueAndPlace.kind).toBe("valueAndPlace");

    const observed: ProofMirObservedOperand = valueOnly;
    expect(observed.kind).toBe("value");

    const consumedPlace: ProofMirConsumedOperand = placeOnly;
    expect(consumedPlace.kind).toBe("place");

    const consumedPair: ProofMirConsumedOperand = valueAndPlace;
    expect(consumedPair.kind).toBe("valueAndPlace");
  });

  test("consume operands reject value-only operands at the type boundary", () => {
    function assignConsumed(operand: ProofMirConsumedOperand): void {
      expect(operand.kind).toBeDefined();
    }

    assignConsumed({ kind: "place", place: proofMirPlaceId(0) });

    // @ts-expect-error value-only operands cannot be consumed
    assignConsumed({ kind: "value", value: proofMirValueId(0) });
  });

  test("join arguments live only on control edges, not block targets", () => {
    const target: ProofMirBlockTarget = {
      edgeId: proofMirControlEdgeId(1),
      blockId: proofMirBlockId(2),
    };

    expect(target.edgeId).toBe(proofMirControlEdgeId(1));
    expect(target.blockId).toBe(proofMirBlockId(2));

    const rejectJoinArgsOnTarget = target as ProofMirBlockTarget & {
      readonly arguments?: readonly ReturnType<typeof proofMirValueId>[];
    };
    expect(rejectJoinArgsOnTarget.arguments).toBeUndefined();
  });

  test("exported graph records have owned ID forms", () => {
    const functionInstanceId = monoInstanceId("fn:main");

    expect(proofMirOwnedValueId(functionInstanceId, proofMirValueId(0)).functionInstanceId).toBe(
      functionInstanceId,
    );
    expect(proofMirOwnedPlaceId(functionInstanceId, proofMirPlaceId(1)).placeId).toBe(
      proofMirPlaceId(1),
    );
    expect(proofMirOwnedCallId(functionInstanceId, proofMirCallId(2)).callId).toBe(
      proofMirCallId(2),
    );
    expect(proofMirOwnedControlEdgeId(functionInstanceId, proofMirControlEdgeId(3)).edgeId).toBe(
      proofMirControlEdgeId(3),
    );
    expect(
      proofMirOwnedLayoutTermBindingId(functionInstanceId, proofMirLayoutTermBindingId(4))
        .bindingId,
    ).toBe(proofMirLayoutTermBindingId(4));
  });

  test("validation, attempt, take, and extension records are representable", () => {
    const origin = proofMirOriginId(0);
    const platformEdgeId: MonoInstantiatedProofId<HirPlatformContractEdgeId> = {
      owner: { kind: "function", instanceId: monoInstanceId("fn:main") },
      hirId: hirPlatformContractEdgeId(0),
      instanceId: monoInstanceId("fn:main"),
    };

    const validationTerminator: ProofMirTerminatorKind = {
      kind: "matchValidation",
      match: {
        validationId: {
          owner: { kind: "function", instanceId: monoInstanceId("fn:main") },
          hirId: 0 as never,
          instanceId: monoInstanceId("fn:main"),
        },
        okTarget: { edgeId: proofMirControlEdgeId(0), blockId: proofMirBlockId(1) },
        errTarget: { edgeId: proofMirControlEdgeId(1), blockId: proofMirBlockId(2) },
        okBindings: [],
        errBindings: [],
        origin,
      },
    };
    expect(validationTerminator.kind).toBe("matchValidation");

    const attemptTerminator: ProofMirTerminatorKind = {
      kind: "matchAttempt",
      match: {
        attemptId: {
          owner: { kind: "function", instanceId: monoInstanceId("fn:main") },
          hirId: 0 as never,
          instanceId: monoInstanceId("fn:main"),
        },
        successTarget: { edgeId: proofMirControlEdgeId(2), blockId: proofMirBlockId(3) },
        errorTarget: { edgeId: proofMirControlEdgeId(3), blockId: proofMirBlockId(4) },
        inputPlaces: [],
        origin,
      },
    };
    expect(attemptTerminator.kind).toBe("matchAttempt");

    const takeStart: ProofMirTakeStart = {
      operand: { kind: "place", place: proofMirPlaceId(0) },
      obligation: {
        obligationId: {
          owner: { kind: "function", instanceId: monoInstanceId("fn:main") },
          hirId: 0 as never,
          instanceId: monoInstanceId("fn:main"),
        },
        origin,
      },
      origin,
    };
    expect(takeStart.obligation.origin).toBe(origin);

    const extension: ProofMirStatementExtension = {
      gate: "crossCoreOwnership",
      kind: "concurrency",
      operation: {
        kind: "transferOwnership",
        fromPlace: proofMirPlaceId(0),
        toPlace: proofMirPlaceId(1),
        origin,
      },
    };
    expect(extension.gate).toBe("crossCoreOwnership");

    const gatedYield: ProofMirTerminatorKind = {
      gate: "coroutineYield",
      kind: "yield",
      suspension: {
        suspendEdge: proofMirControlEdgeId(4),
        resumeTarget: { edgeId: proofMirControlEdgeId(5), blockId: proofMirBlockId(5) },
        frameBoundary: {
          values: [],
          places: [],
          loans: [],
          obligations: [],
          sessionMembers: [],
          privateStateGenerations: [],
        },
        origin,
      },
    };
    expect(gatedYield.gate).toBe("coroutineYield");

    const layoutTypeKey: LayoutTypeKey = {
      kind: "source",
      instanceId: monoInstanceId("type:packet"),
    };
    const callTarget = {
      kind: "certifiedPlatform",
      edgeId: platformEdgeId,
      primitiveId: platformPrimitiveId("uefi.read"),
      abi: { kind: "platformAbi", edgeId: platformEdgeId },
    } as const;
    expect(callTarget.kind).toBe("certifiedPlatform");
    expect(layoutTypeKey.kind).toBe("source");
    expect(proofMirRuntimeOperationId(0)).toBeDefined();
    expect(proofMirRuntimeCallId(0)).toBeDefined();
  });

  test("model graph sources avoid forbidden imports", async () => {
    const forbiddenPatterns = [
      /from\s+["'][^"']*\/parser/,
      /from\s+["'][^"']*\/ast/,
      /from\s+["'][^"']*filesystem/,
      /from\s+["'][^"']*proof-checker/,
      /from\s+["'][^"']*target\//,
      /from\s+["'][^"']*aarch64/i,
      /from\s+["'][^"']*linker/,
      /from\s+["'][^"']*pe\/coff/i,
    ];

    for (const fileName of ["operands.ts", "effects.ts", "graph.ts"] as const) {
      const source = await readFile(join(modelDir, fileName), "utf8");
      for (const pattern of forbiddenPatterns) {
        expect(pattern.test(source)).toBe(false);
      }
    }
  });
});
