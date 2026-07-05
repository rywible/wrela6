import { expect, test } from "bun:test";

import {
  runFullImageReferenceCheckers,
  optIrReferenceChecker,
  proofFactReferenceChecker,
  type FullImageReferenceCheckerInput,
} from "../../../../src/validation/full-image";
import {
  fakeInput,
  optIrOperation,
  packetCounterInput,
  proofFact,
  scenarioInput,
  traceWithOptIr,
  traceWithProofFacts,
} from "./reference-checkers-fixtures";

test("proof fact reference passes PacketCounter when exposed proof facts cover the high-risk path", () => {
  const reports = runFullImageReferenceCheckers({
    input: packetCounterInput({
      trace: traceWithProofFacts([
        proofFact("validated-buffer-layout", "CounterPacket", "fixed-field-layout-through-byte-2"),
        proofFact("validated-buffer-layout", "CounterPacket", "payload-end"),
        proofFact("limit-check", "source.len <= limits.max_frame_bytes"),
        proofFact("validation-success", "CounterPacket", "validated-buffer-authority"),
        proofFact("exit-closure", "clean"),
        proofFact("platform-call-precondition", "output_string"),
        proofFact("platform-call-precondition", "uefi.source.reserveRestrictedMemory"),
        proofFact("platform-call-precondition", "uefi.source.discoverVirtio"),
        proofFact("platform-call-precondition", "uefi.source.bindVirtioNet"),
        proofFact("platform-call-precondition", "uefi.source.planMachine"),
        proofFact("platform-call-precondition", "uefi.source.exitBootServices"),
        proofFact("platform-call-precondition", "uefi.source.splitNetworkDevice"),
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
          evidenceKey: "platform-call-precondition-bind-virtio-net",
          authority: "compiler-trace",
          stableDetail: "platform-call-precondition:uefi.source.bindVirtioNet",
        },
        {
          evidenceKey: "platform-call-precondition-discover-virtio",
          authority: "compiler-trace",
          stableDetail: "platform-call-precondition:uefi.source.discoverVirtio",
        },
        {
          evidenceKey: "platform-call-precondition-exit-boot-services",
          authority: "compiler-trace",
          stableDetail: "platform-call-precondition:uefi.source.exitBootServices",
        },
        {
          evidenceKey: "platform-call-precondition-output-string",
          authority: "compiler-trace",
          stableDetail: "platform-call-precondition:output_string",
        },
        {
          evidenceKey: "platform-call-precondition-plan-machine",
          authority: "compiler-trace",
          stableDetail: "platform-call-precondition:uefi.source.planMachine",
        },
        {
          evidenceKey: "platform-call-precondition-reserve-restricted-memory",
          authority: "compiler-trace",
          stableDetail: "platform-call-precondition:uefi.source.reserveRestrictedMemory",
        },
        {
          evidenceKey: "platform-call-precondition-split-network-device",
          authority: "compiler-trace",
          stableDetail: "platform-call-precondition:uefi.source.splitNetworkDevice",
        },
        {
          evidenceKey: "source-length-limit",
          authority: "compiler-trace",
          stableDetail: "limit-check:source.len <= limits.max_frame_bytes",
        },
        {
          evidenceKey: "validation-success-packet-authority",
          authority: "compiler-trace",
          stableDetail: "validation-success:CounterPacket:validated-buffer-authority",
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
    "proof-fact:packet-counter:missing-exposed-fact:platform-call-precondition-bind-virtio-net",
    "proof-fact:packet-counter:missing-exposed-fact:platform-call-precondition-discover-virtio",
    "proof-fact:packet-counter:missing-exposed-fact:platform-call-precondition-exit-boot-services",
    "proof-fact:packet-counter:missing-exposed-fact:platform-call-precondition-output-string",
    "proof-fact:packet-counter:missing-exposed-fact:platform-call-precondition-plan-machine",
    "proof-fact:packet-counter:missing-exposed-fact:platform-call-precondition-reserve-restricted-memory",
    "proof-fact:packet-counter:missing-exposed-fact:platform-call-precondition-split-network-device",
    "proof-fact:packet-counter:missing-exposed-fact:source-length-limit",
    "proof-fact:packet-counter:missing-exposed-fact:validation-success-packet-authority",
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

test("proof fact reference accepts checked validated-buffer layout evidence", () => {
  const platformPreconditionExtensions = [
    "uefi.console.outputString",
    "uefi.source.reserveRestrictedMemory",
    "uefi.source.discoverVirtio",
    "uefi.source.bindVirtioNet",
    "uefi.source.planMachine",
    "uefi.source.exitBootServices",
    "uefi.source.splitNetworkDevice",
  ].map((primitiveId) => ({
    extensionKey: "platform-call-precondition",
    payload: {
      primitiveId,
      authorityKey: "uefi",
      preconditionKeys: ["boot-services"],
    },
  }));

  const reports = runFullImageReferenceCheckers({
    input: packetCounterInput({
      trace: {
        packagePipeline: {
          layoutFacts: {
            computeRepresentationLayoutFactsResult: {
              facts: {
                validatedBuffers: [
                  {
                    instanceId: "type:3|args:<>",
                    layoutFields: [
                      {
                        name: "counter_delta",
                        end: { kind: "constant", value: "2" },
                        readRequires: [
                          {
                            kind: "layoutFits",
                            end: { kind: "constant", value: "2" },
                          },
                        ],
                      },
                      {
                        name: "payload",
                        readRequires: [{ kind: "payloadEnd", end: { kind: "add" } }],
                      },
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
                  validatedBuffers: [
                    {
                      kind: "validatedBuffer",
                      dependencies: [{ kind: "layoutFact", layoutKey: "type:3|args:<>" }],
                    },
                  ],
                  packetSources: [{}],
                  exitClosure: [{}],
                  extensions: platformPreconditionExtensions,
                },
              },
            },
          },
          proofMir: {
            buildProofMirResult: {
              kind: "ok",
              mir: {
                facts: [],
                functions: [{ edges: [{ kind: "validationErr" }] }],
              },
            },
          },
        },
      } as unknown as FullImageReferenceCheckerInput["trace"],
    }),
    checkers: [proofFactReferenceChecker()],
  });

  expect(reports).toHaveLength(1);
  expect(reports[0]?.status).toBe("passed");
  expect(reports[0]?.evidence).toContainEqual({
    evidenceKey: "fixed-field-layout-through-byte-2",
    authority: "compiler-trace",
    stableDetail:
      "validated-buffer-layout:CounterPacket:fixed-field-layout-through-byte-2|checked-validated-buffer-layout:type:3|args:<>",
  });
  expect(reports[0]?.evidence).toContainEqual({
    evidenceKey: "payload-boundary",
    authority: "compiler-trace",
    stableDetail:
      "validated-buffer-layout:CounterPacket:payload-end|dynamic-payload-boundary|checked-validated-buffer-layout:type:3|args:<>",
  });
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
          optIrOperation("platformCall", {
            target: { primitiveId: "uefi.source.reserveRestrictedMemory" },
          }),
          optIrOperation("platformCall", {
            target: { primitiveId: "uefi.source.discoverVirtio" },
          }),
          optIrOperation("platformCall", {
            target: { primitiveId: "uefi.source.bindVirtioNet" },
          }),
          optIrOperation("platformCall", {
            target: { primitiveId: "uefi.source.planMachine" },
          }),
          optIrOperation("platformCall", {
            target: { primitiveId: "uefi.source.exitBootServices" },
          }),
          optIrOperation("platformCall", {
            target: { primitiveId: "uefi.source.splitNetworkDevice" },
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
          evidenceKey: "uefi-bind-virtio-net-platform-call",
          authority: "compiler-trace",
          stableDetail: "uefi.source.bindVirtioNet",
        },
        {
          evidenceKey: "uefi-console-platform-call",
          authority: "compiler-trace",
          stableDetail: "uefi.console.outputString",
        },
        {
          evidenceKey: "uefi-discover-virtio-platform-call",
          authority: "compiler-trace",
          stableDetail: "uefi.source.discoverVirtio",
        },
        {
          evidenceKey: "uefi-exit-boot-services-platform-call",
          authority: "compiler-trace",
          stableDetail: "uefi.source.exitBootServices",
        },
        {
          evidenceKey: "uefi-plan-machine-platform-call",
          authority: "compiler-trace",
          stableDetail: "uefi.source.planMachine",
        },
        {
          evidenceKey: "uefi-reserve-restricted-memory-platform-call",
          authority: "compiler-trace",
          stableDetail: "uefi.source.reserveRestrictedMemory",
        },
        {
          evidenceKey: "uefi-split-network-device-platform-call",
          authority: "compiler-trace",
          stableDetail: "uefi.source.splitNetworkDevice",
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
    "opt-ir:packet-counter:missing-exposed-fact:uefi-bind-virtio-net-platform-call",
    "opt-ir:packet-counter:missing-exposed-fact:uefi-discover-virtio-platform-call",
    "opt-ir:packet-counter:missing-exposed-fact:uefi-exit-boot-services-platform-call",
    "opt-ir:packet-counter:missing-exposed-fact:uefi-plan-machine-platform-call",
    "opt-ir:packet-counter:missing-exposed-fact:uefi-reserve-restricted-memory-platform-call",
    "opt-ir:packet-counter:missing-exposed-fact:uefi-split-network-device-platform-call",
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
    "opt-ir:packet-counter:missing-exposed-fact:uefi-bind-virtio-net-platform-call",
    "opt-ir:packet-counter:missing-exposed-fact:uefi-console-platform-call",
    "opt-ir:packet-counter:missing-exposed-fact:uefi-discover-virtio-platform-call",
    "opt-ir:packet-counter:missing-exposed-fact:uefi-exit-boot-services-platform-call",
    "opt-ir:packet-counter:missing-exposed-fact:uefi-plan-machine-platform-call",
    "opt-ir:packet-counter:missing-exposed-fact:uefi-reserve-restricted-memory-platform-call",
    "opt-ir:packet-counter:missing-exposed-fact:uefi-split-network-device-platform-call",
  ]);
});

test("OptIR reference uses unoptimized construction operations for packet coverage", () => {
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
    "opt-ir:packet-counter:missing-exposed-fact:uefi-bind-virtio-net-platform-call",
    "opt-ir:packet-counter:missing-exposed-fact:uefi-discover-virtio-platform-call",
    "opt-ir:packet-counter:missing-exposed-fact:uefi-exit-boot-services-platform-call",
    "opt-ir:packet-counter:missing-exposed-fact:uefi-plan-machine-platform-call",
    "opt-ir:packet-counter:missing-exposed-fact:uefi-reserve-restricted-memory-platform-call",
    "opt-ir:packet-counter:missing-exposed-fact:uefi-split-network-device-platform-call",
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
