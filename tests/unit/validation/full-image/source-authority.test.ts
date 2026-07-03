import { describe, expect, test } from "bun:test";

import {
  fingerprintUefiAArch64ImageBytes,
  type UefiAArch64ImageArtifact,
  type UefiAArch64TargetMetadata,
} from "../../../../src/target/uefi-aarch64";
import type { CompilerPackageInput } from "../../../../src/target/uefi-aarch64/package-input";
import {
  checkFullImageArtifactMetadata,
  checkFullImageSourceAuthority,
  fullImageValidationModuleCount,
  fullImageValidationSourceFileCount,
} from "../../../../src/validation/full-image";

describe("full image source authority checker", () => {
  test("accepts toolchain stdlib packages with one untrusted toolchain stdlib root", () => {
    const packageInput = packageInputForTest({
      sourceRoots: [
        projectRoot(),
        {
          kind: "toolchain",
          rootKey: "toolchain-wrela-std",
          rootPath: "stdlib/wrela-std",
          trustedForAuthority: false,
        },
      ],
      sourceFiles: [
        source("src/image.wr", "image"),
        source("stdlib/wrela-std/target/uefi/console.wr", "wrela_std.target.uefi.console"),
      ],
    });

    expect(checkFullImageSourceAuthority({ packageInput, stdlibMode: "toolchain-stdlib" })).toEqual(
      [
        {
          checkerKey: "source-authority.trusted-roots",
          status: "passed",
          stableDetail: "source-authority:trusted-roots:untrusted:2",
          inputAuthority: ["source-package"],
          evidence: [
            {
              evidenceKey: "source-roots",
              authority: "source-package",
              stableDetail:
                "project:project:src:false|toolchain:toolchain-wrela-std:stdlib/wrela-std:false",
            },
          ],
        },
        {
          checkerKey: "source-authority.stdlib-mode",
          status: "passed",
          stableDetail: "source-authority:toolchain-stdlib",
          inputAuthority: ["source-package"],
          evidence: [
            {
              evidenceKey: "source-roots",
              authority: "source-package",
              stableDetail:
                "project:project:src:false|toolchain:toolchain-wrela-std:stdlib/wrela-std:false",
            },
            {
              evidenceKey: "modules",
              authority: "source-package",
              stableDetail: "image|wrela_std.target.uefi.console",
            },
          ],
        },
        {
          checkerKey: "source-authority.counts",
          status: "passed",
          stableDetail: "source-authority:counts:sources:2:modules:2",
          inputAuthority: ["source-package"],
          evidence: [
            {
              evidenceKey: "source-counts",
              authority: "source-package",
              stableDetail: "source-files:2:modules:2",
            },
          ],
        },
      ],
    );
  });

  test("rejects any source root trusted for authority", () => {
    const packageInput = packageInputForTest({
      sourceRoots: [
        {
          kind: "project",
          rootKey: "project",
          rootPath: "src",
          trustedForAuthority: true,
        } as unknown as CompilerPackageInput["sourceRoots"][number],
      ],
      sourceFiles: [source("src/image.wr", "image")],
    });

    const reports = checkFullImageSourceAuthority({ packageInput, stdlibMode: "direct-platform" });

    expect(reportByKey(reports, "source-authority.trusted-roots")).toMatchObject({
      status: "failed",
      stableDetail: "source-authority:trusted-roots:trusted:project",
    });
  });

  test("requires ejected stdlib to use project-wrela-std and no toolchain root", () => {
    const packageInput = packageInputForTest({
      sourceRoots: [
        projectRoot(),
        {
          kind: "toolchain",
          rootKey: "toolchain-wrela-std",
          rootPath: "stdlib/wrela-std",
          trustedForAuthority: false,
        },
      ],
      sourceFiles: [source("src/image.wr", "image")],
    });

    const reports = checkFullImageSourceAuthority({ packageInput, stdlibMode: "ejected-stdlib" });

    expect(reportByKey(reports, "source-authority.stdlib-mode")).toMatchObject({
      status: "failed",
      stableDetail:
        "source-authority:ejected-stdlib:mismatch:project-wrela-std:missing:toolchain-roots:1",
    });
  });

  test("requires direct-platform packages to contain only project root and no wrela_std modules", () => {
    const packageInput = packageInputForTest({
      sourceRoots: [projectRoot()],
      sourceFiles: [
        source("src/image.wr", "image"),
        source("src/wrela_std/console.wr", "wrela_std.console"),
      ],
    });

    const reports = checkFullImageSourceAuthority({ packageInput, stdlibMode: "direct-platform" });

    expect(reportByKey(reports, "source-authority.stdlib-mode")).toMatchObject({
      status: "failed",
      stableDetail:
        "source-authority:direct-platform:mismatch:project-roots:1:toolchain-roots:0:wrela-std-modules:1",
    });
  });

  test("counts source files and unique modules from package input", () => {
    const packageInput = packageInputForTest({
      sourceRoots: [projectRoot()],
      sourceFiles: [
        source("src/image.wr", "image"),
        source("src/duplicate-a.wr", "duplicate"),
        source("src/duplicate-b.wr", "duplicate"),
      ],
    });

    expect(fullImageValidationSourceFileCount(packageInput)).toBe(3);
    expect(fullImageValidationModuleCount(packageInput)).toBe(2);
  });
});

