import { describe, expect, test } from "bun:test";
import { computeRepresentationLayoutFacts } from "../../../src/layout";
import {
  LAYOUT_DIAGNOSTIC_CODES,
  dedupeLayoutErrorDiagnostics,
  finalizeLayoutDiagnostics,
  layoutDiagnostic,
  layoutDiagnosticCode,
  sortLayoutDiagnostics,
  suppressCascadeLayoutDiagnostics,
  type LayoutDiagnostic,
} from "../../../src/layout/diagnostics";
import { layoutOwnerKey } from "../../../src/layout/builder-context";
import { enrichBuilderDependencies } from "../../../src/layout/layout-fact-builder-support";
import type { MonoInstanceId } from "../../../src/mono/ids";
import type {
  LayoutBuilderDependency,
  LayoutBuilderIssue,
  LayoutBuilderResult,
  LayoutOwnerKey,
} from "../../../src/layout/builder-context";
import { monomorphizeWholeImage } from "../../../src/mono/monomorphizer";
import { coreTypeId } from "../../../src/semantic/ids";
import {
  corePrimitiveSpecsFake,
  layoutPrimitiveCatalogFake,
  layoutTargetSurfaceFake,
} from "../../support/layout/layout-fakes";
import {
  aggregateProgramLayoutFixture,
  genericPacketProgramForMonoTest,
} from "../../support/layout/layout-fixtures";
import * as layoutPublic from "../../../src/layout/index";

describe("LayoutDiagnosticCode", () => {
  test("catalog matches the canonical layout diagnostic code union", () => {
    expect(LAYOUT_DIAGNOSTIC_CODES).toHaveLength(46);
    for (const code of LAYOUT_DIAGNOSTIC_CODES) {
      expect(layoutDiagnosticCode(code) as string).toBe(code);
    }
  });

  test("layoutDiagnosticCode rejects unknown codes", () => {
    expect(() => layoutDiagnosticCode("LAYOUT_UNKNOWN_CODE")).toThrow();
  });
});

describe("LayoutDiagnostic severities", () => {
  test("supports error, warning, and note severities", () => {
    const error = layoutDiagnostic({
      severity: "error",
      code: "LAYOUT_MISSING_PRIMITIVE_TYPE",
      message: "missing",
      ownerKey: "target:test",
      rootCauseKey: "target-definition",
      stableDetail: "u32",
    });
    const warning = layoutDiagnostic({
      severity: "warning",
      code: "LAYOUT_MISSING_PRIMITIVE_TYPE",
      message: "warning",
      ownerKey: "target:test",
      rootCauseKey: "target-definition",
      stableDetail: "u32",
    });
    const note = layoutDiagnostic({
      severity: "note",
      code: "LAYOUT_MISSING_PRIMITIVE_TYPE",
      message: "note",
      ownerKey: "target:test",
      rootCauseKey: "target-definition",
      stableDetail: "u32",
    });

    expect(error.severity).toBe("error");
    expect(warning.severity).toBe("warning");
    expect(note.severity).toBe("note");
  });
});

