import { describe, expect, test } from "bun:test";
import { hirPlatformContractEdgeId } from "../../../src/hir/ids";
import type { LayoutFactProgram } from "../../../src/layout/layout-program";
import { monoInstanceId } from "../../../src/mono/ids";
import type { MonoProofMetadata } from "../../../src/mono/mono-hir";
import {
  proofMirCallId,
  proofMirFactId,
  proofMirLayoutTermId,
  proofMirOriginId,
  proofMirOwnedCallId,
  proofMirOwnedPlaceId,
  proofMirOwnedValueId,
  proofMirPlaceId,
  proofMirPrivateStateGenerationId,
  proofMirRuntimeCallId,
  proofMirRuntimeOperationId,
  proofMirValueId,
} from "../../../src/proof-mir/ids";
import type {
  ProofMirCallGraphEdge,
  ProofMirCallTarget,
  ProofMirRuntimeCallContract,
} from "../../../src/proof-mir/model/calls";
import type { ProofMirFact, ProofMirFactDependency } from "../../../src/proof-mir/model/facts";
import type {
  ProofMirLayoutReference,
  ProofMirLayoutTermReference,
} from "../../../src/proof-mir/model/layout-bindings";
import type { ProofMirOrigin } from "../../../src/proof-mir/model/origins";
import type {
  ProofMirImage,
  ProofMirPrivateStateGeneration,
  ProofMirProgram,
} from "../../../src/proof-mir/model/program";
import type { ProofMirDeterministicTable } from "../../../src/proof-mir/canonicalization/canonical-order";
import type { ProofMirRuntimeCatalog } from "../../../src/runtime/runtime-catalog-types";
import { platformPrimitiveId } from "../../../src/semantic/ids";

function emptyDeterministicTable<Key, Value>(): ProofMirDeterministicTable<Key, Value> {
  return {
    get: () => undefined,
    has: () => false,
    entries: () => [],
    keyOf: () => "" as never,
    lookupKeyOf: () => "" as never,
  };
}

function proofMirProgramModelFake(): ProofMirProgram {
  const imageInstanceId = monoInstanceId("image:main");
  const entryFunctionInstanceId = monoInstanceId("function:main");
  const image: ProofMirImage = {
    imageInstanceId,
    entryFunctionInstanceId,
    externalRoots: [],
    layout: { kind: "imageEntryAbi", imageInstanceId },
    origin: proofMirOriginId(0),
  };

  return {
    image,
    reachableFunctions: emptyDeterministicTable(),
    functions: emptyDeterministicTable(),
    layout: {} as LayoutFactProgram,
    proofMetadata: {} as MonoProofMetadata,
    origins: emptyDeterministicTable(),
    facts: emptyDeterministicTable(),
    layoutTerms: emptyDeterministicTable(),
    privateStateGenerations: emptyDeterministicTable(),
    callGraph: emptyDeterministicTable(),
    platformEdges: emptyDeterministicTable(),
    runtimeCatalog: {
      targetId: "x64-test" as never,
      features: [],
      get: () => undefined,
      entries: () => [],
    } satisfies ProofMirRuntimeCatalog,
    runtimeCalls: emptyDeterministicTable(),
  };
}

function platformEdgeIdForTest() {
  return {
    owner: { kind: "function" as const, instanceId: monoInstanceId("function:main") },
    hirId: hirPlatformContractEdgeId(0),
    instanceId: monoInstanceId("function:main"),
  };
}

