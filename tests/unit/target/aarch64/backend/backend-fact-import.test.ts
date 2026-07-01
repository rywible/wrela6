import { describe, expect, test } from "bun:test";

import {
  aarch64MachineFactRecord,
  aarch64PreservedFactSet,
} from "../../../../../src/target/aarch64/machine-ir/fact-set";
import { aarch64MachineFactId } from "../../../../../src/target/aarch64/machine-ir/ids";
import { importAArch64BackendFacts } from "../../../../../src/target/aarch64/backend/facts/backend-fact-import";

function factForTest(input: {
  readonly extensionKey: string;
  readonly subject: Parameters<typeof aarch64MachineFactRecord>[0]["subject"];
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly verifier?: string;
  readonly targetDeclarationKeys?: readonly string[];
  readonly id?: number;
}) {
  return aarch64MachineFactRecord({
    factId: aarch64MachineFactId(input.id ?? 0),
    extensionKey: input.extensionKey,
    subject: input.subject,
    payload: input.payload ?? { label: "session-key" },
    upstreamVerifierKey: input.verifier ?? "proof.security",
    lineage: {
      optIrFactIds: [],
      targetDeclarationKeys: input.targetDeclarationKeys ?? ["target.security"],
    },
  });
}

function preservedFactsForTest(input: {
  readonly records: readonly ReturnType<typeof factForTest>[];
  readonly targetDeclarations?: readonly string[];
}) {
  return aarch64PreservedFactSet({
    targetDeclarations:
      input.targetDeclarations ??
      Object.freeze([...new Set(input.records.flatMap((record) => record.targetDeclarationKeys))]),
    records: input.records,
  });
}

