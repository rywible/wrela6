import { describe, expect, test } from "bun:test";

import {
  compareReproducibleBuildPasses,
  REPRODUCIBILITY_MANIFEST_PATH,
  type ReproducibilityBuildPass,
} from "../../../scripts/verify-reproducible";

describe("verify-reproducible", () => {
  test("compares release output digests from two isolated build passes", () => {
    const first = buildPass("first", "abc", 3, "meta");
    const second = buildPass("second", "abc", 3, "meta");

    expect(compareReproducibleBuildPasses(first, second)).toEqual({ kind: "ok" });
  });

  test("reports byte and metadata mismatches with case context", () => {
    const first = buildPass("first", "abc", 3, "meta-a");
    const second = buildPass("second", "def", 4, "meta-b");

    const result = compareReproducibleBuildPasses(first, second);

    expect(result.kind).toBe("mismatch");
    if (result.kind !== "mismatch") throw new Error("expected mismatch");
    expect(result.diagnostics).toEqual([
      "reproducible:byte-mismatch:stdlib-bits/toolchain-stdlib:stdlib-bits.efi:left=abc:right=def",
      "reproducible:length-mismatch:stdlib-bits/toolchain-stdlib:stdlib-bits.efi:left=3:right=4",
      "reproducible:metadata-mismatch:stdlib-bits/toolchain-stdlib:stdlib-bits.efi:left=meta-a:right=meta-b",
    ]);
  });

  test("reports source input and validation report mismatches with case context", () => {
    const first = buildPass("first", "abc", 3, "meta", {
      sourceSha256: "source-a",
      validationReportSha256: "report-a",
    });
    const second = buildPass("second", "abc", 3, "meta", {
      sourceSha256: "source-b",
      validationReportSha256: "report-b",
    });

    const result = compareReproducibleBuildPasses(first, second);

    expect(result.kind).toBe("mismatch");
    if (result.kind !== "mismatch") throw new Error("expected mismatch");
    expect(result.diagnostics).toEqual([
      "reproducible:source-input-mismatch:stdlib-bits/toolchain-stdlib:project:src/image.wr:image:left=source-a:right=source-b",
      "reproducible:validation-report-mismatch:stdlib-bits/toolchain-stdlib:compile-validation:left=report-a:right=report-b",
    ]);
  });

  test("uses the required release manifest path", () => {
    expect(REPRODUCIBILITY_MANIFEST_PATH).toBe("dist/release/reproducibility-manifest.json");
  });
});

function buildPass(
  label: string,
  sha256: string,
  byteLength: number,
  targetMetadataSha256: string,
  overrides: {
    readonly sourceSha256?: string;
    readonly validationReportSha256?: string;
  } = {},
): ReproducibilityBuildPass {
  return {
    label,
    outputDirectory: `/tmp/${label}`,
    diagnostics: [],
    sourceInputs: [
      {
        caseKey: "stdlib-bits/toolchain-stdlib",
        sourceKey: "src/image.wr",
        moduleName: "image",
        sourceRootKey: "project",
        sourceRootKind: "project",
        byteLength: 5,
        sha256: overrides.sourceSha256 ?? "source",
      },
    ],
    outputs: [
      {
        caseKey: "stdlib-bits/toolchain-stdlib",
        artifactName: "stdlib-bits.efi",
        byteLength,
        sha256,
        targetMetadataSha256,
      },
    ],
    validationReports: [
      {
        caseKey: "stdlib-bits/toolchain-stdlib",
        reportName: "compile-validation",
        passLabel: label,
        status: "passed",
        byteLength: 7,
        sha256: overrides.validationReportSha256 ?? "report",
      },
    ],
  };
}
