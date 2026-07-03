import { expect, test } from "bun:test";

import {
  compilerPackageInput,
  defaultUefiAArch64SourceRoots,
  type CompileUefiAArch64ImageTrace,
  type CompilerPackageInput,
  type UefiAArch64ImageArtifact,
} from "../../../../src/target/uefi-aarch64";
import {
  authenticateUefiAArch64TargetDriverSurface,
  canonicalUefiAArch64TargetDriverSurfaceInput,
} from "../../../../src/target/uefi-aarch64/target-driver-surface";
import { efiErrorStatus } from "../../../../src/target/uefi-aarch64/status-conversion";
import {
  defaultFullImageReferenceCheckers,
  fixtureSpecForFullImageCase,
  runFullImageReferenceCheckers,
  aarch64ObjectReferenceChecker,
  linkedLayoutReferenceChecker,
  optIrReferenceChecker,
  peCoffReferenceChecker,
  proofFactReferenceChecker,
  semanticPlatformReferenceChecker,
  stdlibSourceRootReferenceChecker,
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
  textSectionForLinkTest,
} from "../../../support/linker/aarch64-object-link-fixtures";
import { FULL_IMAGE_UEFI_TCB_GOLDEN } from "../../../support/target/uefi-aarch64/full-image-tcb-golden-fixtures";

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

test("proof fact reference passes PacketCounter when exposed proof facts cover the high-risk path", () => {
  const reports = runFullImageReferenceCheckers({
    input: packetCounterInput({
      trace: traceWithProofFacts([
        proofFact("validated-buffer-layout", "CounterPacket", "fixed-field-layout-through-byte-2"),
        proofFact("validated-buffer-layout", "CounterPacket", "payload-end"),
        proofFact("limit-check", "source.len <= limits.max_frame_bytes"),
        proofFact("validation-success", "source-consumed-into-packet"),
        proofFact("validation-error", "source-preserved-and-closed"),
        proofFact("exit-closure", "clean"),
        proofFact("platform-call-precondition", "output_string"),
      ]),
    }),
    checkers: [proofFactReferenceChecker()],
  });

  expect(reports).toEqual([
    {
      checkerKey: "proof-fact-reference",
      status: "passed",
      stableDetail: "proof-fact:packet-counter:covered",
      inputAuthority: ["compiler-trace"],
      evidence: [
        {
          evidenceKey: "exit-closure-clean",
          authority: "compiler-trace",
          stableDetail: "exit-closure:clean",
        },
        {
          evidenceKey: "fixed-field-layout-through-byte-2",
          authority: "compiler-trace",
          stableDetail: "validated-buffer-layout:CounterPacket:fixed-field-layout-through-byte-2",
        },
        {
          evidenceKey: "payload-boundary",
          authority: "compiler-trace",
          stableDetail: "validated-buffer-layout:CounterPacket:payload-end",
        },
        {
          evidenceKey: "platform-call-precondition-output-string",
          authority: "compiler-trace",
          stableDetail: "platform-call-precondition:output_string",
        },
        {
          evidenceKey: "source-length-limit",
          authority: "compiler-trace",
          stableDetail: "limit-check:source.len <= limits.max_frame_bytes",
        },
        {
          evidenceKey: "validation-error-source-closed",
          authority: "compiler-trace",
          stableDetail: "validation-error:source-preserved-and-closed",
        },
        {
          evidenceKey: "validation-success-source-consumed",
          authority: "compiler-trace",
          stableDetail: "validation-success:source-consumed-into-packet",
        },
      ],
    },
  ]);
});

test("proof fact reference fails honestly when PacketCounter proof facts are not exposed", () => {
  const reports = runFullImageReferenceCheckers({
    input: packetCounterInput({ trace: traceWithProofFacts([]) }),
    checkers: [proofFactReferenceChecker()],
  });

  expect(reports.map((report) => report.stableDetail)).toEqual([
    "proof-fact:packet-counter:missing-exposed-fact:exit-closure-clean",
    "proof-fact:packet-counter:missing-exposed-fact:fixed-field-layout-through-byte-2",
    "proof-fact:packet-counter:missing-exposed-fact:payload-boundary",
    "proof-fact:packet-counter:missing-exposed-fact:platform-call-precondition-output-string",
    "proof-fact:packet-counter:missing-exposed-fact:source-length-limit",
    "proof-fact:packet-counter:missing-exposed-fact:validation-error-source-closed",
    "proof-fact:packet-counter:missing-exposed-fact:validation-success-source-consumed",
  ]);
  expect(reports[0]?.evidence).toEqual([
    {
      evidenceKey: "missing-exposed-fact",
      authority: "compiler-trace",
      stableDetail: "exit-closure-clean",
    },
  ]);
});

