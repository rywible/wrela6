import { describe, expect, test } from "bun:test";
import { computeRepresentationLayoutFacts } from "../../../src/layout";
import { layoutDiagnosticCode } from "../../../src/layout/diagnostics";
import {
  checkPlatformEdgeTargetIds,
  computePlatformAbiFacts,
} from "../../../src/layout/platform-abi";
import { computeImageEntryAbiFact } from "../../../src/layout/image-entry-abi";
import { computeSourceFunctionAbiFacts } from "../../../src/layout/source-function-abi";
import { seedPrimitiveTypeFacts } from "../../../src/layout/primitive-layout";
import { layoutDeterministicTable } from "../../../src/layout/type-key";
import type { LayoutEnumFact } from "../../../src/layout/layout-program";
import type { LayoutCanonicalKeyString } from "../../../src/layout/ids";
import type { LayoutTypeResolver } from "../../../src/layout/layout-type-resolver";
import type { MonomorphizedHirProgram } from "../../../src/mono/mono-hir";
import {
  closedMonoProgramWithPacketType,
  imageEntryAbiFixture,
  layoutTargetSurfaceFake,
  normalizeTargetFactsForTest,
  platformEdgeProgramFixture,
  resolverForReachableTypesFromProgram,
  targetCallConventionId,
} from "../../support/layout/layout-fixtures";
import { monomorphizeWholeImage } from "../../../src/mono/monomorphizer";
import { genericPacketProgramForMonoTest } from "../../support/mono/monomorphization-fixtures";
import { layoutImageProfileCatalogFake } from "../../support/layout/layout-fakes";
import { lowerTypedHirForTest } from "../../support/hir/typed-hir-fixtures";
import { imageProfileId, parameterId, targetId, targetTypeId } from "../../../src/semantic/ids";

function resolverForReachableCoreTypes(program: MonomorphizedHirProgram): LayoutTypeResolver {
  return resolverForReachableTypesFromProgram(program);
}

