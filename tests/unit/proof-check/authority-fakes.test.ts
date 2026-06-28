import { describe, expect, test } from "bun:test";

import { proofMirRuntimeOperationFake } from "../../support/proof-mir/proof-mir-fakes";
import { monoCoreType } from "../../support/mono/monomorphization-fixtures";
import { proofMirRuntimeOperationId } from "../../../src/runtime/runtime-catalog";
import { targetFeatureId } from "../../../src/proof-check/authority/authority-catalog-helpers";
import { targetId } from "../../../src/semantic/ids";
import {
  proofAuthorityFingerprintForTest,
  proofCheckPlatformCatalogFake,
  proofCheckPlatformContractFake,
  proofCheckRuntimeCatalogFake,
  proofCheckTypeFactCatalogFake,
  proofEntailmentRequestForTest,
  proofSemanticsCompanionFake,
  proofSemanticsEntailmentOkForTest,
} from "../../support/proof-check/authority-fakes";
import { proofCheckLiveValueScopeId } from "../../../src/proof-check/authority/type-fact-authority";

describe("proofAuthorityFingerprintForTest", () => {
  test("returns deterministic target ID, version, authority kind, and digest", () => {
    const first = proofAuthorityFingerprintForTest({
      authorityKind: "runtime",
      targetName: "uefi-aarch64",
      version: "runtime-v1",
      digestSeed: "runtime-seed",
    });
    const second = proofAuthorityFingerprintForTest({
      authorityKind: "runtime",
      targetName: "uefi-aarch64",
      version: "runtime-v1",
      digestSeed: "runtime-seed",
    });

    expect(first).toEqual(second);
    expect(first.authorityKind).toBe("runtime");
    expect(first.targetId).toBe(targetId("uefi-aarch64"));
    expect(first.version).toBe("runtime-v1");
    expect(first.digestAlgorithm).toBe("sha256");
    expect(first.digestHex).toMatch(/^[0-9a-f]{64}$/);
  });

  test("derives digest from authority kind when digest seed is omitted", () => {
    const platform = proofAuthorityFingerprintForTest({ authorityKind: "platform" });
    const runtime = proofAuthorityFingerprintForTest({ authorityKind: "runtime" });

    expect(platform.digestHex).not.toBe(runtime.digestHex);
  });
});

describe("proofCheckPlatformCatalogFake", () => {
  test("authority fakes produce deterministic platform contract entries", () => {
    const catalog = proofCheckPlatformCatalogFake({
      entries: [
        proofCheckPlatformContractFake({ authorityKey: "platform:send" }),
        proofCheckPlatformContractFake({ authorityKey: "platform:recv" }),
      ],
    });

    expect(catalog.entries().map((entry) => entry.authorityKey)).toEqual([
      "platform:recv",
      "platform:send",
    ]);
  });

  test("platform contract fake derives deterministic target and contract origins", () => {
    const entry = proofCheckPlatformContractFake({
      authorityKey: "platform:send",
      targetName: "proof-check-test-target",
      primitiveName: "send",
      contractName: "default",
    });

    expect(entry.targetId).toBe(targetId("proof-check-test-target"));
    expect(String(entry.primitiveId)).toBe("send");
    expect(String(entry.contractId)).toBe("default");
    expect(entry.authorityKey).toBe("platform:send");
  });
});

