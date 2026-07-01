import { describe, expect, test } from "bun:test";
import { monoInstanceId } from "../../../../src/mono/ids";
import {
  optIrCallId,
  optIrFactId,
  optIrOperationId,
  optIrOriginId,
  optIrRegionId,
  optIrValueId,
} from "../../../../src/opt-ir/ids";
import {
  optIrAggregateConstructOperation,
  optIrAggregateExtractOperation,
  optIrAggregateInsertOperation,
  optIrBooleanBinaryOperation,
  optIrIntegerBinaryOperation,
  optIrIntegerUnaryOperation,
  optIrLayoutEndianDecodeOperation,
  optIrLayoutByteRangeOperation,
  optIrLayoutOffsetOperation,
  optIrMemoryLoadOperation,
  optIrPlatformCallOperation,
  optIrProofErasedMarkerOperation,
  optIrRuntimeCallOperation,
  optIrSourceCallOperation,
  optIrSemanticChecksumOperation,
} from "../../../../src/opt-ir/operations";
import { layoutFactKey } from "../../../../src/proof-check/model/fact-packet";
import {
  optIrBooleanType,
  optIrSignedIntegerType,
  optIrUnsignedIntegerType,
} from "../../../../src/opt-ir/types";
import { optIrFactSetFromRecords } from "../../../../src/opt-ir/facts/fact-index";
import { footprintFactRecord } from "../../../../src/opt-ir/facts/footprint-facts";
import { fpNumericFactRecord } from "../../../../src/opt-ir/facts/fp-numeric-facts";
import { layoutByteRangeFactRecord } from "../../../../src/opt-ir/facts/layout-facts";
import { memoryOrderFactRecord } from "../../../../src/opt-ir/facts/memory-order-facts";
import { createAArch64FactQuery } from "../../../../src/target/aarch64/facts/aarch64-fact-adapter";
import {
  assignAArch64AbiLocationsForRegisters,
  lowerAArch64CallAbi,
} from "../../../../src/target/aarch64/lower/abi-lowering";
import { lowerAArch64Call } from "../../../../src/target/aarch64/lower/call-lowering";
import {
  materializeAArch64Constant,
  planAArch64MoveWideConstant,
} from "../../../../src/target/aarch64/lower/constant-materialization";
import { lowerAArch64MemoryOrder } from "../../../../src/target/aarch64/lower/memory-order-lowering";
import {
  aarch64IntMachineType,
  aarch64VectorMachineType,
} from "../../../../src/target/aarch64/machine-ir/machine-types";
import {
  materializeAArch64OptIrOperation,
  virtualRegisterForOptIrValue,
} from "../../../../src/target/aarch64/lower/operation-materialization";
import { lowerAArch64Region } from "../../../../src/target/aarch64/lower/region-lowering";
import { checkAArch64ConstantTimeBranchLegality } from "../../../../src/target/aarch64/lower/security-label-lowering";
import { selectAArch64AddressingMode } from "../../../../src/target/aarch64/select/addressing-selection";
import { selectAArch64BitfieldOperation } from "../../../../src/target/aarch64/select/bitfield-selection";
import { selectAArch64EndianDecode } from "../../../../src/target/aarch64/select/endian-selection";
import { selectAArch64FusedMultiplyAdd } from "../../../../src/target/aarch64/select/fp-selection";
import { selectAArch64MemoryWindow } from "../../../../src/target/aarch64/select/memory-selection";
import { selectAArch64LseSuffix } from "../../../../src/target/aarch64/select/memory-order-selection";
import { tileAArch64SelectionCandidates } from "../../../../src/target/aarch64/select/pattern-tiler";
import { filterAArch64OpcodeCandidateByProfile } from "../../../../src/target/aarch64/select/selection-policy";
import { selectAArch64LocalOperation } from "../../../../src/target/aarch64/select/local-selector";
import { selectAArch64VectorOperation } from "../../../../src/target/aarch64/select/vector-selection";
import { planAArch64Prefetches } from "../../../../src/target/aarch64/plan/prefetch-planning";
import { scheduleAArch64EffectIsland } from "../../../../src/target/aarch64/plan/pre-ra-scheduler";
import { instructionForTest } from "../../../support/target/aarch64/interpreter/machine-ir-interpreter-fixtures";

