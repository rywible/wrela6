import { expect, test } from "bun:test";

import { writeAArch64PeCoffEfiImage, type PeCoffEfiImageArtifact } from "../../../../src/pe-coff";
import { AARCH64_OBJECT_SECTION_CLASS_READ_ONLY_DATA } from "../../../../src/target/aarch64/backend/object/object-module";
import { fingerprintUefiAArch64ImageBytes } from "../../../../src/target/uefi-aarch64";
import { uefiAArch64TargetDiagnostic } from "../../../../src/target/uefi-aarch64/diagnostics";
import type {
  CompileUefiAArch64ImageInput,
  CompileUefiAArch64ImageWithTraceResult,
} from "../../../../src/target/uefi-aarch64/compile-uefi-aarch64-image";
import type { FixtureProjectFilesystem } from "../../../../src/target/uefi-aarch64/package-input";
import type { UefiAArch64TargetVerifierRun } from "../../../../src/target/uefi-aarch64/result";
import {
  fullImageValidationCaseKey,
  fullImageValidationV1Cases,
} from "../../../../src/validation/full-image/matrix";
import { runFullImageValidation } from "../../../../src/validation/full-image/runner";
import type { FullImageValidationCheckReport } from "../../../../src/validation/full-image/report";
import {
  globalSymbolForLinkTest,
  objectModuleForLinkTest,
  textSectionForLinkTest,
} from "../../../support/linker/aarch64-object-link-fixtures";
import {
  linkedImageLayoutForPeCoffTest,
  writerTargetForLinkedLayout,
} from "../../../support/pe-coff/pe-coff-fixtures";
import { sectionForTest } from "../../../support/target/aarch64/backend/object-module-fixtures";

test("default request runs v1 cases deterministically through fixture loading and compile trace", async () => {
  const compiledPackageKeys: string[] = [];
  const artifactNames: (string | undefined)[] = [];

  const report = await runFullImageValidation(
    { targetKey: "wrela-uefi-aarch64-rpi5-v1", qemuSmoke: { kind: "disabled" } },
    {
      filesystem: emptyFixtureFilesystem(),
      compileImage: (input) => {
        compiledPackageKeys.push(input.packageInput.packageKey);
        artifactNames.push(input.artifactName);
        expect(input.output).toBeUndefined();
        expect(input.packagePipelineDependencies).toBeUndefined();
        return successfulCompileResult();
      },
    },
  );

  const expectedCaseKeys = fullImageValidationV1Cases().map(fullImageValidationCaseKey);
  const expectedPackageKeys = fullImageValidationV1Cases().map(
    (caseKey) => `full-image-validation:${caseKey.scenario}:${caseKey.stdlibMode}`,
  );
  const expectedArtifactNames = fullImageValidationV1Cases().map(
    (caseKey) => `${caseKey.scenario}-${caseKey.stdlibMode}.efi`,
  );
  expect(report.status).toBe("failed");
  expect(report.cases.map((caseReport) => caseReport.caseKey)).toEqual(expectedCaseKeys);
  expect(compiledPackageKeys).toEqual([...expectedPackageKeys, ...expectedPackageKeys]);
  expect(artifactNames).toEqual([...expectedArtifactNames, ...expectedArtifactNames]);
  expect(report.cases.every((caseReport) => caseReport.stageRuns.length > 0)).toBe(true);
  expect(report.cases.every((caseReport) => caseReport.binaryChecks.length > 0)).toBe(true);
  expect(report.cases.every((caseReport) => caseReport.referenceChecks.length > 0)).toBe(true);
  expect([...new Set(report.cases[0]?.referenceChecks.map((check) => check.checkerKey))]).toEqual([
    "source-authority.trusted-roots",
    "source-authority.stdlib-mode",
    "source-authority.counts",
    "stdlib-source-root-reference",
    "semantic-platform-reference",
    "proof-fact-reference",
    "opt-ir-reference",
    "aarch64-object-reference",
    "linked-layout-reference",
    "pe-coff-reference",
    "uefi-tcb-golden-reference",
  ]);
  expect(report.cases[0]?.binaryChecks.map((check) => check.checkerKey)).toEqual([
    "binary.pe.parse",
    "binary.structure.headers",
    "binary.structure.symbol-table",
    "binary.structure.sections",
    "binary.structure.entry",
    "binary.structure.relocations",
    "binary.structure.exception-directory",
    "binary.structure.trailing-bytes",
    "binary.metadata.fingerprint",
    "self-contained.object-modules",
    "self-contained.unresolved-externals",
    "self-contained.runtime-helpers",
    "self-contained.entry",
    "self-contained.host-references",
    "self-contained.section-ranges",
  ]);
  expect(report.cases.every((caseReport) => caseReport.equivalenceEvidence.length > 0)).toBe(true);
  expect(report.cases[0]?.equivalenceEvidence.map((evidence) => evidence.groupKey)).toEqual([
    "smoke-console:stdlib-modes",
    "packet-counter:stdlib-modes",
    "full-image:determinism",
  ]);
});

