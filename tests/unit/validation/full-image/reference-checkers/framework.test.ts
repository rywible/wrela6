import { expect, test } from "bun:test";

import {
  defaultFullImageReferenceCheckers,
  runFullImageReferenceCheckers,
  type FullImageReferenceChecker,
  type FullImageReferenceCheckerInput,
  type FullImageReferenceCheckerKey,
  type FullImageValidationCheckReport,
  type FullImageValidationEvidenceAuthority,
} from "../../../../../src/validation/full-image";

const expectedCheckerKeys: readonly FullImageReferenceCheckerKey[] = [
  "stdlib-source-root-reference",
  "semantic-platform-reference",
  "proof-fact-reference",
  "opt-ir-reference",
  "aarch64-object-reference",
  "linked-layout-reference",
  "pe-coff-reference",
  "uefi-tcb-golden-reference",
];

test("reference checker key union is closed to task 19 keys", () => {
  expect(expectedCheckerKeys).toEqual([
    "stdlib-source-root-reference",
    "semantic-platform-reference",
    "proof-fact-reference",
    "opt-ir-reference",
    "aarch64-object-reference",
    "linked-layout-reference",
    "pe-coff-reference",
    "uefi-tcb-golden-reference",
  ]);
});

test("default reference checker registry is deterministic", () => {
  const first = defaultFullImageReferenceCheckers();
  const second = defaultFullImageReferenceCheckers();

  expect(first.map((checker) => checker.checkerKey)).toEqual([
    "stdlib-source-root-reference",
    "semantic-platform-reference",
    "proof-fact-reference",
    "opt-ir-reference",
    "aarch64-object-reference",
    "linked-layout-reference",
    "pe-coff-reference",
    "uefi-tcb-golden-reference",
  ]);
  expect(second.map((checker) => checker.checkerKey)).toEqual(
    first.map((checker) => checker.checkerKey),
  );
  expect(Object.isFrozen(first)).toBe(true);
  expect(Object.isFrozen(second)).toBe(true);
});

test("runs fake checkers in deterministic checker-key order and normalizes evidence", () => {
  const input = fakeInput({ compileStatus: "passed" });
  const checkers: readonly FullImageReferenceChecker[] = [
    fakeChecker({
      checkerKey: "pe-coff-reference",
      reports: [
        {
          checkerKey: "pe-coff-reference",
          status: "passed",
          stableDetail: "pe:ok",
          inputAuthority: ["final-bytes"],
          evidence: [
            {
              evidenceKey: "z",
              authority: "final-bytes",
              stableDetail: "z:2",
            },
            {
              evidenceKey: "a",
              authority: "final-bytes",
              stableDetail: "a:1",
            },
          ],
        },
      ],
    }),
    fakeChecker({
      checkerKey: "stdlib-source-root-reference",
      reports: [
        {
          checkerKey: "stdlib-source-root-reference",
          status: "passed",
          stableDetail: "source:ok",
          inputAuthority: ["source-package"],
          evidence: [],
        },
      ],
    }),
  ];

  const reports = runFullImageReferenceCheckers({ input, checkers });

  expect(reports.map((report) => report.checkerKey)).toEqual([
    "stdlib-source-root-reference",
    "pe-coff-reference",
  ]);
  expect(reports[1]?.evidence.map((record) => record.evidenceKey)).toEqual(["a", "z"]);
  expect(Object.isFrozen(reports)).toBe(true);
  expect(reports.every((report) => Object.isFrozen(report))).toBe(true);
});