describe("AArch64 lowering, selection, and planning components", () => {
  test("ABI call lowering keeps the full AAPCS64 caller-saved vector set", () => {
    const result = lowerAArch64CallAbi({
      callId: optIrCallId(3),
      convention: "aapcs64",
    });

    expect(result.callClobbers.registers.vector).toContain("v16");
    expect(result.callClobbers.registers.vector).toContain("v31");
    expect(result.stackAlignmentBytes).toBe(16);
  });

  test("AAPCS64 argument assignment uses separate integer and vector register banks", () => {
    const locations = assignAArch64AbiLocationsForRegisters([
      "gpr64",
      "gpr64",
      "gpr64",
      "gpr64",
      "vector128",
      "vector128",
      "gpr64",
    ]);

    expect(locations).toEqual([
      { kind: "intReg", index: 0 },
      { kind: "intReg", index: 1 },
      { kind: "intReg", index: 2 },
      { kind: "intReg", index: 3 },
      { kind: "vectorReg", index: 0 },
      { kind: "vectorReg", index: 1 },
      { kind: "intReg", index: 4 },
    ]);
    expect(
      assignAArch64AbiLocationsForRegisters([
        "gpr64",
        "gpr64",
        "gpr64",
        "gpr64",
        "gpr64",
        "gpr64",
        "gpr64",
        "gpr64",
        "vector128",
      ]).at(-1),
    ).toEqual({ kind: "vectorReg", index: 0 });
  });

  test("region lowering preserves zero-copy validated payload backing", () => {
    const result = lowerAArch64Region({
      regionId: optIrRegionId(4),
      regionKind: "validatedPayload",
      backingRegion: optIrRegionId(1),
      certifiedOffset: 14n,
    });

    expect(result).toMatchObject({
      kind: "ok",
      addressBasis: {
        kind: "derivedRegionBase",
        backingRegion: optIrRegionId(1),
        copyIntroduced: false,
      },
    });
  });

  test("constant materialization and direct calls produce deterministic machine forms", () => {
    expect(planAArch64MoveWideConstant(0x10000n, 32)).toEqual([
      { opcode: "movz", value: 1n, shift: 16 },
    ]);
    expect(
      materializeAArch64Constant({ value: 0x10000n, widthBits: 32 }).instructions.map(
        (instruction) => String(instruction.opcode),
      ),
    ).toEqual(["movz"]);
    expect(
      materializeAArch64Constant({ value: 0x12340000abcd5678n }).instructions.map((instruction) =>
        String(instruction.opcode),
      ),
    ).toEqual(["movz", "movk", "movk"]);
    expect(
      materializeAArch64Constant({ value: -1n }).instructions.map((instruction) =>
        String(instruction.opcode),
      ),
    ).toEqual(["movn"]);
    expect(lowerAArch64Call({ targetKind: "internal", symbol: "parser.next" })).toMatchObject({
      kind: "ok",
      instructions: ["bl"],
      relocations: [{ kind: "CALL26" }],
    });
  });

  test("register-register unary and boolean lowering avoid immediate opcode forms", () => {
    const integerType = optIrSignedIntegerType(64);
    const boolType = optIrBooleanType();
    const integerRegisters = new Map([
      [
        optIrValueId(1),
        virtualRegisterForOptIrValue({
          valueId: optIrValueId(1),
          type: { kind: "integer", width: 64 },
        }),
      ],
      [
        optIrValueId(2),
        virtualRegisterForOptIrValue({
          valueId: optIrValueId(2),
          type: { kind: "integer", width: 64 },
        }),
      ],
    ]);
    const booleanRegisters = new Map([
      [
        optIrValueId(3),
        virtualRegisterForOptIrValue({
          valueId: optIrValueId(3),
          type: { kind: "integer", width: 1 },
        }),
      ],
      [
        optIrValueId(4),
        virtualRegisterForOptIrValue({
          valueId: optIrValueId(4),
          type: { kind: "integer", width: 1 },
        }),
      ],
      [
        optIrValueId(5),
        virtualRegisterForOptIrValue({
          valueId: optIrValueId(5),
          type: { kind: "integer", width: 1 },
        }),
      ],
    ]);

    const negate = materializeAArch64OptIrOperation({
      operation: optIrIntegerUnaryOperation({
        operationId: optIrOperationId(90),
        resultId: optIrValueId(2),
        operand: optIrValueId(1),
        operator: "negate",
        resultType: integerType,
        originId: optIrOriginId(90),
      }),
      valueRegisters: integerRegisters,
    });
    const equal = materializeAArch64OptIrOperation({
      operation: optIrBooleanBinaryOperation({
        operationId: optIrOperationId(91),
        resultId: optIrValueId(5),
        left: optIrValueId(3),
        right: optIrValueId(4),
        operator: "equal",
        originId: optIrOriginId(91),
      }),
      valueRegisters: booleanRegisters,
    });

    expect(negate.kind).toBe("ok");
    expect(equal.kind).toBe("ok");
    if (negate.kind !== "ok" || equal.kind !== "ok") {
      throw new Error("expected materialization success");
    }
    expect(negate.instructions.map((instruction) => String(instruction.opcode))).toContain(
      "sub-shifted-register",
    );
    expect(equal.instructions.map((instruction) => String(instruction.opcode))).toContain(
      "eor-shifted-register",
    );
    expect(boolType.kind).toBe("boolean");
  });

  test("call materialization uses real target symbols and ABI return placeholders", () => {
    const u64 = optIrUnsignedIntegerType(64);
    const argRegisters = new Map([
      [
        optIrValueId(931),
        virtualRegisterForOptIrValue({
          valueId: optIrValueId(931),
          type: { kind: "integer", width: 64 },
        }),
      ],
      [
        optIrValueId(932),
        virtualRegisterForOptIrValue({
          valueId: optIrValueId(932),
          type: { kind: "integer", width: 64 },
        }),
      ],
      [
        optIrValueId(930),
        virtualRegisterForOptIrValue({
          valueId: optIrValueId(930),
          type: { kind: "integer", width: 64 },
        }),
      ],
    ]);
    const platform = materializeAArch64OptIrOperation({
      operation: optIrPlatformCallOperation({
        operationId: optIrOperationId(92),
        callId: optIrCallId(92),
        target: { kind: "platform", platformKey: "uefi.boot-services.allocate-pool" },
        argumentIds: [],
        resultIds: [],
        resultTypes: [],
        originId: optIrOriginId(92),
      }),
      valueRegisters: new Map(),
    });
    const runtimeResult = materializeAArch64OptIrOperation({
      operation: optIrRuntimeCallOperation({
        operationId: optIrOperationId(93),
        callId: optIrCallId(93),
        target: { kind: "runtime", runtimeKey: "runtime.clock" },
        argumentIds: [optIrValueId(931), optIrValueId(932)],
        resultIds: [optIrValueId(930)],
        resultTypes: [u64],
        originId: optIrOriginId(93),
      }),
      valueRegisters: argRegisters,
    });

    expect(platform.kind).toBe("ok");
    expect(runtimeResult.kind).toBe("ok");
    if (platform.kind !== "ok" || runtimeResult.kind !== "ok") {
      throw new Error("expected call materialization success");
    }
    expect(platform.instructions.map((instruction) => String(instruction.opcode))).toEqual([
      "adrp",
      "add-pageoff",
      "ldr-unsigned-immediate",
      "blr",
    ]);
    const page = platform.instructions.find((instruction) => String(instruction.opcode) === "adrp");
    const pageoff = platform.instructions.find(
      (instruction) => String(instruction.opcode) === "add-pageoff",
    );
    const targetLoad = platform.instructions.find(
      (instruction) => String(instruction.opcode) === "ldr-unsigned-immediate",
    );
    const branch = platform.instructions.find(
      (instruction) => String(instruction.opcode) === "blr",
    );
    const pageDef = page?.operands.find((operand) => operand.role === "def");
    const pageoffBase = pageoff?.operands.find((operand) => operand.role === "use");
    const pageoffDef = pageoff?.operands.find((operand) => operand.role === "def");
    const loadBase = targetLoad?.operands.find((operand) => operand.role === "memoryBase");
    const loadedTarget = targetLoad?.operands.find((operand) => operand.role === "def");
    const branchTarget = branch?.operands.find((operand) => operand.role === "use");
    expect(pageDef?.operand.kind === "vreg" ? pageDef.operand.register.stableKey : undefined).toBe(
      pageoffBase?.operand.kind === "vreg" ? pageoffBase.operand.register.stableKey : undefined,
    );
    expect(
      pageoffDef?.operand.kind === "vreg" ? pageoffDef.operand.register.stableKey : undefined,
    ).toBe(loadBase?.operand.kind === "vreg" ? loadBase.operand.register.stableKey : undefined);
    expect(loadedTarget?.operand.kind).toBe("vreg");
    expect(branchTarget?.operand.kind).toBe("vreg");
    expect(
      loadedTarget?.operand.kind === "vreg" && branchTarget?.operand.kind === "vreg"
        ? loadedTarget.operand.register.stableKey === branchTarget.operand.register.stableKey
        : false,
    ).toBe(true);
    expect(platform.relocationReferences.map((relocation) => relocation.kind)).toEqual([
      "PAGE",
      "PAGEOFF12",
    ]);
    expect(platform.instructions.some((instruction) => String(instruction.opcode) === "movz")).toBe(
      false,
    );
    expect(runtimeResult.instructions.map((instruction) => String(instruction.opcode))).toEqual([
      "add-immediate",
      "add-immediate",
      "bl",
      "add-immediate",
    ]);
    const callInstruction = runtimeResult.instructions.find(
      (instruction) => String(instruction.opcode) === "bl",
    );
    expect(
      callInstruction?.operands.filter((operand) => operand.operand.kind === "vreg"),
    ).toHaveLength(2);
    expect(
      runtimeResult.virtualRegisters.some(
        (register) =>
          register.origin?.kind === "synthetic" &&
          register.origin.stableKey.startsWith("opt-ir:93:abi-return:intReg:0:"),
      ),
    ).toBe(true);
  });

  test("signed integer right shift materializes as arithmetic shift", () => {
    const signed64 = optIrSignedIntegerType(64);
    const registers = new Map([
      [
        optIrValueId(1500),
        virtualRegisterForOptIrValue({
          valueId: optIrValueId(1500),
          type: { kind: "integer", width: 64 },
        }),
      ],
      [
        optIrValueId(1501),
        virtualRegisterForOptIrValue({
          valueId: optIrValueId(1501),
          type: { kind: "integer", width: 64 },
        }),
      ],
      [
        optIrValueId(1502),
        virtualRegisterForOptIrValue({
          valueId: optIrValueId(1502),
          type: { kind: "integer", width: 64 },
        }),
      ],
    ]);

    const result = materializeAArch64OptIrOperation({
      operation: optIrIntegerBinaryOperation({
        operationId: optIrOperationId(150),
        resultId: optIrValueId(1502),
        left: optIrValueId(1500),
        right: optIrValueId(1501),
        operator: "shiftRight",
        resultType: signed64,
        originId: optIrOriginId(150),
      }),
      valueRegisters: registers,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected signed shift materialization");
    expect(result.instructions.map((instruction) => String(instruction.opcode))).toEqual(["asr"]);
  });

  test("128-bit endian decode materializes a vector byte reverse", () => {
    const vectorType = {
      kind: "vector" as const,
      laneType: optIrUnsignedIntegerType(8),
      laneCount: 16,
    };
    const machineVectorType = aarch64VectorMachineType({
      laneType: aarch64IntMachineType(8),
      laneCount: 16,
    });
    const registers = new Map([
      [
        optIrValueId(1510),
        virtualRegisterForOptIrValue({
          valueId: optIrValueId(1510),
          type: machineVectorType,
        }),
      ],
      [
        optIrValueId(1511),
        virtualRegisterForOptIrValue({
          valueId: optIrValueId(1511),
          type: machineVectorType,
        }),
      ],
    ]);

    const result = materializeAArch64OptIrOperation({
      operation: optIrLayoutEndianDecodeOperation({
        operationId: optIrOperationId(151),
        bytes: optIrValueId(1510),
        endian: "big",
        resultId: optIrValueId(1511),
        resultType: vectorType,
        originId: optIrOriginId(151),
      }),
      valueRegisters: registers,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected vector endian materialization");
    expect(result.instructions.map((instruction) => String(instruction.opcode))).toEqual([
      "vector-rev",
    ]);
    expect(result.instructions[0]?.operands[0]?.type).toEqual(machineVectorType);
  });

  test("call materialization stores stack arguments before the call", () => {
    const argumentIds = Array.from({ length: 9 }, (_unused, index) => optIrValueId(1000 + index));
    const valueRegisters = new Map(
      argumentIds.map((valueId) => [
        valueId,
        virtualRegisterForOptIrValue({
          valueId,
          type: { kind: "integer", width: 64 },
        }),
      ]),
    );
    const result = materializeAArch64OptIrOperation({
      operation: optIrRuntimeCallOperation({
        operationId: optIrOperationId(96),
        callId: optIrCallId(96),
        target: { kind: "runtime", runtimeKey: "runtime.with-stack-arg" },
        argumentIds,
        resultIds: [],
        resultTypes: [],
        originId: optIrOriginId(96),
      }),
      valueRegisters,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected stack call materialization success");
    expect(result.instructions.map((instruction) => String(instruction.opcode))).toEqual([
      "add-immediate",
      "add-immediate",
      "add-immediate",
      "add-immediate",
      "add-immediate",
      "add-immediate",
      "add-immediate",
      "add-immediate",
      "str-unsigned-immediate",
      "bl",
    ]);
    const store = result.instructions.find(
      (instruction) => String(instruction.opcode) === "str-unsigned-immediate",
    );
    expect(
      store?.operands.some(
        (operand) => operand.role === "memoryBase" && operand.operand.kind === "frameObject",
      ),
    ).toBe(true);
  });

  test("call materialization keeps mixed integer and vector register arguments in separate banks", () => {
    const vectorType = aarch64VectorMachineType({
      laneType: aarch64IntMachineType(8),
      laneCount: 16,
    });
    const integerIds = Array.from({ length: 8 }, (_unused, index) => optIrValueId(1200 + index));
    const vectorIds = Array.from({ length: 8 }, (_unused, index) => optIrValueId(1300 + index));
    const argumentIds = [...integerIds, ...vectorIds];
    const valueRegisters = new Map([
      ...integerIds.map(
        (valueId) =>
          [
            valueId,
            virtualRegisterForOptIrValue({
              valueId,
              type: { kind: "integer", width: 64 },
            }),
          ] as const,
      ),
      ...vectorIds.map(
        (valueId) =>
          [
            valueId,
            virtualRegisterForOptIrValue({
              valueId,
              type: vectorType,
            }),
          ] as const,
      ),
    ]);
    const result = materializeAArch64OptIrOperation({
      operation: optIrSourceCallOperation({
        operationId: optIrOperationId(98),
        callId: optIrCallId(98),
        target: { kind: "source", functionInstanceId: monoInstanceId("mixed.register.args") },
        argumentIds,
        resultIds: [],
        resultTypes: [],
        originId: optIrOriginId(98),
      }),
      valueRegisters,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected mixed register call materialization");
    expect(
      result.instructions.filter((instruction) =>
        ["str-unsigned-immediate", "st1"].includes(String(instruction.opcode)),
      ),
    ).toEqual([]);
    const call = result.instructions.find((instruction) => String(instruction.opcode) === "bl");
    const callUses = call?.operands.filter((operand) => operand.role === "use") ?? [];
    expect(callUses).toHaveLength(17);
    expect(
      callUses.filter(
        (operand) =>
          operand.operand.kind === "vreg" && operand.operand.register.registerClass === "gpr64",
      ),
    ).toHaveLength(8);
    expect(
      callUses.filter(
        (operand) =>
          operand.operand.kind === "vreg" && operand.operand.register.registerClass === "vector128",
      ),
    ).toHaveLength(8);
  });

  test("call materialization stores overflow vector arguments at 16-byte stack offsets", () => {
    const machineVectorType = aarch64VectorMachineType({
      laneType: aarch64IntMachineType(8),
      laneCount: 16,
    });
    const argumentIds = Array.from({ length: 10 }, (_unused, index) => optIrValueId(1100 + index));
    const valueRegisters = new Map(
      argumentIds.map((valueId) => [
        valueId,
        virtualRegisterForOptIrValue({
          valueId,
          type: machineVectorType,
        }),
      ]),
    );
    const result = materializeAArch64OptIrOperation({
      operation: optIrSourceCallOperation({
        operationId: optIrOperationId(97),
        callId: optIrCallId(97),
        target: { kind: "source", functionInstanceId: monoInstanceId("vector.stack.args") },
        argumentIds,
        resultIds: [],
        resultTypes: [],
        originId: optIrOriginId(97),
      }),
      valueRegisters,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected vector stack call materialization success");
    const stackStores = result.instructions.filter(
      (instruction) => String(instruction.opcode) === "st1",
    );
    expect(
      stackStores.map(
        (instruction) =>
          instruction.operands.find(
            (operand) => operand.role === "use" && operand.operand.kind === "immediate",
          )?.operand,
      ),
    ).toEqual([
      { kind: "immediate", value: 0n },
      { kind: "immediate", value: 16n },
    ]);
  });

  test("semantic operation materialization rejects missing sources instead of fabricating zero", () => {
    const u64 = optIrUnsignedIntegerType(64);
    const result = materializeAArch64OptIrOperation({
      operation: optIrSemanticChecksumOperation({
        operationId: optIrOperationId(94),
        operands: [optIrValueId(940)],
        resultIds: [optIrValueId(941)],
        resultTypes: [u64],
        semanticContract: { algorithm: "crc32" },
        originId: optIrOriginId(94),
      }),
      valueRegisters: new Map([
        [
          optIrValueId(940),
          virtualRegisterForOptIrValue({
            valueId: optIrValueId(940),
            type: { kind: "integer", width: 64 },
          }),
        ],
        [
          optIrValueId(941),
          virtualRegisterForOptIrValue({
            valueId: optIrValueId(941),
            type: { kind: "integer", width: 64 },
          }),
        ],
      ]),
      context: {
        operationSupportContracts: new Map([
          [
            94,
            {
              operationId: 94,
              operationKind: "semanticChecksum",
              status: "helper-lowered",
              authorization: "semantic-plugin",
              factsUsed: [],
              helperPatternIds: ["semantic.checksum-crc32"],
              explanation: ["operation-matrix:test-authorized-semantic-checksum"],
            },
          ],
        ]),
      },
    });

    expect(result).toEqual({
      kind: "error",
      stableDetail: "materialize-operation:missing-source:94:1",
    });
  });

  test("direct materialization refuses proof-erased markers without public support authorization", () => {
    const result = materializeAArch64OptIrOperation({
      operation: optIrProofErasedMarkerOperation({
        operationId: optIrOperationId(95),
        erasedProof: "must-not-reach-machine-ir",
        originId: optIrOriginId(95),
      }),
      valueRegisters: new Map(),
    });

    expect(result).toEqual({
      kind: "error",
      stableDetail:
        "operation-matrix:materialize:missing-authorization:95:proofErasedMarker:unreachable-after-optir",
    });
  });

  test("aggregate and layout operations fail closed instead of placeholder-lowering", () => {
    const u64 = optIrUnsignedIntegerType(64);
    const registers = new Map(
      [optIrValueId(1), optIrValueId(2), optIrValueId(3), optIrValueId(4)].map((valueId) => [
        valueId,
        virtualRegisterForOptIrValue({ valueId, type: { kind: "integer", width: 64 } }),
      ]),
    );
    const aggregateConstruct = materializeAArch64OptIrOperation({
      operation: optIrAggregateConstructOperation({
        operationId: optIrOperationId(96),
        fieldIds: [optIrValueId(1), optIrValueId(2)],
        resultId: optIrValueId(3),
        resultType: u64,
        originId: optIrOriginId(96),
      }),
      valueRegisters: registers,
    });
    const aggregateExtract = materializeAArch64OptIrOperation({
      operation: optIrAggregateExtractOperation({
        operationId: optIrOperationId(97),
        aggregate: optIrValueId(3),
        fieldPath: ["header", "kind"],
        resultId: optIrValueId(4),
        resultType: u64,
        originId: optIrOriginId(97),
      }),
      valueRegisters: registers,
    });
    const aggregateInsert = materializeAArch64OptIrOperation({
      operation: optIrAggregateInsertOperation({
        operationId: optIrOperationId(98),
        aggregate: optIrValueId(3),
        field: optIrValueId(1),
        fieldPath: ["header", "length"],
        resultId: optIrValueId(4),
        resultType: u64,
        originId: optIrOriginId(98),
      }),
      valueRegisters: registers,
    });
    const layoutOffset = materializeAArch64OptIrOperation({
      operation: optIrLayoutOffsetOperation({
        operationId: optIrOperationId(99),
        base: optIrValueId(1),
        layoutPath: layoutFactKey("layout:packet.header.kind"),
        resultId: optIrValueId(4),
        resultType: u64,
        originId: optIrOriginId(99),
      }),
      valueRegisters: registers,
    });
    const layoutByteRange = materializeAArch64OptIrOperation({
      operation: optIrLayoutByteRangeOperation({
        operationId: optIrOperationId(100),
        base: optIrValueId(1),
        layoutPath: layoutFactKey("layout:packet.header.length"),
        resultId: optIrValueId(4),
        resultType: u64,
        originId: optIrOriginId(100),
      }),
      valueRegisters: registers,
    });

    expect(aggregateConstruct).toEqual({
      kind: "error",
      stableDetail: "aggregate-lowering:unsupported-without-layout-facts:96:construct",
    });
    expect(aggregateExtract).toEqual({
      kind: "error",
      stableDetail: "aggregate-lowering:unsupported-without-layout-facts:97:extract:header.kind",
    });
    expect(aggregateInsert).toEqual({
      kind: "error",
      stableDetail: "aggregate-lowering:unsupported-without-layout-facts:98:insert:header.length",
    });
    expect(layoutOffset).toEqual({
      kind: "error",
      stableDetail:
        "layout-lowering:missing-byte-range-fact:99:layoutOffset:layout:packet.header.kind",
    });
    expect(layoutByteRange).toEqual({
      kind: "error",
      stableDetail:
        "layout-lowering:missing-byte-range-fact:100:layoutByteRange:layout:packet.header.length",
    });
  });

  test("layout operations use authenticated byte-range facts for non-zero offsets", () => {
    const u64 = optIrUnsignedIntegerType(64);
    const layoutPath = layoutFactKey("layout:packet.header.length");
    const registers = new Map([
      [
        optIrValueId(1),
        virtualRegisterForOptIrValue({
          valueId: optIrValueId(1),
          type: { kind: "integer", width: 64 },
        }),
      ],
      [
        optIrValueId(2),
        virtualRegisterForOptIrValue({
          valueId: optIrValueId(2),
          type: { kind: "integer", width: 64 },
        }),
      ],
    ]);
    const result = materializeAArch64OptIrOperation({
      operation: optIrLayoutOffsetOperation({
        operationId: optIrOperationId(102),
        base: optIrValueId(1),
        layoutPath,
        resultId: optIrValueId(2),
        resultType: u64,
        originId: optIrOriginId(102),
      }),
      valueRegisters: registers,
      context: {
        factQuery: createAArch64FactQuery(
          optIrFactSetFromRecords([
            layoutByteRangeFactRecord({
              factId: optIrFactId(102),
              layoutKey: layoutPath,
              offsetBytes: 24n,
              sizeBytes: 2n,
            }),
          ]),
        ),
      },
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected layout offset materialization success");
    expect(result.instructions.map((instruction) => String(instruction.opcode))).toEqual([
      "add-immediate",
    ]);
    expect(result.instructions[0]?.operands[2]?.operand).toEqual({
      kind: "immediate",
      value: 24n,
    });
    expect(result.selectionRecord.factsUsed).toEqual([102]);
  });

  test("memory load materialization uses selected unsigned immediate addressing", () => {
    const u64 = optIrUnsignedIntegerType(64);
    const load = optIrMemoryLoadOperation({
      operationId: optIrOperationId(101),
      resultId: optIrValueId(1010),
      region: optIrRegionId(101),
      byteOffset: 32n,
      byteWidth: 8,
      alignment: 8,
      valueType: u64,
      endian: "little",
      volatility: "nonVolatile",
      boundsAuthority: { kind: "targetContract", authorityKey: "aarch64.unit" },
      originId: optIrOriginId(101),
    });
    if (load.kind !== "ok") throw new Error("expected load operation construction success");
    const result = materializeAArch64OptIrOperation({
      operation: load.operation,
      valueRegisters: new Map([
        [
          optIrValueId(1010),
          virtualRegisterForOptIrValue({
            valueId: optIrValueId(1010),
            type: { kind: "integer", width: 64 },
          }),
        ],
      ]),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected load materialization success");
    expect(result.instructions.map((instruction) => String(instruction.opcode))).toEqual([
      "movz",
      "ldr-unsigned-immediate",
    ]);
    const loadInstruction = result.instructions.find(
      (instruction) => String(instruction.opcode) === "ldr-unsigned-immediate",
    );
    expect(loadInstruction?.operands.map((operand) => operand.role)).toEqual([
      "def",
      "memoryBase",
      "use",
    ]);
    expect(loadInstruction?.operands[2]?.operand).toEqual({ kind: "immediate", value: 32n });
  });

  test("region-backed memory loads materialize symbolic PIC addresses", () => {
    const u64 = optIrUnsignedIntegerType(64);
    const regionId = optIrRegionId(102);
    const load = optIrMemoryLoadOperation({
      operationId: optIrOperationId(102),
      resultId: optIrValueId(1020),
      region: regionId,
      byteOffset: 32n,
      byteWidth: 8,
      alignment: 8,
      valueType: u64,
      endian: "little",
      volatility: "nonVolatile",
      boundsAuthority: { kind: "targetContract", authorityKey: "aarch64.unit" },
      originId: optIrOriginId(102),
    });
    if (load.kind !== "ok") throw new Error("expected load operation construction success");
    const region = lowerAArch64Region({
      regionId,
      regionKind: "constantData",
    });
    if (region.kind !== "ok") throw new Error("expected region lowering success");

    const result = materializeAArch64OptIrOperation({
      operation: load.operation,
      valueRegisters: new Map([
        [
          optIrValueId(1020),
          virtualRegisterForOptIrValue({
            valueId: optIrValueId(1020),
            type: { kind: "integer", width: 64 },
          }),
        ],
      ]),
      context: {
        regionAddressBasisForRegion: (candidate) =>
          candidate === regionId
            ? {
                kind: "ok",
                addressBasis: region.addressBasis,
                factsUsed: [],
                explanation: ["test:constant-data-region"],
              }
            : undefined,
      },
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      throw new Error("expected region-backed load materialization success");
    }
    expect(result.instructions.map((instruction) => String(instruction.opcode))).toEqual([
      "adrp",
      "add-pageoff",
      "ldr-unsigned-immediate",
    ]);
    expect(result.instructions.flatMap((instruction) => instruction.operands)).toContainEqual(
      expect.objectContaining({ operand: { kind: "symbol", symbol: "region.102" } }),
    );
    expect(result.relocationReferences).toEqual([
      expect.objectContaining({ kind: "PAGE", symbol: "region.102" }),
      expect.objectContaining({ kind: "PAGEOFF12", symbol: "region.102" }),
    ]);
  });

  test("memory-order and footprint queries feed conservative selection gates", () => {
    const factSet = optIrFactSetFromRecords([
      memoryOrderFactRecord({
        factId: optIrFactId(1),
        operationId: optIrOperationId(9),
        accessKind: "store",
        order: "release",
        publicationShape: "virtioAvailIndexPublication",
      }),
      footprintFactRecord({
        factId: optIrFactId(2),
        regionId: optIrRegionId(3),
        start: 0n,
        endExclusive: 16n,
        access: "read",
      }),
    ]);

    expect(
      createAArch64FactQuery(factSet).memoryOrderForOperation(optIrOperationId(9)),
    ).toMatchObject({
      kind: "yes",
      order: "release",
    });
    expect(
      createAArch64FactQuery(factSet).provesDereferenceableFootprint({
        region: optIrRegionId(3),
        start: 0n,
        endExclusive: 16n,
      }),
    ).toMatchObject({ kind: "yes" });
    expect(
      lowerAArch64MemoryOrder({
        accessKind: "store",
        order: "release",
        regionMemoryType: "deviceMmio",
        publicationShape: "virtioAvailIndexPublication",
      }),
    ).toMatchObject({ kind: "ok", instructions: ["stlr", "dmb"] });
    expect(
      ["relaxed", "acquire", "release", "acquireRelease", "sequentiallyConsistent"].map((order) =>
        lowerAArch64MemoryOrder({
          accessKind: "readModifyWrite",
          order: order as
            | "relaxed"
            | "acquire"
            | "release"
            | "acquireRelease"
            | "sequentiallyConsistent",
          regionMemoryType: "normalCacheable",
        }),
      ),
    ).toEqual([
      { kind: "ok", instructions: ["ldadd"] },
      { kind: "ok", instructions: ["ldadda"] },
      { kind: "ok", instructions: ["ldaddl"] },
      { kind: "ok", instructions: ["ldaddal"] },
      { kind: "ok", instructions: ["ldaddal"] },
    ]);
  });

  test("selection rejects unsafe shortcuts and chooses fact-gated A64 forms", () => {
    expect(selectAArch64AddressingMode({ byteOffset: 32n, scale: 8 })).toBe(
      "base-unsigned-immediate",
    );
    expect(selectAArch64AddressingMode({ byteOffset: 34n, scale: 8 })).toBe(
      "base-signed-immediate",
    );
    expect(selectAArch64AddressingMode({ byteOffset: 1n << 20n, scale: 8 })).toBe(
      "materialized-address",
    );
    expect(
      selectAArch64BitfieldOperation({ signed: false, insert: false, hasLayoutFact: false }),
    ).toBe("fallback");
    expect(
      selectAArch64BitfieldOperation({ signed: true, insert: true, hasLayoutFact: true }),
    ).toBe("fallback");
    expect(selectAArch64LseSuffix({ operation: "ldadd", order: "acquireRelease" })).toBe("al");
    expect(selectAArch64EndianDecode({ endian: "big", widthBits: 16 }).opcode).toBe("rev16");
    expect(
      selectAArch64MemoryWindow({
        operationCount: 2,
        completeFootprint: true,
        noalias: true,
        alignment: 8,
        regionMemoryType: "normalCacheable",
      }),
    ).toMatchObject({ kind: "ok", instructions: ["ldp-signed-offset"] });
    expect(filterAArch64OpcodeCandidateByProfile({ opcode: "sve-ld1b" })).toMatchObject({
      kind: "rejected",
      reason: "excluded-instruction-family:FEAT_SVE",
    });
    expect(
      filterAArch64OpcodeCandidateByProfile({
        opcode: "dotprod",
        targetProfileFeatures: ["BASE_A64", "FEAT_AdvSIMD"],
      }),
    ).toEqual({ kind: "rejected", reason: "missing-profile-feature:FEAT_DotProd" });
    expect(
      selectAArch64LocalOperation({
        operation: { kind: "integerCompare", operator: "unsignedLessThan" },
      }),
    ).toMatchObject({
      kind: "ok",
      patternId: "scalar.compare.nzcv",
    });
    expect(
      selectAArch64VectorOperation({ policy: "scalarOnly", operationKind: "load" }).instructions,
    ).toEqual(["scalar-helper"]);
    expect(
      selectAArch64FusedMultiplyAdd({
        operationId: optIrOperationId(92),
        factAnswer: createAArch64FactQuery(
          optIrFactSetFromRecords([
            fpNumericFactRecord({
              factId: optIrFactId(92),
              operationId: optIrOperationId(92),
              contraction: "allowed",
              rounding: "nearestTiesToEven",
              exceptionFlagsObservable: true,
            }),
          ]),
        ).fpContractionForOperation(optIrOperationId(92)),
        resultRegisterClass: "fpScalar",
        sourceRegisterClasses: ["fpScalar", "fpScalar", "fpScalar"],
      }),
    ).toMatchObject({ kind: "rejected", reason: "fp-exception-flags-observable" });
  });

  test("local scalar selector maps integer binary operators to concrete opcodes", () => {
    const cases = [
      ["add", "add-shifted-register", false],
      ["subtract", "sub-shifted-register", false],
      ["and", "and-shifted-register", false],
      ["or", "orr-shifted-register", false],
      ["xor", "eor-shifted-register", false],
      ["multiply", "mul", false],
      ["unsignedDivide", "udiv", true],
      ["signedDivide", "sdiv", true],
    ] as const;

    for (const [operator, opcode, mayTrap] of cases) {
      const result = selectAArch64LocalOperation({
        operation: { kind: "integerBinary", operator },
      });

      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") throw new Error(`expected scalar selection for ${operator}`);
      expect(result.instructions.map((instruction) => String(instruction.opcode))).toEqual([
        opcode,
      ]);
      expect(result.instructions[0]?.flags.mayTrap).toBe(mayTrap);
    }
  });

  test("tiling and planning preserve deterministic dependency order", () => {
    const tiling = tileAArch64SelectionCandidates({
      baselineCover: [
        { patternId: "local.1", covers: [1], tier: "local", cost: 2 },
        { patternId: "local.2", covers: [2], tier: "local", cost: 2 },
      ],
      replacementCandidates: [{ patternId: "window.12", covers: [1, 2], tier: "window", cost: 3 }],
    });
    expect(tiling.selected.map((candidate) => candidate.patternId)).toEqual(["window.12"]);
    expect(
      planAArch64Prefetches({
        memoryType: "deviceMmio",
        completeFootprint: true,
        crossesOrderedBoundary: true,
      }).rejections.map((rejection) => rejection.reason),
    ).toContain("ordered-device-boundary");
    expect(
      scheduleAArch64EffectIsland({
        instructions: [instructionForTest(1, "trap", []), instructionForTest(2, "trap", [])],
        dependencyEdges: [
          {
            fromInstruction: 1,
            toInstruction: 2,
            kind: "barrier",
            resource: "barrier",
            requiredBy: ["barrier"],
          },
        ],
      }).scheduled,
    ).toEqual([1, 2]);
  });

  test("constant-time legality rejects secret-dependent jump tables", () => {
    expect(
      checkAArch64ConstantTimeBranchLegality({
        terminatorKind: "jump-table",
        scrutineeSecret: true,
      }),
    ).toEqual({ kind: "rejected", reason: "secret-dependent-control:jump-table" });
  });
});
