import { describe, expect, test } from "bun:test";

import type { ProofAuthorityFingerprint } from "../../../src/proof-check/authority/authority-types";
import { validateProofAuthorityFingerprint } from "../../../src/proof-check/authority/authority-fingerprint-validation";
import {
  normalizeTargetSurfaceProofTerm,
  proofCheckPlatformContractCatalog,
  proofCheckPlatformContractContentEqual,
  type ProofCheckPlatformContractDraft,
  type TargetSurfaceProofPlaceholder,
  type TargetSurfaceOperandExpression,
} from "../../../src/proof-check/authority/platform-contracts";
import {
  authenticateProofCheckRuntimeCatalog,
  proofCheckRuntimeCatalog,
  proofCheckRuntimeOperationContentEqual,
} from "../../../src/proof-check/authority/runtime-authority";
import {
  proofCheckLiveValueScopeId,
  proofCheckTypeFactCatalog,
  proofCheckTypeFactCatalogEntryContentEqual,
} from "../../../src/proof-check/authority/type-fact-authority";
import { proofCheckDiagnosticCode } from "../../../src/proof-check/diagnostics";
import {
  normalizeProofCheckTerm,
  platformEffectKindId,
  runtimeEffectKindId,
} from "../../../src/proof-check/model/fact-language";
import { proofMirRuntimeOperationId } from "../../../src/runtime/runtime-catalog";
import { platformContractId, platformPrimitiveId, targetId } from "../../../src/semantic/ids";
import { monoInstanceId } from "../../../src/mono/ids";
import { monoCoreType } from "../../support/mono/monomorphization-fixtures";
import { proofMirRuntimeOperationFake } from "../../support/proof-mir/proof-mir-fakes";
import { comparisonTerm, valueTerm } from "../../support/proof-check/term-fixtures";

function authorityCatalogFingerprintForTask7Test(
  authorityKind: ProofAuthorityFingerprint["authorityKind"],
  targetName: string,
  version: string,
): ProofAuthorityFingerprint {
  return {
    authorityKind,
    targetId: targetId(targetName),
    version,
    digestAlgorithm: "sha256",
    digestHex: "ab".repeat(32),
  };
}

function defaultPlaceholders(): readonly TargetSurfaceProofPlaceholder[] {
  return [{ kind: "receiver", name: "self" }, { kind: "parameter", index: 0 }, { kind: "result" }];
}

function platformContractEntryForTask7Test(input?: {
  readonly authorityKey?: string;
  readonly displayLabel?: string;
  readonly targetName?: string;
  readonly primitiveName?: string;
  readonly contractName?: string;
}): ProofCheckPlatformContractDraft {
  const target = targetId(input?.targetName ?? "uefi-aarch64");
  return {
    targetId: target,
    primitiveId: platformPrimitiveId(input?.primitiveName ?? "send"),
    contractId: platformContractId(input?.contractName ?? "default"),
    signature: {
      hasReceiver: true,
      parameterCount: 1,
      hasResult: false,
    },
    placeholders: defaultPlaceholders(),
    preconditions: [
      {
        kind: "comparison",
        left: {
          kind: "place",
          place: { kind: "parameter", index: 0 },
        },
        operator: "le",
        right: {
          kind: "value",
          value: { kind: "synthetic", name: "limit" },
        },
      },
    ],
    postconditions: [],
    authorityKey: input?.authorityKey ?? "platform:send",
    ...(input?.displayLabel === undefined ? {} : { displayLabel: input.displayLabel }),
  };
}

