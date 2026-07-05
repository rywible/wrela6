import { describe, expect, test } from "bun:test";

import { allocationResult } from "../../../../../src/target/aarch64/backend/allocation/allocation-result";
import { compileAArch64Object } from "../../../../../src/target/aarch64/backend/api/compile-aarch64-object";
import { allocationRegisterPools } from "../../../../../src/target/aarch64/backend/api/function-pipeline/allocation-stage";
import { createAArch64Rpi5PhysicalRegisterModel } from "../../../../../src/target/aarch64/backend/api/physical-register-model";
import { aarch64Diagnostic } from "../../../../../src/target/aarch64/machine-ir/diagnostics";
import {
  aarch64MachineInstructionId,
  aarch64VirtualRegisterId,
} from "../../../../../src/target/aarch64/machine-ir/ids";
import { aarch64MachineInstruction } from "../../../../../src/target/aarch64/machine-ir/machine-instruction";
import {
  aarch64IntMachineType,
  aarch64VectorMachineType,
} from "../../../../../src/target/aarch64/machine-ir/machine-types";
import { aarch64OpcodeFormId } from "../../../../../src/target/aarch64/machine-ir/opcode-catalog";
import { defVreg, immediateOperand } from "../../../../../src/target/aarch64/machine-ir/operands";
import { syntheticAArch64Origin } from "../../../../../src/target/aarch64/machine-ir/provenance";
import { aarch64VirtualRegister } from "../../../../../src/target/aarch64/machine-ir/virtual-register";
import { verifyAArch64CalleeSavedAllocationPreservation } from "../../../../../src/target/aarch64/verify/abi-verifier";
import {
  aarch64CallForTest,
  aarch64MachineFunctionForTest,
  aarch64MovzForTest,
} from "../../../../../tests/support/target/aarch64/machine-ir/builders";
import {
  authenticatedBackendTargetSurfaceForTest,
  fakeRegisterModel,
} from "../../../../../tests/support/target/aarch64/backend/backend-target-surface-fakes";
import {
  backendInputForTest,
  closedImageBackendPlanForTest,
  machineProgramForTest,
} from "../../../../../tests/support/target/aarch64/backend/backend-fixtures";

