import { describe, expect, test } from "bun:test";

import {
  compilerPackageInput,
  productionPackagePipelineDependencies,
  sortUefiAArch64TargetDiagnostics,
  uefiAArch64TargetDiagnostic,
} from "../../../../src/target/uefi-aarch64";

describe("UEFI package pipeline diagnostics", () => {
  test("preserves frontend diagnostic codes and spans at the target pipeline boundary", () => {
    const packageInputResult = compilerPackageInput({
      packageKey: "bad-frontend",
      sourceRoots: [
        { kind: "project", rootKey: "project", rootPath: "src", trustedForAuthority: false },
      ],
      sourceFiles: [
        {
          sourceKey: "src/image.wr",
          moduleName: "image",
          text: "banana\n",
        },
      ],
      entryModuleName: "image",
    });
    expect(packageInputResult.kind).toBe("ok");
    if (packageInputResult.kind !== "ok") return;

    const result = productionPackagePipelineDependencies().parseModuleGraph({
      packageInput: packageInputResult.value,
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "frontend:PARSE_EXPECTED_TOP_LEVEL_DECLARATION:src/image.wr:0:6",
    ]);
    expect(result.diagnostics[0]?.source).toEqual({
      originalCode: "PARSE_EXPECTED_TOP_LEVEL_DECLARATION",
      message: "Expected a top-level declaration.",
      sourceName: "src/image.wr",
      startOffset: 0,
      endOffset: 6,
      startLine: 1,
      startColumn: 1,
      endLine: 1,
      endColumn: 7,
    });
    expect(Object.isFrozen(result.diagnostics[0]?.source)).toBe(true);
    expect(
      result.diagnostics.some((diagnostic) =>
        diagnostic.stableDetail.startsWith("frontend-diagnostics:"),
      ),
    ).toBe(false);
  });

  test("target diagnostic source payload is frozen and does not affect stable sort order", () => {
    const sorted = sortUefiAArch64TargetDiagnostics([
      uefiAArch64TargetDiagnostic({
        code: "UEFI_AARCH64_PIPELINE_FAILED",
        ownerKey: "owner-b",
        stableDetail: "same",
        source: {
          originalCode: "B_SOURCE",
          message: "B",
          sourceName: "b.wr",
          startOffset: 2,
          endOffset: 3,
          startLine: 1,
          startColumn: 3,
        },
      }),
      uefiAArch64TargetDiagnostic({
        code: "UEFI_AARCH64_PIPELINE_FAILED",
        ownerKey: "owner-a",
        stableDetail: "same",
        source: {
          originalCode: "A_SOURCE",
          message: "A",
          sourceName: "a.wr",
          startOffset: 0,
          endOffset: 1,
          startLine: 1,
          startColumn: 1,
        },
      }),
    ]);

    expect(sorted.map((diagnostic) => diagnostic.ownerKey)).toEqual(["owner-a", "owner-b"]);
    expect(Object.isFrozen(sorted[0]?.source)).toBe(true);
  });
});
