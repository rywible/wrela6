import { describe, expect, test } from "bun:test";
import {
  AARCH64_MACHINE_VERIFIER_KEYS,
  defaultAArch64MachineVerifierSuite,
  verifyAArch64MachineProgram,
  type AArch64MachineVerifierDescriptor,
} from "../../../../src/target/aarch64/verify/machine-ir-verifier";
import {
  aarch64MachineBlockId,
  aarch64MachineFactId,
  aarch64FrameObjectId,
  aarch64MachineFunctionId,
  aarch64MachineInstructionId,
  aarch64MachineProgramId,
  aarch64SymbolId,
  aarch64VirtualRegisterId,
} from "../../../../src/target/aarch64/machine-ir/ids";
import { aarch64MachineBlock } from "../../../../src/target/aarch64/machine-ir/machine-block";
import {
  aarch64MachineFactRecord,
  aarch64PreservedFactSet,
} from "../../../../src/target/aarch64/machine-ir/fact-set";
import { aarch64FrameObject } from "../../../../src/target/aarch64/machine-ir/frame-object";
import { aarch64MachineFunction } from "../../../../src/target/aarch64/machine-ir/machine-function";
import { aarch64MachineInstruction } from "../../../../src/target/aarch64/machine-ir/machine-instruction";
import { aarch64MachineProgram } from "../../../../src/target/aarch64/machine-ir/machine-program";
import {
  aarch64FloatMachineType,
  aarch64IntMachineType,
  aarch64PointerMachineType,
  aarch64VectorMachineType,
} from "../../../../src/target/aarch64/machine-ir/machine-types";
import { aarch64MemoryOrderingMetadata } from "../../../../src/target/aarch64/machine-ir/memory-order";
import { aarch64OpcodeFormId } from "../../../../src/target/aarch64/machine-ir/opcode-catalog";
import {
  branchTarget,
  defVreg,
  immediateOperand,
  aarch64InstructionOperand,
  implicitDefResource,
  implicitUseResource,
  symbolOperand,
  useVreg,
} from "../../../../src/target/aarch64/machine-ir/operands";
import {
  emptyAArch64ProvenanceMap,
  syntheticAArch64Origin,
} from "../../../../src/target/aarch64/machine-ir/provenance";
import { aarch64SymbolReference } from "../../../../src/target/aarch64/machine-ir/symbol-reference";
import { aarch64VirtualRegister } from "../../../../src/target/aarch64/machine-ir/virtual-register";
import { aarch64ScheduleMetadata } from "../../../../src/target/aarch64/machine-ir/schedule";
import { aarch64SecurityMetadata } from "../../../../src/target/aarch64/machine-ir/security";
import {
  buildAArch64MachineDependencyGraph,
  requiredConstraintsForAArch64Function,
} from "../../../../src/target/aarch64/plan/machine-dependency-graph";

