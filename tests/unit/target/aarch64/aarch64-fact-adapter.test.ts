import { describe, expect, test } from "bun:test";
import { optIrFactId, optIrOperationId, optIrValueId } from "../../../../src/opt-ir/ids";
import { optIrFactSetFromRecords } from "../../../../src/opt-ir/facts/fact-index";
import {
  createOptIrFactExtensionRegistryForTest,
  optIrExtensionFactRecord,
} from "../../../../src/opt-ir/facts/fact-extension-registry";
import {
  createAArch64FactQuery,
  createAArch64FactAdapterRegistryForTest,
} from "../../../../src/target/aarch64/facts/aarch64-fact-adapter";
import { rekeyAArch64FactsToMachine } from "../../../../src/target/aarch64/facts/aarch64-fact-rekeying";
import { aarch64VirtualRegisterId } from "../../../../src/target/aarch64/machine-ir/ids";

describe("AArch64 fact adapters", () => {
  const factRecordRegistry = createOptIrFactExtensionRegistryForTest([
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
    {
      extensionKey: "security",
      packetKinds: ["security"],
      validateImport: () => ({ kind: "ok", typedAnswers: ["extension"] }),
      indexKeysFor: (record) => [`security:${record.subjectKey}`],
      preservationRules: ["preserve-through-security-stable-clone"],
      invalidationRules: ["invalidate-on-security-rewrite"],
      upstreamVerifierKey: "security-facts",
      negativeFixtures: ["conflicting-spill-labels"],
    },
  ]);

  test("build separate query namespaces from registered adapters", () => {
    const registry = createAArch64FactAdapterRegistryForTest([
      {
        adapterKey: "memory-order",
        optIrExtensionKey: "memory-order",
        targetQueryNamespace: () => ({
          memoryOrderForOperation: () => ({ kind: "yes", order: "release" }),
        }),
        machineRekeyingRules: [
          { subjectKind: "operation", machineSubjectKind: "machineInstruction" },
        ],
        targetProfileFingerprintInputs: ["matrix:memory-order"],
      },
      {
        adapterKey: "security",
        optIrExtensionKey: "security",
        targetQueryNamespace: () => ({
          securityForValue: () => ({ kind: "yes", secret: true }),
        }),
        machineRekeyingRules: [{ subjectKind: "value", machineSubjectKind: "virtualRegister" }],
        targetProfileFingerprintInputs: ["matrix:security"],
      },
    ]);

    expect(registry.adapterKeys()).toEqual(["memory-order", "security"]);
    expect(Object.keys(registry.targetProfileFingerprintInputs())).toEqual([
      "memory-order",
      "security",
    ]);
  });

  test("orders adapter keys by code-unit order", () => {
    const registry = createAArch64FactAdapterRegistryForTest([
      {
        adapterKey: "_",
        optIrExtensionKey: "_",
        targetQueryNamespace: () => ({}),
        machineRekeyingRules: [],
        targetProfileFingerprintInputs: [],
      },
      {
        adapterKey: "Z",
        optIrExtensionKey: "Z",
        targetQueryNamespace: () => ({}),
        machineRekeyingRules: [],
        targetProfileFingerprintInputs: [],
      },
    ]);

    expect(registry.adapterKeys()).toEqual(["Z", "_"]);
  });

  test("default query exposes memory order and security answers with facts used", () => {
    const factSet = optIrFactSetFromRecords([
      optIrExtensionFactRecord({
        registry: factRecordRegistry,
        factId: optIrFactId(4),
        extensionKey: "memory-order",
        packetKind: "memory-order",
        subject: { kind: "operation", operationId: optIrOperationId(9) },
        payload: { order: "release", publicationShape: "virtioAvailIndexPublication" },
        authority: "proof:memory-model",
      }),
      optIrExtensionFactRecord({
        registry: factRecordRegistry,
        factId: optIrFactId(5),
        extensionKey: "security",
        packetKind: "security",
        subject: { kind: "value", valueId: optIrValueId(7) },
        payload: { labels: ["secret", "noSpill"] },
        authority: "proof:security",
      }),
    ]);

    const query = createAArch64FactQuery(factSet);

    expect(query.memoryOrderForOperation(optIrOperationId(9))).toMatchObject({
      kind: "yes",
      order: "release",
      factsUsed: [optIrFactId(4)],
    });
    expect(query.securityForValue(optIrValueId(7))).toMatchObject({
      kind: "yes",
      secret: true,
      spillPolicy: "noSpill",
      factsUsed: [optIrFactId(5)],
    });
  });

  test("machine fact re-keying rejects ambiguous subject mappings", () => {
    const result = rekeyAArch64FactsToMachine({
      records: [
        {
          optIrFactId: optIrFactId(1),
          subject: { kind: "value", valueId: optIrValueId(7) },
          payload: { labels: ["secret"] },
        },
      ],
      valueMappings: [
        { valueId: optIrValueId(7), machineVreg: aarch64VirtualRegisterId(1) },
        { valueId: optIrValueId(7), machineVreg: aarch64VirtualRegisterId(2) },
      ],
    });

    expect(result).toEqual({
      kind: "error",
      reason: "ambiguous-subject-mapping:value:7",
    });
  });
});
