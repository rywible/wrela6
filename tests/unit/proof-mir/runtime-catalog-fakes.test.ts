import { describe, expect, test } from "bun:test";
import {
  proofMirOriginForTest,
  proofMirRuntimeCallContractFake,
  proofMirRuntimeCatalogFake,
  proofMirRuntimeOperationFake,
} from "../../support/proof-mir/proof-mir-fakes";
import { proofMirRuntimeOperationId } from "../../../src/runtime/runtime-catalog";
import { selectProofMirRuntimeCatalog } from "../../../src/target/target-runtime-selection";
import { targetId } from "../../../src/semantic/ids";
import {
  proofMirCallId,
  proofMirFactId,
  proofMirOriginId,
  proofMirOwnedCallId,
  proofMirOwnedPlaceId,
  proofMirPlaceId,
  proofMirRuntimeCallId,
} from "../../../src/proof-mir/ids";
import { monoInstanceId } from "../../../src/mono/ids";

describe("proofMirRuntimeOperationFake", () => {
  test("creates complete runtime operation definitions with deterministic defaults", () => {
    const operation = proofMirRuntimeOperationFake({
      runtimeId: proofMirRuntimeOperationId(3),
      name: "panic_abort",
    });

    expect(operation).toEqual({
      runtimeId: proofMirRuntimeOperationId(3),
      name: "panic_abort",
      targetAvailability: { kind: "allTargets" },
      loweringOwner: "panicAbort",
      abi: { kind: "compilerRuntime", symbol: "__wr_panic_abort" },
      requiredFactSchemas: [],
      consumedCapabilitySchemas: [],
      producedCapabilitySchemas: [],
      effectSchemas: [{ kind: "doesNotReturn" }],
    });
  });

  test("accepts overrides for availability, schemas, and lowering owner", () => {
    const operation = proofMirRuntimeOperationFake({
      runtimeId: proofMirRuntimeOperationId(10),
      name: "read_validated_u8",
      loweringOwner: "validatedBufferHelper",
      targetAvailability: {
        kind: "targetFeature",
        targetId: targetId("x64-test"),
        feature: "sse2",
      },
      requiredFactSchemas: [
        {
          name: "buffer_valid",
          role: "requirement",
          operands: [{ kind: "argument", index: 0 }],
        },
      ],
      consumedCapabilitySchemas: [{ kind: "argument", index: 0 }],
      producedCapabilitySchemas: [{ kind: "result" }],
      effectSchemas: [{ kind: "readsMemory", place: { kind: "argument", index: 0 } }],
      abi: { kind: "runtimeAbi", runtimeId: proofMirRuntimeOperationId(10) },
    });

    expect(operation.loweringOwner).toBe("validatedBufferHelper");
    expect(operation.targetAvailability).toEqual({
      kind: "targetFeature",
      targetId: targetId("x64-test"),
      feature: "sse2",
    });
    expect(operation.requiredFactSchemas).toHaveLength(1);
    expect(operation.consumedCapabilitySchemas).toEqual([{ kind: "argument", index: 0 }]);
    expect(operation.producedCapabilitySchemas).toEqual([{ kind: "result" }]);
    expect(operation.effectSchemas).toEqual([
      { kind: "readsMemory", place: { kind: "argument", index: 0 } },
    ]);
    expect(operation.abi).toEqual({
      kind: "runtimeAbi",
      runtimeId: proofMirRuntimeOperationId(10),
    });
  });
});

