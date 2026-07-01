import { describe, expect, test } from "bun:test";
import { optIrFactId, optIrOperationId } from "../../../src/opt-ir/ids";
import {
  createOptIrFactRecordRegistry,
  createOptIrFactExtensionRegistryForTest,
  optIrExtensionFactRecord,
} from "../../../src/opt-ir/facts/fact-extension-registry";
import { optIrFactSetFromRecords } from "../../../src/opt-ir/facts/fact-index";

describe("OptIR fact extension registry", () => {
  const memoryOrderRecordRegistry = createOptIrFactRecordRegistry({
    extensionKey: "memory-order",
    packetKinds: ["memory-order"],
    preservationRules: ["preserve-through-effect-stable-clone"],
    invalidationRules: ["invalidate-on-effect-rewrite"],
    upstreamVerifierKey: "memory-order-facts",
    negativeFixtures: ["missing-authority"],
  });

  test("dispatches schema validation by extension key in stable order", () => {
    const validatedPayloads: unknown[] = [];
    const registry = createOptIrFactExtensionRegistryForTest([
      {
        extensionKey: "branch-probability",
        packetKinds: ["branch-probability"],
        validateImport: () => ({ kind: "ok", typedAnswers: ["extension"] }),
        indexKeysFor: (record) => [`branch:${record.subjectKey}`],
        preservationRules: ["preserve-through-cfg-stable-clone"],
        invalidationRules: ["invalidate-on-cfg-rewrite"],
        upstreamVerifierKey: "branch-facts",
        negativeFixtures: ["missing-edge"],
      },
      {
        extensionKey: "memory-order",
        packetKinds: ["memory-order"],
        validateImport: (input) => {
          validatedPayloads.push(input.payload);
          return { kind: "ok", typedAnswers: ["extension"] };
        },
        indexKeysFor: (record) => [`memory:${record.subjectKey}`],
        preservationRules: ["preserve-through-effect-stable-clone"],
        invalidationRules: ["invalidate-on-effect-rewrite"],
        upstreamVerifierKey: "memory-order-facts",
        negativeFixtures: ["missing-authority"],
      },
    ]);

    expect(registry.extensionKeys()).toEqual(["branch-probability", "memory-order"]);
    expect(
      registry.validateImport({
        extensionKey: "memory-order",
        packetKind: "memory-order",
        payload: { order: "release" },
      }).kind,
    ).toBe("ok");
    expect(validatedPayloads).toEqual([{ order: "release" }]);
  });

  test("extension fact records index payloads without target imports", () => {
    const factSet = optIrFactSetFromRecords([
      optIrExtensionFactRecord({
        registry: memoryOrderRecordRegistry,
        factId: optIrFactId(3),
        extensionKey: "memory-order",
        packetKind: "memory-order",
        subject: { kind: "operation", operationId: optIrOperationId(9) },
        payload: { order: "release" },
        authority: "proof:memory-model",
      }),
    ]);

    expect(factSet.records[0]?.typedAnswers).toEqual(["extension"]);
    expect(factSet.indexes.byTypedAnswer.extension?.map(Number)).toEqual([3]);
  });

  test("record registry rejects non-object payloads before import", () => {
    expect(
      memoryOrderRecordRegistry.validateImport({
        extensionKey: "memory-order",
        packetKind: "memory-order",
        payload: "release",
      }),
    ).toEqual({
      kind: "error",
      reason: "invalid-extension-payload:memory-order:expected-object",
    });
  });

  test("extension fact record construction rejects facts outside the closed registry", () => {
    const registry = createOptIrFactExtensionRegistryForTest([
      {
        extensionKey: "memory-order",
        packetKinds: ["memory-order"],
        validateImport: () => ({ kind: "ok", typedAnswers: ["extension"] }),
        indexKeysFor: (record) => [`memory:${record.subjectKey}`],
        preservationRules: ["preserve-through-effect-stable-clone"],
        invalidationRules: ["invalidate-on-effect-rewrite"],
        upstreamVerifierKey: "memory-order-facts",
        negativeFixtures: ["missing-authority"],
      },
    ]);

    expect(() =>
      optIrExtensionFactRecord({
        registry,
        factId: optIrFactId(4),
        extensionKey: "forged-aarch64-fact",
        packetKind: "memory-order",
        subject: { kind: "operation", operationId: optIrOperationId(9) },
        payload: { order: "release" },
        authority: "proof:memory-model",
      }),
    ).toThrow("unknown-extension:forged-aarch64-fact");

    expect(() =>
      optIrExtensionFactRecord({
        registry,
        factId: optIrFactId(5),
        extensionKey: "memory-order",
        packetKind: "forged-packet",
        subject: { kind: "operation", operationId: optIrOperationId(9) },
        payload: { order: "release" },
        authority: "proof:memory-model",
      }),
    ).toThrow("unsupported-packet-kind:memory-order:forged-packet");
  });
});
