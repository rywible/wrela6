import { describe, expect, test } from "bun:test";

import {
  documentedStdlibModules,
  documentedStdlibModulesFromMarkdown,
  documentedStdlibPublicSurfaceFromMarkdown,
  formatStdlibVerificationReport,
  runStdlibVerification,
  stdlibVerificationCases,
  verifyDocumentedStdlibPublicSurface,
  type StdlibVerificationCase,
} from "../../../scripts/verify-stdlib";

describe("verify-stdlib", () => {
  test("extracts the public module list from compatibility markdown", () => {
    const markdown = [
      "# Stdlib Compatibility",
      "",
      "## Supported Modules",
      "",
      "- `wrela_std.core.unit`",
      "  - `Unit`",
      "- `wrela_std.target.uefi.status`",
      "  - Cases: `success`",
      "",
      "## Compatibility Policy",
      "",
      "- `wrela_std.not_public`",
    ].join("\n");

    expect(documentedStdlibModulesFromMarkdown(markdown)).toEqual([
      "wrela_std.core.unit",
      "wrela_std.target.uefi.status",
    ]);
  });

  test("extracts documented public exports and enum cases from compatibility markdown", () => {
    const markdown = [
      "# Stdlib Compatibility",
      "",
      "## Supported Modules",
      "",
      "- `wrela_std.core.result`",
      "  - `Result[Ok, Err]`",
      "  - Cases: `ok(value: Ok)`, `err(error: Err)`",
      "- `wrela_std.target.uefi.console`",
      "  - `output_string(message: Utf16Static) -> UefiStatus`",
      "",
      "## Compatibility Policy",
    ].join("\n");

    expect(documentedStdlibPublicSurfaceFromMarkdown(markdown)).toEqual([
      {
        moduleName: "wrela_std.core.result",
        exports: [{ name: "Result", cases: ["ok", "err"] }],
      },
      {
        moduleName: "wrela_std.target.uefi.console",
        exports: [{ name: "output_string", cases: [] }],
      },
    ]);
  });

  test("reports missing documented public exports and enum cases", () => {
    const markdown = [
      "# Stdlib Compatibility",
      "",
      "## Supported Modules",
      "",
      "- `wrela_std.core.result`",
      "  - `Result[Ok, Err]`",
      "  - Cases: `ok(value: Ok)`, `err(error: Err)`",
      "  - `MissingType`",
      "",
      "## Compatibility Policy",
    ].join("\n");

    expect(
      verifyDocumentedStdlibPublicSurface({
        markdown,
        readSourceText: () => "enum Result[Ok, Err]:\n    ok(value: Ok)\n",
      }),
    ).toEqual([
      "stdlib-public-surface:missing-case:wrela_std.core.result:Result:err",
      "stdlib-public-surface:missing-export:wrela_std.core.result:MissingType",
    ]);
  });

  test("verification cases cover every documented stdlib module", () => {
    const covered = new Set(stdlibVerificationCases().flatMap((testCase) => testCase.modules));

    expect([...documentedStdlibModules()].filter((moduleName) => !covered.has(moduleName))).toEqual(
      [],
    );
  });

  test("real stdlib sources provide every documented public export", () => {
    expect(verifyDocumentedStdlibPublicSurface()).toEqual([]);
  });

  test("reports module-specific package input failures", () => {
    const report = runStdlibVerification([
      {
        key: "broken-core",
        modules: ["wrela_std.core.result"],
        packageInput: () => ({
          kind: "error",
          diagnostics: [
            {
              code: "UEFI_AARCH64_PIPELINE_FAILED",
              severity: "error",
              message: "broken",
              ownerKey: "stdlib",
              stableDetail: "result:broken",
            },
          ],
        }),
      } satisfies StdlibVerificationCase,
    ]);

    expect(report.status).toBe("failed");
    expect(formatStdlibVerificationReport(report)).toContain(
      "case broken-core failed modules=wrela_std.core.result",
    );
    expect(formatStdlibVerificationReport(report)).toContain(
      "diagnostic UEFI_AARCH64_PIPELINE_FAILED:result:broken",
    );
  });
});