test("converts successful compile skips from required checkers to deterministic failures", () => {
  const reports = runFullImageReferenceCheckers({
    input: fakeInput({ compileStatus: "passed" }),
    checkers: [
      fakeChecker({
        checkerKey: "linked-layout-reference",
        requiredWhenCompilePassed: true,
        reports: [
          {
            checkerKey: "linked-layout-reference",
            status: "skipped",
            stableDetail: "linked-layout:trace-missing",
            inputAuthority: ["linked-layout"],
            evidence: [],
          },
        ],
      }),
    ],
  });

  expect(reports).toEqual([
    {
      checkerKey: "linked-layout-reference",
      status: "failed",
      stableDetail:
        "reference-checker:required-check-skipped:linked-layout-reference:linked-layout:trace-missing",
      inputAuthority: ["linked-layout"],
      evidence: [
        {
          evidenceKey: "required-check-skipped",
          authority: "linked-layout",
          stableDetail: "linked-layout:trace-missing",
        },
      ],
    },
  ]);
});

test("allows skipped required checkers for failed compile cases", () => {
  const reports = runFullImageReferenceCheckers({
    input: fakeInput({ compileStatus: "failed" }),
    checkers: [
      fakeChecker({
        checkerKey: "linked-layout-reference",
        requiredWhenCompilePassed: true,
        reports: [
          {
            checkerKey: "linked-layout-reference",
            status: "skipped",
            stableDetail: "linked-layout:compile-failed",
            inputAuthority: ["linked-layout"],
            evidence: [],
          },
        ],
      }),
    ],
  });

  expect(reports[0]?.status).toBe("skipped");
  expect(reports[0]?.stableDetail).toBe("linked-layout:compile-failed");
});

test("converts reports with empty input authority to deterministic failures", () => {
  const reports = runFullImageReferenceCheckers({
    input: fakeInput({ compileStatus: "passed" }),
    checkers: [
      fakeChecker({
        checkerKey: "proof-fact-reference",
        reports: [
          {
            checkerKey: "proof-fact-reference",
            status: "passed",
            stableDetail: "proof:ok",
            inputAuthority: [],
            evidence: [],
          },
        ],
      }),
    ],
  });

  expect(reports).toEqual([
    {
      checkerKey: "proof-fact-reference",
      status: "failed",
      stableDetail: "reference-checker:empty-input-authority:proof-fact-reference:proof:ok",
      inputAuthority: ["compiler-trace"],
      evidence: [
        {
          evidenceKey: "empty-input-authority",
          authority: "compiler-trace",
          stableDetail: "proof:ok",
        },
      ],
    },
  ]);
});

function fakeInput(input: {
  readonly compileStatus: FullImageReferenceCheckerInput["compileStatus"];
}): FullImageReferenceCheckerInput {
  return {
    caseKey: "smoke-console/toolchain-stdlib",
    scenario: "smoke-console",
    stdlibMode: "toolchain-stdlib",
    fixtureSpec: {
      scenario: "smoke-console",
      stdlibMode: "toolchain-stdlib",
      fixtureProjectPath: "fixtures/smoke-console/toolchain-stdlib",
      packageKey: "full-image-validation:smoke-console:toolchain-stdlib",
      entryModuleName: "image",
      artifactName: "smoke-console-toolchain-stdlib.efi",
      packageStdlibMode: "toolchain",
      enabledTargetFeatures: [],
      expectedConsoleMarkers: ["WRELA_UEFI_SMOKE_OK"],
    },
    packageInput: {
      packageKey: "full-image-validation:smoke-console:toolchain-stdlib",
      sourceRoots: [],
      sourceFiles: [],
      entryModuleName: "image",
      enabledTargetFeatures: [],
    },
    compileStatus: input.compileStatus,
  };
}

function fakeChecker(input: {
  readonly checkerKey: FullImageReferenceCheckerKey;
  readonly allowedAuthorities?: readonly FullImageValidationEvidenceAuthority[];
  readonly requiredWhenCompilePassed?: boolean;
  readonly reports: readonly FullImageValidationCheckReport[];
}): FullImageReferenceChecker {
  const allowedAuthorities: readonly FullImageValidationEvidenceAuthority[] =
    input.allowedAuthorities ?? ["compiler-trace"];
  return Object.freeze({
    checkerKey: input.checkerKey,
    allowedAuthorities,
    requiredWhenCompilePassed: input.requiredWhenCompilePassed,
    run: () => input.reports,
  });
}
