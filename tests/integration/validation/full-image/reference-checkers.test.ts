import { expect, test } from "bun:test";

import { efiErrorStatus } from "../../../../src/target/uefi-aarch64/status-conversion";
import {
  defaultFullImageReferenceCheckers,
  runFullImageReferenceCheckers,
  aarch64ObjectReferenceChecker,
  linkedLayoutReferenceChecker,
  peCoffReferenceChecker,
  uefiTcbGoldenReferenceChecker,
  type FullImageReferenceCheckerInput,
} from "../../../../src/validation/full-image";
import {
  linkedImageLayoutForPeCoffTest,
  serializedImageBytesForParserTest,
} from "../../../support/pe-coff/pe-coff-fixtures";
import {
  dataSectionForLinkTest,
  externalSymbolForLinkTest,
  globalSymbolForLinkTest,
  objectModuleForLinkTest,
} from "../../../support/linker/aarch64-object-link-fixtures";
import { FULL_IMAGE_UEFI_TCB_GOLDEN } from "../../../support/target/uefi-aarch64/full-image-tcb-golden-fixtures";
import {
  artifactWithBytes,
  canonicalTrace,
  fakeInput,
  linkedSectionForReferenceTest,
  traceWithBinarySpine,
} from "./reference-checkers-fixtures";