describe("proof-check authority catalogs", () => {
  test("platform catalog rejects duplicate authority keys", () => {
    const result = proofCheckPlatformContractCatalog({
      fingerprint: authorityCatalogFingerprintForTask7Test(
        "platform",
        "uefi-aarch64",
        "contracts-v1",
      ),
      entries: [
        platformContractEntryForTask7Test({ authorityKey: "platform:send" }),
        platformContractEntryForTask7Test({ authorityKey: "platform:send" }),
      ],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_DUPLICATE_AUTHORITY_ENTRY"),
    );
  });

  test("platform catalog resolves by target, primitive, and contract ID", () => {
    const result = proofCheckPlatformContractCatalog({
      fingerprint: authorityCatalogFingerprintForTask7Test(
        "platform",
        "uefi-aarch64",
        "contracts-v1",
      ),
      entries: [
        platformContractEntryForTask7Test({
          authorityKey: "platform:recv",
          primitiveName: "recv",
          contractName: "recv-default",
        }),
        platformContractEntryForTask7Test({
          authorityKey: "platform:send",
          primitiveName: "send",
          contractName: "send-default",
        }),
      ],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    expect(result.catalog.entries().map((entry) => entry.authorityKey)).toEqual([
      "platform:recv",
      "platform:send",
    ]);

    const contract = result.catalog.get({
      targetId: targetId("uefi-aarch64"),
      primitiveId: platformPrimitiveId("send"),
      contractId: platformContractId("send-default"),
    });

    expect(contract?.authorityKey).toBe("platform:send");
    expect(contract?.preconditions).toHaveLength(1);
    expect(contract?.preconditions[0]?.kind).toBe("comparison");
  });

  test("normalizeTargetSurfaceProofTerm converts placeholders into proof-check binders", () => {
    const normalized = normalizeTargetSurfaceProofTerm({
      targetId: targetId("uefi-aarch64"),
      authorityKey: "platform:send",
      placeholders: defaultPlaceholders(),
      term: {
        kind: "comparison",
        left: {
          kind: "place",
          place: { kind: "parameter", index: 0 },
        },
        operator: "eq",
        right: {
          kind: "place",
          place: { kind: "receiver" },
        },
      },
    });

    expect(normalizeProofCheckTerm(normalized).key).toContain("parameter:0==receiver");
  });

  test("platform catalog rejects undeclared placeholders before storage", () => {
    const result = proofCheckPlatformContractCatalog({
      fingerprint: authorityCatalogFingerprintForTask7Test(
        "platform",
        "uefi-aarch64",
        "contracts-v1",
      ),
      entries: [
        {
          ...platformContractEntryForTask7Test({ authorityKey: "platform:bad" }),
          placeholders: [{ kind: "receiver", name: "self" }],
          preconditions: [
            {
              kind: "comparison",
              left: {
                kind: "place",
                place: { kind: "parameter", index: 0 },
              },
              operator: "eq",
              right: valueTerm("limit") as TargetSurfaceOperandExpression,
            },
          ],
        },
      ],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_INPUT_CONTRACT_INVALID"),
    );
  });

  test("platform catalog stores normalized terms and never exposes raw placeholders", () => {
    const result = proofCheckPlatformContractCatalog({
      fingerprint: authorityCatalogFingerprintForTask7Test(
        "platform",
        "uefi-aarch64",
        "contracts-v1",
      ),
      entries: [platformContractEntryForTask7Test({ authorityKey: "platform:send" })],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const entry = result.catalog.entries()[0];
    expect(entry).toBeDefined();
    expect(entry?.preconditions[0]).toEqual(
      normalizeTargetSurfaceProofTerm({
        targetId: targetId("uefi-aarch64"),
        authorityKey: "platform:send",
        placeholders: defaultPlaceholders(),
        term: {
          kind: "comparison",
          left: {
            kind: "place",
            place: { kind: "parameter", index: 0 },
          },
          operator: "le",
          right: {
            kind: "value",
            value: { kind: "synthetic", name: "limit" },
          },
        },
      }),
    );
    expect(JSON.stringify(entry)).not.toContain("TargetSurfaceProofPlaceholder");
  });

  test("display labels are excluded from platform contract authority equality", () => {
    const leftResult = proofCheckPlatformContractCatalog({
      fingerprint: authorityCatalogFingerprintForTask7Test(
        "platform",
        "uefi-aarch64",
        "contracts-v1",
      ),
      entries: [
        platformContractEntryForTask7Test({
          authorityKey: "platform:send",
          displayLabel: "Send Buffer ™",
        }),
      ],
    });
    const rightResult = proofCheckPlatformContractCatalog({
      fingerprint: authorityCatalogFingerprintForTask7Test(
        "platform",
        "uefi-aarch64",
        "contracts-v1",
      ),
      entries: [
        platformContractEntryForTask7Test({
          authorityKey: "platform:send",
          displayLabel: "Different Label",
        }),
      ],
    });

    expect(leftResult.kind).toBe("ok");
    expect(rightResult.kind).toBe("ok");
    if (leftResult.kind !== "ok" || rightResult.kind !== "ok") return;

    const left = leftResult.catalog.entries()[0];
    const right = rightResult.catalog.entries()[0];
    expect(left).toBeDefined();
    expect(right).toBeDefined();
    expect(proofCheckPlatformContractContentEqual(left!, right!)).toBe(true);
    expect(left?.displayLabel).toBe("Send Buffer ™");
    expect(right?.displayLabel).toBe("Different Label");
  });

  test("runtime catalog wraps operations with fingerprint, features, and canonical keys", () => {
    const fingerprint = authorityCatalogFingerprintForTask7Test(
      "runtime",
      "uefi-aarch64",
      "runtime-v1",
    );
    const result = proofCheckRuntimeCatalog({
      fingerprint,
      targetId: targetId("uefi-aarch64"),
      features: ["timer", "net"],
      entries: [
        {
          authorityKey: "runtime:panic_abort",
          operation: proofMirRuntimeOperationFake({
            runtimeId: proofMirRuntimeOperationId(1),
            name: "panic_abort",
          }),
        },
      ],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    expect(result.catalog.fingerprint).toEqual(fingerprint);
    expect(result.catalog.targetId).toBe(targetId("uefi-aarch64"));
    expect(result.catalog.features.map(String)).toEqual(["net", "timer"]);

    const operation = result.catalog.get(proofMirRuntimeOperationId(1));
    expect(operation?.authorityKey).toBe("runtime:panic_abort");
    expect(operation?.canonicalEntryKey).toBe("runtime:panic_abort");
    expect(operation?.name).toBe("panic_abort");
  });

  test("runtime catalog rejects duplicate runtime ids", () => {
    const result = proofCheckRuntimeCatalog({
      fingerprint: authorityCatalogFingerprintForTask7Test("runtime", "uefi-aarch64", "runtime-v1"),
      targetId: targetId("uefi-aarch64"),
      features: [],
      entries: [
        {
          authorityKey: "runtime:first",
          operation: proofMirRuntimeOperationFake({
            runtimeId: proofMirRuntimeOperationId(1),
            name: "first",
          }),
        },
        {
          authorityKey: "runtime:second",
          operation: proofMirRuntimeOperationFake({
            runtimeId: proofMirRuntimeOperationId(1),
            name: "second",
          }),
        },
      ],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.stableDetail).toContain("duplicate-runtime-id");
  });

  test("runtime catalog rejects duplicate authority keys", () => {
    const result = proofCheckRuntimeCatalog({
      fingerprint: authorityCatalogFingerprintForTask7Test("runtime", "uefi-aarch64", "runtime-v1"),
      targetId: targetId("uefi-aarch64"),
      features: [],
      entries: [
        {
          authorityKey: "runtime:dup",
          operation: proofMirRuntimeOperationFake({
            runtimeId: proofMirRuntimeOperationId(1),
            name: "first",
          }),
        },
        {
          authorityKey: "runtime:dup",
          operation: proofMirRuntimeOperationFake({
            runtimeId: proofMirRuntimeOperationId(2),
            name: "second",
          }),
        },
      ],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_DUPLICATE_AUTHORITY_ENTRY"),
    );
  });

  test("runtime display labels are excluded from operation content equality", () => {
    const baseOperation = proofMirRuntimeOperationFake({
      runtimeId: proofMirRuntimeOperationId(3),
      name: "helper",
    });
    const left = {
      runtimeId: baseOperation.runtimeId,
      authorityKey: "runtime:helper",
      canonicalEntryKey: "runtime:helper",
      name: baseOperation.name,
      displayLabel: "Helper ™",
      targetAvailability: baseOperation.targetAvailability,
      requiredFactSchemas: baseOperation.requiredFactSchemas,
      consumedCapabilitySchemas: baseOperation.consumedCapabilitySchemas,
      producedCapabilitySchemas: baseOperation.producedCapabilitySchemas,
      effectSchemas: baseOperation.effectSchemas,
      abi: baseOperation.abi,
      loweringOwner: baseOperation.loweringOwner,
    };
    const right = {
      ...left,
      displayLabel: "Other Label",
    };

    expect(proofCheckRuntimeOperationContentEqual(left, right)).toBe(true);
  });

  test("type fact catalog looks up entries by type, brand, capability, and live-value scope", () => {
    const concreteType = monoCoreType("u8");
    const brand = {
      owner: { kind: "function" as const, instanceId: monoInstanceId("1") },
      hirId: 7 as import("../../../src/hir/ids").BrandId,
      instanceId: monoInstanceId("1"),
    } satisfies import("../../../src/mono/mono-hir").MonoInstantiatedProofId<
      import("../../../src/hir/ids").BrandId
    >;
    const scope = proofCheckLiveValueScopeId("owned-parameter");

    const result = proofCheckTypeFactCatalog({
      fingerprint: authorityCatalogFingerprintForTask7Test(
        "typeFacts",
        "uefi-aarch64",
        "type-facts-v1",
      ),
      entries: [
        {
          concreteType,
          brand,
          capabilityKind: undefined,
          liveValueScope: scope,
          placeholders: [{ kind: "layoutTerm", layoutKey: "subject" }],
          facts: [
            {
              kind: "comparison",
              left: {
                kind: "place",
                place: { kind: "subject" },
              },
              operator: "ge",
              right: {
                kind: "literal",
                literal: { kind: "integer", text: "0", value: 0n },
              },
            },
          ],
          invalidatedBy: [{ kind: "moveTransfers" }],
          authorityKey: "typeFacts:u8:brand:7:owned-parameter",
        },
      ],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const matches = result.catalog.get({
      concreteType,
      brand,
      liveValueScope: scope,
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]?.authorityKey).toBe("typeFacts:u8:brand:7:owned-parameter");
    expect(matches[0]?.invalidatedBy).toEqual([{ kind: "moveTransfers" }]);
    expect(matches[0]?.facts[0]?.term.kind).toBe("comparison");
  });

  test("type fact catalog rejects duplicate authority keys", () => {
    const concreteType = monoCoreType("u32");
    const scope = proofCheckLiveValueScopeId("owned-return");

    const result = proofCheckTypeFactCatalog({
      fingerprint: authorityCatalogFingerprintForTask7Test(
        "typeFacts",
        "uefi-aarch64",
        "type-facts-v1",
      ),
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
              right: comparisonTerm(valueTerm("a"), "eq", valueTerm("b"))
                .right as TargetSurfaceOperandExpression,
            },
          ],
          invalidatedBy: [{ kind: "consumeRemoves" }],
          authorityKey: "typeFacts:dup",
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
              right: comparisonTerm(valueTerm("a"), "eq", valueTerm("b"))
                .right as TargetSurfaceOperandExpression,
            },
          ],
          invalidatedBy: [{ kind: "validationSplit" }],
          authorityKey: "typeFacts:dup",
        },
      ],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_DUPLICATE_AUTHORITY_ENTRY"),
    );
  });

  test("type fact display labels are excluded from entry content equality", () => {
    const concreteType = monoCoreType("bool");
    const scope = proofCheckLiveValueScopeId("observed-borrow");
    const left = {
      concreteType,
      liveValueScope: scope,
      facts: [{ term: comparisonTerm(valueTerm("a"), "eq", valueTerm("b")) }],
      invalidatedBy: [{ kind: "attemptSplit" as const }],
      authorityKey: "typeFacts:bool",
      displayLabel: "Bool Facts ™",
    };
    const right = {
      ...left,
      displayLabel: "Other Label",
    };

    expect(proofCheckTypeFactCatalogEntryContentEqual(left, right)).toBe(true);
  });

  test("platform contracts with different preconditions compare unequal", () => {
    const leftResult = proofCheckPlatformContractCatalog({
      fingerprint: authorityCatalogFingerprintForTask7Test(
        "platform",
        "uefi-aarch64",
        "contracts-v1",
      ),
      entries: [
        platformContractEntryForTask7Test({
          authorityKey: "platform:send",
        }),
      ],
    });
    const rightResult = proofCheckPlatformContractCatalog({
      fingerprint: authorityCatalogFingerprintForTask7Test(
        "platform",
        "uefi-aarch64",
        "contracts-v1",
      ),
      entries: [
        {
          ...platformContractEntryForTask7Test({
            authorityKey: "platform:send",
          }),
          preconditions: [
            {
              kind: "comparison",
              left: {
                kind: "place",
                place: { kind: "parameter", index: 0 },
              },
              operator: "ge",
              right: {
                kind: "value",
                value: { kind: "synthetic", name: "limit" },
              },
            },
          ],
        },
      ],
    });

    expect(leftResult.kind).toBe("ok");
    expect(rightResult.kind).toBe("ok");
    if (leftResult.kind !== "ok" || rightResult.kind !== "ok") return;

    const left = leftResult.catalog.entries()[0];
    const right = rightResult.catalog.entries()[0];
    expect(left).toBeDefined();
    expect(right).toBeDefined();
    expect(proofCheckPlatformContractContentEqual(left!, right!)).toBe(false);
  });

  test("type fact entries with different facts compare unequal", () => {
    const concreteType = monoCoreType("u32");
    const scope = proofCheckLiveValueScopeId("owned-parameter");
    const left = {
      concreteType,
      liveValueScope: scope,
      facts: [{ term: comparisonTerm(valueTerm("a"), "eq", valueTerm("b")) }],
      invalidatedBy: [{ kind: "moveTransfers" as const }],
      authorityKey: "typeFacts:u32",
    };
    const right = {
      ...left,
      facts: [{ term: comparisonTerm(valueTerm("a"), "eq", valueTerm("c")) }],
    };

    expect(proofCheckTypeFactCatalogEntryContentEqual(left, right)).toBe(false);
  });

  test("type fact entries with different invalidations compare unequal", () => {
    const concreteType = monoCoreType("u32");
    const scope = proofCheckLiveValueScopeId("owned-parameter");
    const left = {
      concreteType,
      liveValueScope: scope,
      facts: [{ term: comparisonTerm(valueTerm("a"), "eq", valueTerm("b")) }],
      invalidatedBy: [{ kind: "moveTransfers" as const }],
      authorityKey: "typeFacts:u32",
    };
    const right = {
      ...left,
      invalidatedBy: [{ kind: "consumeRemoves" as const }],
    };

    expect(proofCheckTypeFactCatalogEntryContentEqual(left, right)).toBe(false);
  });

  test("type fact catalog entries sort by authority key", () => {
    const concreteType = monoCoreType("u32");
    const scope = proofCheckLiveValueScopeId("global-seed");

    const result = proofCheckTypeFactCatalog({
      fingerprint: authorityCatalogFingerprintForTask7Test(
        "typeFacts",
        "uefi-aarch64",
        "type-facts-v1",
      ),
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
          invalidatedBy: [{ kind: "runtimeEffect", effectKind: runtimeEffectKindId("io") }],
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
          invalidatedBy: [{ kind: "platformEffect", effectKind: platformEffectKindId("tx") }],
          authorityKey: "typeFacts:a",
        },
      ],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.catalog.entries().map((entry) => entry.authorityKey)).toEqual([
      "typeFacts:a",
      "typeFacts:z",
    ]);
  });
});

describe("proof authority fingerprint validation", () => {
  test("validateProofAuthorityFingerprint accepts canonical sha256 fingerprints", () => {
    const fingerprint = authorityCatalogFingerprintForTask7Test(
      "runtime",
      "uefi-aarch64",
      "runtime-v1",
    );

    expect(validateProofAuthorityFingerprint(fingerprint)).toBeUndefined();
  });

  test("validateProofAuthorityFingerprint rejects empty version", () => {
    const fingerprint = {
      ...authorityCatalogFingerprintForTask7Test("platform", "uefi-aarch64", "contracts-v1"),
      version: "",
    };

    const diagnostic = validateProofAuthorityFingerprint(fingerprint);

    expect(diagnostic?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_INVALID_AUTHORITY_FINGERPRINT"),
    );
    expect(diagnostic?.stableDetail).toBe("empty-version");
  });

  test("validateProofAuthorityFingerprint rejects non-sha256 digest algorithms", () => {
    const fingerprint = {
      ...authorityCatalogFingerprintForTask7Test("typeFacts", "uefi-aarch64", "type-facts-v1"),
      digestAlgorithm: "sha1" as "sha256",
    };

    const diagnostic = validateProofAuthorityFingerprint(fingerprint);

    expect(diagnostic?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_INVALID_AUTHORITY_FINGERPRINT"),
    );
    expect(diagnostic?.stableDetail).toBe("invalid-digest-algorithm:sha1");
  });

  test("authenticateProofCheckRuntimeCatalog rejects malformed selected fingerprint", () => {
    const selectedFingerprint = {
      ...authorityCatalogFingerprintForTask7Test("runtime", "uefi-aarch64", "runtime-v1"),
      digestHex: "ZZZZ",
    };
    const selectedResult = proofCheckRuntimeCatalog({
      fingerprint: selectedFingerprint,
      targetId: targetId("uefi-aarch64"),
      features: [],
      entries: [],
    });
    if (selectedResult.kind !== "ok") {
      throw new Error("expected runtime catalog fixture to build");
    }

    const authentication = authenticateProofCheckRuntimeCatalog({
      embedded: {
        targetId: targetId("uefi-aarch64"),
        features: [],
        fingerprint: authorityCatalogFingerprintForTask7Test(
          "runtime",
          "uefi-aarch64",
          "runtime-v1",
        ),
        get: () => undefined,
        entries: () => [],
      },
      selected: selectedResult.catalog,
    });

    expect(authentication.kind).toBe("error");
    if (authentication.kind !== "error") {
      return;
    }
    expect(authentication.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofCheckDiagnosticCode("PROOF_CHECK_INVALID_AUTHORITY_FINGERPRINT"),
    );
  });
});