describe("backend fact import", () => {
  test("rejects unknown fact family without debug-only declaration", () => {
    const result = importAArch64BackendFacts({
      preservedFacts: preservedFactsForTest({
        records: [
          factForTest({
            extensionKey: "unknown.family",
            subject: { kind: "virtualRegister", vreg: 1 },
          }),
        ],
      }),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected unknown family");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "backend-fact-import:unknown-family:unknown.family",
    ]);
  });

  test("rejects no-spill fact on a memory operand subject", () => {
    const result = importAArch64BackendFacts({
      preservedFacts: preservedFactsForTest({
        records: [
          factForTest({
            extensionKey: "security.no-spill",
            subject: { kind: "memoryOperand", instructionId: 3, operandIndex: 1 },
          }),
        ],
      }),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected wrong subject kind");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "backend-fact-import:wrong-subject:security.no-spill:memoryOperand",
    ]);
  });

  test("rejects duplicate conflicting authority", () => {
    const result = importAArch64BackendFacts({
      preservedFacts: preservedFactsForTest({
        records: [
          factForTest({
            id: 1,
            extensionKey: "security.no-spill",
            subject: { kind: "virtualRegister", vreg: 2 },
            payload: { label: "a" },
          }),
          factForTest({
            id: 2,
            extensionKey: "security.no-spill",
            subject: { kind: "virtualRegister", vreg: 2 },
            payload: { label: "b" },
          }),
        ],
      }),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected duplicate authority");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "backend-fact-import:duplicate-conflicting-authority:security.no-spill:vreg:2",
    ]);
  });

  test("rejects malformed validated-region-shape payload", () => {
    const result = importAArch64BackendFacts({
      preservedFacts: preservedFactsForTest({
        records: [
          factForTest({
            extensionKey: "validated-region-shape",
            subject: { kind: "region", regionKey: "packet" },
            payload: { nonsense: true },
            verifier: "proof.layout",
            targetDeclarationKeys: ["target.region"],
          }),
        ],
      }),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected malformed payload");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "backend-fact-import:malformed-payload:validated-region-shape:region:packet",
    ]);
  });

  test("imports validated-region-shape packet fixture payload", () => {
    const result = importAArch64BackendFacts({
      preservedFacts: preservedFactsForTest({
        records: [
          factForTest({
            extensionKey: "validated-region-shape",
            subject: { kind: "region", regionKey: "packet.field.ethertype" },
            payload: { region: "packet.field.ethertype", endian: "big" },
            verifier: "proof.layout",
            targetDeclarationKeys: ["target.region"],
          }),
        ],
      }),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected import success");
    expect(result.factIndex.factsForFamily("validated-region-shape")[0]?.payload).toEqual({
      region: "packet.field.ethertype",
      endian: "big",
    });
  });

  test("rejects malformed security label payloads", () => {
    const result = importAArch64BackendFacts({
      preservedFacts: preservedFactsForTest({
        records: [
          factForTest({
            id: 1,
            extensionKey: "security.no-spill",
            subject: { kind: "virtualRegister", vreg: 2 },
            payload: { nonsense: true },
          }),
          factForTest({
            id: 2,
            extensionKey: "security.wipe-on-spill",
            subject: { kind: "virtualRegister", vreg: 3 },
            payload: {},
          }),
        ],
      }),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected malformed payloads");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "backend-fact-import:malformed-payload:security.no-spill:vreg:2",
      "backend-fact-import:malformed-payload:security.wipe-on-spill:vreg:3",
    ]);
  });

  test("rejects fact-local target declarations not issued by the preserved fact set", () => {
    const result = importAArch64BackendFacts({
      preservedFacts: aarch64PreservedFactSet({
        targetDeclarations: [],
        records: [
          factForTest({
            id: 1,
            extensionKey: "security.no-spill",
            subject: { kind: "virtualRegister", vreg: 2 },
            targetDeclarationKeys: ["target.security"],
          }),
        ],
      }),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected undeclared target authority");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "backend-fact-import:undeclared-target-declaration:security.no-spill:vreg:2:target.security",
    ]);
  });

  test("rejects malformed upstream verifier keys without throwing", () => {
    const result = importAArch64BackendFacts({
      preservedFacts: preservedFactsForTest({
        records: [
          factForTest({
            extensionKey: "security.no-spill",
            subject: { kind: "virtualRegister", vreg: 2 },
            verifier: " proof.security",
          }),
        ],
      }),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected malformed verifier rejection");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "backend-fact-import:malformed-upstream-verifier:security.no-spill:vreg:2: proof.security",
    ]);
  });

  test("imports security labels with label payloads", () => {
    const result = importAArch64BackendFacts({
      preservedFacts: preservedFactsForTest({
        records: [
          factForTest({
            id: 1,
            extensionKey: "security.no-spill",
            subject: { kind: "virtualRegister", vreg: 2 },
            payload: { label: "key" },
          }),
          factForTest({
            id: 2,
            extensionKey: "security.wipe-on-spill",
            subject: { kind: "virtualRegister", vreg: 3 },
            payload: { label: "key" },
          }),
        ],
      }),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected import success");
    expect(result.factIndex.security.noSpillForVirtualRegister(2)?.payload.label).toBe("key");
    expect(result.factIndex.security.wipeOnSpillForVirtualRegister(3)?.payload.label).toBe("key");
  });

  test("rejects generic family payloads without a stable discriminator", () => {
    const result = importAArch64BackendFacts({
      preservedFacts: preservedFactsForTest({
        records: [
          factForTest({
            extensionKey: "ownership-lifetime",
            subject: { kind: "virtualRegister", vreg: 4 },
            payload: {},
            verifier: "liveness",
            targetDeclarationKeys: ["target.liveness"],
          }),
        ],
      }),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected malformed payload");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "backend-fact-import:malformed-payload:ownership-lifetime:vreg:4",
    ]);
  });

  test("rejects malformed memory-order-and-region-type payloads", () => {
    const result = importAArch64BackendFacts({
      preservedFacts: preservedFactsForTest({
        records: [
          factForTest({
            extensionKey: "memory-order-and-region-type",
            subject: { kind: "memoryOperand", instructionId: 7, operandIndex: 0 },
            payload: { kind: "device-load", region: "packet", order: "acquire" },
            verifier: "proof.memory-order",
            targetDeclarationKeys: ["target.memory-order"],
          }),
        ],
      }),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected malformed memory-order payload");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "backend-fact-import:malformed-payload:memory-order-and-region-type:memory:7:0",
    ]);
  });

  test("imports typed memory-order-and-region-type payloads", () => {
    const result = importAArch64BackendFacts({
      preservedFacts: preservedFactsForTest({
        records: [
          factForTest({
            extensionKey: "memory-order-and-region-type",
            subject: { kind: "memoryOperand", instructionId: 7, operandIndex: 0 },
            payload: { region: "packet", order: "acquire", regionType: "device" },
            verifier: "proof.memory-order",
            targetDeclarationKeys: ["target.memory-order"],
          }),
        ],
      }),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected typed memory-order import");
    expect(result.factIndex.factsForFamily("memory-order-and-region-type")[0]?.payload).toEqual({
      region: "packet",
      order: "acquire",
      regionType: "device",
    });
  });

  test("rejects constant rematerialization authority without a concrete value", () => {
    const result = importAArch64BackendFacts({
      preservedFacts: preservedFactsForTest({
        records: [
          factForTest({
            extensionKey: "rematerialization-authority",
            subject: { kind: "virtualRegister", vreg: 6 },
            payload: { kind: "constant-remat" },
            verifier: "proof.remat",
            targetDeclarationKeys: ["target.remat"],
          }),
        ],
      }),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected malformed remat authority");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "backend-fact-import:malformed-payload:rematerialization-authority:vreg:6",
    ]);
  });

  test("rejects unexpected verifier families and missing target declarations", () => {
    const result = importAArch64BackendFacts({
      preservedFacts: preservedFactsForTest({
        targetDeclarations: ["target.security"],
        records: [
          factForTest({
            id: 1,
            extensionKey: "security.no-spill",
            subject: { kind: "virtualRegister", vreg: 2 },
            verifier: "proof.layout",
          }),
          factForTest({
            id: 2,
            extensionKey: "validated-region-shape",
            subject: { kind: "region", regionKey: "packet" },
            payload: { endian: "big" },
            verifier: "proof.layout",
            targetDeclarationKeys: ["target.security"],
          }),
        ],
      }),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected authority errors");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "backend-fact-import:unexpected-upstream-verifier:security.no-spill:proof.layout",
      "backend-fact-import:missing-target-declaration:validated-region-shape:region:packet:target.region",
    ]);
  });

  test("imports no-spill facts with deterministic typed queries", () => {
    const result = importAArch64BackendFacts({
      preservedFacts: preservedFactsForTest({
        records: [
          factForTest({
            id: 4,
            extensionKey: "security.no-spill",
            subject: { kind: "virtualRegister", vreg: 9 },
            payload: { label: "late" },
          }),
          factForTest({
            id: 3,
            extensionKey: "security.no-spill",
            subject: { kind: "virtualRegister", vreg: 1 },
            payload: { label: "early" },
          }),
        ],
      }),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected import success");
    expect(result.factIndex.security.noSpillForVirtualRegister(1)?.payload.label).toBe("early");
    expect(result.factIndex.security.noSpillFacts().map((fact) => fact.subjectKey)).toEqual([
      "vreg:1",
      "vreg:9",
    ]);
  });
});
