import { describe, expect, test } from "bun:test";
import { optIrFactId, optIrValueId } from "../../../../../src/opt-ir/ids";
import {
  rekeyAArch64FactsToMachine,
  type AArch64FactRekeyInputRecord,
} from "../../../../../src/target/aarch64/facts/aarch64-fact-rekeying";
import type { AArch64MachineFactSubject } from "../../../../../src/target/aarch64/machine-ir/fact-set";
import {
  aarch64FrameObjectId,
  aarch64MachineBlockId,
  aarch64MachineFunctionId,
  aarch64MachineInstructionId,
  aarch64RelocationReferenceId,
  aarch64VirtualRegisterId,
} from "../../../../../src/target/aarch64/machine-ir/ids";

describe("AArch64 fact re-keying", () => {
  test("re-keys values and preserves every current machine fact subject kind", () => {
    const machineSubjects: readonly AArch64MachineFactSubject[] = [
      { kind: "machineFunction", functionId: aarch64MachineFunctionId(1) },
      { kind: "machineBlock", blockId: aarch64MachineBlockId(2) },
      { kind: "machineEdge", edgeKey: "2->3:data" },
      { kind: "virtualRegister", vreg: aarch64VirtualRegisterId(3) },
      { kind: "machineInstruction", instructionId: aarch64MachineInstructionId(4) },
      { kind: "memoryOperand", instructionId: aarch64MachineInstructionId(4), operandIndex: 1 },
      { kind: "frameObject", frameObjectId: aarch64FrameObjectId(5) },
      { kind: "symbol", symbol: "packet_table" },
      { kind: "callSite", callKey: "call:helper:0" },
      { kind: "region", regionKey: "packet.field.ethertype" },
      { kind: "relocationReference", relocationId: aarch64RelocationReferenceId(6) },
      { kind: "targetDeclaration", targetDeclarationKey: "target:sha3" },
      { kind: "droppedFact", droppedFactKey: "fact:13:no-surviving-machine-subject" },
    ];
    const records: readonly AArch64FactRekeyInputRecord[] = [
      {
        optIrFactId: optIrFactId(100),
        subject: { kind: "value", valueId: optIrValueId(7) },
        payload: { label: "secret" },
      },
      ...machineSubjects.map((subject, index) => ({
        optIrFactId: optIrFactId(index + 1),
        subject,
        payload: { index },
      })),
    ];

    const result = rekeyAArch64FactsToMachine({
      records,
      valueMappings: [{ valueId: optIrValueId(7), machineVreg: aarch64VirtualRegisterId(31) }],
    });

    expect(result).toMatchObject({ kind: "ok" });
    expect(
      result.kind === "ok" ? result.records.map((record) => record.machineSubject) : [],
    ).toEqual([
      { kind: "virtualRegister", vreg: aarch64VirtualRegisterId(31) },
      ...machineSubjects,
    ]);
  });

  test("reports missing value mappings as stale subjects by default", () => {
    const result = rekeyAArch64FactsToMachine({
      records: [
        {
          optIrFactId: optIrFactId(1),
          subject: { kind: "value", valueId: optIrValueId(7) },
          payload: { label: "secret" },
        },
      ],
      valueMappings: [],
    });

    expect(result).toEqual({
      kind: "error",
      reason: "stale-subject-mapping:value:7",
    });
  });

  test("can explicitly drop missing value mappings", () => {
    const result = rekeyAArch64FactsToMachine({
      records: [
        {
          optIrFactId: optIrFactId(1),
          subject: { kind: "value", valueId: optIrValueId(7) },
          payload: { label: "secret" },
        },
      ],
      valueMappings: [],
      staleSubjectPolicy: "drop",
    });

    expect(result).toEqual({
      kind: "ok",
      records: [],
      droppedFacts: [{ optIrFactId: optIrFactId(1), reason: "stale-subject-mapping:value:7" }],
    });
  });

  test("rejects ambiguous value mappings deterministically", () => {
    const result = rekeyAArch64FactsToMachine({
      records: [
        {
          optIrFactId: optIrFactId(1),
          subject: { kind: "value", valueId: optIrValueId(7) },
          payload: { label: "secret" },
        },
      ],
      valueMappings: [
        { valueId: optIrValueId(7), machineVreg: aarch64VirtualRegisterId(2) },
        { valueId: optIrValueId(7), machineVreg: aarch64VirtualRegisterId(1) },
      ],
    });

    expect(result).toEqual({
      kind: "error",
      reason: "ambiguous-subject-mapping:value:7",
    });
  });

  test("keeps record order independent of value mapping order", () => {
    const records: readonly AArch64FactRekeyInputRecord[] = [
      {
        optIrFactId: optIrFactId(1),
        subject: { kind: "value", valueId: optIrValueId(1) },
        payload: { name: "first" },
      },
      {
        optIrFactId: optIrFactId(2),
        subject: { kind: "value", valueId: optIrValueId(2) },
        payload: { name: "second" },
      },
    ];

    const result = rekeyAArch64FactsToMachine({
      records,
      valueMappings: [
        { valueId: optIrValueId(2), machineVreg: aarch64VirtualRegisterId(20) },
        { valueId: optIrValueId(1), machineVreg: aarch64VirtualRegisterId(10) },
      ],
    });

    expect(
      result.kind === "ok" ? result.records.map((record) => record.machineSubject) : [],
    ).toEqual([
      { kind: "virtualRegister", vreg: aarch64VirtualRegisterId(10) },
      { kind: "virtualRegister", vreg: aarch64VirtualRegisterId(20) },
    ]);
  });
});