test("ejected stdlib source-root report counts nested project roots only once", async () => {
  const report = await runFullImageValidation(
    {
      targetKey: "wrela-uefi-aarch64-rpi5-v1",
      qemuSmoke: { kind: "disabled" },
      cases: [{ scenario: "smoke-console", stdlibMode: "ejected-stdlib" }],
    },
    {
      filesystem: fakeFixtureFilesystem({
        "tests/fixtures/full-image-validation/smoke-console/ejected-stdlib/src": [
          "image.wr",
          "wrela-std",
        ],
        "tests/fixtures/full-image-validation/smoke-console/ejected-stdlib/src/wrela-std": [
          "target",
        ],
        "tests/fixtures/full-image-validation/smoke-console/ejected-stdlib/src/wrela-std/target": [
          "uefi",
        ],
        "tests/fixtures/full-image-validation/smoke-console/ejected-stdlib/src/wrela-std/target/uefi":
          ["console.wr", "status.wr"],
        "tests/fixtures/full-image-validation/smoke-console/ejected-stdlib/src/image.wr":
          "uefi image SmokeConsoleImage:\n    fn boot() -> UefiStatus:\n        return UefiStatus.success\n",
        "tests/fixtures/full-image-validation/smoke-console/ejected-stdlib/src/wrela-std/target/uefi/console.wr":
          "pub fn write_console_string() -> UefiStatus:\n    return UefiStatus.success\n",
        "tests/fixtures/full-image-validation/smoke-console/ejected-stdlib/src/wrela-std/target/uefi/status.wr":
          "enum UefiStatus:\n    success\n",
      }),
      compileImage: () => successfulCompileResult(),
    },
  );

  const caseReport = report.cases[0];
  if (caseReport === undefined) throw new Error("expected one case report");
  expect(caseReport.sourceFileCount).toBe(3);
  expect(
    caseReport.sourceRoots.map((sourceRoot) => [sourceRoot.rootKey, sourceRoot.moduleCount]),
  ).toEqual([
    ["project", 1],
    ["project-wrela-std", 2],
  ]);
});