describe("source function ABI shapes", () => {
  test("every reachable source function receives a layout function ABI fact", () => {
    const program = closedMonoProgramWithPacketType();
    const target = layoutTargetSurfaceFake();
    const targetFacts = normalizeTargetFactsForTest(target);

    const primitiveResult = seedPrimitiveTypeFacts(target);
    expect(primitiveResult.kind).toBe("ok");
    if (primitiveResult.kind !== "ok") return;

    const result = computeSourceFunctionAbiFacts({
      program,
      target,
      targetFacts,
      types: primitiveResult.value.types,
      enums: layoutDeterministicTable({
        entries: [] as readonly LayoutEnumFact[],
        keyOf: (entry) => entry.owner,
        keyString: (key) => `source:${String(key.instanceId)}` as LayoutCanonicalKeyString,
      }),
      resolver: resolverForReachableCoreTypes(program),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const reachableFunctions = program.functions.entries();
    expect(result.value.functions.entries()).toHaveLength(reachableFunctions.length);
    for (const functionInstance of reachableFunctions) {
      const fact = result.value.functions.get(functionInstance.instanceId);
      expect(fact).toBeDefined();
      expect(fact?.sourceFunctionId).toBe(functionInstance.sourceFunctionId);
      expect(fact?.returnValue.shape.kind).toBe("none");
      expect(fact?.callConvention).toBe(target.abi.sourceCallConvention);
    }
  });
});

describe("image entry ABI shapes", () => {
  test("image entry ABI fact records physical and source entry classifications", () => {
    const fixture = imageEntryAbiFixture();
    const result = computeImageEntryAbiFact(fixture);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const fact = result.value.fact;
    expect(fact.profileId).toBe(imageProfileId("uefi"));
    expect(fact.physicalCallConvention).toBe(targetCallConventionId("uefi-aarch64"));
    expect(fact.sourceCallConvention).toBe(fixture.target.abi.sourceCallConvention);
    expect(fact.physicalEntryArguments).toHaveLength(1);
    expect(fact.sourceEntryArguments).toHaveLength(1);
    expect(fact.thunkConversions).toContainEqual({
      source: "firmwareArgument",
      targetParameterIndex: 0,
      sourceEntryParameterId: parameterId(0),
      shape: fact.sourceEntryArguments[0]!,
    });
    expect(fact.result).toEqual({
      kind: "none",
      reason: "unit",
      proofCarrying: false,
    });
  });
});

describe("platform edge ABI shapes", () => {
  test("platform edge target mismatch is rejected before ABI classification", () => {
    const fixture = platformEdgeProgramFixture({
      layoutTarget: layoutTargetSurfaceFake({ targetId: targetId("selected-target") }),
    });
    const edge = fixture.program.proofMetadata.platformContractEdges.entries()[0]!;
    const program = {
      ...fixture.program,
      proofMetadata: {
        ...fixture.program.proofMetadata,
        platformContractEdges: {
          get: fixture.program.proofMetadata.platformContractEdges.get.bind(
            fixture.program.proofMetadata.platformContractEdges,
          ),
          entries: () => [
            {
              ...edge,
              targetId: targetId("wrong-target"),
            },
          ],
        },
      },
    };

    const mismatchDiagnostics = checkPlatformEdgeTargetIds({
      program,
      target: fixture.target,
    });
    expect(mismatchDiagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_PLATFORM_TARGET_MISMATCH"),
    );

    const targetFacts = normalizeTargetFactsForTest(fixture.target);
    const primitiveResult = seedPrimitiveTypeFacts(fixture.target);
    expect(primitiveResult.kind).toBe("ok");
    if (primitiveResult.kind !== "ok") return;

    const platformAbiResult = computePlatformAbiFacts({
      program,
      target: fixture.target,
      targetFacts,
      types: primitiveResult.value.types,
      enums: layoutDeterministicTable({
        entries: [] as readonly LayoutEnumFact[],
        keyOf: (entry) => entry.owner,
        keyString: (key) => `source:${String(key.instanceId)}` as LayoutCanonicalKeyString,
      }),
      resolver: resolverForReachableCoreTypes(program),
    });

    expect(platformAbiResult.kind).toBe("ok");
    if (platformAbiResult.kind !== "ok") return;
    expect(platformAbiResult.value.platformEdges.entries()).toHaveLength(0);
    expect(platformAbiResult.diagnostics).toHaveLength(0);
  });

  test("reachable platform contract edge receives platform ABI facts", () => {
    const fixture = platformEdgeProgramFixture({
      layoutTarget: layoutTargetSurfaceFake({ targetId: targetId("uefi-aarch64") }),
    });
    const targetFacts = normalizeTargetFactsForTest(fixture.target);
    const primitiveResult = seedPrimitiveTypeFacts(fixture.target);
    expect(primitiveResult.kind).toBe("ok");
    if (primitiveResult.kind !== "ok") return;

    const result = computePlatformAbiFacts({
      program: fixture.program,
      target: fixture.target,
      targetFacts,
      types: primitiveResult.value.types,
      enums: layoutDeterministicTable({
        entries: [] as readonly LayoutEnumFact[],
        keyOf: (entry) => entry.owner,
        keyString: (key) => `source:${String(key.instanceId)}` as LayoutCanonicalKeyString,
      }),
      resolver: resolverForReachableCoreTypes(fixture.program),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const edge = fixture.program.proofMetadata.platformContractEdges.entries()[0]!;
    const fact = result.value.platformEdges.get(edge.edgeId);
    expect(fact).toBeDefined();
    expect(fact?.primitiveId).toBe(edge.primitiveId);
    expect(fact?.contractId).toBe(edge.contractId);
    expect(fact?.targetId).toBe(edge.targetId);
    expect(fact?.callConvention).toBe(fixture.target.abi.platformCallConvention);
  });
});

describe("layout API ABI integration", () => {
  test("closed program produces function ABI facts through layout API", () => {
    const monoResult = monomorphizeWholeImage({ program: genericPacketProgramForMonoTest() });
    expect(monoResult.kind).toBe("ok");
    if (monoResult.kind !== "ok") return;

    const result = computeRepresentationLayoutFacts({
      program: monoResult.program,
      target: layoutTargetSurfaceFake({
        imageProfiles: layoutImageProfileCatalogFake([
          {
            profileId: imageProfileId("uefi"),
            physicalEntryCallConvention: targetCallConventionId("wrela-source"),
            physicalEntryArguments: [],
            physicalEntryResult: { kind: "unit" },
          },
        ]),
      }),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.facts.functions.entries().length).toBeGreaterThan(0);
  });

  test("platform edge target mismatch rejected through layout API", () => {
    const fixture = platformEdgeProgramFixture({
      layoutTarget: layoutTargetSurfaceFake({ targetId: targetId("selected-target") }),
    });
    const edge = fixture.program.proofMetadata.platformContractEdges.entries()[0]!;
    const program = {
      ...fixture.program,
      proofMetadata: {
        ...fixture.program.proofMetadata,
        platformContractEdges: {
          get: fixture.program.proofMetadata.platformContractEdges.get.bind(
            fixture.program.proofMetadata.platformContractEdges,
          ),
          entries: () => [
            {
              ...edge,
              targetId: targetId("wrong-target"),
            },
          ],
        },
      },
    };

    const result = computeRepresentationLayoutFacts({
      program,
      target: fixture.target,
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_PLATFORM_TARGET_MISMATCH"),
    );
  });

  test("image entry ABI facts are available through layout API", () => {
    const source = [
      "uefi image Boot:",
      "    fn main(firmware: usize) -> Never:",
      "        return",
    ].join("\n");
    const monoResult = monomorphizeWholeImage({
      program: lowerTypedHirForTest([["main.wr", source]]).program,
    });
    expect(monoResult.kind).toBe("ok");
    if (monoResult.kind !== "ok") return;

    const result = computeRepresentationLayoutFacts({
      program: monoResult.program,
      target: layoutTargetSurfaceFake({
        imageProfiles: layoutImageProfileCatalogFake([
          {
            profileId: imageProfileId("uefi"),
            physicalEntryCallConvention: targetCallConventionId("uefi-aarch64"),
            physicalEntryArguments: [
              {
                name: "firmwareArgument",
                type: { kind: "target", targetTypeId: targetTypeId("Ptr") },
                provenance: "firmware",
              },
            ],
            physicalEntryResult: { kind: "unit" },
          },
        ]),
      }),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.facts.imageEntry?.profileId).toBe(imageProfileId("uefi"));
    expect(result.facts.imageEntry?.thunkConversions.length).toBeGreaterThan(0);
  });
});