describe("Proof MIR program model types", () => {
  test("ProofMirProgram exposes checker-facing whole-image tables", () => {
    const program = proofMirProgramModelFake();

    expect(program.functions.entries()).toEqual([]);
    expect(program.layout).toBeDefined();
    expect(program.runtimeCatalog.entries()).toEqual([]);
    expect(program.origins.entries()).toEqual([]);
    expect(program.facts.entries()).toEqual([]);
    expect(program.layoutTerms.entries()).toEqual([]);
    expect(program.privateStateGenerations.entries()).toEqual([]);
    expect(program.callGraph.entries()).toEqual([]);
    expect(program.platformEdges.entries()).toEqual([]);
    expect(program.runtimeCalls.entries()).toEqual([]);
    expect(program.image.entryFunctionInstanceId).toBe(monoInstanceId("function:main"));
  });

  test("ProofMirCallTarget supports sourceFunction, certifiedPlatform, and compilerRuntime", () => {
    const sourceFunction: ProofMirCallTarget = {
      kind: "sourceFunction",
      functionInstanceId: monoInstanceId("function:add_one"),
      abi: { kind: "functionAbi", functionInstanceId: monoInstanceId("function:add_one") },
    };
    const certifiedPlatform: ProofMirCallTarget = {
      kind: "certifiedPlatform",
      edgeId: platformEdgeIdForTest(),
      primitiveId: platformPrimitiveId("uefi.read"),
      abi: { kind: "platformAbi", edgeId: platformEdgeIdForTest() },
    };
    const compilerRuntime: ProofMirCallTarget = {
      kind: "compilerRuntime",
      runtimeId: proofMirRuntimeOperationId(1),
      runtimeCallId: proofMirRuntimeCallId(0),
    };

    expect(sourceFunction.kind).toBe("sourceFunction");
    expect(certifiedPlatform.kind).toBe("certifiedPlatform");
    expect(compilerRuntime.kind).toBe("compilerRuntime");
  });

  test("program-level call graph edges use owned call IDs with MonoInstanceId", () => {
    const functionInstanceId = monoInstanceId("function:main");
    const edge: ProofMirCallGraphEdge = {
      callId: proofMirOwnedCallId(functionInstanceId, proofMirCallId(2)),
      target: {
        kind: "sourceFunction",
        functionInstanceId,
        abi: { kind: "functionAbi", functionInstanceId },
      },
      origin: proofMirOriginId(4),
    };

    expect(edge.callId.functionInstanceId).toBe(functionInstanceId);
    expect(edge.callId.callId).toBe(proofMirCallId(2));
  });

  test("fact dependencies reference canonical fact IDs instead of embedding fact records", () => {
    const prerequisiteFactId = proofMirFactId(1);
    const dependentFactId = proofMirFactId(2);
    const dependency: ProofMirFactDependency = {
      kind: "fact",
      factId: prerequisiteFactId,
    };
    const fact: ProofMirFact = {
      factId: dependentFactId,
      role: "requirement",
      kind: {
        kind: "comparison",
        left: { kind: "bool", value: true },
        operator: "eq",
        right: { kind: "bool", value: true },
      },
      origin: proofMirOriginId(0),
      dependsOn: [dependency],
    };

    expect(fact.dependsOn[0]).toEqual({ kind: "fact", factId: prerequisiteFactId });
    expect(Object.keys(fact.dependsOn[0] ?? {})).toEqual(["kind", "factId"]);
  });

  test("runtime call contracts reference catalog operation IDs and owned operands", () => {
    const functionInstanceId = monoInstanceId("function:main");
    const contract: ProofMirRuntimeCallContract = {
      runtimeCallId: proofMirRuntimeCallId(0),
      runtimeId: proofMirRuntimeOperationId(3),
      callId: proofMirOwnedCallId(functionInstanceId, proofMirCallId(1)),
      requiredFacts: [proofMirFactId(5)],
      consumedCapabilities: [proofMirOwnedPlaceId(functionInstanceId, proofMirPlaceId(0))],
      producedCapabilities: [],
      effects: [{ kind: "mayPanic" }],
      origin: proofMirOriginId(6),
    };

    expect(contract.runtimeId).toBe(proofMirRuntimeOperationId(3));
    expect(contract.requiredFacts).toEqual([proofMirFactId(5)]);
    expect(contract.consumedCapabilities[0]?.functionInstanceId).toBe(functionInstanceId);
  });

  test("origins, layout references, and private-state generations are representable", () => {
    const functionInstanceId = monoInstanceId("function:main");
    const origin: ProofMirOrigin = {
      originId: proofMirOriginId(0),
      owner: { kind: "function", functionInstanceId },
      note: "if.join",
    };
    const layoutReference: ProofMirLayoutReference = {
      kind: "validatedBufferField",
      instanceId: monoInstanceId("type:packet"),
      fieldId: "payload" as never,
    };
    const termReference: ProofMirLayoutTermReference = {
      termId: proofMirLayoutTermId(0),
      path: {
        root: {
          kind: "validatedBufferFieldTerm",
          instanceId: monoInstanceId("type:packet"),
          fieldId: "payload" as never,
          slot: "end",
        },
        childPath: ["left"],
      },
      unit: "byteOffset",
    };
    const generation: ProofMirPrivateStateGeneration = {
      generationId: proofMirPrivateStateGenerationId(0),
      place: proofMirOwnedPlaceId(functionInstanceId, proofMirPlaceId(1)),
      origin: proofMirOriginId(1),
    };

    expect(origin.owner.kind).toBe("function");
    expect(layoutReference.kind).toBe("validatedBufferField");
    expect(termReference.path.childPath).toEqual(["left"]);
    expect(generation.place.functionInstanceId).toBe(functionInstanceId);
  });

  test("fact operands use owned value and place IDs at program scope", () => {
    const functionInstanceId = monoInstanceId("function:worker");
    const fact: ProofMirFact = {
      factId: proofMirFactId(0),
      role: "evidence",
      kind: {
        kind: "layoutFits",
        source: proofMirOwnedPlaceId(functionInstanceId, proofMirPlaceId(2)),
        end: {
          termId: proofMirLayoutTermId(1),
          path: {
            root: {
              kind: "validatedBufferSourceLength",
              instanceId: monoInstanceId("type:buffer"),
            },
            childPath: [],
          },
          unit: "byteLength",
        },
      },
      origin: proofMirOriginId(2),
      dependsOn: [
        {
          kind: "value",
          valueId: proofMirOwnedValueId(functionInstanceId, proofMirValueId(3)),
        },
      ],
    };

    expect(fact.kind.kind).toBe("layoutFits");
    if (fact.kind.kind === "layoutFits") {
      expect(fact.kind.source.functionInstanceId).toBe(functionInstanceId);
    }
    expect(fact.dependsOn[0]?.kind).toBe("value");
  });
});