test("proof fact reference does not accept layout and OptIR structure as checked PacketCounter proof", () => {
  const reports = runFullImageReferenceCheckers({
    input: packetCounterInput({
      trace: {
        packagePipeline: {
          layoutFacts: {
            computeRepresentationLayoutFactsResult: {
              facts: {
                validatedBuffers: [
                  {
                    fixedEndBytes: "2",
                    layoutFields: [
                      { name: "counter_delta", end: { value: "2" } },
                      { name: "payload", readRequires: [{ kind: "payloadEnd" }] },
                    ],
                  },
                ],
              },
            },
          },
          proofCheck: {
            checkProofAndResourcesResult: {
              kind: "ok",
              checked: {
                facts: {
                  packetSources: [{}],
                  exitClosure: [{}],
                },
              },
            },
          },
          proofMir: {
            buildProofMirResult: {
              kind: "ok",
              mir: {
                facts: [
                  {
                    kind: { kind: "layoutFits" },
                    dependsOn: [{ kind: "validatedBufferField", fieldId: 2 }],
                  },
                  { kind: { kind: "payloadEnd" } },
                ],
                functions: [{ edges: [{ kind: "validationErr" }] }],
              },
            },
          },
          optIr: {
            operations: [
              optIrOperation("platformCall", {
                target: { kind: "platform", platformKey: "uefi.console.outputString" },
              }),
            ],
          },
        },
      } as unknown as FullImageReferenceCheckerInput["trace"],
    }),
    checkers: [proofFactReferenceChecker()],
  });

  expect(reports.map((report) => report.stableDetail)).toContain(
    "proof-fact:packet-counter:missing-exposed-fact:platform-call-precondition-output-string",
  );
  expect(reports.map((report) => report.stableDetail)).toContain(
    "proof-fact:packet-counter:missing-exposed-fact:source-length-limit",
  );
});

test("proof fact reference uses console policy for smoke-console scenarios", () => {
  const reports = runFullImageReferenceCheckers({
    input: fakeInput({
      trace: traceWithProofFacts([
        {
          packetKind: "exitClosure",
          subjectKey: "place:entry",
          typedAnswers: ["terminalBehavior"],
        },
        proofFact(
          "platform-call-precondition",
          "output_string",
          "output_string|uefi.console.outputString",
        ),
      ]),
    }),
    checkers: [proofFactReferenceChecker()],
  });

  expect(reports).toEqual([
    {
      checkerKey: "proof-fact-reference",
      status: "passed",
      stableDetail: "proof-fact:smoke-console:covered",
      inputAuthority: ["compiler-trace"],
      evidence: [
        {
          evidenceKey: "exit-closure-terminal",
          authority: "compiler-trace",
          stableDetail: "exit-closure:place:entry:terminalBehavior",
        },
        {
          evidenceKey: "platform-call-precondition-output-string",
          authority: "compiler-trace",
          stableDetail:
            "platform-call-precondition:output_string:output_string|uefi.console.outputString",
        },
      ],
    },
  ]);
});

test("proof fact reference uses narrower status-error policy without requiring entry ownership", () => {
  const reports = runFullImageReferenceCheckers({
    input: scenarioInput("status-error", {
      trace: traceWithProofFacts([
        { packetKind: "exitClosure", subjectKey: "function-exit", typedAnswers: ["clean"] },
      ]),
    }),
    checkers: [proofFactReferenceChecker()],
  });

  expect(reports.map((report) => report.stableDetail)).toEqual(["proof-fact:status-error:covered"]);
});

test("OptIR reference passes PacketCounter when optimized operations expose required coverage", () => {
  const reports = runFullImageReferenceCheckers({
    input: packetCounterInput({
      trace: traceWithOptIr({
        operations: [
          optIrOperation("memoryLoad", { displayName: "packet.counter.low" }),
          optIrOperation("memoryLoad", { displayName: "packet.counter.high" }),
          optIrOperation("integerBinary", { operator: "add" }),
          optIrOperation("integerCompare", {
            operator: "unsignedLessThanOrEqual",
          }),
          optIrOperation("platformCall", {
            target: { primitiveId: "uefi.console.outputString" },
          }),
        ],
        staticChar16Strings: [{ stableKey: "packet-ok", text: "WRELA_PACKET_COUNTER_OK\r\n" }],
        diagnostics: [],
      }),
    }),
    checkers: [optIrReferenceChecker()],
  });

  expect(reports).toEqual([
    {
      checkerKey: "opt-ir-reference",
      status: "passed",
      stableDetail: "opt-ir:packet-counter:covered",
      inputAuthority: ["compiler-trace"],
      evidence: [
        {
          evidenceKey: "integer-binary-operations",
          authority: "compiler-trace",
          stableDetail: "count:1",
        },
        {
          evidenceKey: "integer-compare-operations",
          authority: "compiler-trace",
          stableDetail: "count:1",
        },
        {
          evidenceKey: "packet-memory-loads",
          authority: "compiler-trace",
          stableDetail: "count:2",
        },
        {
          evidenceKey: "static-char16-marker:WRELA_PACKET_COUNTER_OK",
          authority: "compiler-trace",
          stableDetail: "packet-ok:WRELA_PACKET_COUNTER_OK\\r\\n",
        },
        {
          evidenceKey: "uefi-console-platform-call",
          authority: "compiler-trace",
          stableDetail: "uefi.console.outputString",
        },
        {
          evidenceKey: "unsupported-operation-diagnostics",
          authority: "compiler-trace",
          stableDetail: "count:0",
        },
      ],
    },
  ]);
});