describe("sortLayoutDiagnostics", () => {
  test("layout diagnostics sort deterministically by diagnostic code", () => {
    const diagnostics: LayoutDiagnostic[] = [
      layoutDiagnostic({
        severity: "error",
        code: "LAYOUT_ABI_HIDDEN_PARAMETER_INCONSISTENT",
        message: "b",
        ownerKey: "type:2",
        rootCauseKey: "root",
        stableDetail: "b",
      }),
      layoutDiagnostic({
        severity: "error",
        code: "LAYOUT_ABI_CLASSIFICATION_FAILED",
        message: "a",
        ownerKey: "type:1",
        rootCauseKey: "root",
        stableDetail: "a",
      }),
    ];

    expect(sortLayoutDiagnostics(diagnostics).map((diagnostic) => diagnostic.code)).toEqual([
      layoutDiagnosticCode("LAYOUT_ABI_CLASSIFICATION_FAILED"),
      layoutDiagnosticCode("LAYOUT_ABI_HIDDEN_PARAMETER_INCONSISTENT"),
    ]);
  });

  test("sorts by source origin before code", () => {
    const laterOrigin = layoutDiagnostic({
      severity: "error",
      code: "LAYOUT_MISSING_PRIMITIVE_TYPE",
      message: "m",
      sourceOrigin: "b.wr:10",
      ownerKey: "target:test",
      rootCauseKey: "target-definition",
      stableDetail: "detail",
    });
    const earlierOrigin = layoutDiagnostic({
      severity: "error",
      code: "LAYOUT_MISSING_TYPE_RESOLUTION",
      message: "m",
      sourceOrigin: "a.wr:10",
      ownerKey: "target:test",
      rootCauseKey: "target-definition",
      stableDetail: "detail",
    });

    expect(
      sortLayoutDiagnostics([laterOrigin, earlierOrigin]).map(
        (diagnostic) => diagnostic.sourceOrigin,
      ),
    ).toEqual(["a.wr:10", "b.wr:10"]);
  });

  test("sorts by owner key when source origin and code agree", () => {
    const laterOwner = layoutDiagnostic({
      severity: "error",
      code: "LAYOUT_MISSING_PRIMITIVE_TYPE",
      message: "m",
      ownerKey: "type:2",
      rootCauseKey: "root",
      stableDetail: "detail",
    });
    const earlierOwner = layoutDiagnostic({
      severity: "error",
      code: "LAYOUT_MISSING_PRIMITIVE_TYPE",
      message: "m",
      ownerKey: "type:1",
      rootCauseKey: "root",
      stableDetail: "detail",
    });

    expect(
      sortLayoutDiagnostics([laterOwner, earlierOwner]).map((diagnostic) => diagnostic.ownerKey),
    ).toEqual(["type:1", "type:2"]);
  });

  test("sorts by root cause key when earlier keys agree", () => {
    const laterRoot = layoutDiagnostic({
      severity: "error",
      code: "LAYOUT_MISSING_PRIMITIVE_TYPE",
      message: "m",
      ownerKey: "type:1",
      rootCauseKey: "root:b",
      stableDetail: "detail",
    });
    const earlierRoot = layoutDiagnostic({
      severity: "error",
      code: "LAYOUT_MISSING_PRIMITIVE_TYPE",
      message: "m",
      ownerKey: "type:1",
      rootCauseKey: "root:a",
      stableDetail: "detail",
    });

    expect(
      sortLayoutDiagnostics([laterRoot, earlierRoot]).map((diagnostic) => diagnostic.rootCauseKey),
    ).toEqual(["root:a", "root:b"]);
  });

  test("sorts by stable detail when earlier keys agree", () => {
    const laterDetail = layoutDiagnostic({
      severity: "error",
      code: "LAYOUT_MISSING_PRIMITIVE_TYPE",
      message: "m",
      ownerKey: "type:1",
      rootCauseKey: "root",
      stableDetail: "b",
    });
    const earlierDetail = layoutDiagnostic({
      severity: "error",
      code: "LAYOUT_MISSING_PRIMITIVE_TYPE",
      message: "m",
      ownerKey: "type:1",
      rootCauseKey: "root",
      stableDetail: "a",
    });

    expect(
      sortLayoutDiagnostics([laterDetail, earlierDetail]).map(
        (diagnostic) => diagnostic.stableDetail,
      ),
    ).toEqual(["a", "b"]);
  });
});

