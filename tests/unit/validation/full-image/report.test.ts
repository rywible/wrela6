import { expect, test } from "bun:test";

import {
  fullImageValidationDiagnostic,
  sortFullImageValidationDiagnostics,
  type FullImageValidationCaseReport,
  type FullImageValidationCheckReport,
  type FullImageValidationReport,
} from "../../../../src/validation/full-image";
import { formatHumanReport } from "../../../../scripts/validate-full-image";

test("diagnostics are sorted deterministically and frozen", () => {
  const diagnostics = sortFullImageValidationDiagnostics([
    fullImageValidationDiagnostic({
      ownerKey: "stage-trail",
      code: "FULL_IMAGE_VALIDATION_STAGE_TRAIL",
      stableDetail: "stage-trail:missing-required-stage:semantic",
    }),
    fullImageValidationDiagnostic({
      ownerKey: "matrix",
      code: "FULL_IMAGE_VALIDATION_MATRIX",
      stableDetail: "matrix:case",
    }),
    fullImageValidationDiagnostic({
      ownerKey: "stage-trail",
      code: "FULL_IMAGE_VALIDATION_STAGE_TRAIL",
      stableDetail: "stage-trail:duplicate-required-stage:semantic",
    }),
  ]);

  expect(diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
    "matrix:case",
    "stage-trail:duplicate-required-stage:semantic",
    "stage-trail:missing-required-stage:semantic",
  ]);
  expect(Object.isFrozen(diagnostics)).toBe(true);
  expect(diagnostics.every((diagnostic) => Object.isFrozen(diagnostic))).toBe(true);
});

test("check report carries deterministic evidence and input authority", () => {
  const report: FullImageValidationCheckReport = {
    checkerKey: "pe-coff-structure",
    status: "passed",
    stableDetail: "pe-coff-structure:ok",
    inputAuthority: ["final-bytes", "linked-layout"],
    evidence: [
      {
        evidenceKey: "section-count",
        authority: "final-bytes",
        stableDetail: "sections:3",
      },
    ],
  };

  expect(report).toMatchObject({
    checkerKey: "pe-coff-structure",
    status: "passed",
    stableDetail: "pe-coff-structure:ok",
    inputAuthority: ["final-bytes", "linked-layout"],
  });
  expect(report.evidence.map((record) => record.evidenceKey)).toEqual(["section-count"]);
});

test("case report type includes full image validation report fields", () => {
  const report: FullImageValidationCaseReport = {
    caseKey: "smoke-console/toolchain-stdlib",
    scenario: "smoke-console",
    stdlibMode: "toolchain-stdlib",
    packageKey: "smoke-console",
    artifactName: "SMOKEAA64.EFI",
    compileStatus: "passed",
    sourceRoots: [
      {
        kind: "project",
        rootKey: "app",
        rootPath: "src",
        trustedForAuthority: false,
        moduleCount: 1,
      },
    ],
    sourceFileCount: 1,
    moduleCount: 1,
    targetMetadata: {
      schema: "wrela.uefi-aarch64-image",
      schemaVersion: 1,
      targetDriverFingerprint: "target-driver:abc",
      aarch64TargetFingerprint: "aarch64:abc",
      backendTargetFingerprint: "backend:abc",
      linkerTargetFingerprint: "linker:abc",
      peCoffWriterTargetFingerprint: "pe-coff:abc",
      semanticPlatformCatalogFingerprint: "semantic-platform:abc",
      proofMirRuntimeCatalogFingerprint: "proof-mir-runtime:abc",
      entryThunkFingerprint: "entry-thunk:abc",
      firmwareAbiFingerprint: "firmware-abi:abc",
      statusPolicyFingerprint: "status-policy:abc",
      watchdogPolicyFingerprint: "watchdog-policy:abc",
      peCoffImageFingerprint: "pe-coff-image:abc",
      finalImageFingerprint: "final-image:abc",
    },
    stageRuns: [
      {
        verifierKey: "uefi-aarch64-compile",
        runKey: "frontend",
        status: "passed",
        stableDetail: "frontend:passed",
      },
    ],
    binaryChecks: [],
    referenceChecks: [],
    equivalenceEvidence: [
      {
        groupKey: "smoke-console:determinism",
        comparedCases: ["smoke-console/toolchain-stdlib"],
        status: "passed",
        stableDetail: "artifact-fingerprint:abc",
      },
    ],
    smoke: {
      status: "passed",
      stableDetail: "nonce:ok",
      observedMarkers: ["ok"],
    },
    artifactFingerprint: "sha256:abc",
    artifactByteLength: 123,
    compilerDiagnostics: [],
    diagnostics: [],
  };

  expect(report.sourceRoots[0]?.rootKey).toBe("app");
  expect(report.sourceRoots[0]?.trustedForAuthority).toBe(false);
  expect(report.targetMetadata?.schema).toBe("wrela.uefi-aarch64-image");
  expect(report.equivalenceEvidence[0]?.stableDetail).toBe("artifact-fingerprint:abc");
});

test("human report renders compiler diagnostics with source locations when preserved", () => {
  const report: FullImageValidationReport = {
    schema: "wrela.full-image-validation",
    schemaVersion: 1,
    targetKey: "wrela-uefi-aarch64-rpi5-v1",
    status: "failed",
    cases: [
      {
        caseKey: "smoke-console/toolchain-stdlib",
        scenario: "smoke-console",
        stdlibMode: "toolchain-stdlib",
        packageKey: "smoke-console",
        artifactName: "SMOKEAA64.EFI",
        compileStatus: "failed",
        sourceRoots: [],
        sourceFileCount: 1,
        moduleCount: 1,
        stageRuns: [],
        binaryChecks: [],
        referenceChecks: [],
        equivalenceEvidence: [],
        compilerDiagnostics: [
          {
            code: "UEFI_AARCH64_PIPELINE_FAILED",
            ownerKey: "uefi-aarch64-package-pipeline:frontend",
            stableDetail: "frontend:PARSE_EXPECTED_TOP_LEVEL_DECLARATION:src/image.wr:0:6",
            source: {
              originalCode: "PARSE_EXPECTED_TOP_LEVEL_DECLARATION",
              message: "Expected a top-level declaration.",
              sourceName: "src/image.wr",
              startOffset: 0,
              endOffset: 6,
              startLine: 1,
              startColumn: 1,
              endLine: 1,
              endColumn: 7,
            },
          },
          {
            code: "UEFI_AARCH64_PIPELINE_FAILED",
            ownerKey: "uefi-aarch64-package-pipeline:semantic",
            stableDetail: "SEMANTIC_SYNTHETIC:semantic:synthetic",
          },
        ],
        diagnostics: [],
      },
    ],
    diagnostics: [],
  };

  expect(formatHumanReport(report)).toContain(
    "  compiler src/image.wr:1:1 PARSE_EXPECTED_TOP_LEVEL_DECLARATION Expected a top-level declaration.",
  );
  expect(formatHumanReport(report)).toContain(
    "  compiler UEFI_AARCH64_PIPELINE_FAILED SEMANTIC_SYNTHETIC:semantic:synthetic",
  );
});
