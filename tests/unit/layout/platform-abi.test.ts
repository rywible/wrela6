import { describe, expect, test } from "bun:test";
import { layoutDiagnosticCode } from "../../../src/layout/diagnostics";
import {
  checkPlatformEdgeTargetIds,
  computePlatformAbiFacts,
} from "../../../src/layout/platform-abi";
import { seedPrimitiveTypeFacts } from "../../../src/layout/primitive-layout";
import { layoutDeterministicTable } from "../../../src/layout/type-key";
import type { LayoutEnumFact } from "../../../src/layout/layout-program";
import type { LayoutCanonicalKeyString } from "../../../src/layout/ids";
import type { LayoutTypeResolver } from "../../../src/layout/layout-type-resolver";
import type { MonomorphizedHirProgram } from "../../../src/mono/mono-hir";
import { functionId, targetId } from "../../../src/semantic/ids";
import {
  layoutTargetSurfaceFake,
  normalizeTargetFactsForTest,
  platformEdgeProgramFixture,
  resolverForReachableTypesFromProgram,
} from "../../support/layout/layout-fixtures";

function resolverForReachableCoreTypes(program: MonomorphizedHirProgram): LayoutTypeResolver {
  return resolverForReachableTypesFromProgram(program);
}

function platformAbiInputs(options?: {
  readonly edgeTargetId?: ReturnType<typeof targetId>;
  readonly layoutTarget?: ReturnType<typeof layoutTargetSurfaceFake>;
}) {
  const layoutTarget =
    options?.layoutTarget ??
    layoutTargetSurfaceFake({
      targetId: targetId("uefi-aarch64"),
    });
  const fixture = platformEdgeProgramFixture({ layoutTarget });
  const program =
    options?.edgeTargetId === undefined
      ? fixture.program
      : {
          ...fixture.program,
          proofMetadata: {
            ...fixture.program.proofMetadata,
            platformContractEdges: {
              get: fixture.program.proofMetadata.platformContractEdges.get.bind(
                fixture.program.proofMetadata.platformContractEdges,
              ),
              entries: () =>
                fixture.program.proofMetadata.platformContractEdges.entries().map((edge) => ({
                  ...edge,
                  targetId: options.edgeTargetId ?? edge.targetId,
                })),
            },
          },
        };
  const targetFacts = normalizeTargetFactsForTest(layoutTarget);
  const primitiveResult = seedPrimitiveTypeFacts(layoutTarget);
  expect(primitiveResult.kind).toBe("ok");
  if (primitiveResult.kind !== "ok") {
    throw new Error("seedPrimitiveTypeFacts failed");
  }

  return {
    program,
    target: layoutTarget,
    targetFacts,
    types: primitiveResult.value.types,
    enums: layoutDeterministicTable({
      entries: [] as readonly LayoutEnumFact[],
      keyOf: (entry) => entry.owner,
      keyString: (key) => `source:${String(key.instanceId)}` as LayoutCanonicalKeyString,
    }),
    resolver: resolverForReachableCoreTypes(program),
  };
}

describe("checkPlatformEdgeTargetIds", () => {
  test("rejects platform edges whose target ID does not match the layout target", () => {
    const { program, target } = platformAbiInputs({
      edgeTargetId: targetId("wrong-target"),
      layoutTarget: layoutTargetSurfaceFake({ targetId: targetId("selected-target") }),
    });

    const diagnostics = checkPlatformEdgeTargetIds({ program, target });
    const edge = program.proofMetadata.platformContractEdges.entries()[0]!;

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_PLATFORM_TARGET_MISMATCH"),
    );
    expect(diagnostics[0]?.ownerKey).toBe(
      `platform-edge:${String(edge.edgeId.instanceId)}:${String(edge.edgeId.hirId)}`,
    );
    expect(diagnostics[0]?.rootCauseKey).toBe(`target:${String(target.targetId)}`);
    expect(diagnostics[0]?.stableDetail).toBe(
      `${String(edge.targetId)}->${String(target.targetId)}`,
    );
  });

  test("accepts platform edges whose target ID matches the layout target", () => {
    const { program, target } = platformAbiInputs();

    expect(checkPlatformEdgeTargetIds({ program, target })).toHaveLength(0);
  });
});

describe("computePlatformAbiFacts", () => {
  test("every reachable platform edge receives a layout platform ABI fact", () => {
    const input = platformAbiInputs();
    const result = computePlatformAbiFacts(input);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const edges = input.program.proofMetadata.platformContractEdges.entries();
    expect(result.value.platformEdges.entries()).toHaveLength(edges.length);
    for (const edge of edges) {
      const fact = result.value.platformEdges.get(edge.edgeId);
      expect(fact).toBeDefined();
      expect(fact?.edgeId).toEqual(edge.edgeId);
      expect(fact?.primitiveId).toBe(edge.primitiveId);
      expect(fact?.contractId).toBe(edge.contractId);
      expect(fact?.targetId).toBe(edge.targetId);
      expect(fact?.sourceOrigin).toBe(edge.sourceOrigin);
      expect(fact?.callConvention).toBe(input.target.abi.platformCallConvention);
    }
  });

  test("classifies platform return values under the platform call convention", () => {
    const input = platformAbiInputs();
    const result = computePlatformAbiFacts(input);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const fact = result.value.platformEdges.entries()[0]!;
    expect(fact.result).toEqual({
      kind: "none",
      reason: "never",
      proofCarrying: false,
    });
    expect(fact.arguments).toHaveLength(0);
  });

  test("skips platform edge ABI diagnostics when source function ABI already failed", () => {
    const input = platformAbiInputs();
    const edge = input.program.proofMetadata.platformContractEdges.entries()[0]!;

    const result = computePlatformAbiFacts({
      ...input,
      target: layoutTargetSurfaceFake({
        targetId: targetId("uefi-aarch64"),
        forceClassifierError: "forced classifier failure",
      }),
      sourceFunctionAbiFailures: new Set([edge.sourceFunctionId]),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.platformEdges.entries()).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(0);
  });

  test("does not classify platform edges with mismatched target IDs", () => {
    const input = platformAbiInputs({
      edgeTargetId: targetId("wrong-target"),
      layoutTarget: layoutTargetSurfaceFake({ targetId: targetId("selected-target") }),
    });

    const result = computePlatformAbiFacts(input);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.platformEdges.entries()).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(0);
  });

  test("ABI classifier errors produce layout diagnostics and no partial platform ABI fact", () => {
    const input = platformAbiInputs({
      layoutTarget: layoutTargetSurfaceFake({
        targetId: targetId("uefi-aarch64"),
        forceClassifierError: "forced classifier failure",
      }),
    });
    const edge = input.program.proofMetadata.platformContractEdges.entries()[0]!;

    const result = computePlatformAbiFacts(input);

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_ABI_CLASSIFICATION_FAILED"),
    );
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.ownerKey.startsWith("platform-edge:")),
    ).toBe(true);
    expect(edge.sourceFunctionId).toBe(functionId(0));
  });
});
