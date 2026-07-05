import { describe, expect, test } from "bun:test";
import type { ProofAuthorityFingerprint } from "../../../src/proof-check/authority/authority-types";
import {
  proofMirRuntimeOperationId,
  runtimeCatalog,
  runtimeCatalogsEqual,
  runtimeOperationAvailableOnTarget,
  type ProofMirRuntimeCatalog,
  type ProofMirRuntimeOperation,
  type ProofMirRuntimeOperationId,
  type ProofMirRuntimeTargetAvailability,
} from "../../../src/runtime/runtime-catalog";
import { selectProofMirRuntimeCatalog } from "../../../src/target/target-runtime-selection";
import { canonicalUefiAArch64ProofMirRuntimeCatalog } from "../../../src/target/uefi-aarch64/runtime-catalog";
import { targetId } from "../../../src/semantic/ids";

function runtimeAuthorityFingerprintForRuntimeCatalogTest(
  targetName: string,
  version: string,
): ProofAuthorityFingerprint {
  return {
    authorityKind: "runtime",
    targetId: targetId(targetName),
    version,
    digestAlgorithm: "sha256",
    digestHex: "00".repeat(32),
  };
}

function runtimeOperationForCatalogTypesTest(input: {
  readonly runtimeId: ProofMirRuntimeOperationId;
  readonly name: string;
  readonly authorityKey?: string;
  readonly targetAvailability?: ProofMirRuntimeTargetAvailability;
}): ProofMirRuntimeOperation {
  return {
    runtimeId: input.runtimeId,
    name: input.name,
    authorityKey: input.authorityKey,
    targetAvailability: input.targetAvailability ?? { kind: "allTargets" },
    loweringOwner: "panicAbort",
    abi: { kind: "compilerRuntime", symbol: `__wr_${input.name}` },
    requiredFactSchemas: [],
    consumedCapabilitySchemas: [],
    producedCapabilitySchemas: [],
    effectSchemas: [],
  };
}

function catalogForTest(input: {
  readonly targetId?: ReturnType<typeof targetId>;
  readonly features?: readonly string[];
  readonly fingerprint?: ProofAuthorityFingerprint;
  readonly entries: readonly ProofMirRuntimeOperation[];
}): ProofMirRuntimeCatalog {
  const result = runtimeCatalog({
    targetId: input.targetId ?? targetId("x64-test"),
    features: input.features ?? [],
    fingerprint: input.fingerprint,
    entries: input.entries,
  });
  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") {
    throw new Error("runtimeCatalog failed");
  }
  return result.catalog;
}