test("compile errors still record compile context and stage trail diagnostics", async () => {
  const report = await runFullImageValidation(
    {
      targetKey: "wrela-uefi-aarch64-rpi5-v1",
      qemuSmoke: { kind: "disabled" },
      cases: [{ scenario: "smoke-console", stdlibMode: "toolchain-stdlib" }],
    },
    {
      filesystem: emptyFixtureFilesystem(),
      compileImage: () => ({
        kind: "error",
        diagnostics: [
          uefiAArch64TargetDiagnostic({
            code: "UEFI_AARCH64_PIPELINE_FAILED",
            ownerKey: "frontend",
            stableDetail: "frontend:synthetic-failure",
          }),
        ],
        verification: {
          runs: [
            compileRun("target-driver-authenticate", "passed"),
            compileRun("unexpected-stage", "failed"),
          ],
        },
        partialTrace: {},
      }),
    },
  );

  expect(report.status).toBe("failed");
  expect(report.cases).toHaveLength(1);
  const caseReport = report.cases[0];
  if (caseReport === undefined) throw new Error("expected one case report");
  expect(caseReport).toMatchObject({
    caseKey: "smoke-console/toolchain-stdlib",
    compileStatus: "failed",
    packageKey: "full-image-validation:smoke-console:toolchain-stdlib",
    artifactName: "smoke-console-toolchain-stdlib.efi",
  });
  expect(caseReport.compilerDiagnostics).toEqual([
    {
      code: "UEFI_AARCH64_PIPELINE_FAILED",
      ownerKey: "frontend",
      stableDetail: "frontend:synthetic-failure",
    },
  ]);
  expect(caseReport.stageRuns.map((run) => run.runKey)).toEqual([
    "target-driver-authenticate",
    "unexpected-stage",
  ]);
  expect(caseReport.diagnostics).toContainEqual({
    ownerKey: "stage-trail",
    code: "FULL_IMAGE_VALIDATION_STAGE_TRAIL",
    stableDetail: "stage-trail:unknown-extra-stage:unexpected-stage",
  });
  expect(report.diagnostics).toContainEqual({
    ownerKey: "smoke-console/toolchain-stdlib",
    code: "FULL_IMAGE_COMPILE_FAILED",
    stableDetail: "compile:failed",
  });
});

test("runner accepts injected checker arrays as deterministic category overrides", async () => {
  const observedChecks: string[] = [];
  const checkReport = (checkerKey: string): FullImageValidationCheckReport =>
    Object.freeze({
      checkerKey,
      status: "passed",
      stableDetail: `${checkerKey}:passed`,
      inputAuthority: Object.freeze(["source-package" as const]),
      evidence: Object.freeze([]),
    });

  const report = await runFullImageValidation(
    {
      targetKey: "wrela-uefi-aarch64-rpi5-v1",
      qemuSmoke: { kind: "disabled" },
      cases: [{ scenario: "smoke-console", stdlibMode: "toolchain-stdlib" }],
    },
    {
      filesystem: emptyFixtureFilesystem(),
      compileImage: () => successfulCompileResult(),
      sourceRootChecks: [
        ({ caseKey }) => {
          observedChecks.push(`source:${caseKey}`);
          return [checkReport("source-root-fake")];
        },
      ],
      binaryChecks: [
        ({ caseKey }) => {
          observedChecks.push(`binary:${caseKey}`);
          return [checkReport("binary-fake")];
        },
      ],
      selfContainedChecks: [
        ({ caseKey }) => {
          observedChecks.push(`self-contained:${caseKey}`);
          return [checkReport("self-contained-fake")];
        },
      ],
      referenceChecks: [
        ({ caseKey }) => {
          observedChecks.push(`reference:${caseKey}`);
          return [checkReport("reference-fake")];
        },
      ],
      qemuChecks: [
        ({ caseKey }) => {
          observedChecks.push(`qemu:${caseKey}`);
          return Object.freeze({
            status: "skipped" as const,
            stableDetail: "qemu-fake:skipped",
            observedMarkers: Object.freeze([]),
          });
        },
      ],
      equivalenceChecks: [
        ({ cases }) => {
          observedChecks.push(`equivalence:${cases.length}`);
          return [
            Object.freeze({
              groupKey: "equivalence-fake",
              comparedCases: Object.freeze(cases.map((caseReport) => caseReport.caseKey)),
              status: "passed" as const,
              stableDetail: "equivalence-fake:passed",
            }),
          ];
        },
      ],
    },
  );

  const caseReport = report.cases[0];
  if (caseReport === undefined) throw new Error("expected one case report");
  expect(observedChecks).toEqual([
    "source:smoke-console/toolchain-stdlib",
    "binary:smoke-console/toolchain-stdlib",
    "self-contained:smoke-console/toolchain-stdlib",
    "reference:smoke-console/toolchain-stdlib",
    "qemu:smoke-console/toolchain-stdlib",
    "equivalence:1",
  ]);
  expect(caseReport.binaryChecks.map((check) => check.checkerKey)).toEqual([
    "binary-fake",
    "self-contained-fake",
  ]);
  expect(caseReport.referenceChecks.map((check) => check.checkerKey)).toEqual([
    "source-root-fake",
    "reference-fake",
  ]);
  expect(caseReport.smoke?.stableDetail).toBe("qemu-fake:skipped");
  expect(caseReport.equivalenceEvidence).toEqual([
    {
      groupKey: "equivalence-fake",
      comparedCases: ["smoke-console/toolchain-stdlib"],
      status: "passed",
      stableDetail: "equivalence-fake:passed",
    },
  ]);
});

