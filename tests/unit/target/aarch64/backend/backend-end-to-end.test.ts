import { describe, expect, test } from "bun:test";

import { compileAArch64Object } from "../../../../../src/target/aarch64/backend/api/compile-aarch64-object";
import {
  aarch64MachineFactId,
  aarch64MachineInstructionId,
  aarch64VirtualRegisterId,
} from "../../../../../src/target/aarch64/machine-ir/ids";
import {
  aarch64MachineFactRecord,
  aarch64PreservedFactSet,
} from "../../../../../src/target/aarch64/machine-ir/fact-set";
import {
  aarch64AddForTest,
  aarch64CallForTest,
  aarch64IndirectCallForTest,
  aarch64MovzForTest,
  aarch64MachineFunctionForTest,
  aarch64RetForTest,
  aarch64TrapForTest,
} from "../../../../../tests/support/target/aarch64/machine-ir/builders";
import { aarch64AbiBinding } from "../../../../../src/target/aarch64/machine-ir/abi-location";
import { aarch64MachineInstruction } from "../../../../../src/target/aarch64/machine-ir/machine-instruction";
import {
  aarch64IntMachineType,
  aarch64VectorMachineType,
} from "../../../../../src/target/aarch64/machine-ir/machine-types";
import { aarch64OpcodeFormId } from "../../../../../src/target/aarch64/machine-ir/opcode-catalog";
import {
  defVreg,
  immediateOperand,
  useVreg,
} from "../../../../../src/target/aarch64/machine-ir/operands";
import { syntheticAArch64Origin } from "../../../../../src/target/aarch64/machine-ir/provenance";
import { aarch64VirtualRegister } from "../../../../../src/target/aarch64/machine-ir/virtual-register";
import {
  backendInputForTest,
  closedImageBackendPlanForTest,
  machineProgramForTest,
  packetLoopBackendInputForTest,
} from "../../../../../tests/support/target/aarch64/backend/backend-fixtures";
import {
  authenticatedBackendTargetSurfaceForTest,
  fakeRegisterModel,
} from "../../../../../tests/support/target/aarch64/backend/backend-target-surface-fakes";
import {
  privateConventionForTest,
  publicBoundaryTableForTest,
} from "../../../../../tests/support/target/aarch64/backend/closed-image-plan-fakes";
import {
  aarch64CallWithArgumentForTest,
  branchingFunctionForTest,
  containsMoveWideImmediate,
  hasByteSequence,
  movzZeroOffsets,
  multiReturnFramedFunctionForTest,
  retWordOffsets,
  secretBranchFunctionForTest,
  secretCompareBranchFunctionForTest,
  spillPressureFunctionForTest,
  storeWordOffsets,
  wordOffsets,
} from "../../../../../tests/support/target/aarch64/backend/backend-end-to-end-helpers";