describe("proofCheckRuntimeCatalogFake", () => {
  test("sorts runtime entries by authority key", () => {
    const catalog = proofCheckRuntimeCatalogFake({
      entries: [
        {
          authorityKey: "runtime:z",
          operation: proofMirRuntimeOperationFake({
            runtimeId: proofMirRuntimeOperationId(2),
            name: "z",
          }),
        },
        {
          authorityKey: "runtime:a",
          operation: proofMirRuntimeOperationFake({
            runtimeId: proofMirRuntimeOperationId(1),
            name: "a",
          }),
        },
      ],
    });

    expect(catalog.entries().map((entry) => entry.authorityKey)).toEqual([
      "runtime:a",
      "runtime:z",
    ]);
  });

  test("derives selected runtime catalog from embedded Proof MIR runtime catalog", () => {
    const embedded = {
      targetId: targetId("proof-check-test-target"),
      features: [targetFeatureId("net")],
      fingerprint: proofAuthorityFingerprintForTest({
        authorityKind: "runtime",
        digestSeed: "embedded-runtime",
      }),
      get: () => undefined,
      entries: () => [
        proofMirRuntimeOperationFake({
          runtimeId: proofMirRuntimeOperationId(1),
          name: "panic_abort",
        }),
      ],
    };

    const catalog = proofCheckRuntimeCatalogFake({ embedded });

    expect(catalog.targetId).toBe(embedded.targetId);
    expect(catalog.features).toEqual([targetFeatureId("net")]);
    expect(catalog.fingerprint).toEqual(embedded.fingerprint);
    expect(catalog.entries()[0]?.authorityKey).toBe("runtime:panic_abort");
  });

  test("fingerprintName produces a distinct runtime fingerprint", () => {
    const selected = proofCheckRuntimeCatalogFake({ fingerprintName: "selected" });
    const embedded = proofCheckRuntimeCatalogFake({ fingerprintName: "embedded" });

    expect(selected.fingerprint?.digestHex).not.toBe(embedded.fingerprint?.digestHex);
  });
});

describe("proofCheckTypeFactCatalogFake", () => {
  test("sorts type fact entries by authority key", () => {
    const concreteType = monoCoreType("u32");
    const scope = proofCheckLiveValueScopeId("global-seed");
    const catalog = proofCheckTypeFactCatalogFake({
      entries: [
        {
          concreteType,
          liveValueScope: scope,
          placeholders: [{ kind: "layoutTerm", layoutKey: "subject" }],
          facts: [
            {
              kind: "comparison",
              left: { kind: "place", place: { kind: "subject" } },
              operator: "eq",
              right: { kind: "literal", literal: { kind: "bool", value: true } },
            },
          ],
          invalidatedBy: [{ kind: "moveTransfers" }],
          authorityKey: "typeFacts:z",
        },
        {
          concreteType,
          liveValueScope: scope,
          placeholders: [{ kind: "layoutTerm", layoutKey: "subject" }],
          facts: [
            {
              kind: "comparison",
              left: { kind: "place", place: { kind: "subject" } },
              operator: "eq",
              right: { kind: "literal", literal: { kind: "bool", value: false } },
            },
          ],
          invalidatedBy: [{ kind: "consumeRemoves" }],
          authorityKey: "typeFacts:a",
        },
      ],
    });

    expect(catalog.entries().map((entry) => entry.authorityKey)).toEqual([
      "typeFacts:a",
      "typeFacts:z",
    ]);
  });
});

describe("proofSemanticsCompanionFake", () => {
  test("produces deterministic companion requests and results", () => {
    const result = proofSemanticsEntailmentOkForTest();
    const companion = proofSemanticsCompanionFake({
      providedJudgments: ["entailment"],
      result,
    });
    const request = proofEntailmentRequestForTest();

    expect(companion.judge(request)).toEqual(result);
    expect(proofEntailmentRequestForTest()).toEqual(request);
    expect(proofSemanticsEntailmentOkForTest()).toEqual(result);
  });

  test("never mutates captured providedJudgments arrays", () => {
    const providedJudgments = ["entailment", "stateJoin"];
    const companion = proofSemanticsCompanionFake({ providedJudgments });

    providedJudgments.push("terminalClosure");
    expect(companion.providedJudgments.map(String)).toEqual(["entailment", "stateJoin"]);
  });

  test("accepts string judgment labels and exposes companion metadata", () => {
    const companion = proofSemanticsCompanionFake({
      providedJudgments: ["crossCoreOwnership"],
    });

    expect(companion.targetId).toBe(targetId("proof-check-test-target"));
    expect(companion.schemaVersion).toBe("semantics-v1");
    expect(companion.providedJudgments.map(String)).toEqual(["crossCoreOwnership"]);
    expect(companion.fingerprint.authorityKind).toBe("semantics");
  });
});
