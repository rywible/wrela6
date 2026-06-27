import { describe, expect, test } from "bun:test";
import {
  proofMirRuntimeOperationId,
  runtimeCatalog,
  runtimeOperationAvailableOnTarget,
  type ProofMirRuntimeCatalog,
  type ProofMirRuntimeOperation,
  type ProofMirRuntimeOperationId,
  type ProofMirRuntimeTargetAvailability,
} from "../../../src/runtime/runtime-catalog";
import { selectProofMirRuntimeCatalog } from "../../../src/target/target-runtime-selection";
import { targetId } from "../../../src/semantic/ids";

function runtimeOperationForCatalogTypesTest(input: {
  readonly runtimeId: ProofMirRuntimeOperationId;
  readonly name: string;
  readonly targetAvailability?: ProofMirRuntimeTargetAvailability;
}): ProofMirRuntimeOperation {
  return {
    runtimeId: input.runtimeId,
    name: input.name,
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
  readonly entries: readonly ProofMirRuntimeOperation[];
}): ProofMirRuntimeCatalog {
  const result = runtimeCatalog({
    targetId: input.targetId ?? targetId("x64-test"),
    features: input.features ?? [],
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