describe("proofMirRuntimeCatalogFake", () => {
  test("runtime fake can model a validated-buffer helper", () => {
    const catalog = proofMirRuntimeCatalogFake({
      operations: [
        proofMirRuntimeOperationFake({
          runtimeId: proofMirRuntimeOperationId(10),
          name: "read_validated_u8",
          loweringOwner: "validatedBufferHelper",
          effectSchemas: [{ kind: "readsMemory", place: { kind: "argument", index: 0 } }],
        }),
      ],
    });

    expect(catalog.entries().map((entry) => entry.name)).toEqual(["read_validated_u8"]);
  });

  test("creates a sorted closed catalog for a target ID and feature set", () => {
    const catalog = proofMirRuntimeCatalogFake({
      targetId: targetId("x64-test"),
      features: ["avx2", "sse2"],
      operations: [
        proofMirRuntimeOperationFake({
          runtimeId: proofMirRuntimeOperationId(20),
          name: "panic",
        }),
        proofMirRuntimeOperationFake({
          runtimeId: proofMirRuntimeOperationId(5),
          name: "read_u8",
        }),
      ],
    });

    expect(catalog.targetId).toBe(targetId("x64-test"));
    expect(catalog.features).toEqual(["avx2", "sse2"]);
    expect(catalog.entries().map((entry) => entry.name)).toEqual(["read_u8", "panic"]);
    expect(catalog.get(proofMirRuntimeOperationId(5))?.name).toBe("read_u8");
    expect(catalog.get(proofMirRuntimeOperationId(20))?.name).toBe("panic");
  });

  test("is injectable through target runtime catalog selection", () => {
    const catalog = proofMirRuntimeCatalogFake({
      targetId: targetId("x64-test"),
      features: ["sse2"],
      operations: [
        proofMirRuntimeOperationFake({
          runtimeId: proofMirRuntimeOperationId(1),
          name: "read_u8",
        }),
      ],
    });

    const result = selectProofMirRuntimeCatalog({
      targetId: targetId("x64-test"),
      features: ["sse2"],
      catalogs: [catalog],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.catalog).toBe(catalog);
  });
});

describe("proofMirOriginForTest", () => {
  test("returns deterministic origin IDs for stable notes", () => {
    expect(proofMirOriginForTest("yield")).toBe(proofMirOriginForTest("yield"));
    expect(proofMirOriginForTest("return")).toBe(proofMirOriginForTest("return"));
    expect(proofMirOriginForTest("yield")).not.toBe(proofMirOriginForTest("return"));
  });

  test("returns branded ProofMirOriginId values", () => {
    const origin = proofMirOriginForTest("if.join");
    expect(typeof origin).toBe("number");
    expect(origin).toBe(proofMirOriginId(Number(origin)));
  });
});

describe("proofMirRuntimeCallContractFake", () => {
  test("creates a complete runtime call contract with deterministic defaults", () => {
    const functionInstanceId = monoInstanceId("fn:main");
    const contract = proofMirRuntimeCallContractFake({
      runtimeId: proofMirRuntimeOperationId(10),
      callId: proofMirOwnedCallId(functionInstanceId, proofMirCallId(4)),
      origin: proofMirOriginForTest("runtime.call"),
    });

    expect(typeof contract.runtimeCallId).toBe("number");
    expect(contract.runtimeCallId).toBe(proofMirRuntimeCallId(10));
    expect(contract.runtimeId).toBe(proofMirRuntimeOperationId(10));
    expect(contract.callId).toEqual(proofMirOwnedCallId(functionInstanceId, proofMirCallId(4)));
    expect(contract.requiredFacts).toEqual([]);
    expect(contract.consumedCapabilities).toEqual([]);
    expect(contract.producedCapabilities).toEqual([]);
    expect(contract.effects).toEqual([]);
    expect(contract.origin).toBe(proofMirOriginForTest("runtime.call"));
  });

  test("accepts overrides for facts, capabilities, and effects", () => {
    const functionInstanceId = monoInstanceId("fn:helper");
    const contract = proofMirRuntimeCallContractFake({
      runtimeCallId: proofMirRuntimeCallId(7),
      runtimeId: proofMirRuntimeOperationId(10),
      callId: proofMirOwnedCallId(functionInstanceId, proofMirCallId(1)),
      requiredFacts: [proofMirFactId(2)],
      consumedCapabilities: [proofMirOwnedPlaceId(functionInstanceId, proofMirPlaceId(3))],
      producedCapabilities: [proofMirOwnedPlaceId(functionInstanceId, proofMirPlaceId(4))],
      effects: [
        {
          kind: "readsMemory",
          place: proofMirOwnedPlaceId(functionInstanceId, proofMirPlaceId(3)),
        },
      ],
      origin: proofMirOriginForTest("validated-buffer.read"),
    });

    expect(contract.runtimeCallId).toBe(proofMirRuntimeCallId(7));
    expect(contract.requiredFacts).toEqual([proofMirFactId(2)]);
    expect(contract.consumedCapabilities).toEqual([
      proofMirOwnedPlaceId(functionInstanceId, proofMirPlaceId(3)),
    ]);
    expect(contract.producedCapabilities).toEqual([
      proofMirOwnedPlaceId(functionInstanceId, proofMirPlaceId(4)),
    ]);
    expect(contract.effects).toEqual([
      {
        kind: "readsMemory",
        place: proofMirOwnedPlaceId(functionInstanceId, proofMirPlaceId(3)),
      },
    ]);
  });
});
