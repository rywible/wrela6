import { describe, expect, test } from "bun:test";
import { optIrFunctionId, optIrValueId } from "../../../../src/opt-ir/ids";
import {
  aarch64MachineBlockId,
  aarch64MachineFunctionId,
  aarch64MachineInstructionId,
  aarch64PatternId,
  aarch64VirtualRegisterId,
} from "../../../../src/target/aarch64/machine-ir/ids";
import { allocateAArch64FunctionIds } from "../../../../src/target/aarch64/machine-ir/deterministic-ids";
import {
  aarch64DiagnosticForTest,
  aarch64LoweringDiagnosticCode,
  sortAArch64Diagnostics,
} from "../../../../src/target/aarch64/machine-ir/diagnostics";
import {
  aarch64ProvenanceMap,
  selectedAArch64PatternOrigin,
  syntheticAArch64Origin,
} from "../../../../src/target/aarch64/machine-ir/provenance";

describe("AArch64 Machine IR IDs diagnostics and provenance", () => {
  test("ID constructors reject impossible values", () => {
    expect(() => aarch64MachineFunctionId(-1)).toThrow(RangeError);
    expect(() => aarch64MachineBlockId(1.5)).toThrow(RangeError);
    expect(() => aarch64PatternId("")).toThrow(RangeError);
  });

  test("deterministic allocators produce dense IDs in stable sorted OptIR order", () => {
    const allocation = allocateAArch64FunctionIds([optIrFunctionId(7), optIrFunctionId(2)]);

    expect(Number(allocation.machineFunctionFor(optIrFunctionId(2)))).toBe(0);
    expect(Number(allocation.machineFunctionFor(optIrFunctionId(7)))).toBe(1);
    expect(Object.isFrozen(allocation.entries())).toBe(true);
  });

  test("diagnostic codes are allowlisted and sorted by deterministic order keys", () => {
    expect(() => aarch64LoweringDiagnosticCode("NOPE")).toThrow(RangeError);

    const diagnostics = sortAArch64Diagnostics([
      aarch64DiagnosticForTest({
        code: "AARCH64_PROFILE_REJECTED",
        ownerKey: "owner:b",
        stableDetail: "b",
      }),
      aarch64DiagnosticForTest({
        code: "AARCH64_PROFILE_REJECTED",
        ownerKey: "owner:a",
        stableDetail: "a",
      }),
    ]);

    expect(diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual(["a", "b"]);
  });

  test("provenance records cite every lowering authority family and freeze nested records", () => {
    const provenance = aarch64ProvenanceMap({
      origins: [
        syntheticAArch64Origin("lowering:test"),
        { kind: "source", sourceKey: "packet.wr:1:1" },
        { kind: "hir", hirKey: "hir:node:1" },
        { kind: "mono", monoKey: "mono:function:main" },
        { kind: "proofMir", proofMirKey: "proof-mir:statement:1" },
        { kind: "checkedMir", checkedMirKey: "checked-mir:statement:1" },
        { kind: "layout", layoutKey: "layout:packet.header" },
        { kind: "optIr", valueId: optIrValueId(7) },
        { kind: "targetSurface", fingerprint: "target:fingerprint" },
        selectedAArch64PatternOrigin({
          patternId: aarch64PatternId("scalar.add"),
          instructionId: aarch64MachineInstructionId(1),
        }),
        { kind: "machinePlanning", planningKey: "schedule:block:0" },
      ],
      ownerIds: [aarch64VirtualRegisterId(1)],
    });

    expect(provenance.origins.map((origin) => origin.kind)).toContain("machinePlanning");
    expect(Object.isFrozen(provenance.origins)).toBe(true);
  });
});
