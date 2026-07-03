import { expect, test } from "bun:test";

import {
  compareFullImageValidationReportsForDeterminism,
  compareFullImageValidationStdlibModeEquivalence,
  type FullImageValidationCaseReport,
  type FullImageValidationReport,
} from "../../../../src/validation/full-image";

test("repeated equal reports produce stable passed evidence", () => {
  const report = validationReport([
    validationCase("smoke-console", "toolchain-stdlib"),
    validationCase("packet-counter", "toolchain-stdlib"),
  ]);

  const evidence = compareFullImageValidationReportsForDeterminism({
    left: report,
    right: report,
    leftArtifacts: {
      "smoke-console/toolchain-stdlib": bytes(1, 2, 3),
      "packet-counter/toolchain-stdlib": bytes(4, 5, 6),
    },
    rightArtifacts: {
      "smoke-console/toolchain-stdlib": bytes(1, 2, 3),
      "packet-counter/toolchain-stdlib": bytes(4, 5, 6),
    },
  });

  expect(evidence).toEqual([
    {
      groupKey: "full-image:determinism",
      comparedCases: ["smoke-console/toolchain-stdlib", "packet-counter/toolchain-stdlib"],
      status: "passed",
      stableDetail: "determinism:reports-equivalent",
    },
  ]);
});

test("repeated report comparison detects emitted byte mismatches compactly", () => {
  const report = validationReport([validationCase("smoke-console", "toolchain-stdlib")]);

  const evidence = compareFullImageValidationReportsForDeterminism({
    left: report,
    right: report,
    leftArtifacts: {
      "smoke-console/toolchain-stdlib": bytes(1, 2, 3),
    },
    rightArtifacts: {
      "smoke-console/toolchain-stdlib": bytes(1, 9, 3),
    },
  });

  expect(evidence).toEqual([
    {
      groupKey: "smoke-console/toolchain-stdlib:determinism",
      comparedCases: ["smoke-console/toolchain-stdlib"],
      status: "failed",
      stableDetail: "determinism:artifact-bytes:first-mismatch:index=1:left=2:right=9",
    },
  ]);
});

test("repeated report comparison detects stage and diagnostic ordering mismatches", () => {
  const left = validationReport([
    validationCase("smoke-console", "toolchain-stdlib", {
      diagnostics: [
        {
          ownerKey: "compiler",
          code: "FULL_IMAGE_COMPILE_FAILED",
          stableDetail: "compile:a",
        },
        {
          ownerKey: "compiler",
          code: "FULL_IMAGE_COMPILE_FAILED",
          stableDetail: "compile:b",
        },
      ],
    }),
  ]);
  const right = validationReport([
    validationCase("smoke-console", "toolchain-stdlib", {
      stageRuns: [
        { verifierKey: "uefi-aarch64-compile", runKey: "semantic", status: "passed" },
        { verifierKey: "uefi-aarch64-compile", runKey: "frontend", status: "passed" },
      ],
      diagnostics: [
        {
          ownerKey: "compiler",
          code: "FULL_IMAGE_COMPILE_FAILED",
          stableDetail: "compile:b",
        },
        {
          ownerKey: "compiler",
          code: "FULL_IMAGE_COMPILE_FAILED",
          stableDetail: "compile:a",
        },
      ],
    }),
  ]);

  const evidence = compareFullImageValidationReportsForDeterminism({ left, right });

  expect(evidence).toEqual([
    {
      groupKey: "smoke-console/toolchain-stdlib:determinism",
      comparedCases: ["smoke-console/toolchain-stdlib"],
      status: "failed",
      stableDetail: "determinism:stage-runs:index=0:left=frontend/passed:right=semantic/passed",
    },
    {
      groupKey: "smoke-console/toolchain-stdlib:determinism",
      comparedCases: ["smoke-console/toolchain-stdlib"],
      status: "failed",
      stableDetail:
        "determinism:case-diagnostics:index=0:left=compiler/FULL_IMAGE_COMPILE_FAILED/compile:a:right=compiler/FULL_IMAGE_COMPILE_FAILED/compile:b",
    },
  ]);
});

test("cross-stdlib equivalence compares structure without requiring byte identity", () => {
  const report = validationReport([
    validationCase("packet-counter", "toolchain-stdlib", {
      artifactFingerprint: "sha256:toolchain",
    }),
    validationCase("packet-counter", "ejected-stdlib", {
      artifactFingerprint: "sha256:ejected",
      packageKey: "packet-counter-ejected",
    }),
    validationCase("packet-counter", "direct-platform", {
      artifactFingerprint: "sha256:direct",
      packageKey: "packet-counter-direct",
    }),
  ]);

  const evidence = compareFullImageValidationStdlibModeEquivalence(report);

  expect(evidence).toEqual([
    {
      groupKey: "packet-counter:stdlib-modes",
      comparedCases: [
        "packet-counter/toolchain-stdlib",
        "packet-counter/ejected-stdlib",
        "packet-counter/direct-platform",
      ],
      status: "passed",
      stableDetail: "equivalence:platform-primitives-and-binary-structure",
    },
  ]);
});