test("registers the UEFI TCB golden checker in the default deterministic order", () => {
  expect(defaultFullImageReferenceCheckers().map((checker) => checker.checkerKey)).toEqual([
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

test("AArch64 object reference fails malformed object modules with external symbols", () => {
  const backendObject = objectModuleForLinkTest({
    moduleKey: "wrela-source-object",
    symbols: [
      globalSymbolForLinkTest({
        stableKey: "main",
        linkageName: "Boot.main",
        sectionKey: ".text",
      }),
      externalSymbolForLinkTest({ stableKey: "extern:firmware", linkageName: "Firmware.call" }),
    ],
  });
  const reports = runFullImageReferenceCheckers({
    input: fakeInput({
      trace: traceWithBinarySpine({
        backendObjects: [backendObject],
        staticChar16Objects: [objectModuleForLinkTest({ moduleKey: "static-char16:smoke" })],
        helperObjects: [objectModuleForLinkTest({ moduleKey: "helper:runtime" })],
      }),
    }),
    checkers: [aarch64ObjectReferenceChecker()],
  });

  expect(reports.map((report) => report.stableDetail)).toContain(
    "aarch64-object:undefined-symbols:wrela-source-object:Firmware.call",
  );
});

test("AArch64 object reference accepts externals resolved by sibling compiler objects", () => {
  const backendObject = objectModuleForLinkTest({
    moduleKey: "wrela-source-object",
    symbols: [
      globalSymbolForLinkTest({
        stableKey: "main",
        linkageName: "Boot.main",
        sectionKey: ".text",
      }),
      externalSymbolForLinkTest({ stableKey: "extern:char16", linkageName: "Firmware.char16" }),
    ],
  });
  const staticObject = objectModuleForLinkTest({
    moduleKey: "static-char16:smoke",
    symbols: [
      globalSymbolForLinkTest({
        stableKey: "char16",
        linkageName: "Firmware.char16",
        sectionKey: ".text",
      }),
    ],
  });
  const reports = runFullImageReferenceCheckers({
    input: fakeInput({
      trace: traceWithBinarySpine({
        backendObjects: [backendObject],
        staticChar16Objects: [staticObject],
        helperObjects: [objectModuleForLinkTest({ moduleKey: "helper:runtime" })],
      }),
    }),
    checkers: [aarch64ObjectReferenceChecker()],
  });

  expect(reports.map((report) => report.stableDetail)).not.toContain(
    "aarch64-object:undefined-symbols:wrela-source-object:Firmware.char16",
  );
});

test("AArch64 object reference checks static CHAR16 objects are read-only and NUL-terminated", () => {
  const staticObject = objectModuleForLinkTest({
    moduleKey: "static-char16:bad",
    sections: [dataSectionForLinkTest({ stableKey: ".data.char16", bytes: [65, 0, 66, 0] })],
  });
  const reports = runFullImageReferenceCheckers({
    input: fakeInput({
      trace: traceWithBinarySpine({
        backendObjects: [objectModuleForLinkTest({ moduleKey: "wrela-source-object" })],
        staticChar16Objects: [staticObject],
        helperObjects: [objectModuleForLinkTest({ moduleKey: "helper:runtime" })],
      }),
    }),
    checkers: [aarch64ObjectReferenceChecker()],
  });

  expect(reports.map((report) => report.stableDetail)).toContain(
    "aarch64-object:static-char16:section-not-read-only:static-char16:bad:.data.char16",
  );
  expect(reports.map((report) => report.stableDetail)).toContain(
    "aarch64-object:static-char16:not-nul-terminated:static-char16:bad:.data.char16",
  );
});

test("linked layout reference fails unresolved externals and malformed section ranges", () => {
  const layout = {
    ...linkedImageLayoutForPeCoffTest({
      sections: [
        {
          ...linkedImageLayoutForPeCoffTest().sections[0]!,
          stableKey: ".text",
          rva: 0x1000,
          virtualSizeBytes: 0,
        },
      ],
    }),
    symbols: [
      {
        symbolKey: "extern:missing",
        linkageName: "Missing.symbol",
        binding: "global",
        sourceModuleKey: "module:test",
        sectionKey: "<external>",
        contributionKey: "<external>",
        rva: 0,
        objectOffsetBytes: 0,
      },
    ],
  } as NonNullable<FullImageReferenceCheckerInput["trace"]>["binarySpine"]["linkedLayout"];
  const reports = runFullImageReferenceCheckers({
    input: fakeInput({ trace: traceWithBinarySpine({ linkedLayout: layout }) }),
    checkers: [linkedLayoutReferenceChecker()],
  });

  expect(reports.map((report) => report.stableDetail)).toContain(
    "linked-layout:section-range:invalid:.text:4096:0",
  );
  expect(reports.map((report) => report.stableDetail)).toContain(
    "linked-layout:unresolved-externals:present:Missing.symbol",
  );
});

test("PE/COFF reference reports parse failures from malformed final bytes", () => {
  const reports = runFullImageReferenceCheckers({
    input: fakeInput({
      artifact: artifactWithBytes([0, 1, 2]),
      trace: traceWithBinarySpine(),
    }),
    checkers: [peCoffReferenceChecker()],
  });

  expect(reports).toEqual([
    {
      checkerKey: "pe-coff-reference",
      status: "failed",
      stableDetail: "pe-coff:parse:failed:dos-header:truncated",
      inputAuthority: ["final-bytes", "linked-layout"],
      evidence: [
        {
          evidenceKey: "pe-parse",
          authority: "final-bytes",
          stableDetail: "parsePeCoffImage:artifact.peCoffArtifact.bytes",
        },
      ],
    },
  ]);
});

test("PE/COFF reference validates parsed final bytes against linked-layout evidence", () => {
  const layout = linkedImageLayoutForPeCoffTest({
    sections: [
      linkedSectionForReferenceTest(".text", 0x1000, 0x20, 0x60000020, [0xc0, 0x03, 0x5f, 0xd6]),
      linkedSectionForReferenceTest(
        ".pdata",
        0x2000,
        0x0c,
        0x40000040,
        [0x00, 0x10, 0x00, 0x00, 0x20, 0x10, 0x00, 0x00, 0x00, 0x30, 0x00, 0x00],
      ),
      linkedSectionForReferenceTest(".xdata", 0x3000, 0x08, 0x40000040, [0x01, 0x02, 0x03, 0x04]),
      linkedSectionForReferenceTest(".data", 0x4000, 0x10, 0xc0000040, [0xaa, 0xbb, 0xcc, 0xdd]),
    ],
  });
  const reports = runFullImageReferenceCheckers({
    input: fakeInput({
      artifact: artifactWithBytes(serializedImageBytesForParserTest()),
      trace: traceWithBinarySpine({ linkedLayout: layout }),
    }),
    checkers: [peCoffReferenceChecker()],
  });

  expect(reports.map((report) => report.stableDetail)).toEqual([
    "pe-coff:data-directories:matched:16",
    "pe-coff:entry-rva:matched:4096",
    "pe-coff:raw-sections:matched:4",
    "pe-coff:relocations:matched:0",
    "pe-coff:sizes:matched:1024:20480",
    "pe-coff:symbol-table:absent",
  ]);
});

test("passes when production UEFI TCB records match the curated golden table", () => {
  expect(FULL_IMAGE_UEFI_TCB_GOLDEN.status.badBufferSize.value).toBe(0x8000000000000004n);

  const reports = runFullImageReferenceCheckers({
    input: fakeInput({ trace: canonicalTrace() }),
    checkers: [uefiTcbGoldenReferenceChecker()],
  });

  expect(reports).toEqual([
    {
      checkerKey: "uefi-tcb-golden-reference",
      status: "passed",
      stableDetail: "uefi-tcb-golden:matched",
      inputAuthority: ["compiler-trace", "golden"],
      evidence: [
        {
          evidenceKey: "trace.target",
          authority: "compiler-trace",
          stableDetail: "uefi target TCB records",
        },
        {
          evidenceKey: "golden.fixture",
          authority: "golden",
          stableDetail: "FULL_IMAGE_UEFI_TCB_GOLDEN",
        },
      ],
    },
  ]);
});

test("reports stable golden keys when UEFI TCB records drift", () => {
  const trace = canonicalTrace();
  const driftedTrace = {
    ...trace,
    target: {
      ...trace.target,
      statusPolicy: {
        ...trace.target.statusPolicy,
        badBufferSize: efiErrorStatus(5n),
      },
      entryProfile: {
        ...trace.target.entryProfile,
        statusResultRegister: "x1",
      },
    },
  } as unknown as FullImageReferenceCheckerInput["trace"];

  const reports = runFullImageReferenceCheckers({
    input: fakeInput({ trace: driftedTrace }),
    checkers: [uefiTcbGoldenReferenceChecker()],
  });

  expect(reports.map((report) => report.stableDetail)).toEqual([
    "uefi-tcb-golden:entry-profile:statusResultRegister",
    "uefi-tcb-golden:status:badBufferSize",
  ]);
  expect(
    reports.every((report) => report.inputAuthority.join(",") === "compiler-trace,golden"),
  ).toBe(true);
  expect(reports[0]?.evidence.map((record) => record.evidenceKey)).toEqual([
    "entry-profile:statusResultRegister",
    "entry-profile:statusResultRegister",
  ]);
});

test("skips with deterministic evidence when compiler trace is unavailable", () => {
  const reports = uefiTcbGoldenReferenceChecker().run(fakeInput({ compileStatus: "failed" }));

  expect(reports).toEqual([
    {
      checkerKey: "uefi-tcb-golden-reference",
      status: "skipped",
      stableDetail: "uefi-tcb-golden:trace-missing",
      inputAuthority: ["compiler-trace", "golden"],
      evidence: [
        {
          evidenceKey: "trace.target",
          authority: "compiler-trace",
          stableDetail: "trace target unavailable",
        },
        {
          evidenceKey: "golden.fixture",
          authority: "golden",
          stableDetail: "FULL_IMAGE_UEFI_TCB_GOLDEN",
        },
      ],
    },
  ]);
});