test("OptIR reference fails PacketCounter missing exposed OptIR operation coverage", () => {
  const reports = runFullImageReferenceCheckers({
    input: packetCounterInput({
      trace: traceWithOptIr({
        operations: [
          optIrOperation("platformCall", {
            target: { primitiveId: "uefi.console.outputString" },
          }),
        ],
        staticChar16Strings: [],
      }),
    }),
    checkers: [optIrReferenceChecker()],
  });

  expect(reports.map((report) => report.stableDetail)).toEqual([
    "opt-ir:packet-counter:missing-exposed-fact:integer-binary-operations",
    "opt-ir:packet-counter:missing-exposed-fact:integer-compare-operations",
    "opt-ir:packet-counter:missing-exposed-fact:packet-memory-loads",
    "opt-ir:packet-counter:missing-exposed-fact:static-char16-marker:WRELA_PACKET_COUNTER_OK",
  ]);
});

test("OptIR reference ignores Proof-MIR operations when checking optimized coverage", () => {
  const reports = runFullImageReferenceCheckers({
    input: packetCounterInput({
      trace: {
        packagePipeline: {
          optIr: {
            operations: [],
            program: { diagnostics: [] },
            staticChar16Strings: [{ stableKey: "packet-ok", text: "WRELA_PACKET_COUNTER_OK\r\n" }],
          },
          proofMir: {
            buildProofMirResult: {
              mir: {
                functions: [
                  {
                    blocks: [
                      {
                        statements: [
                          { kind: { kind: "readValidatedBufferField", read: { field: "kind" } } },
                          {
                            kind: {
                              kind: "readValidatedBufferField",
                              read: { field: "counter_delta" },
                            },
                          },
                          { kind: { kind: "binary", operator: "add" } },
                          { kind: { kind: "comparison", operator: "lte" } },
                          {
                            kind: {
                              kind: "call",
                              call: { target: { primitiveId: "uefi.console.outputString" } },
                            },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          },
        },
      } as unknown as FullImageReferenceCheckerInput["trace"],
    }),
    checkers: [optIrReferenceChecker()],
  });

  expect(reports.map((report) => report.stableDetail)).toEqual([
    "opt-ir:packet-counter:missing-exposed-fact:integer-binary-operations",
    "opt-ir:packet-counter:missing-exposed-fact:integer-compare-operations",
    "opt-ir:packet-counter:missing-exposed-fact:packet-memory-loads",
    "opt-ir:packet-counter:missing-exposed-fact:uefi-console-platform-call",
  ]);
});

test("OptIR reference ignores unoptimized operations when checking optimized coverage", () => {
  const reports = runFullImageReferenceCheckers({
    input: packetCounterInput({
      trace: {
        packagePipeline: {
          optIr: {
            operations: [],
            unoptimizedOperations: [
              optIrOperation("memoryLoad", { displayName: "packet.counter.low" }),
              optIrOperation("memoryLoad", { displayName: "packet.counter.high" }),
              optIrOperation("integerBinary"),
              optIrOperation("integerCompare"),
              optIrOperation("platformCall", {
                target: { primitiveId: "uefi.console.outputString" },
              }),
            ],
            staticChar16Strings: [{ stableKey: "packet-ok", text: "WRELA_PACKET_COUNTER_OK\r\n" }],
            diagnostics: [],
          },
        },
      } as unknown as FullImageReferenceCheckerInput["trace"],
    }),
    checkers: [optIrReferenceChecker()],
  });

  expect(reports.map((report) => report.stableDetail)).toEqual([
    "opt-ir:packet-counter:missing-exposed-fact:integer-binary-operations",
    "opt-ir:packet-counter:missing-exposed-fact:integer-compare-operations",
    "opt-ir:packet-counter:missing-exposed-fact:packet-memory-loads",
    "opt-ir:packet-counter:missing-exposed-fact:uefi-console-platform-call",
  ]);
});

test("OptIR reference uses smoke marker and platform-call policy for smoke-console", () => {
  const reports = runFullImageReferenceCheckers({
    input: fakeInput({
      trace: traceWithOptIr({
        operations: [
          optIrOperation("platformCall", {
            target: { kind: "platform", platformKey: "uefi.console.outputString" },
          }),
        ],
        staticChar16Strings: [
          {
            stableKey: "smoke-ok",
            codeUnits: [..."WRELA_UEFI_SMOKE_OK\r\n"]
              .map((character) => character.charCodeAt(0))
              .concat(0),
          },
        ],
      }),
    }),
    checkers: [optIrReferenceChecker()],
  });

  expect(reports.map((report) => report.stableDetail)).toEqual(["opt-ir:smoke-console:covered"]);
});

test("OptIR reference uses status constant policy for status-error", () => {
  const reports = runFullImageReferenceCheckers({
    input: scenarioInput("status-error", {
      trace: traceWithOptIr({
        operations: [
          optIrOperation("constant", {
            constant: { kind: "integer", normalizedValue: 4n },
          }),
        ],
        staticChar16Strings: [],
      }),
    }),
    checkers: [optIrReferenceChecker()],
  });

  expect(reports.map((report) => report.stableDetail)).toEqual(["opt-ir:status-error:covered"]);
});

test("OptIR reference uses watchdog platform-call policy for watchdog scenarios", () => {
  const reports = runFullImageReferenceCheckers({
    input: scenarioInput("watchdog-or-boot-policy", {
      trace: traceWithOptIr({
        operations: [
          optIrOperation("platformCall", {
            target: { kind: "platform", platformKey: "uefi.boot.setWatchdogTimer" },
          }),
        ],
        staticChar16Strings: [],
      }),
    }),
    checkers: [optIrReferenceChecker()],
  });

  expect(reports.map((report) => report.stableDetail)).toEqual([
    "opt-ir:watchdog-or-boot-policy:covered",
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

test("stdlib source-root reference rejects direct-platform packages with stdlib modules", () => {
  const reports = runFullImageReferenceCheckers({
    input: task20ReferenceInput({
      stdlibMode: "direct-platform",
      packageInput: task20PackageInput({
        sourceRoots: defaultUefiAArch64SourceRoots({
          projectSourceRoot: "src",
          stdlibMode: "none",
        }),
        sourceFiles: [
          {
            sourceKey: "src/image.wr",
            moduleName: "image",
            text: "platform fn output_string(message: Utf16Static) -> UefiStatus\n",
          },
          {
            sourceKey: "src/wrela-std/target/uefi/console.wr",
            moduleName: "wrela_std.target.uefi.console",
            text: "platform fn output_string(message: Utf16Static) -> UefiStatus\n",
          },
        ],
      }),
      reachablePlatformPrimitiveIds: ["uefi.console.outputString"],
    }),
    checkers: [stdlibSourceRootReferenceChecker(), semanticPlatformReferenceChecker()],
  });

  expect(reports).toContainEqual({
    checkerKey: "stdlib-source-root-reference",
    status: "failed",
    stableDetail: "stdlib-source-root:direct-platform:unexpected-wrela-std-modules:1",
    inputAuthority: ["source-package"],
    evidence: [
      {
        evidenceKey: "expected-source-root-shape",
        authority: "source-package",
        stableDetail: "direct-platform:project:src",
      },
      {
        evidenceKey: "wrela-std-modules",
        authority: "source-package",
        stableDetail: "wrela_std.target.uefi.console",
      },
    ],
  });
});

test("stdlib source-root reference rejects ejected stdlib packages using toolchain root", () => {
  const reports = runFullImageReferenceCheckers({
    input: task20ReferenceInput({
      stdlibMode: "ejected-stdlib",
      packageInput: task20PackageInput({
        sourceRoots: defaultUefiAArch64SourceRoots({
          projectSourceRoot: "src",
        }),
        sourceFiles: [
          {
            sourceKey: "src/image.wr",
            moduleName: "image",
            text: "use write_smoke_marker from wrela_std.target.uefi.console\n",
          },
          {
            sourceKey: "stdlib/wrela-std/target/uefi/console.wr",
            moduleName: "wrela_std.target.uefi.console",
            text: "platform fn output_string(message: Utf16Static) -> UefiStatus\n",
          },
        ],
      }),
      reachablePlatformPrimitiveIds: ["uefi.console.outputString"],
    }),
    checkers: [stdlibSourceRootReferenceChecker(), semanticPlatformReferenceChecker()],
  });

  expect(reports).toContainEqual({
    checkerKey: "stdlib-source-root-reference",
    status: "failed",
    stableDetail: "stdlib-source-root:ejected-stdlib:unexpected-toolchain-root:toolchain-wrela-std",
    inputAuthority: ["source-package"],
    evidence: [
      {
        evidenceKey: "actual-source-root-shape",
        authority: "source-package",
        stableDetail: "project:src,toolchain:stdlib/wrela-std",
      },
      {
        evidenceKey: "expected-source-root-shape",
        authority: "source-package",
        stableDetail: "ejected-stdlib:project:src,project:src/wrela-std",
      },
    ],
  });
});

test("stdlib source-root reference rejects shipped stdlib packages without toolchain stdlib root", () => {
  const reports = runFullImageReferenceCheckers({
    input: task20ReferenceInput({
      stdlibMode: "toolchain-stdlib",
      packageInput: task20PackageInput({
        sourceRoots: defaultUefiAArch64SourceRoots({
          projectSourceRoot: "src",
          stdlibMode: "none",
        }),
        sourceFiles: [
          {
            sourceKey: "src/image.wr",
            moduleName: "image",
            text: "use write_smoke_marker from wrela_std.target.uefi.console\n",
          },
        ],
      }),
      reachablePlatformPrimitiveIds: ["uefi.console.outputString"],
    }),
    checkers: [stdlibSourceRootReferenceChecker(), semanticPlatformReferenceChecker()],
  });

  expect(reports.find((report) => report.checkerKey === "stdlib-source-root-reference")).toEqual({
    checkerKey: "stdlib-source-root-reference",
    status: "failed",
    stableDetail: "stdlib-source-root:toolchain-stdlib:missing-toolchain-stdlib-root",
    inputAuthority: ["source-package"],
    evidence: [
      {
        evidenceKey: "actual-source-root-shape",
        authority: "source-package",
        stableDetail: "project:src",
      },
      {
        evidenceKey: "expected-source-root-shape",
        authority: "source-package",
        stableDetail: "toolchain-stdlib:project:src,toolchain:stdlib/wrela-std",
      },
    ],
  });
});

test("semantic platform reference checks scenario reachable primitive ids", () => {
  const reports = runFullImageReferenceCheckers({
    input: task20ReferenceInput({
      scenario: "packet-counter",
      stdlibMode: "direct-platform",
      packageInput: task20PackageInput({
        sourceRoots: defaultUefiAArch64SourceRoots({
          projectSourceRoot: "src",
          stdlibMode: "none",
        }),
        sourceFiles: [
          {
            sourceKey: "src/image.wr",
            moduleName: "image",
            text: [
              "platform fn output_string(message: Utf16Static) -> UefiStatus",
              "platform fn validation_fixture_packet_source() -> U64",
            ].join("\n"),
          },
        ],
      }),
      reachablePlatformPrimitiveIds: ["uefi.console.outputString"],
    }),
    checkers: [stdlibSourceRootReferenceChecker(), semanticPlatformReferenceChecker()],
  });

  expect(reports).toContainEqual({
    checkerKey: "semantic-platform-reference",
    status: "failed",
    stableDetail:
      "semantic-platform:reachable:mismatch:missing:uefi.validation.fixturePacketSource",
    inputAuthority: ["compiler-trace", "source-package"],
    evidence: [
      {
        evidenceKey: "expected-reachable-primitives",
        authority: "compiler-trace",
        stableDetail: "uefi.console.outputString,uefi.validation.fixturePacketSource",
      },
      {
        evidenceKey: "reachable-platform-primitives",
        authority: "compiler-trace",
        stableDetail: "uefi.console.outputString",
      },
      {
        evidenceKey: "declared-platform-primitives",
        authority: "source-package",
        stableDetail:
          "output_string=uefi.console.outputString,validation_fixture_packet_source=uefi.validation.fixturePacketSource",
      },
    ],
  });
});

test("semantic platform reference rejects direct-platform unknown primitive declarations", () => {
  const reports = runFullImageReferenceCheckers({
    input: task20ReferenceInput({
      stdlibMode: "direct-platform",
      packageInput: task20PackageInput({
        sourceRoots: defaultUefiAArch64SourceRoots({
          projectSourceRoot: "src",
          stdlibMode: "none",
        }),
        sourceFiles: [
          {
            sourceKey: "src/image.wr",
            moduleName: "image",
            text: "platform fn mystery_firmware_call() -> UefiStatus\n",
          },
        ],
      }),
      reachablePlatformPrimitiveIds: [],
    }),
    checkers: [stdlibSourceRootReferenceChecker(), semanticPlatformReferenceChecker()],
  });

  expect(reports).toContainEqual({
    checkerKey: "semantic-platform-reference",
    status: "failed",
    stableDetail:
      "semantic-platform:direct-platform:unknown-platform-primitive:mystery_firmware_call",
    inputAuthority: ["compiler-trace", "source-package"],
    evidence: [
      {
        evidenceKey: "uefi-platform-primitive-name-catalog",
        authority: "compiler-trace",
        stableDetail:
          "exit_boot_services_with_fresh_map=uefi.boot.exitBootServices,output_string=uefi.console.outputString,set_watchdog_timer=uefi.boot.setWatchdogTimer,validation_fixture_packet_source=uefi.validation.fixturePacketSource",
      },
      {
        evidenceKey: "declared-platform-primitives",
        authority: "source-package",
        stableDetail: "mystery_firmware_call=<unknown>",
      },
    ],
  });
});

test("semantic platform reference accepts status-error cases without reachable primitives", () => {
  const reports = runFullImageReferenceCheckers({
    input: task20ReferenceInput({
      scenario: "status-error",
      stdlibMode: "toolchain-stdlib",
      packageInput: task20PackageInput({
        sourceRoots: defaultUefiAArch64SourceRoots({
          projectSourceRoot: "src",
        }),
        sourceFiles: [
          {
            sourceKey: "src/image.wr",
            moduleName: "image",
            text: "use UefiStatus from wrela_std.target.uefi.status\n",
          },
          {
            sourceKey: "stdlib/wrela-std/target/uefi/status.wr",
            moduleName: "wrela_std.target.uefi.status",
            text: "enum UefiStatus:\n    success\n    bad_buffer_size\n",
          },
        ],
      }),
      reachablePlatformPrimitiveIds: [],
    }),
    checkers: [stdlibSourceRootReferenceChecker(), semanticPlatformReferenceChecker()],
  });

  expect(reports).toContainEqual({
    checkerKey: "semantic-platform-reference",
    status: "passed",
    stableDetail: "semantic-platform:reachable:",
    inputAuthority: ["compiler-trace", "source-package"],
    evidence: [
      {
        evidenceKey: "expected-reachable-primitives",
        authority: "compiler-trace",
        stableDetail: "",
      },
      {
        evidenceKey: "reachable-platform-primitives",
        authority: "compiler-trace",
        stableDetail: "",
      },
      {
        evidenceKey: "declared-platform-primitives",
        authority: "source-package",
        stableDetail: "",
      },
    ],
  });
});

test("semantic platform reference passes for matching smoke-console source and trace metadata", () => {
  const source = task20PackageInput({
    sourceRoots: defaultUefiAArch64SourceRoots({
      projectSourceRoot: "src",
      stdlibMode: "none",
    }),
    sourceFiles: [
      {
        sourceKey: "src/image.wr",
        moduleName: "image",
        text: [
          "enum UefiStatus:",
          "    success",
          "    bad_buffer_size",
          "",
          "platform fn output_string(message: Utf16Static) -> UefiStatus",
          "",
          "uefi image SmokeConsoleImage:",
          "",
          "fn boot() -> UefiStatus:",
          '    output_string(utf16_static("WRELA_UEFI_SMOKE_OK\\r\\n"))',
        ].join("\n"),
      },
    ],
  });

  const reports = runFullImageReferenceCheckers({
    input: task20ReferenceInput({
      stdlibMode: "direct-platform",
      packageInput: source,
      reachablePlatformPrimitiveIds: ["uefi.console.outputString"],
    }),
    checkers: [stdlibSourceRootReferenceChecker(), semanticPlatformReferenceChecker()],
  });

  expect(reports).toContainEqual({
    checkerKey: "semantic-platform-reference",
    status: "passed",
    stableDetail: "semantic-platform:reachable:uefi.console.outputString",
    inputAuthority: ["compiler-trace", "source-package"],
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
      {
        evidenceKey: "declared-platform-primitives",
        authority: "source-package",
        stableDetail: "output_string=uefi.console.outputString",
      },
    ],
  });
});

function canonicalTrace(): NonNullable<FullImageReferenceCheckerInput["trace"]> {
  const target = authenticateUefiAArch64TargetDriverSurface(
    canonicalUefiAArch64TargetDriverSurfaceInput(),
  );
  if (target.kind === "error") {
    throw new Error(target.diagnostics.map((diagnostic) => diagnostic.stableDetail).join(","));
  }
  return {
    target: target.value,
    packagePipeline: {} as NonNullable<FullImageReferenceCheckerInput["trace"]>["packagePipeline"],
    binarySpine: {} as NonNullable<FullImageReferenceCheckerInput["trace"]>["binarySpine"],
  };
}

function fakeInput(
  input: {
    readonly compileStatus?: FullImageReferenceCheckerInput["compileStatus"];
    readonly trace?: FullImageReferenceCheckerInput["trace"];
    readonly artifact?: FullImageReferenceCheckerInput["artifact"];
  } = {},
): FullImageReferenceCheckerInput {
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
      packageKey: "full-image-validation:smoke-console/toolchain-stdlib",
      sourceRoots: [],
      sourceFiles: [],
      entryModuleName: "image",
      enabledTargetFeatures: [],
    },
    compileStatus: input.compileStatus ?? "passed",
    trace: input.trace,
    artifact: input.artifact,
  };
}

function traceWithBinarySpine(
  input: {
    readonly backendObjects?: NonNullable<
      FullImageReferenceCheckerInput["trace"]
    >["binarySpine"]["backendObjects"];
    readonly staticChar16Objects?: NonNullable<
      FullImageReferenceCheckerInput["trace"]
    >["binarySpine"]["staticChar16Objects"];
    readonly validationFixtureObjects?: NonNullable<
      FullImageReferenceCheckerInput["trace"]
    >["binarySpine"]["validationFixtureObjects"];
    readonly helperObjects?: NonNullable<
      FullImageReferenceCheckerInput["trace"]
    >["binarySpine"]["helperObjects"];
    readonly linkedLayout?: NonNullable<
      FullImageReferenceCheckerInput["trace"]
    >["binarySpine"]["linkedLayout"];
  } = {},
): FullImageReferenceCheckerInput["trace"] {
  return {
    ...canonicalTrace(),
    binarySpine: {
      stages: [],
      backendObjects: input.backendObjects ?? [
        objectModuleForLinkTest({ moduleKey: "wrela-source-object" }),
      ],
      staticChar16Objects: input.staticChar16Objects ?? [
        objectModuleForLinkTest({
          moduleKey: "static-char16:smoke",
          sections: [textSectionForLinkTest({ stableKey: ".rdata.char16", bytes: [0, 0] })],
        }),
      ],
      validationFixtureObjects: input.validationFixtureObjects ?? [],
      helperObjects: input.helperObjects ?? [
        objectModuleForLinkTest({ moduleKey: "helper:runtime" }),
      ],
      linkedLayout: input.linkedLayout ?? linkedImageLayoutForPeCoffTest(),
      peCoffArtifact: {
        artifactName: "smoke-console-toolchain-stdlib.efi",
        mediaType: "application/vnd.microsoft.portable-executable",
        fileExtension: ".efi",
        bytes: serializedImageBytesForParserTest(),
        deterministicMetadata: peCoffMetadataForReferenceTest(),
        verification: { runs: [] },
      },
      entryThunkFingerprint: "fixture:entry-thunk",
    },
  } as unknown as FullImageReferenceCheckerInput["trace"];
}

function artifactWithBytes(bytes: readonly number[]): UefiAArch64ImageArtifact {
  return {
    artifactName: "smoke-console-toolchain-stdlib.efi",
    peCoffArtifact: {
      artifactName: "smoke-console-toolchain-stdlib.efi",
      mediaType: "application/vnd.microsoft.portable-executable",
      fileExtension: ".efi",
      bytes,
      deterministicMetadata: peCoffMetadataForReferenceTest(),
      verification: { runs: [] },
    },
    targetMetadata: {
      schema: "wrela.uefi-aarch64-image",
      schemaVersion: 1,
      targetDriverFingerprint: "fixture:target-driver",
      aarch64TargetFingerprint: "fixture:aarch64",
      backendTargetFingerprint: "fixture:backend",
      linkerTargetFingerprint: "fixture:linker",
      peCoffWriterTargetFingerprint: "fixture:pe",
      semanticPlatformCatalogFingerprint: "fixture:semantic",
      proofMirRuntimeCatalogFingerprint: "fixture:proof",
      entryThunkFingerprint: "fixture:entry",
      firmwareAbiFingerprint: "fixture:firmware",
      statusPolicyFingerprint: "fixture:status",
      watchdogPolicyFingerprint: "fixture:watchdog",
      peCoffImageFingerprint: "fixture:image",
      finalImageFingerprint: "fixture:final",
    },
    smoke: {
      status: "disabled",
      stableDetail: "qemu-smoke:disabled",
      observedMarkers: [],
      targetDriverFingerprint: "fixture:target-driver",
    },
  };
}

function peCoffMetadataForReferenceTest(): UefiAArch64ImageArtifact["peCoffArtifact"]["deterministicMetadata"] {
  return {
    schema: "wrela.pe-coff-efi-image",
    schemaVersion: 1,
    linkedLayoutFingerprint: "fixture:layout",
    writerTargetFingerprint: "fixture:writer",
    sectionTableFingerprint: "fixture:sections",
    dataDirectoryFingerprint: "fixture:directories",
    baseRelocationTableFingerprint: "fixture:relocations",
    headerFingerprint: "fixture:headers",
    imageFingerprint: "fixture:image",
  };
}

function linkedSectionForReferenceTest(
  stableKey: string,
  rva: number,
  virtualSizeBytes: number,
  flags: number,
  bytes: readonly number[],
): ReturnType<typeof linkedImageLayoutForPeCoffTest>["sections"][number] {
  return {
    stableKey,
    classKey: stableKey,
    flags,
    alignmentBytes: 4096,
    rva,
    virtualSizeBytes,
    bytes,
    contributions: [
      {
        stableKey: `contribution:${stableKey}`,
        sourceModuleKey: "module:test",
        sourceObjectSectionKey: stableKey,
        sourceObjectSectionClass: stableKey,
        outputSectionKey: stableKey,
        offsetBytes: 0,
        sizeBytes: virtualSizeBytes,
        alignmentBytes: 1,
      },
    ],
  };
}

function task20ReferenceInput(input: {
  readonly scenario?: FullImageReferenceCheckerInput["scenario"];
  readonly stdlibMode: FullImageReferenceCheckerInput["stdlibMode"];
  readonly packageInput: CompilerPackageInput;
  readonly reachablePlatformPrimitiveIds?: readonly string[];
  readonly trace?: CompileUefiAArch64ImageTrace;
}): FullImageReferenceCheckerInput {
  const scenario = input.scenario ?? "smoke-console";
  const fixtureSpec = fixtureSpecForFullImageCase({
    scenario,
    stdlibMode: input.stdlibMode,
  });
  return {
    caseKey: `${scenario}/${input.stdlibMode}`,
    scenario,
    stdlibMode: input.stdlibMode,
    fixtureSpec,
    packageInput: input.packageInput,
    compileStatus: "passed",
    trace:
      input.trace ??
      ({
        packagePipeline: {
          reachablePlatformPrimitiveIds: input.reachablePlatformPrimitiveIds ?? [],
        },
      } as CompileUefiAArch64ImageTrace),
  };
}

function task20PackageInput(input: {
  readonly sourceRoots: CompilerPackageInput["sourceRoots"];
  readonly sourceFiles: CompilerPackageInput["sourceFiles"];
}): CompilerPackageInput {
  const result = compilerPackageInput({
    packageKey: "full-image-validation:test",
    entryModuleName: "image",
    enabledTargetFeatures: [],
    sourceRoots: input.sourceRoots,
    sourceFiles: input.sourceFiles,
  });
  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("test package input failed");
  return result.value;
}

function packetCounterInput(input: {
  readonly trace?: FullImageReferenceCheckerInput["trace"];
}): FullImageReferenceCheckerInput {
  const fixtureSpec = fixtureSpecForFullImageCase({
    scenario: "packet-counter",
    stdlibMode: "toolchain-stdlib",
  });
  return {
    ...fakeInput(input),
    caseKey: "packet-counter/toolchain-stdlib",
    scenario: "packet-counter",
    fixtureSpec,
  };
}

function scenarioInput(
  scenario: FullImageReferenceCheckerInput["scenario"],
  input: {
    readonly trace?: FullImageReferenceCheckerInput["trace"];
    readonly compileStatus?: FullImageReferenceCheckerInput["compileStatus"];
  },
): FullImageReferenceCheckerInput {
  const fixtureSpec = fixtureSpecForFullImageCase({
    scenario,
    stdlibMode: "toolchain-stdlib",
  });
  return {
    ...fakeInput(input),
    caseKey: `${scenario}/toolchain-stdlib`,
    scenario,
    fixtureSpec,
  };
}

function traceWithProofFacts(facts: readonly unknown[]): FullImageReferenceCheckerInput["trace"] {
  return {
    packagePipeline: {
      proofCheck: {
        checkProofAndResourcesResult: {
          kind: "ok",
          factPacket: { facts },
        },
      },
      proofMir: {
        buildProofMirResult: {
          kind: "ok",
          layoutReferences: facts,
        },
      },
    },
  } as unknown as FullImageReferenceCheckerInput["trace"];
}

function proofFact(family: string, subject: string, detail = ""): unknown {
  return { family, subject, detail };
}

function traceWithOptIr(input: {
  readonly operations: readonly unknown[];
  readonly staticChar16Strings: readonly unknown[];
  readonly diagnostics?: readonly unknown[];
}): FullImageReferenceCheckerInput["trace"] {
  return {
    packagePipeline: {
      optIr: {
        operations: input.operations,
        program: { diagnostics: input.diagnostics ?? [] },
        facts: { records: [] },
        staticChar16Strings: input.staticChar16Strings,
      },
    },
  } as unknown as FullImageReferenceCheckerInput["trace"];
}

function optIrOperation(kind: string, fields: Readonly<Record<string, unknown>> = {}): unknown {
  return { kind, ...fields };
}