test("cross-stdlib equivalence fails when production evidence is missing", () => {
  const report = validationReport([
    validationCase("packet-counter", "toolchain-stdlib", {
      binaryChecks: [],
      referenceChecks: [],
    }),
    validationCase("packet-counter", "ejected-stdlib", {
      binaryChecks: [],
      referenceChecks: [],
    }),
    validationCase("packet-counter", "direct-platform", {
      binaryChecks: [],
      referenceChecks: [],
    }),
  ]);

  const evidence = compareFullImageValidationStdlibModeEquivalence(report);

  expect(evidence).toEqual([
    {
      groupKey: "packet-counter:stdlib-modes",
      comparedCases: [
        "packet-counter/toolchain-stdlib",
        "packet-counter/ejected-stdlib",
        "packet-counter/direct-platform",
      ],
      status: "failed",
      stableDetail:
        "equivalence:expected-platform-primitives:missing:packet-counter/toolchain-stdlib:packet-counter/ejected-stdlib:expected-reachable-primitives",
    },
  ]);
});

function validationReport(
  cases: readonly FullImageValidationCaseReport[],
): FullImageValidationReport {
  return {
    schema: "wrela.full-image-validation",
    schemaVersion: 1,
    targetKey: "wrela-uefi-aarch64-rpi5-v1",
    status: "passed",
    cases,
    diagnostics: [],
  };
}

function validationCase(
  scenario: "smoke-console" | "packet-counter",
  stdlibMode: "toolchain-stdlib" | "ejected-stdlib" | "direct-platform",
  overrides: Partial<FullImageValidationCaseReport> = {},
): FullImageValidationCaseReport {
  const caseKey = `${scenario}/${stdlibMode}`;

  return {
    caseKey,
    scenario,
    stdlibMode,
    packageKey: scenario,
    compileStatus: "passed",
    sourceRoots: [
      {
        kind: stdlibMode === "toolchain-stdlib" ? "toolchain" : "project",
        rootKey: stdlibMode,
        rootPath: `fixtures/${caseKey}`,
        trustedForAuthority: false,
        moduleCount: 2,
      },
    ],
    sourceFileCount: 2,
    moduleCount: 2,
    targetMetadata: {
      schema: "wrela.uefi-aarch64-image",
      schemaVersion: 1,
      targetDriverFingerprint: "target-driver:stable",
      aarch64TargetFingerprint: "aarch64:stable",
      backendTargetFingerprint: "backend:stable",
      linkerTargetFingerprint: "linker:stable",
      peCoffWriterTargetFingerprint: "pe-coff:stable",
      semanticPlatformCatalogFingerprint: "semantic-platform:stable",
      proofMirRuntimeCatalogFingerprint: "proof-mir-runtime:stable",
      entryThunkFingerprint: "entry-thunk:stable",
      firmwareAbiFingerprint: "firmware-abi:stable",
      statusPolicyFingerprint: "status-policy:stable",
      watchdogPolicyFingerprint: "watchdog-policy:stable",
      peCoffImageFingerprint: `pe-coff-image:${stdlibMode}`,
      finalImageFingerprint: `final-image:${stdlibMode}`,
    },
    stageRuns: [
      { verifierKey: "uefi-aarch64-compile", runKey: "frontend", status: "passed" },
      { verifierKey: "uefi-aarch64-compile", runKey: "semantic", status: "passed" },
    ],
    binaryChecks: [
      {
        checkerKey: "self-contained.entry",
        status: "passed",
        stableDetail: "self-contained:entry:__wrela_uefi_entry:wrela.image.boot",
        inputAuthority: ["compiler-trace", "linked-layout"],
        evidence: [
          {
            evidenceKey: "target-boot-symbol",
            authority: "compiler-trace",
            stableDetail: "wrela.image.boot",
          },
        ],
      },
    ],
    referenceChecks: [
      {
        checkerKey: "semantic-platform-reference",
        status: "passed",
        stableDetail: "semantic-platform-reference:ok",
        inputAuthority: ["compiler-trace"],
        evidence: [
          {
            evidenceKey: "expected-reachable-primitives",
            authority: "compiler-trace",
            stableDetail: "uefi.console.outputString",
          },
          {
            evidenceKey: "reachable-platform-primitives",
            authority: "compiler-trace",
            stableDetail: "uefi.console.outputString",
          },
        ],
      },
      {
        checkerKey: "opt-ir-reference",
        status: "passed",
        stableDetail: "opt-ir-reference:ok",
        inputAuthority: ["compiler-trace"],
        evidence: [
          {
            evidenceKey:
              scenario === "packet-counter"
                ? "static-char16-marker:WRELA_PACKET_COUNTER_OK"
                : "static-char16-marker:WRELA_UEFI_SMOKE_OK",
            authority: "compiler-trace",
            stableDetail:
              scenario === "packet-counter"
                ? "utf16-static:WRELA_PACKET_COUNTER_OK"
                : "utf16-static:WRELA_UEFI_SMOKE_OK",
          },
        ],
      },
      {
        checkerKey: "pe-coff-reference",
        status: "passed",
        stableDetail: "pe-coff-reference:ok",
        inputAuthority: ["final-bytes", "linked-layout"],
        evidence: [],
      },
    ],
    equivalenceEvidence: [],
    artifactFingerprint: "sha256:stable",
    artifactByteLength: 4096,
    compilerDiagnostics: [],
    diagnostics: [],
    ...overrides,
  };
}

function bytes(...values: readonly number[]): Uint8Array {
  return Uint8Array.from(values);
}