describe("LayoutBuilderResult contract", () => {
  test("matches the shared builder result shape", () => {
    const dependency: LayoutBuilderDependency = {
      ownerKey: "type:Packet" as LayoutBuilderDependency["ownerKey"],
      reason: "type",
    };
    const issue: LayoutBuilderIssue = {
      ownerKey: "type:Packet" as LayoutBuilderIssue["ownerKey"],
      dependencies: [dependency],
      diagnostics: [
        layoutDiagnostic({
          severity: "error",
          code: "LAYOUT_MISSING_FIELD_TYPE_LAYOUT",
          message: "missing field layout",
          ownerKey: "type:Packet",
          rootCauseKey: "type:Packet",
          stableDetail: "size",
        }),
      ],
    };
    const okResult: LayoutBuilderResult<{ readonly fieldName: string }> = {
      kind: "ok",
      ownerKey: "type:Packet" as LayoutBuilderResult<{ readonly fieldName: string }>["ownerKey"] &
        LayoutBuilderIssue["ownerKey"],
      dependencies: [dependency],
      value: { fieldName: "size" },
      diagnostics: issue.diagnostics,
    };
    const errorResult: LayoutBuilderResult<{ readonly fieldName: string }> = {
      kind: "error",
      ownerKey: "type:Packet" as LayoutBuilderResult<{ readonly fieldName: string }>["ownerKey"] &
        LayoutBuilderIssue["ownerKey"],
      dependencies: [dependency],
      diagnostics: issue.diagnostics,
    };

    expect(okResult.kind).toBe("ok");
    if (okResult.kind === "ok") {
      expect(okResult.value.fieldName).toBe("size");
    }
    expect(errorResult.kind).toBe("error");
  });
});

describe("layout public barrel", () => {
  test("exports public layout types without internal builder helpers", () => {
    expect("LayoutDiagnostic" in layoutPublic).toBe(false);
    expect("LayoutBuilderContext" in layoutPublic).toBe(false);
    expect(layoutPublic.layoutDiagnostic).toBeTypeOf("function");
    expect(layoutPublic.sortLayoutDiagnostics).toBeTypeOf("function");
    expect(layoutPublic.layoutDiagnosticCode).toBeTypeOf("function");
    expect(layoutPublic.LAYOUT_DIAGNOSTIC_CODES.length).toBe(46);
  });

  test("exports builder contract types through type-only surface", () => {
    const exportedCode = layoutPublic.LAYOUT_DIAGNOSTIC_CODES[0]!;
    expect(layoutDiagnosticCode(exportedCode) as string).toBe(exportedCode);
  });
});

function layoutTargetSurfaceWithoutCoreType(excludedCoreTypeId: ReturnType<typeof coreTypeId>) {
  return layoutTargetSurfaceFake({
    coreTypes: layoutPrimitiveCatalogFake(
      corePrimitiveSpecsFake().filter((spec) => spec.id !== excludedCoreTypeId),
    ),
  });
}

describe("layout diagnostic cascade suppression", () => {
  test("dependency suppression keeps one root missing primitive error", () => {
    const monoResult = monomorphizeWholeImage({ program: genericPacketProgramForMonoTest() });
    expect(monoResult.kind).toBe("ok");
    if (monoResult.kind !== "ok") return;

    const result = computeRepresentationLayoutFacts(
      aggregateProgramLayoutFixture({
        program: monoResult.program,
        target: layoutTargetSurfaceWithoutCoreType(coreTypeId("u32")),
      }),
    );

    expect(result.kind).toBe("error");
    const missingPrimitive = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "LAYOUT_MISSING_PRIMITIVE_TYPE",
    );
    const missingLayout = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "LAYOUT_MISSING_FIELD_TYPE_LAYOUT",
    );
    expect(missingPrimitive).toHaveLength(1);
    expect(missingLayout).toHaveLength(0);
  });

  test("suppresses missing field layout when target type resolution already failed", () => {
    const monoResult = monomorphizeWholeImage({ program: genericPacketProgramForMonoTest() });
    expect(monoResult.kind).toBe("ok");
    if (monoResult.kind !== "ok") return;

    const result = computeRepresentationLayoutFacts(
      aggregateProgramLayoutFixture({
        program: monoResult.program,
        target: layoutTargetSurfaceFake({
          coreTypes: layoutPrimitiveCatalogFake(
            corePrimitiveSpecsFake().filter((spec) => spec.id !== coreTypeId("u32")),
          ),
          enumPolicy: {
            candidateTagTypes: [
              { kind: "core", coreTypeId: coreTypeId("u8") },
              { kind: "core", coreTypeId: coreTypeId("u16") },
            ],
            emptyEnumPolicy: "reject",
            discriminantStart: 0n,
            chooseTagType: "smallestUnsignedThatFits",
          },
        }),
      }),
    );

    expect(result.kind).toBe("error");
    expect(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === "LAYOUT_INVALID_PUBLISHED_TYPE_KEY",
      ),
    ).toBe(true);
    expect(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === "LAYOUT_MISSING_FIELD_TYPE_LAYOUT",
      ),
    ).toBe(false);
  });
});