describe("AArch64 machine IR verifier suite", () => {
  test("declares the stable verifier key tuple and mechanically derives the default suite", () => {
    expect(AARCH64_MACHINE_VERIFIER_KEYS).toEqual([
      "structural",
      "nzcv",
      "abi",
      "regions",
      "facts",
      "tiling",
      "superselection",
      "memory-order",
      "scheduler",
      "fp-environment",
      "security",
    ]);
    expect(defaultAArch64MachineVerifierSuite.map((descriptor) => descriptor.key)).toEqual([
      ...AARCH64_MACHINE_VERIFIER_KEYS,
    ]);
  });

  test("returns ok for a minimal valid function with a constant producer and return", () => {
    expect(verifyAArch64MachineProgram({ program: validProgramForTest() })).toEqual({
      kind: "ok",
      diagnostics: [],
    });
  });

  test("root runner aggregates and sorts diagnostics from injected verifier descriptors", () => {
    const verifierSuite: readonly AArch64MachineVerifierDescriptor[] = [
      descriptorForTest("security", "z-detail"),
      descriptorForTest("abi", "a-detail"),
    ];

    const result = verifyAArch64MachineProgram({
      program: validProgramForTest(),
      verifierSuite,
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.orderKey)).toEqual([
      "code:AARCH64_ABI_CONTRACT_INVALID/owner:abi/root:test/detail:a-detail",
      "code:AARCH64_SECURITY_CONSTRAINT_INVALID/owner:security/root:test/detail:z-detail",
    ]);
  });

  test("rejects undefined virtual register uses before instruction defs", () => {
    const result = verifyAArch64MachineProgram({
      program: validProgramForTest({
        instructions: [
          aarch64MachineInstruction({
            instructionId: aarch64MachineInstructionId(20),
            opcode: aarch64OpcodeFormId("add-immediate"),
            operands: [
              defVreg(vregForTest(2), aarch64IntMachineType(64)),
              useVreg(vregForTest(1), aarch64IntMachineType(64)),
              immediateOperand(1n, aarch64IntMachineType(64)),
            ],
            flags: { mayTrap: false },
            origin: syntheticAArch64Origin("test:undefined-use"),
          }),
        ],
      }),
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toContain(
      "AARCH64_UNDEFINED_VIRTUAL_REGISTER",
    );
  });

  test("checks instruction schema and block operands against the machine function", () => {
    const malformed = {
      ...retForTest(30),
      opcode: aarch64OpcodeFormId("b"),
      operands: [branchTarget(aarch64MachineBlockId(99))],
    };

    const result = verifyAArch64MachineProgram({
      program: validProgramForTest({ terminator: malformed }),
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toEqual([
      "AARCH64_INPUT_CONTRACT_INVALID",
    ]);
  });

  test("structural verifier rejects vector operands on scalar opcode forms", () => {
    const vector = vectorVregForTest(10);
    const malformed = uncheckedInstructionForTest({
      instructionId: 80,
      opcode: "add-immediate",
      operands: [
        defVreg(vector, vector.type),
        useVreg(vector, vector.type),
        immediateOperand(0n, vector.type),
      ],
    });

    const result = verifyAArch64MachineProgram({
      program: validProgramForTest({
        instructions: [malformed],
        virtualRegisters: [vector],
      }),
    });

    expect(errorDetails(result)).toContain(
      "operand-register-class-mismatch:80:0:gpr32|gpr64:vector128",
    );
  });

  test("structural verifier rejects scalar operands on vector opcode forms", () => {
    const vector = vectorVregForTest(11);
    const malformed = uncheckedInstructionForTest({
      instructionId: 81,
      opcode: "cmeq",
      operands: [
        defVreg(vector, vector.type),
        useVreg(vregForTest(1), vregForTest(1).type),
        useVreg(vregForTest(1), vregForTest(1).type),
      ],
    });

    const result = verifyAArch64MachineProgram({
      program: validProgramForTest({
        instructions: [malformed],
        virtualRegisters: [vector],
      }),
    });

    expect(errorDetails(result)).toContain("operand-register-class-mismatch:81:1:vector128:gpr64");
  });

  test("structural verifier rejects overly broad specialized opcode operands", () => {
    const vector = vectorVregForTest(12);
    const scalar = vregForTest(13);
    const scalarPmull = uncheckedInstructionForTest({
      instructionId: 85,
      opcode: "pmull",
      operands: [
        defVreg(scalar, scalar.type),
        useVreg(scalar, scalar.type),
        useVreg(scalar, scalar.type),
      ],
    });
    const vectorCset = uncheckedInstructionForTest({
      instructionId: 86,
      opcode: "cset",
      operands: [
        defVreg(vector, vector.type),
        implicitUseResource({ kind: "NZCV" }),
        immediateOperand(0n, scalar.type),
      ],
    });
    const vectorPrefetch = uncheckedInstructionForTest({
      instructionId: 87,
      opcode: "prfm",
      operands: [
        aarch64InstructionOperand({
          role: "memoryBase",
          operand: { kind: "vreg", register: vector },
          type: vector.type,
        }),
      ],
    });

    const result = verifyAArch64MachineProgram({
      program: validProgramForTest({
        virtualRegisters: [vector, scalar],
        instructions: [scalarPmull, vectorCset, vectorPrefetch],
      }),
    });

    expect(errorDetails(result)).toEqual(
      expect.arrayContaining([
        "operand-register-class-mismatch:85:0:vector128:gpr64",
        "operand-register-class-mismatch:86:0:gpr32|gpr64:vector128",
        "operand-register-class-mismatch:87:0:gpr64:vector128",
      ]),
    );
  });

  test("structural verifier rejects invalid immediate domains in deserialized machine IR", () => {
    const scalar = vregForTest(14);
    const badCondition = uncheckedInstructionForTest({
      instructionId: 88,
      opcode: "cset",
      operands: [
        defVreg(scalar, scalar.type),
        implicitUseResource({ kind: "NZCV" }),
        immediateOperand(999n, scalar.type),
      ],
    });
    const badBitIndex = uncheckedInstructionForTest({
      instructionId: 89,
      opcode: "tbz",
      operands: [
        useVreg(scalar, scalar.type),
        immediateOperand(64n, scalar.type),
        branchTarget(aarch64MachineBlockId(0)),
      ],
    });
    const badMemoryOffset = uncheckedInstructionForTest({
      instructionId: 90,
      opcode: "ldr-unsigned-immediate",
      operands: [
        defVreg(scalar, scalar.type),
        aarch64InstructionOperand({
          role: "memoryBase",
          operand: { kind: "frameObject", frameObject: aarch64FrameObjectId(0) },
          type: aarch64PointerMachineType("stack"),
        }),
        immediateOperand(4095n * 16n, scalar.type),
      ],
    });
    const badMoveWideShift = uncheckedInstructionForTest({
      instructionId: 91,
      opcode: "movz",
      operands: [
        defVreg(scalar, scalar.type),
        immediateOperand(1n, scalar.type),
        immediateOperand(3n, scalar.type),
      ],
    });
    const gpr32 = aarch64VirtualRegister({
      vreg: aarch64VirtualRegisterId(91_001),
      registerClass: "gpr32",
      type: aarch64IntMachineType(32),
    });
    const badGpr32MoveWideShift = uncheckedInstructionForTest({
      instructionId: 98,
      opcode: "movk",
      operands: [
        aarch64InstructionOperand({
          role: "tiedDefUse",
          operand: { kind: "vreg", register: gpr32 },
          type: gpr32.type,
        }),
        immediateOperand(1n, gpr32.type),
        immediateOperand(32n, gpr32.type),
      ],
    });
    const validGpr32Definition = uncheckedInstructionForTest({
      instructionId: 87,
      opcode: "movz",
      operands: [
        defVreg(gpr32, gpr32.type),
        immediateOperand(1n, gpr32.type),
        immediateOperand(16n, gpr32.type),
      ],
    });
    const badLogicalImmediate = uncheckedInstructionForTest({
      instructionId: 92,
      opcode: "and-logical-immediate",
      operands: [
        defVreg(scalar, scalar.type),
        useVreg(scalar, scalar.type),
        immediateOperand(0n, scalar.type),
      ],
    });
    const badConditionalBranch = uncheckedInstructionForTest({
      instructionId: 93,
      opcode: "b-cond",
      operands: [implicitUseResource({ kind: "NZCV" }), branchTarget(aarch64MachineBlockId(0))],
    });
    const badAcquireOffset = uncheckedInstructionForTest({
      instructionId: 94,
      opcode: "ldar",
      operands: [
        defVreg(scalar, scalar.type),
        aarch64InstructionOperand({
          role: "memoryBase",
          operand: { kind: "frameObject", frameObject: aarch64FrameObjectId(0) },
          type: aarch64PointerMachineType("stack"),
        }),
        immediateOperand(8n, scalar.type),
      ],
    });
    const badConditionalSelect = uncheckedInstructionForTest({
      instructionId: 95,
      opcode: "csel",
      operands: [
        defVreg(scalar, scalar.type),
        useVreg(scalar, scalar.type),
        useVreg(scalar, scalar.type),
        implicitUseResource({ kind: "NZCV" }),
      ],
    });
    const badConditionalCompareFallback = uncheckedInstructionForTest({
      instructionId: 96,
      opcode: "ccmp",
      operands: [
        useVreg(scalar, scalar.type),
        useVreg(scalar, scalar.type),
        immediateOperand(16n, scalar.type),
        implicitDefResource({ kind: "NZCV" }),
        implicitUseResource({ kind: "NZCV" }),
        immediateOperand(0n, scalar.type),
      ],
    });
    const badConditionalCompareCondition = uncheckedInstructionForTest({
      instructionId: 97,
      opcode: "ccmp",
      operands: [
        useVreg(scalar, scalar.type),
        useVreg(scalar, scalar.type),
        immediateOperand(0n, scalar.type),
        implicitDefResource({ kind: "NZCV" }),
        implicitUseResource({ kind: "NZCV" }),
        immediateOperand(16n, scalar.type),
      ],
    });

    const result = verifyAArch64MachineProgram({
      program: validProgramForTest({
        virtualRegisters: [scalar, gpr32],
        instructions: [
          badCondition,
          validGpr32Definition,
          badBitIndex,
          badMemoryOffset,
          badMoveWideShift,
          badLogicalImmediate,
          badConditionalBranch,
          badAcquireOffset,
          badConditionalSelect,
          badConditionalCompareFallback,
          badConditionalCompareCondition,
          badGpr32MoveWideShift,
        ],
        frameObjects: [
          aarch64FrameObject({
            frameObjectId: aarch64FrameObjectId(0),
            kind: "local",
            size: 8,
            alignment: 8,
          }),
        ],
      }),
    });

    expect(errorDetails(result)).toEqual(
      expect.arrayContaining([
        "operand-immediate-domain-mismatch:88:2:condition:999",
        "operand-immediate-domain-mismatch:89:1:bitIndex64:64",
        "operand-immediate-domain-mismatch:90:2:unsignedMemoryOffset12:65520",
        "operand-immediate-domain-mismatch:91:2:moveWideShift:3",
        "operand-logical-immediate-unencodable:92:2:64:0",
        "schema:93:implicitUse,branchTarget:implicitUse,branchTarget,use",
        "schema:94:def,memoryBase,use:def,memoryBase",
        "schema:95:def,use,use,implicitUse:def,use,use,implicitUse,use",
        "operand-immediate-domain-mismatch:96:2:nzcvImmediate:16",
        "operand-immediate-domain-mismatch:97:5:condition:16",
        "operand-immediate-domain-mismatch:98:2:moveWideShift:32",
      ]),
    );
  });

  test("structural verifier rejects operand types that do not match virtual register types", () => {
    const malformed = uncheckedInstructionForTest({
      instructionId: 82,
      opcode: "add-immediate",
      operands: [
        defVreg(vregForTest(2), vregForTest(2).type),
        useVreg(vregForTest(1), aarch64IntMachineType(32)),
        immediateOperand(0n, aarch64IntMachineType(64)),
      ],
    });

    const result = verifyAArch64MachineProgram({
      program: validProgramForTest({
        instructions: [movzForTest(1, vregForTest(1), 7n), malformed],
      }),
    });

    expect(errorDetails(result)).toContain("operand-type-mismatch:82:1:i32:i64");
  });

  test("structural verifier rejects immediates in register-form opcode operands", () => {
    const malformed = uncheckedInstructionForTest({
      instructionId: 83,
      opcode: "add-shifted-register",
      operands: [
        defVreg(vregForTest(2), vregForTest(2).type),
        useVreg(vregForTest(1), vregForTest(1).type),
        immediateOperand(1n, aarch64IntMachineType(64)),
      ],
    });

    const result = verifyAArch64MachineProgram({
      program: validProgramForTest({ instructions: [malformed] }),
    });

    expect(errorDetails(result)).toContain("operand-kind-mismatch:83:2:vreg:immediate");
  });

  test("structural verifier rejects malformed memory address operands", () => {
    const malformed = uncheckedInstructionForTest({
      instructionId: 84,
      opcode: "ldr-unsigned-immediate",
      operands: [
        defVreg(vregForTest(2), vregForTest(2).type),
        aarch64InstructionOperand({
          role: "memoryBase",
          operand: { kind: "immediate", value: 0n },
          type: aarch64PointerMachineType("stack"),
        }),
      ],
    });

    const result = verifyAArch64MachineProgram({
      program: validProgramForTest({ instructions: [malformed] }),
    });

    expect(errorDetails(result)).toContain("operand-kind-mismatch:84:1:vreg|frameObject:immediate");
  });

  test("structural verifier rejects malformed branch target operands", () => {
    const malformed = uncheckedInstructionForTest({
      instructionId: 98,
      opcode: "b",
      operands: [
        aarch64InstructionOperand({
          role: "branchTarget",
          operand: { kind: "immediate", value: 0n },
          type: aarch64IntMachineType(64),
        }),
      ],
    });

    const result = verifyAArch64MachineProgram({
      program: validProgramForTest({ terminator: malformed }),
    });

    expect(errorDetails(result)).toContain("operand-kind-mismatch:98:0:block:immediate");
  });

  test("structural verifier rejects duplicate instruction ids", () => {
    const result = verifyAArch64MachineProgram({
      program: validProgramForTest({
        instructions: [movzForTest(77, vregForTest(1), 7n)],
        terminator: retForTest(77),
      }),
    });

    expect(errorDetails(result)).toContain("duplicate-instruction-id:77:block:0:block:0");
  });

  test("security verifier rejects secret-dependent conditional terminators", () => {
    const result = verifyAArch64MachineProgram({
      program: validProgramForTest({
        terminator: aarch64MachineInstruction({
          instructionId: aarch64MachineInstructionId(84),
          opcode: aarch64OpcodeFormId("cbnz"),
          operands: [
            useVreg(vregForTest(1), aarch64IntMachineType(64)),
            branchTarget(aarch64MachineBlockId(0)),
          ],
          flags: { mayTrap: false, isTerminator: true },
          origin: syntheticAArch64Origin("test:secret-cbnz"),
          security: aarch64SecurityMetadata({
            labels: [{ kind: "secret", key: "condition" }],
            constantTime: true,
            spillPolicy: "ordinary",
          }),
        }),
      }),
    });

    expect(errorDetails(result)).toContain("secret-dependent-control:branch");
  });

  test("structural verifier rejects unterminated blocks", () => {
    const result = verifyAArch64MachineProgram({
      program: validProgramForTest({ terminator: undefined, omitTerminator: true }),
    });

    expect(errorDetails(result)).toContain("missing-terminator:block:0");
  });

  test("structural verifier accepts entry block even when its id is not sorted first", () => {
    const cold = aarch64MachineBlock({
      blockId: aarch64MachineBlockId(0),
      frequency: { kind: "cold" },
      instructions: [],
      terminator: retForTest(3),
    });
    const entry = aarch64MachineBlock({
      blockId: aarch64MachineBlockId(9),
      frequency: { kind: "entry" },
      instructions: [],
      terminator: retForTest(4),
    });
    const symbol = aarch64SymbolId("test.entry");
    const program = aarch64MachineProgram({
      programId: aarch64MachineProgramId(9),
      functions: [
        aarch64MachineFunction({
          functionId: aarch64MachineFunctionId(1),
          symbol,
          virtualRegisters: [],
          parameters: [],
          returns: [],
          frameObjects: [],
          blocks: [entry, cold],
        }),
      ],
      globalSymbols: [aarch64SymbolReference({ symbol, visibility: "global", section: "text" })],
      entrySymbol: symbol,
      targetFingerprint: "target:test",
      consultedSubsurfaceFingerprints: [],
      provenance: emptyAArch64ProvenanceMap(),
    });

    expect(verifyAArch64MachineProgram({ program })).toEqual({ kind: "ok", diagnostics: [] });
  });

  test("structural verifier rejects uses defined only in unrelated blocks", () => {
    const crossBlockOnly = vregForTest(30);
    const entryOutput = vregForTest(31);
    const entry = aarch64MachineBlock({
      blockId: aarch64MachineBlockId(0),
      frequency: { kind: "entry" },
      instructions: [
        aarch64MachineInstruction({
          instructionId: aarch64MachineInstructionId(110),
          opcode: aarch64OpcodeFormId("add-immediate"),
          operands: [
            defVreg(entryOutput, entryOutput.type),
            useVreg(crossBlockOnly, crossBlockOnly.type),
            immediateOperand(1n, entryOutput.type),
          ],
          flags: { mayTrap: false },
          origin: syntheticAArch64Origin("test:cross-block-use"),
        }),
      ],
      terminator: retForTest(111),
    });
    const cold = aarch64MachineBlock({
      blockId: aarch64MachineBlockId(1),
      frequency: { kind: "cold" },
      instructions: [movzForTest(112, crossBlockOnly, 7n)],
      terminator: retForTest(113),
    });
    const symbol = aarch64SymbolId("test.entry");
    const program = aarch64MachineProgram({
      programId: aarch64MachineProgramId(10),
      functions: [
        aarch64MachineFunction({
          functionId: aarch64MachineFunctionId(1),
          symbol,
          virtualRegisters: [crossBlockOnly, entryOutput],
          parameters: [],
          returns: [],
          frameObjects: [],
          blocks: [entry, cold],
        }),
      ],
      globalSymbols: [aarch64SymbolReference({ symbol, visibility: "global", section: "text" })],
      entrySymbol: symbol,
      targetFingerprint: "target:test",
      consultedSubsurfaceFingerprints: [],
      provenance: emptyAArch64ProvenanceMap(),
    });

    expect(errorDetails(verifyAArch64MachineProgram({ program }))).toContain(
      "undefined-vreg:110:30",
    );
  });

  test("structural verifier accepts cross-block uses from dominating definitions", () => {
    const crossBlockValue = vregForTest(32);
    const successorOutput = vregForTest(33);
    const entry = aarch64MachineBlock({
      blockId: aarch64MachineBlockId(9),
      frequency: { kind: "entry" },
      instructions: [movzForTest(115, crossBlockValue, 7n)],
      terminator: aarch64MachineInstruction({
        instructionId: aarch64MachineInstructionId(116),
        opcode: aarch64OpcodeFormId("b"),
        operands: [branchTarget(aarch64MachineBlockId(0))],
        flags: { mayTrap: false, isTerminator: true },
        origin: syntheticAArch64Origin("test:dominating-branch"),
      }),
    });
    const successor = aarch64MachineBlock({
      blockId: aarch64MachineBlockId(0),
      frequency: { kind: "warm" },
      instructions: [
        aarch64MachineInstruction({
          instructionId: aarch64MachineInstructionId(117),
          opcode: aarch64OpcodeFormId("add-immediate"),
          operands: [
            defVreg(successorOutput, successorOutput.type),
            useVreg(crossBlockValue, crossBlockValue.type),
            immediateOperand(1n, successorOutput.type),
          ],
          flags: { mayTrap: false },
          origin: syntheticAArch64Origin("test:dominated-use"),
        }),
      ],
      terminator: retForTest(118),
    });
    const symbol = aarch64SymbolId("test.entry");
    const program = aarch64MachineProgram({
      programId: aarch64MachineProgramId(11),
      functions: [
        aarch64MachineFunction({
          functionId: aarch64MachineFunctionId(1),
          symbol,
          virtualRegisters: [crossBlockValue, successorOutput],
          parameters: [],
          returns: [],
          frameObjects: [],
          blocks: [successor, entry],
        }),
      ],
      globalSymbols: [aarch64SymbolReference({ symbol, visibility: "global", section: "text" })],
      entrySymbol: symbol,
      targetFingerprint: "target:test",
      consultedSubsurfaceFingerprints: [],
      provenance: emptyAArch64ProvenanceMap(),
    });

    expect(verifyAArch64MachineProgram({ program })).toEqual({ kind: "ok", diagnostics: [] });
  });

  test("structural verifier rejects non-terminators in the terminator slot", () => {
    const malformed = uncheckedInstructionForTest({
      instructionId: 114,
      opcode: "add-immediate",
      operands: [
        defVreg(vregForTest(2), vregForTest(2).type),
        useVreg(vregForTest(1), vregForTest(1).type),
        immediateOperand(0n, aarch64IntMachineType(64)),
      ],
    });

    const result = verifyAArch64MachineProgram({
      program: validProgramForTest({ terminator: malformed }),
    });

    expect(errorDetails(result)).toContain("non-terminator-in-terminator-slot:114");
  });

  test("production verifier families remain implemented when required", () => {
    const withoutRequiredFamilies = verifyAArch64MachineProgram({ program: validProgramForTest() });
    const withRequiredFamilies = verifyAArch64MachineProgram({
      program: validProgramForTest(),
      options: { requiredVerifierKeys: ["abi", "security"] },
    });

    expect(withoutRequiredFamilies.kind).toBe("ok");
    expect(withRequiredFamilies).toEqual({ kind: "ok", diagnostics: [] });
  });

  test("required context-backed verifiers fail closed when context is missing", () => {
    const result = verifyAArch64MachineProgram({
      program: validProgramForTest(),
      options: { requiredVerifierKeys: ["facts", "tiling", "scheduler"] },
    });

    expect(errorDetails(result)).toEqual([
      "verifier-context-missing:facts:preservedFacts",
      "verifier-context-missing:scheduler:dependencyEdges",
      "verifier-context-missing:scheduler:requiredEdges",
      "verifier-context-missing:tiling:selectionCandidates",
    ]);
  });

  test("fact verifier rejects preserved facts for missing machine subjects", () => {
    const result = verifyAArch64MachineProgram({
      program: validProgramForTest(),
      preservedFacts: aarch64PreservedFactSet({
        records: [
          aarch64MachineFactRecord({
            factId: aarch64MachineFactId(0),
            subject: { kind: "machineInstruction", instructionId: 999 },
            payload: { fixture: "missing-subject" },
            lineage: { optIrFactIds: [1 as never], targetDeclarationKeys: ["target:test"] },
          }),
        ],
        targetDeclarations: ["target:test"],
      }),
      preservedOptIrFactIds: [1],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected missing subject diagnostic");
    expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toContain(
      "AARCH64_FACT_PRESERVATION_INVALID",
    );
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "missing-machine-subject:instruction:999|lineage:1|target:target:test|gate:",
    );
  });

  test("fact verifier rejects missing target declarations and invalid memory operands", () => {
    const base = vregForTest(3);
    const load = aarch64MachineInstruction({
      instructionId: aarch64MachineInstructionId(40),
      opcode: aarch64OpcodeFormId("ldr-unsigned-immediate"),
      operands: [
        defVreg(vregForTest(2), aarch64IntMachineType(64)),
        aarch64InstructionOperand({
          role: "memoryBase",
          operand: { kind: "vreg", register: base },
          type: base.type,
        }),
      ],
      flags: { mayTrap: false, mayLoad: true },
      origin: syntheticAArch64Origin("test:load"),
    });
    const result = verifyAArch64MachineProgram({
      program: validProgramForTest({ instructions: [load], virtualRegisters: [base] }),
      preservedFacts: aarch64PreservedFactSet({
        records: [
          aarch64MachineFactRecord({
            factId: aarch64MachineFactId(1),
            subject: { kind: "memoryOperand", instructionId: 40, operandIndex: 999 },
            lineage: { optIrFactIds: [2 as never], targetDeclarationKeys: ["target:missing"] },
          }),
        ],
        targetDeclarations: ["target:test"],
      }),
      preservedOptIrFactIds: [2],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected fact verifier diagnostics");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual(
      expect.arrayContaining([
        "missing-target-declaration:target:missing",
        "missing-machine-subject:memory:40:999|lineage:2|target:target:missing|gate:",
      ]),
    );
  });

  test("fact verifier rejects machine facts that cite dropped OptIR facts", () => {
    const result = verifyAArch64MachineProgram({
      program: validProgramForTest(),
      preservedFacts: aarch64PreservedFactSet({
        records: [
          aarch64MachineFactRecord({
            factId: aarch64MachineFactId(2),
            subject: { kind: "machineInstruction", instructionId: 1 },
            payload: { fixture: "dropped-lineage" },
            lineage: { optIrFactIds: [2 as never], targetDeclarationKeys: ["target:test"] },
          }),
        ],
        droppedFacts: [{ optIrFactId: 2 as never, reason: "fixture-invalidated" }],
        targetDeclarations: ["target:test"],
      }),
      preservedOptIrFactIds: [2],
    });

    expect(errorDetails(result)).toContain("dropped-fact-preserved:optIrFact:2");
  });

  test("default suite reports superselection hidden live-outs", () => {
    const result = verifyAArch64MachineProgram({
      program: validProgramForTest(),
      semanticCandidates: [
        {
          patternId: "semantic.hidden",
          consumedOperations: [1],
          liveOuts: ["secret-live-out"],
          effects: [],
        },
      ],
      semanticManifestLiveOuts: { "semantic.hidden": [] },
    });

    expect(errorDetails(result)).toContain("semantic-boundary:hidden-live-out");
  });

  test("ABI verifier reports invalid placements and missing stack argument areas", () => {
    const result = verifyAArch64MachineProgram({
      program: validProgramForTest({
        parameters: [
          { valueKey: "arg0", location: { kind: "intReg", index: 8 } },
          {
            valueKey: "stack0",
            location: { kind: "stackArg", ordinal: 0, offsetBytes: 4, size: 12, alignment: 8 },
          },
        ],
      }),
    });

    expect(errorDetails(result)).toEqual(
      expect.arrayContaining([
        "parameter-int-reg-out-of-range:x8",
        "parameter-stack-arg-layout-invalid:0:4:12:8",
        "stack-arg-area-missing",
      ]),
    );
  });

  test("ABI verifier rejects deserialized locations that bypass constructor lower bounds", () => {
    const result = verifyAArch64MachineProgram({
      program: validProgramForTest({
        parameters: [
          { valueKey: "negative-int", location: { kind: "intReg", index: -1 } },
          { valueKey: "negative-vector", location: { kind: "vectorReg", index: -1 } },
          {
            valueKey: "negative-stack",
            location: { kind: "stackArg", ordinal: -1, offsetBytes: -8, size: -8, alignment: -8 },
          },
        ],
        returns: [{ kind: "indirectResultPointer", index: -1 }],
      }),
    });

    expect(errorDetails(result)).toEqual(
      expect.arrayContaining([
        "parameter-int-reg-out-of-range:x-1",
        "parameter-vector-reg-out-of-range:v-1",
        "parameter-stack-arg-layout-invalid:-1:-8:-8:-8",
        "return-indirect-result-out-of-range:x-1",
      ]),
    );
  });

  test("ABI verifier rejects overlapping stack argument ranges and undersized areas", () => {
    const result = verifyAArch64MachineProgram({
      program: validProgramForTest({
        parameters: [
          {
            valueKey: "stack0",
            location: { kind: "stackArg", ordinal: 0, offsetBytes: 0, size: 16, alignment: 16 },
          },
          {
            valueKey: "stack1",
            location: { kind: "stackArg", ordinal: 1, offsetBytes: 8, size: 16, alignment: 8 },
          },
        ],
        frameObjects: [
          aarch64FrameObject({
            frameObjectId: aarch64FrameObjectId(0),
            kind: "incomingArg",
            size: 16,
            alignment: 16,
          }),
        ],
      }),
    });

    expect(errorDetails(result)).toEqual(
      expect.arrayContaining([
        "stack-arg-range-overlap:stack0:stack1:0:16:8:24",
        "stack-arg-area-too-small:16:32",
      ]),
    );
  });

  test("region verifier reports device domain and access-shape violations", () => {
    const base = vregForTest(3);
    const output = vregForTest(4);
    const result = verifyAArch64MachineProgram({
      program: validProgramForTest({
        virtualRegisters: [base, output],
        instructions: [
          loadForTest(50, output, base, {
            order: "relaxed",
            regionMemoryType: "deviceMmio",
            barrierDomain: { domain: "nonShareable", access: "loads" },
            atomicity: "nonAtomic",
          }),
        ],
      }),
    });

    expect(errorDetails(result)).toContain("region-domain-invalid:deviceMmio:nonShareable");
  });

  test("memory-order verifier reports opcode and required-edge mismatches", () => {
    const base = vregForTest(5);
    const output = vregForTest(6);
    const result = verifyAArch64MachineProgram({
      program: validProgramForTest({
        virtualRegisters: [base, output],
        instructions: [
          loadForTest(60, output, base, {
            order: "acquire",
            regionMemoryType: "normalCacheable",
            barrierDomain: { domain: "system", access: "loads" },
            atomicity: "singleCopyAtomic",
          }),
        ],
      }),
      dependencyEdges: [],
      requiredEdges: [
        {
          fromInstruction: 60,
          toInstruction: 2,
          kind: "memory",
          requiredBy: ["memory-order"],
        },
      ],
    });

    expect(errorDetails(result)).toEqual(
      expect.arrayContaining([
        "acquire-load-opcode-invalid:ldr-unsigned-immediate",
        "memory-order-edge-missing:60:2",
      ]),
    );
  });

  test("memory-order verifier rejects incomplete seq-cst non-LSE load and store sequences", () => {
    const base = vregForTest(12);
    const stored = vregForTest(13);
    const invalidLoadOutput = vregForTest(14);
    const missingBarrierOutput = vregForTest(15);
    const sequentiallyConsistent = {
      order: "sequentiallyConsistent" as const,
      regionMemoryType: "normalCacheable" as const,
      barrierDomain: { domain: "system" as const, access: "loadsAndStores" as const },
      atomicity: "singleCopyAtomic" as const,
    };
    const result = verifyAArch64MachineProgram({
      program: validProgramForTest({
        virtualRegisters: [base, stored, invalidLoadOutput, missingBarrierOutput],
        instructions: [
          movzForTest(88, base, 0n),
          movzForTest(89, stored, 1n),
          loadForTest(90, invalidLoadOutput, base, sequentiallyConsistent),
          loadForTest(91, missingBarrierOutput, base, sequentiallyConsistent, "ldar"),
          storeForTest(92, stored, base, sequentiallyConsistent),
          storeForTest(93, stored, base, sequentiallyConsistent, "stlr"),
        ],
      }),
    });

    expect(errorDetails(result)).toEqual(
      expect.arrayContaining([
        "seq-cst-load-opcode-invalid:ldr-unsigned-immediate",
        "seq-cst-load-missing-leading-dmb",
        "seq-cst-store-opcode-invalid:str-unsigned-immediate",
        "seq-cst-store-missing-trailing-dmb",
      ]),
    );
  });

  test("memory-order verifier accepts seq-cst barriers across direct block boundaries", () => {
    const base = vregForTest(16);
    const stored = vregForTest(17);
    const loaded = vregForTest(18);
    const sequentiallyConsistent = {
      order: "sequentiallyConsistent" as const,
      regionMemoryType: "normalCacheable" as const,
      barrierDomain: { domain: "system" as const, access: "loadsAndStores" as const },
      atomicity: "singleCopyAtomic" as const,
    };
    const symbol = aarch64SymbolId("test.seqcst.cross.block");
    const program = aarch64MachineProgram({
      programId: aarch64MachineProgramId(12),
      functions: [
        aarch64MachineFunction({
          functionId: aarch64MachineFunctionId(2),
          symbol,
          virtualRegisters: [base, stored, loaded],
          parameters: [],
          returns: [],
          frameObjects: [],
          blocks: [
            aarch64MachineBlock({
              blockId: aarch64MachineBlockId(0),
              frequency: { kind: "entry" },
              instructions: [
                movzForTest(150, base, 0n),
                movzForTest(151, stored, 1n),
                dmbForTest(152),
              ],
              terminator: branchForTest(153, 1),
            }),
            aarch64MachineBlock({
              blockId: aarch64MachineBlockId(1),
              instructions: [
                loadForTest(154, loaded, base, sequentiallyConsistent, "ldar"),
                storeForTest(155, stored, base, sequentiallyConsistent, "stlr"),
              ],
              terminator: branchForTest(156, 2),
            }),
            aarch64MachineBlock({
              blockId: aarch64MachineBlockId(2),
              instructions: [dmbForTest(157)],
              terminator: retForTest(158),
            }),
          ],
        }),
      ],
      globalSymbols: [aarch64SymbolReference({ symbol, visibility: "global", section: "text" })],
      entrySymbol: symbol,
      targetFingerprint: "target:test",
      consultedSubsurfaceFingerprints: [],
      provenance: emptyAArch64ProvenanceMap(),
    });

    expect(verifyAArch64MachineProgram({ program })).toEqual({ kind: "ok", diagnostics: [] });
  });

  test("memory-order verifier checks exact LSE atomic suffixes", () => {
    const base = vregForTest(7);
    const input = vregForTest(8);
    const acquireOutput = vregForTest(9);
    const releaseOutput = vregForTest(10);
    const seqCstOutput = vregForTest(11);
    const result = verifyAArch64MachineProgram({
      program: validProgramForTest({
        virtualRegisters: [base, input, acquireOutput, releaseOutput, seqCstOutput],
        instructions: [
          movzForTest(70, input, 1n),
          movzForTest(71, base, 16n),
          atomicAddForTest(72, "ldadd", input, acquireOutput, base, "acquire"),
          atomicAddForTest(73, "ldadd", input, releaseOutput, base, "release"),
          atomicAddForTest(74, "ldaddl", input, seqCstOutput, base, "sequentiallyConsistent"),
        ],
      }),
    });

    expect(errorDetails(result)).toEqual(
      expect.arrayContaining([
        "lse-atomic-suffix-invalid:acquire:ldadd",
        "lse-atomic-suffix-invalid:release:ldadd",
        "lse-atomic-suffix-invalid:sequentiallyConsistent:ldaddl",
      ]),
    );
  });

  test("scheduler verifier rejects missing planning metadata when dependency context is supplied", () => {
    const result = verifyAArch64MachineProgram({
      program: validProgramForTest(),
      dependencyEdges: [],
      requiredEdges: [],
    });

    expect(errorDetails(result)).toContain("planning-metadata-missing");
  });

  test("scheduler verifier rejects persisted schedule order that violates a dependency edge", () => {
    const result = verifyAArch64MachineProgram({
      program: validProgramForTest({
        schedulePlan: ["dependency-graph:edges:1", "schedule:block:0:0:2,1"],
      }),
      dependencyEdges: [
        {
          fromInstruction: 1,
          toInstruction: 2,
          kind: "register",
          resource: "vreg",
          requiredBy: ["vreg"],
        },
      ],
      requiredEdges: [
        {
          fromInstruction: 1,
          toInstruction: 2,
          kind: "register",
          resource: "vreg",
          requiredBy: ["vreg"],
        },
      ],
      scheduleOrderByBlock: { "0:0": [2, 1] },
    });

    expect(errorDetails(result)).toContain("schedule-order-violates-edge:1:2:register");
  });

  test("scheduler verifier rejects physical instruction order dependency violations", () => {
    const result = verifyAArch64MachineProgram({
      program: validProgramForTest({
        instructions: [movzForTest(2, vregForTest(2), 8n), movzForTest(1, vregForTest(1), 7n)],
        terminator: retForTest(3),
        schedulePlan: ["dependency-graph:edges:1", "schedule:block:0:0:1,2,3"],
      }),
      dependencyEdges: [
        {
          fromInstruction: 1,
          toInstruction: 2,
          kind: "register",
          resource: "vreg",
          requiredBy: ["vreg"],
        },
      ],
      requiredEdges: [
        {
          fromInstruction: 1,
          toInstruction: 2,
          kind: "register",
          resource: "vreg",
          requiredBy: ["vreg"],
        },
      ],
      scheduleOrderByBlock: { "0:0": [1, 2, 3] },
    });

    expect(errorDetails(result)).toContain("physical-order-violates-edge:1:2:register");
  });

  test("scheduler verifier rejects call-result copies scheduled before their call", () => {
    const abiReturn = aarch64VirtualRegister({
      vreg: aarch64VirtualRegisterId(30),
      registerClass: "gpr64",
      type: aarch64IntMachineType(64),
      origin: { kind: "synthetic", stableKey: "opt-ir:9:abi-return:x0:0" },
    });
    const output = aarch64VirtualRegister({
      vreg: aarch64VirtualRegisterId(31),
      registerClass: "gpr64",
      type: aarch64IntMachineType(64),
    });
    const call = aarch64MachineInstruction({
      instructionId: aarch64MachineInstructionId(1),
      opcode: aarch64OpcodeFormId("bl"),
      operands: [
        symbolOperand(aarch64SymbolId("test.entry")),
        implicitDefResource({ kind: "NZCV" }),
        implicitDefResource({ kind: "FPCR" }),
        implicitDefResource({ kind: "FPSR" }),
        implicitDefResource({ kind: "vectorState" }),
      ],
      flags: { mayTrap: false },
      origin: syntheticAArch64Origin("test:call-result-order:call"),
    });
    const resultCopy = aarch64MachineInstruction({
      instructionId: aarch64MachineInstructionId(2),
      opcode: aarch64OpcodeFormId("add-immediate"),
      operands: [
        defVreg(output, output.type),
        useVreg(abiReturn, abiReturn.type),
        immediateOperand(0n, output.type),
      ],
      flags: { mayTrap: false },
      origin: syntheticAArch64Origin("test:call-result-order:copy"),
    });
    const program = validProgramForTest({
      virtualRegisters: [abiReturn, output],
      instructions: [call, resultCopy],
      terminator: retForTest(3),
      schedulePlan: ["dependency-graph:edges:2", "schedule:block:0:0:2,1,3"],
    });
    const machineFunction = program.functions.entries()[0];
    if (machineFunction === undefined) throw new Error("expected machine function");
    const requiredEdges = requiredConstraintsForAArch64Function(machineFunction).edges;
    const dependencyEdges = buildAArch64MachineDependencyGraph({
      machineFunction,
      requiredConstraints: { edges: requiredEdges },
    }).edges;

    const result = verifyAArch64MachineProgram({
      program,
      dependencyEdges,
      requiredEdges,
      scheduleOrderByBlock: { "0:0": [2, 1, 3] },
    });

    expect(errorDetails(result)).toContain("schedule-order-violates-edge:1:2:call");
  });

  test("FP verifier reports missing contraction authority through default suite", () => {
    const output = fpVregForTest(7);
    const left = fpVregForTest(8);
    const right = fpVregForTest(9);
    const addend = fpVregForTest(10);
    const result = verifyAArch64MachineProgram({
      program: validProgramForTest({
        virtualRegisters: [output, left, right, addend],
        instructions: [
          aarch64MachineInstruction({
            instructionId: aarch64MachineInstructionId(70),
            opcode: aarch64OpcodeFormId("fmadd"),
            operands: [
              defVreg(output, output.type),
              useVreg(left, left.type),
              useVreg(right, right.type),
              useVreg(addend, addend.type),
              implicitUseResource({ kind: "FPCR" }),
              implicitDefResource({ kind: "FPSR" }),
            ],
            flags: { mayTrap: false },
            origin: syntheticAArch64Origin("test:fmadd"),
            schedule: aarch64ScheduleMetadata({
              issueClass: "fp",
              latencyClass: "singleCycle",
              motion: { kind: "insideEffectIsland" },
              pairability: [],
              pressure: { gpr: 0, vector: 0 },
              errataConstraints: [],
            }),
          }),
        ],
      }),
    });

    expect(errorDetails(result)).toContain(
      "fp-numeric-authority-missing:fmadd:fp-contraction-authorized",
    );
  });

  test("security verifier reports metadata loss for protected registers", () => {
    const secure = aarch64VirtualRegister({
      vreg: aarch64VirtualRegisterId(11),
      registerClass: "gpr64",
      type: aarch64IntMachineType(64),
      securityLabels: [{ kind: "noSpill", key: "secret" }],
    });
    const result = verifyAArch64MachineProgram({
      program: validProgramForTest({
        virtualRegisters: [secure],
        instructions: [
          aarch64MachineInstruction({
            instructionId: aarch64MachineInstructionId(80),
            opcode: aarch64OpcodeFormId("movz"),
            operands: [defVreg(secure, secure.type), immediateOperand(1n, secure.type)],
            flags: { mayTrap: false },
            origin: syntheticAArch64Origin("test:secret-without-security"),
          }),
        ],
        frameObjects: [
          aarch64FrameObject({
            frameObjectId: aarch64FrameObjectId(0),
            kind: "local",
            size: 8,
            alignment: 8,
            security: aarch64SecurityMetadata({
              labels: [{ kind: "noSpill", key: "secret" }],
              constantTime: false,
              spillPolicy: "noSpill",
            }),
          }),
        ],
      }),
    });

    expect(errorDetails(result)).toEqual(
      expect.arrayContaining([
        "no-spill-value-materialized-in-frame",
        "security-policy-not-preserved:noSpill:11",
      ]),
    );
  });
});

function descriptorForTest(
  key: AArch64MachineVerifierDescriptor["key"],
  stableDetail: string,
): AArch64MachineVerifierDescriptor {
  return {
    key,
    verify({ makeDiagnostic }) {
      return [
        makeDiagnostic({
          code:
            key === "abi" ? "AARCH64_ABI_CONTRACT_INVALID" : "AARCH64_SECURITY_CONSTRAINT_INVALID",
          ownerKey: key,
          rootCauseKey: "test",
          stableDetail,
        }),
      ];
    },
  };
}

function validProgramForTest(
  input: {
    readonly instructions?: readonly ReturnType<typeof aarch64MachineInstruction>[];
    readonly terminator?: ReturnType<typeof aarch64MachineInstruction>;
    readonly virtualRegisters?: readonly ReturnType<typeof vregForTest>[];
    readonly parameters?: Parameters<typeof aarch64MachineFunction>[0]["parameters"];
    readonly returns?: Parameters<typeof aarch64MachineFunction>[0]["returns"];
    readonly frameObjects?: Parameters<typeof aarch64MachineFunction>[0]["frameObjects"];
    readonly schedulePlan?: readonly string[];
    readonly omitTerminator?: boolean;
  } = {},
) {
  const value = vregForTest(1);
  const entry = aarch64MachineBlock({
    blockId: aarch64MachineBlockId(0),
    frequency: { kind: "entry" },
    instructions: input.instructions ?? [
      aarch64MachineInstruction({
        instructionId: aarch64MachineInstructionId(1),
        opcode: aarch64OpcodeFormId("movz"),
        operands: [
          defVreg(value, aarch64IntMachineType(64)),
          immediateOperand(7n, aarch64IntMachineType(64)),
        ],
        flags: { mayTrap: false },
        origin: syntheticAArch64Origin("test:const"),
      }),
    ],
    ...(input.omitTerminator === true ? {} : { terminator: input.terminator ?? retForTest(2) }),
  });
  const symbol = aarch64SymbolId("test.entry");
  return aarch64MachineProgram({
    programId: aarch64MachineProgramId(0),
    functions: [
      aarch64MachineFunction({
        functionId: aarch64MachineFunctionId(0),
        symbol,
        virtualRegisters: [value, vregForTest(2), ...(input.virtualRegisters ?? [])],
        parameters: input.parameters ?? [],
        returns: input.returns ?? [],
        frameObjects: input.frameObjects ?? [],
        schedulePlan: input.schedulePlan ?? [],
        blocks: [entry],
      }),
    ],
    globalSymbols: [aarch64SymbolReference({ symbol, visibility: "global", section: "text" })],
    entrySymbol: symbol,
    targetFingerprint: "target:test",
    consultedSubsurfaceFingerprints: [],
    provenance: emptyAArch64ProvenanceMap(),
  });
}

function errorDetails(result: ReturnType<typeof verifyAArch64MachineProgram>) {
  expect(result.kind).toBe("error");
  if (result.kind !== "error") throw new Error("expected verifier diagnostics");
  return result.diagnostics.map((diagnostic) => diagnostic.stableDetail);
}

function vregForTest(value: number) {
  return aarch64VirtualRegister({
    vreg: aarch64VirtualRegisterId(value),
    registerClass: "gpr64",
    type: aarch64IntMachineType(64),
  });
}

function fpVregForTest(value: number) {
  return aarch64VirtualRegister({
    vreg: aarch64VirtualRegisterId(value),
    registerClass: "fpScalar",
    type: aarch64FloatMachineType(64),
  });
}

function vectorVregForTest(value: number) {
  return aarch64VirtualRegister({
    vreg: aarch64VirtualRegisterId(value),
    registerClass: "vector128",
    type: aarch64VectorMachineType({ laneType: aarch64IntMachineType(8), laneCount: 16 }),
  });
}

function uncheckedInstructionForTest(input: {
  readonly instructionId: number;
  readonly opcode: string;
  readonly operands: Parameters<typeof aarch64MachineInstruction>[0]["operands"];
}): ReturnType<typeof aarch64MachineInstruction> {
  return {
    instructionId: aarch64MachineInstructionId(input.instructionId),
    opcode: aarch64OpcodeFormId(input.opcode),
    operands: input.operands,
    flags: { mayTrap: false },
    origin: syntheticAArch64Origin(`test:unchecked:${input.instructionId}`),
    schedule: aarch64ScheduleMetadata({
      issueClass: "integer",
      latencyClass: "singleCycle",
      motion: { kind: "insideEffectIsland" },
      pairability: [],
      pressure: { gpr: 0, vector: 0 },
      errataConstraints: [],
    }),
  };
}

function loadForTest(
  instructionId: number,
  output: ReturnType<typeof vregForTest>,
  base: ReturnType<typeof vregForTest>,
  memoryOrdering: Parameters<typeof aarch64MemoryOrderingMetadata>[0],
  opcode: "ldr-unsigned-immediate" | "ldar" = "ldr-unsigned-immediate",
) {
  return aarch64MachineInstruction({
    instructionId: aarch64MachineInstructionId(instructionId),
    opcode: aarch64OpcodeFormId(opcode),
    operands: [
      defVreg(output, output.type),
      aarch64InstructionOperand({
        role: "memoryBase",
        operand: { kind: "vreg", register: base },
        type: base.type,
      }),
    ],
    flags: { mayTrap: false, mayLoad: true },
    origin: syntheticAArch64Origin(`test:load:${instructionId}`),
    memoryOrdering: aarch64MemoryOrderingMetadata(memoryOrdering),
  });
}

function storeForTest(
  instructionId: number,
  input: ReturnType<typeof vregForTest>,
  base: ReturnType<typeof vregForTest>,
  memoryOrdering: Parameters<typeof aarch64MemoryOrderingMetadata>[0],
  opcode: "str-unsigned-immediate" | "stlr" = "str-unsigned-immediate",
) {
  return aarch64MachineInstruction({
    instructionId: aarch64MachineInstructionId(instructionId),
    opcode: aarch64OpcodeFormId(opcode),
    operands: [
      useVreg(input, input.type),
      aarch64InstructionOperand({
        role: "memoryBase",
        operand: { kind: "vreg", register: base },
        type: base.type,
      }),
    ],
    flags: { mayTrap: false, mayStore: true },
    origin: syntheticAArch64Origin(`test:store:${instructionId}`),
    memoryOrdering: aarch64MemoryOrderingMetadata(memoryOrdering),
  });
}

function movzForTest(instructionId: number, output: ReturnType<typeof vregForTest>, value: bigint) {
  return aarch64MachineInstruction({
    instructionId: aarch64MachineInstructionId(instructionId),
    opcode: aarch64OpcodeFormId("movz"),
    operands: [defVreg(output, output.type), immediateOperand(value, output.type)],
    flags: { mayTrap: false },
    origin: syntheticAArch64Origin(`test:movz:${instructionId}`),
  });
}

function atomicAddForTest(
  instructionId: number,
  opcode: "ldadd" | "ldadda" | "ldaddl" | "ldaddal",
  input: ReturnType<typeof vregForTest>,
  output: ReturnType<typeof vregForTest>,
  base: ReturnType<typeof vregForTest>,
  order: Parameters<typeof aarch64MemoryOrderingMetadata>[0]["order"],
) {
  return aarch64MachineInstruction({
    instructionId: aarch64MachineInstructionId(instructionId),
    opcode: aarch64OpcodeFormId(opcode),
    operands: [
      useVreg(input, input.type),
      defVreg(output, output.type),
      aarch64InstructionOperand({
        role: "memoryBase",
        operand: { kind: "vreg", register: base },
        type: base.type,
      }),
    ],
    flags: { mayTrap: false, mayLoad: true, mayStore: true },
    origin: syntheticAArch64Origin(`test:atomic:${instructionId}`),
    memoryOrdering: aarch64MemoryOrderingMetadata({
      order,
      regionMemoryType: "normalCacheable",
      barrierDomain: { domain: "system", access: "loadsAndStores" },
      atomicity: "lseAtomic",
    }),
  });
}

function dmbForTest(instructionId: number) {
  return aarch64MachineInstruction({
    instructionId: aarch64MachineInstructionId(instructionId),
    opcode: aarch64OpcodeFormId("dmb"),
    operands: [],
    flags: { mayTrap: false },
    origin: syntheticAArch64Origin(`test:dmb:${instructionId}`),
  });
}

function branchForTest(instructionId: number, blockId: number) {
  return aarch64MachineInstruction({
    instructionId: aarch64MachineInstructionId(instructionId),
    opcode: aarch64OpcodeFormId("b"),
    operands: [branchTarget(aarch64MachineBlockId(blockId))],
    flags: { mayTrap: false, isTerminator: true },
    origin: syntheticAArch64Origin(`test:b:${instructionId}`),
  });
}

function retForTest(value: number) {
  return aarch64MachineInstruction({
    instructionId: aarch64MachineInstructionId(value),
    opcode: aarch64OpcodeFormId("ret"),
    operands: [],
    flags: { mayTrap: false, isTerminator: true },
    origin: syntheticAArch64Origin(`test:ret:${value}`),
  });
}