function emptyFixtureFilesystem(): FixtureProjectFilesystem {
  return {
    readDirectory: () => [],
    isDirectory: () => false,
    readTextFile: () => "",
  };
}

function fakeFixtureFilesystem(
  entries: Record<string, readonly string[] | string>,
): FixtureProjectFilesystem {
  return {
    readDirectory: (path) => {
      const entry = entries[path];
      return Array.isArray(entry) ? entry : [];
    },
    isDirectory: (path) => Array.isArray(entries[path]),
    readTextFile: (path) => {
      const entry = entries[path];
      if (typeof entry !== "string") throw new Error(`missing text fixture ${path}`);
      return entry;
    },
  };
}

function successfulCompileResult(): CompileUefiAArch64ImageWithTraceResult {
  const fixture = fakePeCoffFixture();
  return {
    kind: "ok",
    artifact: {
      artifactName: "fake.efi",
      peCoffArtifact: fixture.peCoffArtifact,
      targetMetadata: {
        schema: "wrela.uefi-aarch64-image",
        schemaVersion: 1,
        targetDriverFingerprint: "target",
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
        peCoffImageFingerprint: fixture.peCoffArtifact.deterministicMetadata.imageFingerprint,
        finalImageFingerprint: fingerprintUefiAArch64ImageBytes(fixture.peCoffArtifact.bytes),
      },
      smoke: {
        status: "disabled",
        stableDetail: "qemu-smoke:disabled",
        observedMarkers: [],
      },
    },
    diagnostics: [],
    verification: {
      runs: [
        compileRun("target-driver-authenticate", "passed"),
        compileRun("frontend", "passed"),
        compileRun("semantic", "passed"),
        compileRun("monomorphization", "passed"),
        compileRun("layout-facts", "passed"),
        compileRun("proof-mir", "passed"),
        compileRun("proof-check", "passed"),
        compileRun("opt-ir", "passed"),
        compileRun("aarch64-lowering", "passed"),
        compileRun("aarch64-backend", "passed"),
        compileRun("static-char16-objects", "passed"),
        compileRun("validation-fixture-objects", "passed"),
        compileRun("runtime-helper-objects", "passed"),
        compileRun("synthetic-entry-object", "passed"),
        compileRun("linker", "passed"),
        compileRun("pe-coff-writer", "passed"),
      ],
    },
    trace: minimalCompileTrace(fixture),
  };
}

function minimalCompileTrace(
  input: ReturnType<typeof fakePeCoffFixture>,
): CompileUefiAArch64ImageWithTraceResult extends {
  trace: infer Trace;
}
  ? Trace
  : never {
  return {
    packagePipeline: {
      reachablePlatformPrimitiveIds: [],
      optIr: {
        staticChar16Strings: [{}],
        staticChar16Pointers: [{}],
      },
    },
    target: {
      targetKey: "fake-target",
      statusPolicy: {
        success: 0,
        invalidParameter: 0,
        badBufferSize: 0,
        bufferTooSmall: 0,
        unsupported: 0,
        aborted: 0,
        panicStatus: 0,
      },
      firmwareTables: {
        records: [],
      },
      runtimeMaterializations: [],
      entryProfile: {
        bootFunctionSymbol: "wrela_boot",
      },
    },
    binarySpine: {
      backendObjects: [fakeTextObjectModule("wrela-source-object", "wrela_boot")],
      staticChar16Objects: [fakeStaticChar16ObjectModule()],
      validationFixtureObjects: [
        fakeTextObjectModule(
          "validation-fixture:test",
          "__wrela_uefi_validation_fixture_packet_bytes",
        ),
      ],
      helperObjects: [fakeTextObjectModule("runtime-helper:test", "wrela_runtime_helper")],
      linkedLayout: input.linkedLayout,
      peCoffArtifact: input.peCoffArtifact,
    },
  } as unknown as CompileUefiAArch64ImageWithTraceResult extends { trace: infer Trace }
    ? Trace
    : never;
}