describe("runtimeCatalog", () => {
  test("runtime catalog entries are deterministic by runtime id", () => {
    const result = runtimeCatalog({
      targetId: targetId("x64-test"),
      features: ["sse2"],
      entries: [
        runtimeOperationForCatalogTypesTest({
          runtimeId: proofMirRuntimeOperationId(2),
          name: "panic",
        }),
        runtimeOperationForCatalogTypesTest({
          runtimeId: proofMirRuntimeOperationId(1),
          name: "read_u8",
        }),
      ],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.catalog.entries().map((entry) => entry.name)).toEqual(["read_u8", "panic"]);
  });

  test("rejects duplicate runtime IDs with a typed construction result", () => {
    const duplicateId = proofMirRuntimeOperationId(1);
    const result = runtimeCatalog({
      targetId: targetId("x64-test"),
      features: [],
      entries: [
        runtimeOperationForCatalogTypesTest({
          runtimeId: duplicateId,
          name: "read_u8",
        }),
        runtimeOperationForCatalogTypesTest({
          runtimeId: duplicateId,
          name: "panic",
        }),
      ],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("RUNTIME_CATALOG_DUPLICATE_RUNTIME_ID");
  });

  test("stores target features in deterministic sorted order", () => {
    const result = runtimeCatalog({
      targetId: targetId("x64-test"),
      features: ["avx2", "sse2"],
      entries: [],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.catalog.features).toEqual(["avx2", "sse2"]);
  });

  test("runtime catalog exposes deterministic authority keys", () => {
    const result = runtimeCatalog({
      targetId: targetId("uefi-aarch64"),
      features: ["timer", "net"],
      fingerprint: runtimeAuthorityFingerprintForRuntimeCatalogTest("uefi-aarch64", "runtime-v1"),
      entries: [
        runtimeOperationForCatalogTypesTest({
          runtimeId: proofMirRuntimeOperationId(7),
          name: "panic_abort",
          authorityKey: "runtime:panic_abort",
        }),
      ],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.catalog.entries()[0]?.authorityKey).toBe("runtime:panic_abort");
  });

  test("stores optional authority fingerprint on the catalog", () => {
    const fingerprint = runtimeAuthorityFingerprintForRuntimeCatalogTest("x64-test", "runtime-v1");
    const result = runtimeCatalog({
      targetId: targetId("x64-test"),
      features: [],
      fingerprint,
      entries: [],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.catalog.fingerprint).toEqual(fingerprint);
  });

  test("builder callers can omit proof-check authority metadata", () => {
    const result = runtimeCatalog({
      targetId: targetId("x64-test"),
      features: [],
      entries: [
        runtimeOperationForCatalogTypesTest({
          runtimeId: proofMirRuntimeOperationId(1),
          name: "read_u8",
        }),
      ],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.catalog.fingerprint).toBeUndefined();
    expect(result.catalog.entries()[0]?.authorityKey).toBeUndefined();
  });

  test("canonical UEFI AArch64 runtime catalog enables streamLoop", () => {
    const catalog = canonicalUefiAArch64ProofMirRuntimeCatalog();

    expect(catalog.features).toContain("streamLoop");
  });
});

describe("runtimeCatalogsEqual", () => {
  test("returns true when catalogs match by target, features, operation IDs, authority keys, and content", () => {
    const left = catalogForTest({
      targetId: targetId("x64-test"),
      features: ["sse2"],
      fingerprint: runtimeAuthorityFingerprintForRuntimeCatalogTest("x64-test", "runtime-v1"),
      entries: [
        runtimeOperationForCatalogTypesTest({
          runtimeId: proofMirRuntimeOperationId(1),
          name: "read_u8",
          authorityKey: "runtime:read_u8",
        }),
      ],
    });
    const right = catalogForTest({
      targetId: targetId("x64-test"),
      features: ["sse2"],
      fingerprint: runtimeAuthorityFingerprintForRuntimeCatalogTest("x64-test", "runtime-v1"),
      entries: [
        runtimeOperationForCatalogTypesTest({
          runtimeId: proofMirRuntimeOperationId(1),
          name: "read_u8",
          authorityKey: "runtime:read_u8",
        }),
      ],
    });

    expect(runtimeCatalogsEqual(left, right)).toBe(true);
  });

  test("returns false when authority keys differ", () => {
    const left = catalogForTest({
      entries: [
        runtimeOperationForCatalogTypesTest({
          runtimeId: proofMirRuntimeOperationId(1),
          name: "read_u8",
          authorityKey: "runtime:read_u8",
        }),
      ],
    });
    const right = catalogForTest({
      entries: [
        runtimeOperationForCatalogTypesTest({
          runtimeId: proofMirRuntimeOperationId(1),
          name: "read_u8",
          authorityKey: "runtime:other",
        }),
      ],
    });

    expect(runtimeCatalogsEqual(left, right)).toBe(false);
  });

  test("returns false when fingerprints differ", () => {
    const left = catalogForTest({
      fingerprint: runtimeAuthorityFingerprintForRuntimeCatalogTest("x64-test", "runtime-v1"),
      entries: [],
    });
    const right = catalogForTest({
      fingerprint: runtimeAuthorityFingerprintForRuntimeCatalogTest("x64-test", "runtime-v2"),
      entries: [],
    });

    expect(runtimeCatalogsEqual(left, right)).toBe(false);
  });

  test("returns false when one catalog has a fingerprint and the other does not", () => {
    const left = catalogForTest({
      fingerprint: runtimeAuthorityFingerprintForRuntimeCatalogTest("x64-test", "runtime-v1"),
      entries: [],
    });
    const right = catalogForTest({ entries: [] });

    expect(runtimeCatalogsEqual(left, right)).toBe(false);
  });
});

describe("runtimeOperationAvailableOnTarget", () => {
  const selectedTarget = targetId("x64-test");

  test("allows allTargets availability on any target context", () => {
    const operation = runtimeOperationForCatalogTypesTest({
      runtimeId: proofMirRuntimeOperationId(1),
      name: "panic",
      targetAvailability: { kind: "allTargets" },
    });

    expect(
      runtimeOperationAvailableOnTarget({
        operation,
        targetId: selectedTarget,
        features: [],
      }),
    ).toBe(true);
  });

  test("allows exact target availability when target IDs match", () => {
    const operation = runtimeOperationForCatalogTypesTest({
      runtimeId: proofMirRuntimeOperationId(1),
      name: "read_u8",
      targetAvailability: { kind: "target", targetId: selectedTarget },
    });

    expect(
      runtimeOperationAvailableOnTarget({
        operation,
        targetId: selectedTarget,
        features: [],
      }),
    ).toBe(true);
    expect(
      runtimeOperationAvailableOnTarget({
        operation,
        targetId: targetId("aarch64-test"),
        features: [],
      }),
    ).toBe(false);
  });

  test("allows targetFeature availability when the feature is enabled", () => {
    const operation = runtimeOperationForCatalogTypesTest({
      runtimeId: proofMirRuntimeOperationId(1),
      name: "read_u8",
      targetAvailability: {
        kind: "targetFeature",
        targetId: selectedTarget,
        feature: "sse2",
      },
    });

    expect(
      runtimeOperationAvailableOnTarget({
        operation,
        targetId: selectedTarget,
        features: ["sse2", "avx2"],
      }),
    ).toBe(true);
    expect(
      runtimeOperationAvailableOnTarget({
        operation,
        targetId: selectedTarget,
        features: ["avx2"],
      }),
    ).toBe(false);
    expect(
      runtimeOperationAvailableOnTarget({
        operation,
        targetId: targetId("aarch64-test"),
        features: ["sse2"],
      }),
    ).toBe(false);
  });
});

describe("selectProofMirRuntimeCatalog", () => {
  test("returns the matching catalog from injected catalogs", () => {
    const catalog = catalogForTest({
      targetId: targetId("x64-test"),
      features: ["sse2"],
      entries: [
        runtimeOperationForCatalogTypesTest({
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

  test("reports missing catalog through dependency injection", () => {
    const catalog = catalogForTest({
      targetId: targetId("aarch64-test"),
      features: [],
      entries: [],
    });

    const result = selectProofMirRuntimeCatalog({
      targetId: targetId("x64-test"),
      features: [],
      catalogs: [catalog],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe("RUNTIME_CATALOG_NOT_FOUND");
  });

  test("rejects catalogs whose feature list does not match the target context", () => {
    const catalog = catalogForTest({
      targetId: targetId("x64-test"),
      features: ["sse2"],
      entries: [],
    });

    const result = selectProofMirRuntimeCatalog({
      targetId: targetId("x64-test"),
      features: ["avx2"],
      catalogs: [catalog],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe("RUNTIME_CATALOG_FEATURES_MISMATCH");
  });

  test("continues searching catalogs after a feature mismatch", () => {
    const mismatchedCatalog = catalogForTest({
      targetId: targetId("x64-test"),
      features: ["sse2"],
      entries: [],
    });
    const matchingCatalog = catalogForTest({
      targetId: targetId("x64-test"),
      features: ["avx2"],
      entries: [
        runtimeOperationForCatalogTypesTest({
          runtimeId: proofMirRuntimeOperationId(2),
          name: "write_u8",
        }),
      ],
    });

    const result = selectProofMirRuntimeCatalog({
      targetId: targetId("x64-test"),
      features: ["avx2"],
      catalogs: [mismatchedCatalog, matchingCatalog],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.catalog).toBe(matchingCatalog);
  });
});
