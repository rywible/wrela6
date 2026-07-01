import { describe, expect, test } from "bun:test";
import {
  optIrBlockId,
  optIrEdgeId,
  optIrOperationId,
  optIrOriginId,
  optIrValueId,
} from "../../../../src/opt-ir/ids";
import { optIrCfgEdgeTable } from "../../../../src/opt-ir/cfg";
import { optIrBranchTerminator, optIrSwitchTerminator } from "../../../../src/opt-ir/terminators";
import { optIrUnsignedIntegerType } from "../../../../src/opt-ir/types";
import { optIrBlockParameter } from "../../../../src/opt-ir/values";
import { lowerAArch64BlockShell } from "../../../../src/target/aarch64/lower/lower-block";
import { virtualRegisterForOptIrValue } from "../../../../src/target/aarch64/lower/operation-materialization";
import { edgeForTest, optIrBlockForTest } from "../../../support/opt-ir/cfg-fakes";

describe("AArch64 block terminator lowering", () => {
  test("emits both true and false successors for conditional branches", () => {
    const result = lowerAArch64BlockShell({
      block: optIrBlockForTest({
        parameters: [],
        terminator: optIrBranchTerminator({
          operationId: optIrOperationId(10),
          condition: optIrValueId(1),
          trueEdge: optIrEdgeId(1),
          falseEdge: optIrEdgeId(2),
          originId: optIrOriginId(1),
        }),
      }),
      edges: optIrCfgEdgeTable([
        edgeForTest({ edgeId: optIrEdgeId(1), toBlock: optIrBlockId(2) }),
        edgeForTest({ edgeId: optIrEdgeId(2), toBlock: optIrBlockId(3) }),
      ]),
      isEntry: true,
      operations: new Map(),
      returnLocations: [],
      valueRegisters: new Map([[optIrValueId(1), vreg(1)]]),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected branch lowering success");
    expect(result.block.instructions.map((instruction) => String(instruction.opcode))).toEqual([
      "cbnz",
    ]);
    expect(String(result.block.terminator?.opcode)).toBe("b");
    expect(branchTargets(result.block.instructions, result.block.terminator)).toEqual([2, 3]);
  });

  test("rejects conditional branches with a missing false edge", () => {
    const result = lowerAArch64BlockShell({
      block: optIrBlockForTest({
        parameters: [],
        terminator: optIrBranchTerminator({
          operationId: optIrOperationId(11),
          condition: optIrValueId(1),
          trueEdge: optIrEdgeId(1),
          falseEdge: optIrEdgeId(2),
          originId: optIrOriginId(1),
        }),
      }),
      edges: optIrCfgEdgeTable([edgeForTest({ edgeId: optIrEdgeId(1), toBlock: optIrBlockId(2) })]),
      isEntry: true,
      operations: new Map(),
      returnLocations: [],
      valueRegisters: new Map([[optIrValueId(1), vreg(1)]]),
    });

    expect(result).toMatchObject({
      kind: "error",
      stableDetail: "lower-terminator:missing-target:11:2",
    });
  });

  test("publishes branch edge-copy temporaries for cyclic arguments", () => {
    const u64 = optIrUnsignedIntegerType(64);
    const result = lowerAArch64BlockShell({
      block: optIrBlockForTest({
        parameters: [],
        terminator: optIrBranchTerminator({
          operationId: optIrOperationId(22),
          condition: optIrValueId(3),
          trueEdge: optIrEdgeId(11),
          falseEdge: optIrEdgeId(12),
          originId: optIrOriginId(22),
        }),
      }),
      edges: optIrCfgEdgeTable([
        edgeForTest({
          edgeId: optIrEdgeId(11),
          toBlock: optIrBlockId(12),
          arguments: [optIrValueId(2), optIrValueId(1)],
        }),
        edgeForTest({ edgeId: optIrEdgeId(12), toBlock: optIrBlockId(13) }),
      ]),
      blockParametersByBlock: new Map([
        [
          optIrBlockId(12),
          [
            optIrBlockParameter({
              valueId: optIrValueId(1),
              type: u64,
              incomingRole: "branchArgument",
              originId: optIrOriginId(22),
            }),
            optIrBlockParameter({
              valueId: optIrValueId(2),
              type: u64,
              incomingRole: "branchArgument",
              originId: optIrOriginId(22),
            }),
          ],
        ],
      ]),
      isEntry: true,
      operations: new Map(),
      returnLocations: [],
      valueRegisters: new Map([
        [optIrValueId(1), vreg(1)],
        [optIrValueId(2), vreg(2)],
        [optIrValueId(3), vreg(3)],
      ]),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected branch edge-copy lowering success");
    expect(result.edgeBlocks).toHaveLength(1);
    expect(result.virtualRegisters.some(isEdgeCopyTempRegister)).toBe(true);
  });

  test("lowers switch cases to explicit compare branches before default", () => {
    const result = lowerAArch64BlockShell({
      block: optIrBlockForTest({
        parameters: [],
        terminator: optIrSwitchTerminator({
          operationId: optIrOperationId(12),
          scrutinee: optIrValueId(1),
          cases: [
            { label: "4", edge: optIrEdgeId(1) },
            { label: "9", edge: optIrEdgeId(2) },
          ],
          defaultEdge: optIrEdgeId(3),
          originId: optIrOriginId(1),
        }),
      }),
      edges: optIrCfgEdgeTable([
        edgeForTest({ edgeId: optIrEdgeId(1), toBlock: optIrBlockId(2) }),
        edgeForTest({ edgeId: optIrEdgeId(2), toBlock: optIrBlockId(3) }),
        edgeForTest({ edgeId: optIrEdgeId(3), toBlock: optIrBlockId(4) }),
      ]),
      isEntry: true,
      operations: new Map(),
      returnLocations: [],
      valueRegisters: new Map([[optIrValueId(1), vreg(1)]]),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected switch lowering success");
    expect(result.block.instructions.map((instruction) => String(instruction.opcode))).toEqual([
      "movz",
      "cmp-shifted-register",
      "b-cond",
      "movz",
      "cmp-shifted-register",
      "b-cond",
    ]);
    expect(String(result.block.terminator?.opcode)).toBe("b");
    expect(branchTargets(result.block.instructions, result.block.terminator)).toEqual([2, 3, 4]);
  });

  test("lowers dense switches to a symbolic PIC-safe jump table", () => {
    const result = lowerAArch64BlockShell({
      block: optIrBlockForTest({
        parameters: [],
        terminator: optIrSwitchTerminator({
          operationId: optIrOperationId(12),
          scrutinee: optIrValueId(1),
          cases: [
            { label: "4", edge: optIrEdgeId(1) },
            { label: "5", edge: optIrEdgeId(2) },
            { label: "6", edge: optIrEdgeId(3) },
            { label: "7", edge: optIrEdgeId(4) },
          ],
          defaultEdge: optIrEdgeId(5),
          originId: optIrOriginId(1),
        }),
      }),
      edges: optIrCfgEdgeTable([
        edgeForTest({ edgeId: optIrEdgeId(1), toBlock: optIrBlockId(2) }),
        edgeForTest({ edgeId: optIrEdgeId(2), toBlock: optIrBlockId(3) }),
        edgeForTest({ edgeId: optIrEdgeId(3), toBlock: optIrBlockId(4) }),
        edgeForTest({ edgeId: optIrEdgeId(4), toBlock: optIrBlockId(5) }),
        edgeForTest({ edgeId: optIrEdgeId(5), toBlock: optIrBlockId(9) }),
      ]),
      isEntry: true,
      operations: new Map(),
      returnLocations: [],
      valueRegisters: new Map([[optIrValueId(1), vreg(1)]]),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected jump-table switch lowering success");
    expect(result.block.instructions.map((instruction) => String(instruction.opcode))).toEqual([
      "movz",
      "sub-shifted-register",
      "movz",
      "cmp-shifted-register",
      "b-cond",
      "lsl-immediate",
      "adrp",
      "add-pageoff",
      "ldr-register-offset",
    ]);
    const page = result.block.instructions.find(
      (instruction) => String(instruction.opcode) === "adrp",
    );
    const pageoff = result.block.instructions.find(
      (instruction) => String(instruction.opcode) === "add-pageoff",
    );
    const targetLoad = result.block.instructions.find(
      (instruction) => String(instruction.opcode) === "ldr-register-offset",
    );
    const pageDef = page?.operands.find((operand) => operand.role === "def");
    const pageoffBase = pageoff?.operands.find((operand) => operand.role === "use");
    const pageoffDef = pageoff?.operands.find((operand) => operand.role === "def");
    const loadBase = targetLoad?.operands.find((operand) => operand.role === "memoryBase");
    expect(pageDef?.operand.kind === "vreg" ? pageDef.operand.register.stableKey : undefined).toBe(
      pageoffBase?.operand.kind === "vreg" ? pageoffBase.operand.register.stableKey : undefined,
    );
    expect(
      pageoffDef?.operand.kind === "vreg" ? pageoffDef.operand.register.stableKey : undefined,
    ).toBe(loadBase?.operand.kind === "vreg" ? loadBase.operand.register.stableKey : undefined);
    expect(result.relocationReferences.map((relocation) => relocation.kind)).toEqual([
      "PAGE",
      "PAGEOFF12",
    ]);
    expect(String(result.block.terminator?.opcode)).toBe("br");
    expect(result.jumpTables).toEqual([
      {
        tableKey: "jump-table.12",
        operationKey: "terminator:12",
        defaultTargetBlock: 9,
        picSafe: true,
        entries: [
          { value: 4n, targetBlock: 2 },
          { value: 5n, targetBlock: 3 },
          { value: 6n, targetBlock: 4 },
          { value: 7n, targetBlock: 5 },
        ],
      },
    ]);
    expect(result.selectionRecords.at(-1)).toMatchObject({
      patternId: "switch.jumpTable",
      emittedOpcodes: [
        "movz",
        "sub-shifted-register",
        "movz",
        "cmp-shifted-register",
        "b-cond",
        "lsl-immediate",
        "adrp",
        "add-pageoff",
        "ldr-register-offset",
        "br",
      ],
    });
  });

  test("publishes switch edge-copy temporaries for jump-table case arguments", () => {
    const u64 = optIrUnsignedIntegerType(64);
    const result = lowerAArch64BlockShell({
      block: optIrBlockForTest({
        parameters: [],
        terminator: optIrSwitchTerminator({
          operationId: optIrOperationId(23),
          scrutinee: optIrValueId(3),
          cases: [
            { label: "4", edge: optIrEdgeId(21) },
            { label: "5", edge: optIrEdgeId(22) },
            { label: "6", edge: optIrEdgeId(23) },
            { label: "7", edge: optIrEdgeId(24) },
          ],
          defaultEdge: optIrEdgeId(25),
          originId: optIrOriginId(23),
        }),
      }),
      edges: optIrCfgEdgeTable([
        edgeForTest({
          edgeId: optIrEdgeId(21),
          toBlock: optIrBlockId(21),
          arguments: [optIrValueId(2), optIrValueId(1)],
        }),
        edgeForTest({ edgeId: optIrEdgeId(22), toBlock: optIrBlockId(22) }),
        edgeForTest({ edgeId: optIrEdgeId(23), toBlock: optIrBlockId(23) }),
        edgeForTest({ edgeId: optIrEdgeId(24), toBlock: optIrBlockId(24) }),
        edgeForTest({ edgeId: optIrEdgeId(25), toBlock: optIrBlockId(25) }),
      ]),
      blockParametersByBlock: new Map([
        [
          optIrBlockId(21),
          [
            optIrBlockParameter({
              valueId: optIrValueId(1),
              type: u64,
              incomingRole: "branchArgument",
              originId: optIrOriginId(23),
            }),
            optIrBlockParameter({
              valueId: optIrValueId(2),
              type: u64,
              incomingRole: "branchArgument",
              originId: optIrOriginId(23),
            }),
          ],
        ],
      ]),
      isEntry: true,
      operations: new Map(),
      returnLocations: [],
      valueRegisters: new Map([
        [optIrValueId(1), vreg(1)],
        [optIrValueId(2), vreg(2)],
        [optIrValueId(3), vreg(3)],
      ]),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected switch edge-copy lowering success");
    expect(result.jumpTables).toHaveLength(1);
    expect(result.edgeBlocks).toHaveLength(1);
    expect(result.virtualRegisters.some(isEdgeCopyTempRegister)).toBe(true);
  });

  test("uses unique instruction ids for larger switch materializations and following jumps", () => {
    const switchResult = lowerAArch64BlockShell({
      block: optIrBlockForTest({
        parameters: [],
        terminator: optIrSwitchTerminator({
          operationId: optIrOperationId(12),
          scrutinee: optIrValueId(1),
          cases: [
            { label: "0", edge: optIrEdgeId(1) },
            { label: "100", edge: optIrEdgeId(2) },
            { label: "200", edge: optIrEdgeId(3) },
            { label: "300", edge: optIrEdgeId(4) },
            { label: "400", edge: optIrEdgeId(5) },
            { label: "500", edge: optIrEdgeId(6) },
          ],
          defaultEdge: optIrEdgeId(7),
          originId: optIrOriginId(1),
        }),
      }),
      edges: optIrCfgEdgeTable([
        edgeForTest({ edgeId: optIrEdgeId(1), toBlock: optIrBlockId(2) }),
        edgeForTest({ edgeId: optIrEdgeId(2), toBlock: optIrBlockId(3) }),
        edgeForTest({ edgeId: optIrEdgeId(3), toBlock: optIrBlockId(4) }),
        edgeForTest({ edgeId: optIrEdgeId(4), toBlock: optIrBlockId(5) }),
        edgeForTest({ edgeId: optIrEdgeId(5), toBlock: optIrBlockId(6) }),
        edgeForTest({ edgeId: optIrEdgeId(6), toBlock: optIrBlockId(7) }),
        edgeForTest({ edgeId: optIrEdgeId(7), toBlock: optIrBlockId(8) }),
      ]),
      isEntry: true,
      operations: new Map(),
      returnLocations: [],
      valueRegisters: new Map([[optIrValueId(1), vreg(1)]]),
    });
    const jumpResult = lowerAArch64BlockShell({
      block: optIrBlockForTest({
        blockId: optIrBlockId(2),
        parameters: [],
        terminator: {
          kind: "jump",
          operationId: optIrOperationId(13),
          edge: optIrEdgeId(8),
          originId: optIrOriginId(1),
        },
      }),
      edges: optIrCfgEdgeTable([edgeForTest({ edgeId: optIrEdgeId(8), toBlock: optIrBlockId(9) })]),
      isEntry: false,
      operations: new Map(),
      returnLocations: [],
      valueRegisters: new Map([[optIrValueId(1), vreg(1)]]),
    });

    expect(switchResult.kind).toBe("ok");
    expect(jumpResult.kind).toBe("ok");
    if (switchResult.kind !== "ok" || jumpResult.kind !== "ok") {
      throw new Error("expected switch and jump lowering success");
    }
    const instructionIds = [
      ...instructionIdsForBlock(switchResult.block),
      ...instructionIdsForBlock(jumpResult.block),
    ];
    expect(new Set(instructionIds).size).toBe(instructionIds.length);
  });

  test("lowers jump edge arguments through a deterministic copy block", () => {
    const targetParameter = optIrBlockParameter({
      valueId: optIrValueId(2),
      type: optIrUnsignedIntegerType(64),
      incomingRole: "branchArgument",
      originId: optIrOriginId(2),
    });
    const result = lowerAArch64BlockShell({
      block: optIrBlockForTest({
        parameters: [],
        terminator: {
          kind: "jump",
          operationId: optIrOperationId(20),
          edge: optIrEdgeId(8),
          originId: optIrOriginId(20),
        },
      }),
      edges: optIrCfgEdgeTable([
        edgeForTest({
          edgeId: optIrEdgeId(8),
          toBlock: optIrBlockId(9),
          arguments: [optIrValueId(1)],
        }),
      ]),
      blockParametersByBlock: new Map([[optIrBlockId(9), [targetParameter]]]),
      isEntry: true,
      operations: new Map(),
      returnLocations: [],
      valueRegisters: new Map([
        [optIrValueId(1), vreg(1)],
        [optIrValueId(2), vreg(2)],
      ]),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected edge argument lowering success");
    expect(result.edgeBlocks).toHaveLength(1);
    expect(String(result.block.terminator?.opcode)).toBe("b");
    expect(branchTargets([], result.block.terminator)[0]).toBe(
      Number(result.edgeBlocks[0]?.blockId),
    );
    expect(
      result.edgeBlocks[0]?.instructions.map((instruction) => String(instruction.opcode)),
    ).toEqual(["add-immediate"]);
    expect(branchTargets([], result.edgeBlocks[0]?.terminator)).toEqual([9]);
  });

  test("lowers cyclic edge arguments with temporary parallel copies", () => {
    const u64 = optIrUnsignedIntegerType(64);
    const result = lowerAArch64BlockShell({
      block: optIrBlockForTest({
        parameters: [],
        terminator: {
          kind: "jump",
          operationId: optIrOperationId(21),
          edge: optIrEdgeId(9),
          originId: optIrOriginId(21),
        },
      }),
      edges: optIrCfgEdgeTable([
        edgeForTest({
          edgeId: optIrEdgeId(9),
          toBlock: optIrBlockId(10),
          arguments: [optIrValueId(2), optIrValueId(1)],
        }),
      ]),
      blockParametersByBlock: new Map([
        [
          optIrBlockId(10),
          [
            optIrBlockParameter({
              valueId: optIrValueId(1),
              type: u64,
              incomingRole: "loopCarried",
              originId: optIrOriginId(21),
            }),
            optIrBlockParameter({
              valueId: optIrValueId(2),
              type: u64,
              incomingRole: "loopCarried",
              originId: optIrOriginId(21),
            }),
          ],
        ],
      ]),
      isEntry: true,
      operations: new Map(),
      returnLocations: [],
      valueRegisters: new Map([
        [optIrValueId(1), vreg(1)],
        [optIrValueId(2), vreg(2)],
      ]),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected cyclic edge lowering success");
    expect(
      result.edgeBlocks[0]?.instructions.map((instruction) => String(instruction.opcode)),
    ).toEqual(["add-immediate", "add-immediate", "add-immediate", "add-immediate"]);
    expect(result.virtualRegisters.some((register) => Number(register.vreg) >= 4_500_000_000)).toBe(
      true,
    );
  });
});

function vreg(valueId: number) {
  return virtualRegisterForOptIrValue({
    valueId: optIrValueId(valueId),
    type: { kind: "integer", width: 64 },
  });
}

function branchTargets(
  instructions: readonly { readonly operands: readonly { readonly operand: unknown }[] }[],
  terminator: { readonly operands: readonly { readonly operand: unknown }[] } | undefined,
): readonly number[] {
  return [...instructions, ...(terminator === undefined ? [] : [terminator])]
    .flatMap((instruction) => instruction.operands)
    .flatMap((operand) =>
      typeof operand.operand === "object" &&
      operand.operand !== null &&
      "kind" in operand.operand &&
      operand.operand.kind === "block" &&
      "block" in operand.operand
        ? [Number(operand.operand.block)]
        : [],
    );
}

function instructionIdsForBlock(block: {
  readonly instructions: readonly { readonly instructionId: number }[];
  readonly terminator?: { readonly instructionId: number };
}): readonly number[] {
  return [
    ...block.instructions.map((instruction) => instruction.instructionId),
    ...(block.terminator === undefined ? [] : [block.terminator.instructionId]),
  ];
}

function isEdgeCopyTempRegister(register: { readonly vreg: number }): boolean {
  return Number(register.vreg) >= 4_500_000_000;
}