describe("AArch64 callee-saved allocation support", () => {
  test("includes public callee-saved GPRs in the allocation pool", () => {
    const registerModel = createAArch64Rpi5PhysicalRegisterModel();

    const pools = allocationRegisterPools({ registerModel });

    expect(pools.gprs).toContain("x17");
    expect(pools.gprs).toContain("x19");
    expect(pools.gprs).toContain("x20");
    expect(pools.gprs).toContain("x28");
  });

  test("includes public callee-saved SIMD registers in the allocation pool", () => {
    const registerModel = createAArch64Rpi5PhysicalRegisterModel();

    const pools = allocationRegisterPools({ registerModel });

    expect(pools.vectors).toContain("v8");
    expect(pools.vectors).toContain("v15");
    expect(pools.fps).toContain("d8");
    expect(pools.fps).toContain("d15");
  });

  test("saves allocated public callee-saved registers and the link register at call boundaries", () => {
    const target = authenticatedBackendTargetSurfaceForTest({
      registerModel: fakeRegisterModel({
        registerRecords: [
          { stableKey: "x21", encodingNumber: 21, aliasSet: "gpr:21", isAllocatable: true },
          { stableKey: "x30", encodingNumber: 30, aliasSet: "gpr:30", isAllocatable: false },
          { stableKey: "sp", encodingNumber: 31, aliasSet: "sp", isAllocatable: false },
          { stableKey: "xzr", encodingNumber: 31, aliasSet: "xzr", isAllocatable: false },
          { stableKey: "wzr", encodingNumber: 31, aliasSet: "xzr", isAllocatable: false },
        ],
        publicCallerSavedGprs: Object.freeze(["x30"]),
        publicCalleeSavedGprs: Object.freeze(["x21"]),
        privateConventionCandidateGprs: Object.freeze(["x21"]),
        veneerScratchGprs: Object.freeze([]),
      }),
    });

    const result = compileAArch64Object(
      backendInputForTest({
        target,
        machineProgram: machineProgramForTest({
          targetFingerprint: target.sourceSurfaceFingerprint,
          functions: [
            aarch64MachineFunctionForTest({
              instructions: [
                aarch64MovzForTest({ instructionId: 1, value: 7n }),
                aarch64CallForTest({ instructionId: 2, callee: "helper" }),
              ],
            }),
          ],
        }),
        closedImagePlan: closedImageBackendPlanForTest({ privateConventions: [] }),
        debugArtifacts: { allocationPlan: true },
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected object module");
    expect(result.debugArtifacts?.allocationPlan).toContain("fixture.function:vreg:1:x21:0-1");
    const bytes = result.objectModule.sections[0]?.bytes ?? [];
    expect(containsByteSequence(bytes, [0xfe, 0x57, 0x00, 0xa9])).toBe(true);
    expect(containsByteSequence(bytes, [0xfe, 0x57, 0x40, 0xa9])).toBe(true);
  });

  test("saves allocated public low-SIMD callee-saved aliases with d-register frame slots", () => {
    const target = authenticatedBackendTargetSurfaceForTest({
      registerModel: fakeRegisterModel({
        registerRecords: [
          { stableKey: "v8", encodingNumber: 8, aliasSet: "simd:8", isAllocatable: true },
          { stableKey: "d8", encodingNumber: 8, aliasSet: "simd:8", isAllocatable: true },
          { stableKey: "x30", encodingNumber: 30, aliasSet: "gpr:30", isAllocatable: false },
          { stableKey: "sp", encodingNumber: 31, aliasSet: "sp", isAllocatable: false },
          { stableKey: "xzr", encodingNumber: 31, aliasSet: "xzr", isAllocatable: false },
          { stableKey: "wzr", encodingNumber: 31, aliasSet: "xzr", isAllocatable: false },
        ],
        publicCallerSavedGprs: Object.freeze(["x30"]),
        publicCalleeSavedGprs: Object.freeze([]),
        publicCalleeSavedSimd: Object.freeze(["d8"]),
        privateConventionCandidateGprs: Object.freeze([]),
        veneerScratchGprs: Object.freeze([]),
      }),
    });
    const vectorType = aarch64VectorMachineType({
      laneType: aarch64IntMachineType(64),
      laneCount: 2,
    });
    const vector = aarch64VirtualRegister({
      vreg: aarch64VirtualRegisterId(8),
      registerClass: "vector128",
      type: vectorType,
      origin: { kind: "synthetic", stableKey: "fixture.vector.8" },
    });

    const result = compileAArch64Object(
      backendInputForTest({
        target,
        machineProgram: machineProgramForTest({
          targetFingerprint: target.sourceSurfaceFingerprint,
          functions: [
            aarch64MachineFunctionForTest({
              instructions: [
                aarch64MachineInstruction({
                  instructionId: aarch64MachineInstructionId(1),
                  opcode: aarch64OpcodeFormId("movi"),
                  operands: [defVreg(vector, vectorType), immediateOperand(0n, vectorType)],
                  flags: { mayTrap: false },
                  origin: syntheticAArch64Origin("fixture.vector.callee-saved"),
                }),
              ],
            }),
          ],
        }),
        closedImagePlan: closedImageBackendPlanForTest({ privateConventions: [] }),
        debugArtifacts: { allocationPlan: true },
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected SIMD callee-saved object module");
    expect(result.debugArtifacts?.allocationPlan).toEqual(["fixture.function:vreg:8:v8:0-1"]);
    const byteProvenanceKeys = result.objectModule.byteProvenance.map((record) =>
      String(record.stableKey),
    );
    expect(byteProvenanceKeys).toEqual(
      expect.arrayContaining([
        "byte:.text:fixture.function:prologue:save:d8",
        "byte:.text:implicit-return:fixture.function:epilogue:restore:d8",
      ]),
    );
    expect(byteProvenanceKeys).not.toContain("byte:.text:fixture.function:prologue:save:v8");
    const bytes = result.objectModule.sections[0]?.bytes ?? [];
    expect(containsByteSequence(bytes, [0xe8, 0x07, 0x00, 0xfd])).toBe(true);
    expect(containsByteSequence(bytes, [0xe8, 0x07, 0x40, 0xfd])).toBe(true);
  });

  test("reports unpreserved callee-saved allocation segments", () => {
    const registerModel = createAArch64Rpi5PhysicalRegisterModel();
    const allocation = allocationResult({
      segments: [
        {
          liveRangeKey: "live-range:vreg:20",
          vreg: 20,
          physical: "x20",
          startOrder: 0,
          endOrder: 4,
          reason: "allocated",
        },
      ],
    });

    const diagnostics = verifyAArch64CalleeSavedAllocationPreservation({
      allocation,
      savedRegisters: [],
      registerModel,
      context: {
        makeDiagnostic: aarch64Diagnostic,
      },
    });

    expect(diagnostics.map((diagnostic) => String(diagnostic.code))).toContain(
      "AARCH64_ABI_CALLEE_SAVED_UNPRESERVED",
    );
  });

  test("accepts allocation segments covered by saved registers", () => {
    const registerModel = createAArch64Rpi5PhysicalRegisterModel();
    const allocation = allocationResult({
      segments: [
        {
          liveRangeKey: "live-range:vreg:20",
          vreg: 20,
          physical: "w20",
          startOrder: 0,
          endOrder: 4,
          reason: "allocated",
        },
      ],
    });

    const diagnostics = verifyAArch64CalleeSavedAllocationPreservation({
      allocation,
      savedRegisters: ["x20"],
      registerModel,
      context: {
        makeDiagnostic: aarch64Diagnostic,
      },
    });

    expect(diagnostics).toEqual([]);
  });
});

function containsByteSequence(haystack: ArrayLike<number>, needle: readonly number[]): boolean {
  for (let index = 0; index < haystack.length; index += 1) {
    if (needle.every((needleByte, needleIndex) => haystack[index + needleIndex] === needleByte)) {
      return true;
    }
  }
  return false;
}
