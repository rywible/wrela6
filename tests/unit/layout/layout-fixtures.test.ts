import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  ClassifyAbiValueInput,
  LayoutAbiValueShape,
  LayoutEnumFact,
  LayoutTypeFact,
} from "../../../src/layout";
import { layoutDiagnosticCode } from "../../../src/layout/diagnostics";
import { coreTypeId, targetId, targetTypeId } from "../../../src/semantic/ids";
import {
  classifyAbiInputForTest,
  closedMonoProgramWithPacketType,
  coreMonoType,
  enumFactForTest,
  layoutTypeFactForTest,
  normalizeTargetFactsForTest,
  parameterConsumeUse,
  parameterObserveUse,
  returnUse,
  sourceLayoutTypeKey,
  typedHirProgramForLayoutIntegration,
  aggregateProgramLayoutFixture,
  deterministicLayoutProgramFixture,
  platformEdgeProgramFixture,
  validatedBufferHirForLayoutFixture,
  validatedBufferProgramFixture,
} from "../../support/layout/layout-fixtures";
import * as layoutFixtures from "../../support/layout/layout-fixtures";
import {
  layoutTargetSurfaceFake,
  pointerShape64,
  targetAbiSurfaceFake,
} from "../../support/layout/layout-fakes";

const workspaceRoot = new URL("../../..", import.meta.url).pathname;

const REQUIRED_LAYOUT_FIXTURE_EXPORTS = [
  "layoutTargetSurfaceFake",
  "layoutDataModelFake",
  "validatedBufferHandleLayoutFake",
  "layoutPrimitiveCatalogFake",
  "corePrimitiveSpecsFake",
  "targetPrimitiveSpecsFake",
  "layoutDeviceSurfaceCatalogFake",
  "layoutImageProfileCatalogFake",
  "layoutWireReadHelperCatalogFake",
  "enumLayoutPolicyFake",
  "targetAbiSurfaceFake",
  "targetCallConventionId",
  "pointerShape64",
  "typedHirProgramForLayoutIntegration",
  "closedMonoProgramWithPacketType",
  "genericPacketProgramForMonoTest",
  "aggregateProgramLayoutFixture",
  "validatedBufferProgramFixture",
  "platformEdgeProgramFixture",
  "deterministicLayoutProgramFixture",
  "normalizeTargetFactsForTest",
  "aggregateLayoutFixture",
  "enumLayoutFixture",
  "imageDeviceLayoutFixture",
  "validatedBufferLayoutFixture",
  "termTranslationFixture",
  "wireTypeFixture",
  "derivedFieldFixture",
  "functionAbiFixture",
  "imageEntryAbiFixture",
  "monoIntegerLiteral",
  "monoSourceLength",
  "monoSubtract",
  "constantLayoutTerm",
  "sourceLengthLayoutTermForTest",
  "sourceLayoutTypeKey",
  "stableLayoutProjection",
  "primitiveFieldListArbitrary",
  "fieldOffsetProjection",
  "aggregateOffsetOracle",
] as const;

