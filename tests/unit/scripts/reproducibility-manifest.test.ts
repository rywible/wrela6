import { describe, expect, test } from "bun:test";

import { buildReproducibilityManifest } from "../../../scripts/reproducibility-manifest";

describe("reproducibility manifest", () => {
  test("writes stable sorted release output evidence", () => {
    const manifest = JSON.parse(
      buildReproducibilityManifest({
        gitCommit: "abc123",
        dirty: false,
        lockSha256: "lock",
        platform: { operatingSystem: "test-os", architecture: "test-arch" },
        tools: { git: "git 1", bun: "1.0.0" },
        commands: [
          {
            command: ["bun", "run", "typecheck"],
            exitCode: 0,
            stdoutSha256: "out",
            stderrSha256: "err",
          },
        ],
        sourceInputs: [
          {
            caseKey: "z-case/toolchain-stdlib",
            sourceKey: "src/z.wr",
            moduleName: "z",
            sourceRootKey: "project",
            sourceRootKind: "project",
            byteLength: 2,
            sha256: "source-z",
          },
          {
            caseKey: "a-case/toolchain-stdlib",
            sourceKey: "src/a.wr",
            moduleName: "a",
            sourceRootKey: "project",
            sourceRootKind: "project",
            byteLength: 1,
            sha256: "source-a",
          },
        ],
        outputs: [
          {
            caseKey: "z-case/toolchain-stdlib",
            artifactName: "z.efi",
            byteLength: 2,
            sha256: "z",
            targetMetadataSha256: "meta-z",
          },
          {
            caseKey: "a-case/toolchain-stdlib",
            artifactName: "a.efi",
            byteLength: 1,
            sha256: "a",
            targetMetadataSha256: "meta-a",
          },
        ],
        validationReports: [
          {
            caseKey: "z-case/toolchain-stdlib",
            reportName: "compile-validation",
            passLabel: "second",
            status: "passed",
            byteLength: 2,
            sha256: "report-z",
          },
          {
            caseKey: "a-case/toolchain-stdlib",
            reportName: "compile-validation",
            passLabel: "first",
            status: "passed",
            byteLength: 1,
            sha256: "report-a",
          },
        ],
        validationEvidence: { comparison: "ok" },
      }),
    ) as {
      readonly platform: Readonly<Record<"arch" | "os", string>>;
      readonly tools: Record<string, string>;
      readonly sourceInputs: readonly { readonly caseKey: string }[];
      readonly outputs: readonly { readonly caseKey: string }[];
      readonly validationReports: readonly {
        readonly caseKey: string;
        readonly passLabel: string;
      }[];
    };

    expect(manifest.platform).toEqual({ arch: "test-arch", os: "test-os" });
    expect(Object.keys(manifest.tools)).toEqual(["bun", "git"]);
    expect(manifest.sourceInputs.map((sourceInput) => sourceInput.caseKey)).toEqual([
      "a-case/toolchain-stdlib",
      "z-case/toolchain-stdlib",
    ]);
    expect(manifest.outputs.map((output) => output.caseKey)).toEqual([
      "a-case/toolchain-stdlib",
      "z-case/toolchain-stdlib",
    ]);
    expect(
      manifest.validationReports.map((report) => `${report.caseKey}:${report.passLabel}`),
    ).toEqual(["a-case/toolchain-stdlib:first", "z-case/toolchain-stdlib:second"]);
  });
});