describe("full image artifact metadata checker", () => {
  test("recomputes final image fingerprint from PE/COFF bytes and records metadata as evidence", () => {
    const bytes = [0xde, 0xad, 0xbe, 0xef];
    const artifact = artifactForTest(bytes, fingerprintUefiAArch64ImageBytes(bytes));

    expect(checkFullImageArtifactMetadata({ artifact })).toEqual([
      {
        checkerKey: "artifact.metadata.final-image-fingerprint",
        status: "passed",
        stableDetail: "artifact-metadata:final-image-fingerprint:matched",
        inputAuthority: ["final-bytes", "compiler-trace"],
        evidence: [
          {
            evidenceKey: "final-image-fingerprint",
            authority: "final-bytes",
            stableDetail: fingerprintUefiAArch64ImageBytes(bytes),
          },
          {
            evidenceKey: "metadata-final-image-fingerprint",
            authority: "compiler-trace",
            stableDetail: fingerprintUefiAArch64ImageBytes(bytes),
          },
        ],
      },
    ]);
  });

  test("fails when target metadata does not match recomputed byte fingerprint", () => {
    const artifact = artifactForTest([1, 2, 3], "uefi-aarch64-image-bytes:metadata-only");

    const reports = checkFullImageArtifactMetadata({ artifact });

    expect(reportByKey(reports, "artifact.metadata.final-image-fingerprint")).toMatchObject({
      status: "failed",
      stableDetail: `artifact-metadata:final-image-fingerprint:mismatch:uefi-aarch64-image-bytes:metadata-only:${fingerprintUefiAArch64ImageBytes(
        [1, 2, 3],
      )}`,
    });
  });
});

function packageInputForTest(input: {
  readonly sourceRoots: CompilerPackageInput["sourceRoots"];
  readonly sourceFiles: CompilerPackageInput["sourceFiles"];
}): CompilerPackageInput {
  return {
    packageKey: "test-package",
    sourceRoots: input.sourceRoots,
    sourceFiles: input.sourceFiles,
    entryModuleName: "image",
    enabledTargetFeatures: [],
  };
}

function projectRoot(): CompilerPackageInput["sourceRoots"][number] {
  return {
    kind: "project",
    rootKey: "project",
    rootPath: "src",
    trustedForAuthority: false,
  };
}

function source(
  sourceKey: string,
  moduleName: string,
): CompilerPackageInput["sourceFiles"][number] {
  return { sourceKey, moduleName, text: "" };
}

function artifactForTest(
  bytes: readonly number[],
  finalImageFingerprint: string,
): UefiAArch64ImageArtifact {
  return {
    artifactName: "test.efi",
    peCoffArtifact: {
      artifactName: "test.efi",
      mediaType: "application/vnd.microsoft.portable-executable",
      fileExtension: ".efi",
      bytes,
      deterministicMetadata: {
        schema: "wrela.pe-coff-efi-image",
        schemaVersion: 1,
        linkedLayoutFingerprint: "linked-layout",
        writerTargetFingerprint: "writer-target",
        sectionTableFingerprint: "section-table",
        dataDirectoryFingerprint: "data-directory",
        baseRelocationTableFingerprint: "base-relocation-table",
        headerFingerprint: "header",
        imageFingerprint: "pe-coff-image",
      },
      verification: { runs: [] },
    },
    targetMetadata: metadataForTest(finalImageFingerprint),
  };
}

function metadataForTest(finalImageFingerprint: string): UefiAArch64TargetMetadata {
  return {
    schema: "wrela.uefi-aarch64-image",
    schemaVersion: 1,
    targetDriverFingerprint: "target-driver",
    aarch64TargetFingerprint: "aarch64",
    backendTargetFingerprint: "backend",
    linkerTargetFingerprint: "linker",
    peCoffWriterTargetFingerprint: "pe-coff-writer",
    semanticPlatformCatalogFingerprint: "semantic-platform",
    proofMirRuntimeCatalogFingerprint: "proof-mir-runtime",
    entryThunkFingerprint: "entry-thunk",
    firmwareAbiFingerprint: "firmware-abi",
    statusPolicyFingerprint: "status-policy",
    watchdogPolicyFingerprint: "watchdog-policy",
    peCoffImageFingerprint: "pe-coff-image",
    finalImageFingerprint,
  };
}

function reportByKey<
  Report extends {
    readonly checkerKey: string;
    readonly evidence: readonly unknown[];
    readonly inputAuthority: readonly unknown[];
  },
>(reports: readonly Report[], checkerKey: string): Report {
  const report = reports.find((candidate) => candidate.checkerKey === checkerKey);
  if (report === undefined) throw new Error(`missing report ${checkerKey}`);
  expect(report.evidence.length).toBeGreaterThan(0);
  expect(report.inputAuthority.length).toBeGreaterThan(0);
  return report;
}