describe("AArch64 backend end-to-end compile", () => {
  test("simple leaf function emits deterministic text object module", () => {
    const input = backendInputForTest({
      machineProgram: machineProgramForTest({
        functions: [
          aarch64MachineFunctionForTest({
            instructions: [aarch64MovzForTest({ instructionId: 1, value: 7n })],
          }),
        ],
      }),
      closedImagePlan: closedImageBackendPlanForTest({ privateConventions: [] }),
    });

    const result = compileAArch64Object(input);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected object module");
    expect(result.objectModule.sections.map((section) => String(section.stableKey))).toEqual([
      ".text",
    ]);
    expect(result.objectModule.symbols.map((symbol) => String(symbol.stableKey))).toEqual([
      "fixture.function",
    ]);
    expect(result.objectModule.unwindRecords[0]?.frameShape).toBe("frameless-leaf");
    expect(result.objectModule.sections[0]?.bytes).toEqual([
      0xe0, 0x00, 0x80, 0xd2, 0xc0, 0x03, 0x5f, 0xd6,
    ]);
    expect(result.verification.runs.every((run) => run.status === "passed")).toBe(true);
  });

  test("movz plus add lowers to allocated registers without silent nop", () => {
    const input = backendInputForTest({
      machineProgram: machineProgramForTest({
        functions: [
          aarch64MachineFunctionForTest({
            instructions: [
              aarch64MovzForTest({ instructionId: 0, value: 7n }),
              aarch64MovzForTest({ instructionId: 1, value: 9n }),
              aarch64AddForTest({ instructionId: 2 }),
            ],
          }),
        ],
      }),
      closedImagePlan: closedImageBackendPlanForTest({ privateConventions: [] }),
    });

    const result = compileAArch64Object(input);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected object module");
    expect(result.objectModule.sections[0]?.bytes).toEqual([
      0xe0, 0x00, 0x80, 0xd2, 0x21, 0x01, 0x80, 0xd2, 0x02, 0x00, 0x01, 0x8b, 0xc0, 0x03, 0x5f,
      0xd6,
    ]);
    expect(result.objectModule.sections[0]?.bytes).not.toContain(0xd5);
  });

  test("allocation uses authenticated target allocatable registers", () => {
    const target = authenticatedBackendTargetSurfaceForTest({
      registerModel: fakeRegisterModel({
        registerRecords: [
          { stableKey: "x20", encodingNumber: 20, aliasSet: "x", isAllocatable: true },
          { stableKey: "x18", encodingNumber: 18, aliasSet: "x", isAllocatable: false },
          { stableKey: "x30", encodingNumber: 30, aliasSet: "x", isAllocatable: false },
          { stableKey: "sp", encodingNumber: 31, aliasSet: "sp", isAllocatable: false },
          { stableKey: "xzr", encodingNumber: 31, aliasSet: "zr", isAllocatable: false },
          { stableKey: "wzr", encodingNumber: 31, aliasSet: "zr", isAllocatable: false },
        ],
      }),
    });
    const result = compileAArch64Object(
      backendInputForTest({
        target,
        machineProgram: machineProgramForTest({
          targetFingerprint: target.sourceSurfaceFingerprint,
          functions: [
            aarch64MachineFunctionForTest({
              instructions: [aarch64MovzForTest({ instructionId: 1, value: 7n })],
            }),
          ],
        }),
        closedImagePlan: closedImageBackendPlanForTest({ privateConventions: [] }),
        debugArtifacts: { allocationPlan: true },
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected object module");
    expect(result.debugArtifacts?.allocationPlan).toEqual(["fixture.function:vreg:1:x20:0-1"]);
  });

  test("branch and add-immediate machine opcodes compile through object output", () => {
    const result = compileAArch64Object(
      backendInputForTest({
        machineProgram: machineProgramForTest({
          functions: [branchingFunctionForTest()],
        }),
        closedImagePlan: closedImageBackendPlanForTest({ privateConventions: [] }),
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected branch object module");
    expect(result.objectModule.relocations.map((relocation) => relocation.family)).toEqual([
      "branch26",
    ]);
    expect(result.objectModule.relocations[0]?.targetSymbol).toBe("fixture.function:block:1");
    expect(
      result.objectModule.symbols.map((symbol) => ({
        stableKey: String(symbol.stableKey),
        offsetBytes: symbol.offsetBytes,
      })),
    ).toEqual([
      { stableKey: "fixture.function", offsetBytes: 0 },
      { stableKey: "fixture.function:block:1", offsetBytes: 12 },
    ]);
    expect(result.objectModule.sections[0]?.bytes).toEqual([
      0xe0, 0x00, 0x80, 0xd2, 0x01, 0x00, 0x00, 0x91, 0x00, 0x00, 0x00, 0x14, 0x60, 0x00, 0x80,
      0xd2, 0xc0, 0x03, 0x5f, 0xd6,
    ]);
  });

  test("secret branch condition facts are projected into object security verification", () => {
    const result = compileAArch64Object(
      backendInputForTest({
        machineProgram: machineProgramForTest({
          functions: [secretBranchFunctionForTest()],
        }),
        preservedFacts: aarch64PreservedFactSet({
          targetDeclarations: ["target.security"],
          records: [
            aarch64MachineFactRecord({
              factId: aarch64MachineFactId(79),
              extensionKey: "security-and-secret-lifetime",
              subject: { kind: "virtualRegister", vreg: 0 },
              payload: { kind: "secret" },
              upstreamVerifierKey: "security",
              targetDeclarationKeys: ["target.security"],
            }),
          ],
        }),
        closedImagePlan: closedImageBackendPlanForTest({ privateConventions: [] }),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected secret branch rejection");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "security:secret-branch-condition:insn:fixture.function:1:vreg:0",
    ]);
    expect(
      result.verification.runs.find((run) => run.verifierKey === "verify-object-module")?.status,
    ).toBe("failed");
  });

  test("secret compare flags feeding b.cond are projected into object security verification", () => {
    const result = compileAArch64Object(
      backendInputForTest({
        machineProgram: machineProgramForTest({
          functions: [secretCompareBranchFunctionForTest()],
        }),
        preservedFacts: aarch64PreservedFactSet({
          targetDeclarations: ["target.security"],
          records: [
            aarch64MachineFactRecord({
              factId: aarch64MachineFactId(80),
              extensionKey: "security-and-secret-lifetime",
              subject: { kind: "virtualRegister", vreg: 0 },
              payload: { kind: "secret" },
              upstreamVerifierKey: "security",
              targetDeclarationKeys: ["target.security"],
            }),
          ],
        }),
        closedImagePlan: closedImageBackendPlanForTest({ privateConventions: [] }),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected secret compare branch rejection");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "security:secret-branch-condition:insn:fixture.function:1:vreg:0",
    ]);
  });

  test("non-leaf public call emits relocation and target symbol", () => {
    const result = compileAArch64Object(
      backendInputForTest({
        machineProgram: machineProgramForTest({
          functions: [
            aarch64MachineFunctionForTest({
              instructions: [aarch64CallForTest({ instructionId: 1, callee: "helper" })],
              terminator: aarch64RetForTest(),
            }),
          ],
        }),
        closedImagePlan: closedImageBackendPlanForTest({
          privateConventions: [],
          publicAbiBoundaries: publicBoundaryTableForTest([
            { caller: "fixture.function", callee: "helper" },
          ]),
        }),
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected object module");
    expect(result.objectModule.sections.map((section) => String(section.stableKey))).toEqual([
      ".extern",
      ".text",
    ]);
    expect(
      result.objectModule.symbols.map((symbol) => ({
        stableKey: String(symbol.stableKey),
        sectionKey: String(symbol.sectionKey),
        offsetBytes: symbol.offsetBytes,
      })),
    ).toEqual([
      { stableKey: "fixture.function", sectionKey: ".text", offsetBytes: 0 },
      { stableKey: "helper", sectionKey: ".extern", offsetBytes: 0 },
    ]);
    expect(result.objectModule.relocations.map((relocation) => relocation.family)).toEqual([
      "branch26",
    ]);
    expect(result.objectModule.relocations[0]?.offsetBytes).toBe(8);
    expect(
      result.objectModule.sections.find((section) => String(section.stableKey) === ".text")?.bytes,
    ).toEqual([
      0xff, 0x43, 0x00, 0xd1, 0xfe, 0x07, 0x00, 0xf9, 0x00, 0x00, 0x00, 0x94, 0xfe, 0x07, 0x40,
      0xf9, 0xff, 0x43, 0x00, 0x91, 0xc0, 0x03, 0x5f, 0xd6,
    ]);
    expect(result.objectModule.unwindRecords).toContainEqual(
      expect.objectContaining({
        stableKey: "unwind:fixture.function",
        frameShape: "serializable-unwind",
      }),
    );
  });

  test("indirect calls are non-leaf frame boundaries without external relocations", () => {
    const result = compileAArch64Object(
      backendInputForTest({
        machineProgram: machineProgramForTest({
          functions: [
            aarch64MachineFunctionForTest({
              instructions: [aarch64IndirectCallForTest({ instructionId: 1, targetVreg: 0 })],
              terminator: aarch64RetForTest(),
            }),
          ],
        }),
        closedImagePlan: closedImageBackendPlanForTest({ privateConventions: [] }),
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected object module");
    expect(result.objectModule.relocations).toEqual([]);
    expect(result.objectModule.unwindRecords).toContainEqual(
      expect.objectContaining({
        stableKey: "unwind:fixture.function",
        frameShape: "serializable-unwind",
      }),
    );
    const bytes =
      result.objectModule.sections.find((section) => String(section.stableKey) === ".text")
        ?.bytes ?? [];
    expect(wordOffsets(bytes, [0x00, 0x00, 0x3f, 0xd6])).toEqual([8]);
  });

  test("framed functions restore and return at every machine return site", () => {
    const result = compileAArch64Object(
      backendInputForTest({
        machineProgram: machineProgramForTest({
          functions: [multiReturnFramedFunctionForTest()],
        }),
        closedImagePlan: closedImageBackendPlanForTest({
          privateConventions: [],
          publicAbiBoundaries: publicBoundaryTableForTest([
            { caller: "fixture.function", callee: "helper" },
          ]),
        }),
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected object module");
    expect(
      retWordOffsets(
        result.objectModule.sections.find((section) => String(section.stableKey) === ".text")
          ?.bytes ?? [],
      ),
    ).toEqual([20, 36]);
  });

  test("closed-image plan metadata does not synthesize executable calls", () => {
    const result = compileAArch64Object(
      backendInputForTest({
        machineProgram: machineProgramForTest({
          functions: [aarch64MachineFunctionForTest({ terminator: aarch64RetForTest() })],
        }),
        closedImagePlan: closedImageBackendPlanForTest({
          privateConventions: [],
          publicAbiBoundaries: publicBoundaryTableForTest([
            { caller: "fixture.function", callee: "helper" },
          ]),
        }),
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected object module");
    expect(result.objectModule.sections.map((section) => String(section.stableKey))).toEqual([
      ".text",
    ]);
    expect(result.objectModule.symbols.map((symbol) => String(symbol.stableKey))).toEqual([
      "fixture.function",
    ]);
    expect(result.objectModule.relocations).toEqual([]);
    expect(result.objectModule.unwindRecords[0]?.frameShape).toBe("frameless-leaf");
    expect(result.objectModule.sections[0]?.bytes).toEqual([0xc0, 0x03, 0x5f, 0xd6]);
  });

  test("classifies projected machine ABI values instead of empty public boundaries", () => {
    const result = compileAArch64Object(
      backendInputForTest({
        machineProgram: machineProgramForTest({
          functions: [
            aarch64MachineFunctionForTest({
              parameters: [
                aarch64AbiBinding({
                  valueKey: "scratch",
                  location: { kind: "intReg", index: 18 },
                }),
              ],
            }),
          ],
        }),
        closedImagePlan: closedImageBackendPlanForTest({ privateConventions: [] }),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected ABI classification error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "abi:reserved-x18:fixture.function:scratch",
    ]);
  });

  test("multi-function object symbols use final fragment offsets", () => {
    const result = compileAArch64Object(
      backendInputForTest({
        machineProgram: machineProgramForTest({
          functions: [
            aarch64MachineFunctionForTest({
              functionId: 1,
              symbol: "alpha",
              instructions: [aarch64MovzForTest({ instructionId: 1, value: 1n })],
            }),
            aarch64MachineFunctionForTest({
              functionId: 2,
              symbol: "beta",
              instructions: [aarch64MovzForTest({ instructionId: 2, value: 2n })],
            }),
          ],
        }),
        closedImagePlan: closedImageBackendPlanForTest({ privateConventions: [] }),
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected object module");
    expect(
      result.objectModule.symbols.map((symbol) => ({
        stableKey: String(symbol.stableKey),
        offsetBytes: symbol.offsetBytes,
      })),
    ).toEqual([
      { stableKey: "alpha", offsetBytes: 0 },
      { stableKey: "beta", offsetBytes: 8 },
    ]);
  });

  test("same backend input compiles to deeply equal object modules", () => {
    const input = packetLoopBackendInputForTest();

    const first = compileAArch64Object(input);
    const second = compileAArch64Object(input);

    expect(first.kind).toBe("ok");
    expect(second.kind).toBe("ok");
    if (first.kind !== "ok" || second.kind !== "ok")
      throw new Error("expected deterministic success");
    expect(first.objectModule).toEqual(second.objectModule);
    expect(first.diagnostics).toEqual(second.diagnostics);
    expect(first.verification).toEqual(second.verification);
  });

  test("consumes spill repair drafts during final lowering", () => {
    const result = compileAArch64Object(
      backendInputForTest({
        machineProgram: machineProgramForTest({
          functions: [spillPressureFunctionForTest()],
        }),
        closedImagePlan: closedImageBackendPlanForTest({ privateConventions: [] }),
        debugArtifacts: { allocationPlan: true, framePlan: true },
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected spill-repaired object module");
    expect(
      (result.debugArtifacts?.allocationPlan ?? []).some((entry) =>
        entry.includes(":repair:spill:"),
      ),
    ).toBe(true);
    expect(result.debugArtifacts?.framePlan).toEqual([
      "spill.pressure:serializable-unwind:size:32",
    ]);
    const bytes = result.objectModule.sections[0]?.bytes ?? [];
    expect(bytes.slice(0, 4)).toEqual([0xff, 0x83, 0x00, 0xd1]);
    expect(bytes).toContain(0xf9);
    expect(bytes.slice(-8)).toEqual([0xff, 0x83, 0x00, 0x91, 0xc0, 0x03, 0x5f, 0xd6]);
  });

  test("uses fact-backed constant rematerialization instead of spilling at use sites", () => {
    const result = compileAArch64Object(
      backendInputForTest({
        machineProgram: machineProgramForTest({
          functions: [spillPressureFunctionForTest()],
        }),
        preservedFacts: aarch64PreservedFactSet({
          targetDeclarations: ["target.remat"],
          records: [
            aarch64MachineFactRecord({
              factId: aarch64MachineFactId(79),
              extensionKey: "rematerialization-authority",
              subject: { kind: "virtualRegister", vreg: 6 },
              payload: { kind: "constant-remat", value: 7n },
              upstreamVerifierKey: "proof.remat",
              lineage: {
                optIrFactIds: [],
                targetDeclarationKeys: ["target.remat"],
              },
            }),
          ],
        }),
        closedImagePlan: closedImageBackendPlanForTest({ privateConventions: [] }),
        debugArtifacts: { allocationPlan: true, framePlan: true },
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected rematerialized object module");
    expect(result.debugArtifacts?.allocationPlan).toContain(
      "spill.pressure:repair:remat:live-range:vreg:6",
    );
    expect(result.debugArtifacts?.allocationPlan).not.toContain(
      "spill.pressure:repair:spill:live-range:vreg:6",
    );
    expect(result.debugArtifacts?.framePlan).toEqual([
      "spill.pressure:serializable-unwind:size:16",
    ]);
    expect(containsMoveWideImmediate(result.objectModule.sections[0]?.bytes ?? [], 7)).toBe(true);
  });

  test("propagates wipe-on-spill facts into spill repair frame layout", () => {
    const result = compileAArch64Object(
      backendInputForTest({
        machineProgram: machineProgramForTest({
          functions: [spillPressureFunctionForTest()],
        }),
        preservedFacts: aarch64PreservedFactSet({
          targetDeclarations: ["target.security"],
          records: [
            aarch64MachineFactRecord({
              factId: aarch64MachineFactId(77),
              extensionKey: "security.wipe-on-spill",
              subject: { kind: "virtualRegister", vreg: 8 },
              payload: { label: "session-key" },
              upstreamVerifierKey: "proof.security",
              lineage: {
                optIrFactIds: [],
                targetDeclarationKeys: ["target.security"],
              },
            }),
          ],
        }),
        closedImagePlan: closedImageBackendPlanForTest({ privateConventions: [] }),
        debugArtifacts: { allocationPlan: true, framePlan: true },
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected wipe-on-spill object module");
    expect(result.debugArtifacts?.allocationPlan).toContain(
      "spill.pressure:repair:spill:live-range:vreg:8",
    );
    expect(result.debugArtifacts?.framePlan).toEqual([
      "spill.pressure:serializable-unwind:size:32:wipe:spill-slot:vreg:8",
    ]);
    expect(result.objectModule.factSpending.map((record) => record.authority)).toContain(
      "security.wipe-on-spill",
    );
    expect((result.objectModule.sections[0]?.bytes ?? []).join(",")).toContain("9,0,128,210");
  });

  test("emits wipe-on-spill cleanup before trap exits", () => {
    const result = compileAArch64Object(
      backendInputForTest({
        machineProgram: machineProgramForTest({
          functions: [
            spillPressureFunctionForTest({
              terminator: aarch64TrapForTest({ instructionId: 12 }),
            }),
          ],
        }),
        preservedFacts: aarch64PreservedFactSet({
          targetDeclarations: ["target.security"],
          records: [
            aarch64MachineFactRecord({
              factId: aarch64MachineFactId(81),
              extensionKey: "security.wipe-on-spill",
              subject: { kind: "virtualRegister", vreg: 8 },
              payload: { label: "session-key" },
              upstreamVerifierKey: "proof.security",
              lineage: {
                optIrFactIds: [],
                targetDeclarationKeys: ["target.security"],
              },
            }),
          ],
        }),
        closedImagePlan: closedImageBackendPlanForTest({ privateConventions: [] }),
        debugArtifacts: { framePlan: true },
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected trap object module");
    expect(result.debugArtifacts?.framePlan).toEqual([
      "spill.pressure:serializable-unwind:size:32:wipe:spill-slot:vreg:8",
    ]);
    const bytes = result.objectModule.sections[0]?.bytes ?? [];
    const trapOffset = wordOffsets(bytes, [0x00, 0x00, 0x20, 0xd4])[0];
    const zeroOffsets = movzZeroOffsets(bytes);
    const wipeZeroOffset = zeroOffsets.at(-1);
    expect(trapOffset).toBeDefined();
    expect(wipeZeroOffset).toBeDefined();
    expect(zeroOffsets.length).toBeGreaterThanOrEqual(2);
    expect(wipeZeroOffset! < trapOffset!).toBe(true);
    expect(
      storeWordOffsets(bytes).some((offset) => wipeZeroOffset! < offset && offset < trapOffset!),
    ).toBe(true);
    expect(retWordOffsets(bytes).filter((offset) => offset > trapOffset!)).toEqual([]);
  });

  test("unmatched facts are not attached to arbitrary byte provenance", () => {
    const result = compileAArch64Object(
      backendInputForTest({
        machineProgram: machineProgramForTest({
          functions: [
            aarch64MachineFunctionForTest({
              instructions: [aarch64MovzForTest({ instructionId: 0, value: 7n })],
            }),
          ],
        }),
        preservedFacts: aarch64PreservedFactSet({
          targetDeclarations: ["target.security"],
          records: [
            aarch64MachineFactRecord({
              factId: aarch64MachineFactId(80),
              extensionKey: "security.no-spill",
              subject: { kind: "virtualRegister", vreg: 2 },
              payload: { label: "unrelated" },
              upstreamVerifierKey: "proof.security",
              targetDeclarationKeys: ["target.security"],
            }),
          ],
        }),
        closedImagePlan: closedImageBackendPlanForTest({ privateConventions: [] }),
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected object module");
    expect(result.objectModule.factSpending.map((record) => record.authority)).toEqual([
      "security.no-spill",
    ]);
    expect(
      result.objectModule.byteProvenance.some((record) =>
        record.factFamilies.includes("security.no-spill"),
      ),
    ).toBe(false);
  });

  test("distinct fact families on the same subject produce distinct fact spending records", () => {
    const result = compileAArch64Object(
      backendInputForTest({
        machineProgram: machineProgramForTest({
          functions: [
            aarch64MachineFunctionForTest({
              instructions: [aarch64MovzForTest({ instructionId: 1, value: 7n })],
            }),
          ],
        }),
        preservedFacts: aarch64PreservedFactSet({
          targetDeclarations: ["target.security"],
          records: [
            aarch64MachineFactRecord({
              factId: aarch64MachineFactId(82),
              extensionKey: "security.no-spill",
              subject: { kind: "virtualRegister", vreg: 1 },
              payload: { label: "session-key" },
              upstreamVerifierKey: "proof.security",
              targetDeclarationKeys: ["target.security"],
            }),
            aarch64MachineFactRecord({
              factId: aarch64MachineFactId(83),
              extensionKey: "security.wipe-on-spill",
              subject: { kind: "virtualRegister", vreg: 1 },
              payload: { label: "session-key" },
              upstreamVerifierKey: "proof.security",
              targetDeclarationKeys: ["target.security"],
            }),
          ],
        }),
        closedImagePlan: closedImageBackendPlanForTest({ privateConventions: [] }),
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected object module");
    expect(
      result.objectModule.factSpending.map((record) => ({
        stableKey: record.stableKey,
        authority: record.authority,
      })),
    ).toEqual([
      {
        stableKey:
          'fact-spent:security.no-spill:vreg:1|extension:security.no-spill|payload:{"label":"session-key"}|lineage:|target:target.security|gate:',
        authority: "security.no-spill",
      },
      {
        stableKey:
          'fact-spent:security.wipe-on-spill:vreg:1|extension:security.wipe-on-spill|payload:{"label":"session-key"}|lineage:|target:target.security|gate:',
        authority: "security.wipe-on-spill",
      },
    ]);
  });

  test("closed-image private calls consume private ABI reconciliation", () => {
    const result = compileAArch64Object(
      backendInputForTest({
        machineProgram: machineProgramForTest({
          functions: [
            aarch64MachineFunctionForTest({
              instructions: [aarch64CallForTest({ instructionId: 1, callee: "private.callee" })],
              terminator: aarch64RetForTest(),
            }),
          ],
        }),
        closedImagePlan: closedImageBackendPlanForTest({
          publicAbiBoundaries: publicBoundaryTableForTest([
            { caller: "fixture.function", callee: "private.callee" },
          ]),
          privateConventions: [
            privateConventionForTest({
              caller: "fixture.function",
              callee: "private.callee",
              clobberedGprs: ["x0", "x1"],
              pinnedLiveThroughGprs: ["x19"],
              potentialVeneerClobberGprs: ["x9"],
            }),
          ],
        }),
        debugArtifacts: { allocationPlan: true },
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected private ABI object module");
    expect(result.debugArtifacts?.allocationPlan).toContain(
      "fixture.function:call-boundary:private:call:fixture.function:private.callee:insn:1:clobber:x0,x1:vclobber::pin:x19:veneer:x9",
    );
    expect(result.objectModule.relocations[0]?.targetSymbol).toBe("private.callee");
  });

  test("private call ABI argument locations constrain final call argument registers", () => {
    const result = compileAArch64Object(
      backendInputForTest({
        machineProgram: machineProgramForTest({
          functions: [
            aarch64MachineFunctionForTest({
              instructions: [
                aarch64MovzForTest({ instructionId: 0, value: 7n }),
                aarch64CallWithArgumentForTest({
                  instructionId: 1,
                  callee: "private.callee",
                  argumentVreg: 0,
                }),
              ],
              terminator: aarch64RetForTest({ instructionId: 2 }),
            }),
          ],
        }),
        closedImagePlan: closedImageBackendPlanForTest({
          publicAbiBoundaries: publicBoundaryTableForTest([
            { caller: "fixture.function", callee: "private.callee" },
          ]),
          privateConventions: [
            privateConventionForTest({
              caller: "fixture.function",
              callee: "private.callee",
              argumentLocations: [{ valueKey: "arg0", location: { kind: "gpr", register: "x9" } }],
              clobberedGprs: [],
              potentialVeneerClobberGprs: [],
            }),
          ],
        }),
        debugArtifacts: { allocationPlan: true },
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected private ABI object module");
    expect(result.debugArtifacts?.allocationPlan).toContain("fixture.function:vreg:0:x9:0-1");
    expect(result.debugArtifacts?.allocationPlan).toContain("fixture.function:vreg:0:x9:1-2");
    expect(result.debugArtifacts?.allocationPlan).not.toContain("fixture.function:vreg:0:x0:0-1");
    const text = result.objectModule.sections.find(
      (section) => String(section.stableKey) === ".text",
    );
    expect(hasByteSequence(text?.bytes ?? [], [0xe9, 0x00, 0x80, 0xd2])).toBe(true);
  });

  test("propagates public vector call clobbers into allocation unavailable registers", () => {
    const target = authenticatedBackendTargetSurfaceForTest({
      registerModel: fakeRegisterModel({
        registerRecords: [
          ...Array.from({ length: 18 }, (unusedValue, index) => ({
            stableKey: `x${index}`,
            encodingNumber: index,
            aliasSet: `gpr:${index}`,
            isAllocatable: true,
          })),
          { stableKey: "x18", encodingNumber: 18, aliasSet: "gpr:18", isAllocatable: false },
          { stableKey: "x30", encodingNumber: 30, aliasSet: "gpr:30", isAllocatable: false },
          { stableKey: "sp", encodingNumber: 31, aliasSet: "sp", isAllocatable: false },
          { stableKey: "xzr", encodingNumber: 31, aliasSet: "xzr", isAllocatable: false },
          { stableKey: "wzr", encodingNumber: 31, aliasSet: "xzr", isAllocatable: false },
          ...Array.from({ length: 9 }, (unusedValue, index) => ({
            stableKey: `v${index}`,
            encodingNumber: index,
            aliasSet: `simd:${index}`,
            isAllocatable: true,
          })),
        ],
        publicCallerSavedGprs: [
          ...Array.from({ length: 18 }, (unusedValue, index) => `x${index}`),
          "x30",
        ],
        veneerScratchGprs: ["x16", "x17"],
      }),
    });
    const vectorType = aarch64VectorMachineType({
      laneType: aarch64IntMachineType(64),
      laneCount: 2,
    });
    const vector = aarch64VirtualRegister({
      vreg: aarch64VirtualRegisterId(1),
      registerClass: "vector128",
      type: vectorType,
      origin: { kind: "synthetic", stableKey: "fixture.vector.1" },
    });
    const liveAfterCallVector = aarch64VirtualRegister({
      vreg: aarch64VirtualRegisterId(2),
      registerClass: "vector128",
      type: vectorType,
      origin: { kind: "synthetic", stableKey: "fixture.vector.2" },
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
                  instructionId: aarch64MachineInstructionId(0),
                  opcode: aarch64OpcodeFormId("movi"),
                  operands: [defVreg(vector, vectorType), immediateOperand(0n, vectorType)],
                  flags: { mayTrap: false },
                  origin: syntheticAArch64Origin("test.vector"),
                }),
                aarch64CallForTest({ instructionId: 1, callee: "helper" }),
                aarch64MachineInstruction({
                  instructionId: aarch64MachineInstructionId(2),
                  opcode: aarch64OpcodeFormId("mov-vector"),
                  operands: [defVreg(liveAfterCallVector, vectorType), useVreg(vector, vectorType)],
                  flags: { mayTrap: false },
                  origin: syntheticAArch64Origin("test.vector.live.after.call"),
                }),
              ],
              terminator: aarch64RetForTest(),
            }),
          ],
        }),
        closedImagePlan: closedImageBackendPlanForTest({
          privateConventions: [],
          publicAbiBoundaries: publicBoundaryTableForTest([
            { caller: "fixture.function", callee: "helper" },
          ]),
        }),
        debugArtifacts: { allocationPlan: true },
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected public ABI object module");
    expect(result.debugArtifacts?.allocationPlan).toContain(
      "fixture.function:call-boundary:public:call:fixture.function:helper:insn:1:clobber:x0,x1,x10,x11,x12,x13,x14,x15,x16,x17,x2,x3,x30,x4,x5,x6,x7,x8,x9:vclobber:v0,v1,v2,v3,v4,v5,v6,v7:pin::veneer:x16,x17",
    );
    expect(
      (result.debugArtifacts?.allocationPlan ?? []).some((entry) =>
        entry.startsWith("fixture.function:vreg:1:v8:"),
      ),
    ).toBe(true);
  });

  test("no-spill allocation failure stops before object output", () => {
    const result = compileAArch64Object(
      backendInputForTest({
        machineProgram: machineProgramForTest({
          functions: [spillPressureFunctionForTest()],
        }),
        preservedFacts: aarch64PreservedFactSet({
          targetDeclarations: ["target.security"],
          records: [
            aarch64MachineFactRecord({
              factId: aarch64MachineFactId(78),
              extensionKey: "security.no-spill",
              subject: { kind: "virtualRegister", vreg: 8 },
              payload: { label: "session-key" },
              upstreamVerifierKey: "proof.security",
              lineage: {
                optIrFactIds: [],
                targetDeclarationKeys: ["target.security"],
              },
            }),
          ],
        }),
        closedImagePlan: closedImageBackendPlanForTest({ privateConventions: [] }),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected no-spill allocation failure");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail).join("|")).toContain(
      "allocation:no-spill-unallocatable:vreg:8",
    );
    expect(
      result.verification.runs.find((run) => run.verifierKey === "allocate-registers")?.status,
    ).toBe("failed");
  });

  test("relocation mapping failure is caught by final object verification", () => {
    const input = backendInputForTest({
      machineProgram: machineProgramForTest({
        functions: [
          aarch64MachineFunctionForTest({
            instructions: [aarch64CallForTest({ instructionId: 1, callee: "helper" })],
            terminator: aarch64RetForTest(),
          }),
        ],
      }),
      closedImagePlan: closedImageBackendPlanForTest({
        privateConventions: [],
        publicAbiBoundaries: publicBoundaryTableForTest([
          { caller: "fixture.function", callee: "helper" },
        ]),
      }),
    });
    const result = compileAArch64Object({
      ...input,
      target: {
        ...input.target,
        relocationCatalog: {
          ...input.target.relocationCatalog,
          mappingFor: (family) =>
            family === "branch26" ? undefined : input.target.relocationCatalog.mappingFor(family),
        },
      },
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected object verification failure");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "object-verifier:relocation-family-unmapped:reloc:insn:fixture.function:1:branch26",
    ]);
    expect(
      result.verification.runs.find((run) => run.verifierKey === "verify-object-module")?.status,
    ).toBe("failed");
  });

  test("packet loop provenance explains direct endian field load", () => {
    const result = compileAArch64Object({
      ...packetLoopBackendInputForTest(),
      debugArtifacts: { allocationPlan: true },
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected packet loop object");
    expect(result.objectModule.sections[0]?.bytes).toEqual([
      0x20, 0x08, 0x40, 0xf9, 0x01, 0x04, 0xc0, 0xda, 0xbf, 0x3b, 0x03, 0xd5, 0x9f, 0x3b, 0x03,
      0xd5, 0xc0, 0x03, 0x5f, 0xd6,
    ]);
    expect(result.debugArtifacts?.allocationPlan).toContain("packet.loop:vreg:1:x1:0-1");
    expect(result.objectModule.factSpending.map((record) => record.authority)).toEqual([
      "core-owner-and-transfer",
      "memory-order-and-region-type",
      "terminal-exit-and-cleanup",
      "validated-region-shape",
    ]);
    const endianByte = result.objectModule.byteProvenance.find(
      (record) =>
        record.factFamilies.includes("validated-region-shape") &&
        record.machineSubjectKey === "region:packet.field.ethertype",
    );
    expect(endianByte).toBeDefined();
  });
});