describe("layout target fakes", () => {
  test("layout target fake exposes deterministic core primitive entries", () => {
    const target = layoutTargetSurfaceFake();

    expect(target.dataModel.pointerWidthBits).toBe(64);
    expect(target.dataModel.endian).toBe("little");
    expect(target.coreTypes.entries().map((entry) => String(entry.id))).toEqual([
      "Never",
      "bool",
      "u16",
      "u32",
      "u64",
      "u8",
      "usize",
    ]);
  });

  test("target facts normalization preserves little-endian 64-bit data model", () => {
    const target = layoutTargetSurfaceFake();
    const facts = normalizeTargetFactsForTest(target);

    expect(facts.endian).toBe("little");
    expect(facts.pointerWidthBits).toBe(64);
    expect(facts.sizeType).toEqual({ kind: "core", coreTypeId: coreTypeId("usize") });
  });

  test("forceClassifierError override returns LAYOUT_ABI_CLASSIFICATION_FAILED", () => {
    const abi = targetAbiSurfaceFake({ forceClassifierError: "forced failure" });
    const layout = layoutTypeFactForTest({
      key: { kind: "core", coreTypeId: coreTypeId("u32") },
      representation: { kind: "primitive", primitive: "unsignedInteger" },
      sizeBytes: 4n,
      alignmentBytes: 4n,
    });
    const result = abi.classifyValue(
      classifyAbiInputForTest({
        layout,
        use: parameterObserveUse(0),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_ABI_CLASSIFICATION_FAILED"),
    );
  });
});

describe("fake ABI classifier behavior", () => {
  const abi = targetAbiSurfaceFake();

  function classify(
    layout: LayoutTypeFact,
    use: ClassifyAbiValueInput["use"],
    enumFact?: LayoutEnumFact,
  ): LayoutAbiValueShape {
    const result = abi.classifyValue(
      classifyAbiInputForTest({
        layout,
        use,
        ...(enumFact !== undefined ? { enumFact } : {}),
      }),
    );
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      throw new Error("expected ok classification");
    }
    return result.shape;
  }

  test("zero-sized unit layouts classify as none", () => {
    const shape = classify(
      layoutTypeFactForTest({
        key: { kind: "core", coreTypeId: coreTypeId("u8") },
        representation: { kind: "zeroSized", reason: "unit" },
        sizeBytes: 0n,
        alignmentBytes: 1n,
      }),
      parameterObserveUse(0),
    );

    expect(shape).toEqual({ kind: "none", reason: "unit", proofCarrying: false });
  });

  test("never layouts classify as none", () => {
    const shape = classify(
      layoutTypeFactForTest({
        key: { kind: "core", coreTypeId: coreTypeId("Never") },
        representation: { kind: "never" },
        sizeBytes: 0n,
        alignmentBytes: 1n,
      }),
      returnUse(),
    );

    expect(shape).toEqual({ kind: "none", reason: "never", proofCarrying: false });
  });

  test("zero-sized capability layouts classify as proof-carrying none", () => {
    const shape = classify(
      layoutTypeFactForTest({
        key: sourceLayoutTypeKey("Capability"),
        representation: { kind: "zeroSized", reason: "capabilityToken" },
        sizeBytes: 0n,
        alignmentBytes: 1n,
      }),
      parameterObserveUse(0),
    );

    expect(shape).toEqual({
      kind: "none",
      reason: "zeroSizedCapability",
      proofCarrying: true,
    });
  });

  test("unsigned integer primitives classify as one direct unsigned lane", () => {
    const shape = classify(
      layoutTypeFactForTest({
        key: { kind: "core", coreTypeId: coreTypeId("u32") },
        representation: { kind: "primitive", primitive: "unsignedInteger" },
        sizeBytes: 4n,
        alignmentBytes: 4n,
      }),
      parameterObserveUse(0),
    );

    expect(shape.kind).toBe("direct");
    if (shape.kind !== "direct") return;
    expect(shape.lanes).toEqual([
      {
        kind: "integer",
        sizeBytes: 4n,
        alignmentBytes: 4n,
        signedness: "unsigned",
        extension: "none",
      },
    ]);
  });

  test("signed integer primitives classify as one direct signed lane", () => {
    const shape = classify(
      layoutTypeFactForTest({
        key: { kind: "target", targetTypeId: targetTypeId("i32") },
        representation: { kind: "primitive", primitive: "signedInteger" },
        sizeBytes: 4n,
        alignmentBytes: 4n,
      }),
      parameterObserveUse(0),
    );

    expect(shape.kind).toBe("direct");
    if (shape.kind !== "direct") return;
    expect(shape.lanes[0]).toEqual({
      kind: "integer",
      sizeBytes: 4n,
      alignmentBytes: 4n,
      signedness: "signed",
      extension: "sign",
    });
  });

  test("address primitives classify as pointer lanes with use provenance", () => {
    const observeShape = classify(
      layoutTypeFactForTest({
        key: { kind: "target", targetTypeId: targetTypeId("Ptr") },
        representation: { kind: "primitive", primitive: "address" },
        sizeBytes: 8n,
        alignmentBytes: 8n,
      }),
      parameterObserveUse(0),
    );
    const platformShape = classify(
      layoutTypeFactForTest({
        key: { kind: "target", targetTypeId: targetTypeId("Ptr") },
        representation: { kind: "primitive", primitive: "address" },
        sizeBytes: 8n,
        alignmentBytes: 8n,
      }),
      { kind: "platformArgument", index: 0, mode: "observe" },
    );

    expect(observeShape.kind).toBe("direct");
    expect(platformShape.kind).toBe("direct");
    if (observeShape.kind !== "direct" || platformShape.kind !== "direct") return;
    expect(observeShape.lanes[0]).toMatchObject({
      kind: "pointer",
      provenance: "ordinaryAddress",
    });
    expect(platformShape.lanes[0]).toMatchObject({
      kind: "pointer",
      provenance: "platformPrimitive",
    });
  });

  test("float primitives classify as one direct float lane", () => {
    const shape = classify(
      layoutTypeFactForTest({
        key: { kind: "target", targetTypeId: targetTypeId("f64") },
        representation: { kind: "primitive", primitive: "float" },
        sizeBytes: 8n,
        alignmentBytes: 8n,
      }),
      parameterObserveUse(0),
    );

    expect(shape.kind).toBe("direct");
    if (shape.kind !== "direct") return;
    expect(shape.lanes[0]).toEqual({
      kind: "float",
      sizeBytes: 8n,
      alignmentBytes: 8n,
      format: "ieee754-binary64",
    });
  });

  test("small aggregates classify as direct opaque lanes split by pointer width", () => {
    const shape = classify(
      layoutTypeFactForTest({
        key: sourceLayoutTypeKey("Small"),
        representation: { kind: "aggregate", sourceKind: "class" },
        sizeBytes: 12n,
        alignmentBytes: 4n,
      }),
      parameterObserveUse(0),
    );

    expect(shape.kind).toBe("direct");
    if (shape.kind !== "direct") return;
    expect(shape.lanes).toEqual([
      { kind: "opaque", sizeBytes: 8n, alignmentBytes: 8n },
      { kind: "opaque", sizeBytes: 4n, alignmentBytes: 4n },
    ]);
  });

  test("large aggregates classify as indirect with ownership from use", () => {
    const observeShape = classify(
      layoutTypeFactForTest({
        key: sourceLayoutTypeKey("Large"),
        representation: { kind: "aggregate", sourceKind: "class" },
        sizeBytes: 24n,
        alignmentBytes: 8n,
      }),
      parameterObserveUse(0),
    );
    const consumeShape = classify(
      layoutTypeFactForTest({
        key: sourceLayoutTypeKey("Large"),
        representation: { kind: "aggregate", sourceKind: "class" },
        sizeBytes: 24n,
        alignmentBytes: 8n,
      }),
      parameterConsumeUse(0),
    );

    expect(observeShape).toMatchObject({
      kind: "indirect",
      ownership: "borrowed",
      pointer: pointerShape64(),
    });
    expect(consumeShape).toMatchObject({
      kind: "indirect",
      ownership: "callerAllocated",
      pointer: pointerShape64(),
    });
  });

  test("enum layouts classify through tagType", () => {
    const shape = classify(
      layoutTypeFactForTest({
        key: sourceLayoutTypeKey("PacketKind"),
        representation: { kind: "enum" },
        sizeBytes: 1n,
        alignmentBytes: 1n,
      }),
      parameterObserveUse(0),
      enumFactForTest({ tagType: { kind: "core", coreTypeId: coreTypeId("u8") } }),
    );

    expect(shape.kind).toBe("direct");
    if (shape.kind !== "direct") return;
    expect(shape.lanes[0]).toMatchObject({
      kind: "integer",
      signedness: "unsigned",
      sizeBytes: 1n,
    });
  });
});

describe("layout mono program fixtures", () => {
  test("typed integration program lowers class enum validated buffer device and platform edge", () => {
    const program = typedHirProgramForLayoutIntegration();

    expect(program.types.entries().some((record) => record.sourceKind === "class")).toBe(true);
    expect(program.types.entries().some((record) => record.sourceKind === "enum")).toBe(true);
    expect(program.validatedBuffers.entries().length).toBeGreaterThan(0);
    expect(program.images.entries()[0]?.devices.length).toBeGreaterThan(0);
    expect(program.proofMetadata.platformContractEdges.entries().length).toBeGreaterThan(0);
  });

  test("closed mono program fixture monomorphizes integration program", () => {
    const program = closedMonoProgramWithPacketType();

    expect(program.functions.entries().length).toBeGreaterThan(0);
    expect(program.proofMetadata.platformContractEdges.entries().length).toBeGreaterThan(0);
    expect(program.image.devices.length).toBeGreaterThan(0);
  });

  test("aggregate program layout fixture returns program and target", () => {
    const input = aggregateProgramLayoutFixture();

    expect(input.program).toBeDefined();
    expect(input.target.targetId).toBeDefined();
  });

  test("validated buffer program fixture accepts layout source overrides", () => {
    const layoutSource = ["kind: u8 @ 0", "length: be u16 @ 1", "payload: u8 @ 3 len length"];
    const hirProgram = validatedBufferHirForLayoutFixture({ layoutSource });
    const buffer = hirProgram.validatedBuffers.entries()[0];

    expect(buffer?.layoutFields.length).toBe(3);

    const input = validatedBufferProgramFixture({ layoutSource });

    expect(input.program).toBeDefined();
    expect(input.target.targetId).toBeDefined();
  });

  test("platform edge program fixture preserves selected target", () => {
    const input = platformEdgeProgramFixture({
      layoutTarget: layoutTargetSurfaceFake({ targetId: targetId("selected-target") }),
    });

    expect(input.target.targetId).toBe(targetId("selected-target"));
    expect(input.program.proofMetadata.platformContractEdges.entries().length).toBeGreaterThan(0);
  });

  test("deterministic layout program fixture matches aggregate fixture shape", () => {
    const deterministic = deterministicLayoutProgramFixture();
    const aggregate = aggregateProgramLayoutFixture();

    expect(Object.keys(deterministic).sort()).toEqual(Object.keys(aggregate).sort());
  });
});

describe("layout fixture inventory", () => {
  test("exports every helper listed in the common fixture inventory", () => {
    for (const exportName of REQUIRED_LAYOUT_FIXTURE_EXPORTS) {
      expect(layoutFixtures[exportName]).toBeDefined();
    }
  });

  test("term helpers build fixture mono layout expressions", () => {
    expect(layoutFixtures.monoIntegerLiteral(14n).kind).toBe("integerLiteral");
    expect(layoutFixtures.monoSourceLength().kind).toBe("sourceLength");
    expect(
      layoutFixtures.monoSubtract(
        layoutFixtures.monoSourceLength(),
        layoutFixtures.monoIntegerLiteral(1n),
      ).kind,
    ).toBe("subtract");
    expect(layoutFixtures.constantLayoutTerm(3n, "byteOffset").kind).toBe("constant");
    expect(layoutFixtures.sourceLengthLayoutTermForTest().kind).toBe("sourceLength");
  });

  test("aggregate offset oracle matches primitive field ordering", () => {
    const fields = [
      { name: "tag", type: coreMonoType("u8") },
      { name: "size", type: coreMonoType("u32") },
    ];

    expect(layoutFixtures.aggregateOffsetOracle(fields)).toEqual([
      ["tag", 0n],
      ["size", 4n],
    ]);
  });

  test("layout fixture helpers avoid filesystem access and test doubles", () => {
    const forbiddenCallPattern = new RegExp("\\bm" + "o" + "ck\\s*\\(");
    for (const relativePath of [
      "tests/support/layout/layout-fakes.ts",
      "tests/support/layout/layout-fixtures.ts",
    ]) {
      const source = readFileSync(join(workspaceRoot, relativePath), "utf8");
      expect(source).not.toMatch(/\bfrom\s+["']node:fs["']/);
      expect(source).not.toMatch(/\bfrom\s+["']fs["']/);
      expect(source).not.toMatch(/\breadFileSync\b|\bwriteFileSync\b|\breaddirSync\b/);
      expect(source).not.toMatch(forbiddenCallPattern);
      expect(source).not.toMatch(new RegExp("\\bvi\\." + "m" + "o" + "ck\\b"));
      expect(source).not.toMatch(new RegExp("\\bjest\\." + "m" + "o" + "ck\\b"));
    }
  });
});