function fakePeCoffFixture(): {
  readonly peCoffArtifact: PeCoffEfiImageArtifact;
  readonly linkedLayout: ReturnType<typeof linkedImageLayoutForPeCoffTest>;
} {
  const baseLayout = linkedImageLayoutForPeCoffTest();
  const linkedLayout: ReturnType<typeof linkedImageLayoutForPeCoffTest> = {
    ...baseLayout,
    inputModules: [
      { moduleKey: "wrela-source-object", moduleFingerprint: "stable-hash:source" },
      { moduleKey: "static-char16:test", moduleFingerprint: "stable-hash:char16" },
      { moduleKey: "runtime-helper:test", moduleFingerprint: "stable-hash:helper" },
      {
        moduleKey: "synthetic-entry:test",
        moduleFingerprint: "stable-hash:entry",
        syntheticProviderKey: "aarch64-uefi-entry",
      },
      {
        moduleKey: "synthetic-unwind:test",
        moduleFingerprint: "stable-hash:unwind",
        syntheticProviderKey: "aarch64-unwind",
      },
    ],
    symbols: [
      {
        symbolKey: "symbol:entry",
        linkageName: "EfiMain",
        binding: "global" as const,
        sourceModuleKey: "synthetic-entry:test",
        sectionKey: ".text",
        contributionKey: "contribution:.text",
        rva: 0x1000,
        objectOffsetBytes: 0,
      },
      {
        symbolKey: "symbol:boot",
        linkageName: "wrela_boot",
        binding: "global" as const,
        sourceModuleKey: "wrela-source-object",
        sectionKey: ".text",
        contributionKey: "contribution:.text",
        rva: 0x1000,
        objectOffsetBytes: 0,
      },
    ],
  };
  const artifactResult = writeAArch64PeCoffEfiImage({
    layout: linkedLayout,
    target: writerTargetForLinkedLayout(linkedLayout),
    artifactName: "fake.efi",
  });
  if (artifactResult.kind !== "ok") throw new Error("expected PE/COFF fixture");
  return {
    peCoffArtifact: artifactResult.artifact,
    linkedLayout,
  };
}

function fakeTextObjectModule(moduleKey: string, linkageName: string) {
  const section = textSectionForLinkTest({ stableKey: `.text.${moduleKey}` });
  return objectModuleForLinkTest({
    moduleKey,
    sections: [section],
    symbols: [
      globalSymbolForLinkTest({
        stableKey: `symbol:${moduleKey}`,
        linkageName,
        sectionKey: String(section.stableKey),
      }),
    ],
  });
}

function fakeStaticChar16ObjectModule() {
  const section = sectionForTest({
    stableKey: ".rdata.static-char16",
    classKey: AARCH64_OBJECT_SECTION_CLASS_READ_ONLY_DATA,
    alignmentBytes: 2,
    bytes: [65, 0, 0, 0],
  });
  return objectModuleForLinkTest({
    moduleKey: "static-char16:test",
    sections: [section],
    symbols: [
      globalSymbolForLinkTest({
        stableKey: "symbol:static-char16",
        linkageName: "static_char16_test",
        sectionKey: String(section.stableKey),
      }),
    ],
  });
}

function compileRun(
  runKey: string,
  status: UefiAArch64TargetVerifierRun["status"],
): UefiAArch64TargetVerifierRun {
  return Object.freeze({
    verifierKey: "uefi-aarch64-compile",
    runKey,
    status,
  });
}

void ({} satisfies Partial<CompileUefiAArch64ImageInput>);