describe("layout diagnostic deduplication", () => {
  test("duplicate errors with same code owner and root cause keep earliest stable detail", () => {
    const first = layoutDiagnostic({
      severity: "error",
      code: "LAYOUT_MISSING_PRIMITIVE_TYPE",
      message: "first",
      ownerKey: "target:test",
      rootCauseKey: "target-definition",
      stableDetail: "a",
    });
    const duplicate = layoutDiagnostic({
      severity: "error",
      code: "LAYOUT_MISSING_PRIMITIVE_TYPE",
      message: "second",
      ownerKey: "target:test",
      rootCauseKey: "target-definition",
      stableDetail: "b",
    });

    expect(dedupeLayoutErrorDiagnostics([duplicate, first])).toEqual([first]);
  });

  test("finalizeLayoutDiagnostics applies cascade suppression and deduplication", () => {
    const targetOwnerKey = "target:test" as LayoutOwnerKey;
    const typeOwnerKey = "type:Packet" as LayoutOwnerKey;
    const targetDependency: LayoutBuilderDependency = {
      ownerKey: targetOwnerKey,
      reason: "target",
    };
    const rootDiagnostic = layoutDiagnostic({
      severity: "error",
      code: "LAYOUT_MISSING_PRIMITIVE_TYPE",
      message: "missing u32",
      ownerKey: "target:test",
      rootCauseKey: "target-definition",
      stableDetail: "core:u32",
    });
    const cascadeDiagnostic = layoutDiagnostic({
      severity: "error",
      code: "LAYOUT_MISSING_FIELD_TYPE_LAYOUT",
      message: "missing field layout",
      ownerKey: "type:Packet",
      rootCauseKey: "type:Packet",
      stableDetail: "size",
    });
    const duplicateRoot = layoutDiagnostic({
      severity: "error",
      code: "LAYOUT_MISSING_PRIMITIVE_TYPE",
      message: "duplicate",
      ownerKey: "target:test",
      rootCauseKey: "target-definition",
      stableDetail: "z",
    });
    const noteDiagnostic = layoutDiagnostic({
      severity: "note",
      code: "LAYOUT_MISSING_FIELD_TYPE_LAYOUT",
      message: "narrower context",
      ownerKey: "type:Packet",
      rootCauseKey: "type:Packet",
      stableDetail: "size",
    });

    const issues: LayoutBuilderIssue[] = [
      {
        ownerKey: targetOwnerKey,
        dependencies: [],
        diagnostics: [rootDiagnostic, duplicateRoot],
      },
      {
        ownerKey: typeOwnerKey,
        dependencies: [targetDependency],
        diagnostics: [cascadeDiagnostic, noteDiagnostic],
      },
    ];

    expect(
      finalizeLayoutDiagnostics({
        issues,
        diagnostics: [rootDiagnostic, duplicateRoot, cascadeDiagnostic, noteDiagnostic],
      }),
    ).toEqual([noteDiagnostic, rootDiagnostic]);
  });

  test("self-referential failed owner dependencies do not suppress root ABI errors", () => {
    const functionsOwnerKey = "functions:test" as LayoutOwnerKey;
    const rootDiagnostic = layoutDiagnostic({
      severity: "error",
      code: "LAYOUT_ABI_CLASSIFICATION_FAILED",
      message: "classifier failed",
      ownerKey: "function:fn:test",
      rootCauseKey: "abi:functions",
      stableDetail: "return",
    });
    const issues: LayoutBuilderIssue[] = [
      {
        ownerKey: functionsOwnerKey,
        dependencies: [{ ownerKey: functionsOwnerKey, reason: "abi" }],
        diagnostics: [rootDiagnostic],
      },
    ];

    expect(
      finalizeLayoutDiagnostics({
        issues,
        diagnostics: [rootDiagnostic],
      }),
    ).toEqual([rootDiagnostic]);
  });

  test("suppressCascadeLayoutDiagnostics keeps notes from downstream builders", () => {
    const targetOwnerKey = "target:test" as LayoutOwnerKey;
    const typeOwnerKey = "type:Packet" as LayoutOwnerKey;
    const cascadeDiagnostic = layoutDiagnostic({
      severity: "error",
      code: "LAYOUT_ABI_CLASSIFICATION_FAILED",
      message: "missing layout",
      ownerKey: "functions:test",
      rootCauseKey: "abi:functions",
      stableDetail: "parameter:0",
    });
    const noteDiagnostic = layoutDiagnostic({
      severity: "note",
      code: "LAYOUT_ABI_CLASSIFICATION_FAILED",
      message: "narrower context",
      ownerKey: "functions:test",
      rootCauseKey: "abi:functions",
      stableDetail: "parameter:0",
    });
    const issues: LayoutBuilderIssue[] = [
      {
        ownerKey: targetOwnerKey,
        dependencies: [],
        diagnostics: [
          layoutDiagnostic({
            severity: "error",
            code: "LAYOUT_MISSING_PRIMITIVE_TYPE",
            message: "root",
            ownerKey: "target:test",
            rootCauseKey: "target-definition",
            stableDetail: "core:u32",
          }),
        ],
      },
      {
        ownerKey: typeOwnerKey,
        dependencies: [{ ownerKey: targetOwnerKey, reason: "target" }],
        diagnostics: [cascadeDiagnostic, noteDiagnostic],
      },
    ];

    expect(
      suppressCascadeLayoutDiagnostics({
        issues,
        diagnostics: [cascadeDiagnostic, noteDiagnostic],
      }),
    ).toEqual([noteDiagnostic]);
  });

  test("enrichBuilderDependencies preserves validated-buffer owner for colon-containing instance ids", () => {
    const instanceId = "type:5|args:<>" as MonoInstanceId;
    const bufferOwnerKey = layoutOwnerKey(`validated-buffer:${String(instanceId)}`);
    const fieldOwnerKey = layoutOwnerKey(`validated-buffer:${String(instanceId)}:field:0`);

    const enriched = enrichBuilderDependencies(
      {
        kind: "error",
        ownerKey: fieldOwnerKey,
        dependencies: [],
        diagnostics: [],
      },
      "my-target",
    );

    expect(enriched).toContainEqual({
      ownerKey: bufferOwnerKey,
      reason: "validatedBuffer",
    });
  });

  test("enrichBuilderDependencies preserves validated-buffer owner for value-storage owner keys", () => {
    const instanceId = "type:5|args:<>" as MonoInstanceId;
    const bufferOwnerKey = layoutOwnerKey(`validated-buffer:${String(instanceId)}`);
    const valueStorageOwnerKey = layoutOwnerKey(
      `validated-buffer:${String(instanceId)}:value-storage`,
    );

    const enriched = enrichBuilderDependencies(
      {
        kind: "error",
        ownerKey: valueStorageOwnerKey,
        dependencies: [],
        diagnostics: [],
      },
      "my-target",
    );

    expect(enriched).toContainEqual({
      ownerKey: bufferOwnerKey,
      reason: "validatedBuffer",
    });
  });
});
