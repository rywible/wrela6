import { describe, expect, test } from "bun:test";

import { RPI5_BACKEND_CATALOGS } from "../../../../../src/target/aarch64/backend/catalogs/rpi5-backend-catalog-data";
import {
  encodeAArch64PhysicalInstructionWithFamilies,
  type AArch64InstructionOperand,
} from "../../../../../src/target/aarch64/backend/object/encoding-core";
import { aarch64IntegerBranchEncoderFamilies } from "../../../../../src/target/aarch64/backend/object/encoding-integer-branch";

describe("AArch64 integer and branch encoder", () => {
  test("encodes movz x0, #0x1234 using known bytes", () => {
    const result = encodeAArch64PhysicalInstructionWithFamilies(
      {
        catalog: RPI5_BACKEND_CATALOGS.encodingCatalog,
        registerModel: RPI5_BACKEND_CATALOGS.registerModel,
        instruction: {
          opcode: "movz",
          operands: [
            { kind: "register", register: "x0" },
            { kind: "immediate", value: 0x1234n },
          ],
        },
      },
      aarch64IntegerBranchEncoderFamilies,
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected encoding");
    expect([...result.value.bytes]).toEqual([0x80, 0x46, 0x82, 0xd2]);
  });

  test("conditional branch records branch19 relocation hole", () => {
    const result = encodeAArch64PhysicalInstructionWithFamilies(
      {
        catalog: RPI5_BACKEND_CATALOGS.encodingCatalog,
        registerModel: RPI5_BACKEND_CATALOGS.registerModel,
        instruction: {
          opcode: "b-cond",
          operands: [
            { kind: "condition", condition: "eq" },
            { kind: "relocation-target", target: "target.block" },
          ],
          relocation: { family: "branch19", target: "target.block" },
        },
      },
      aarch64IntegerBranchEncoderFamilies,
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected branch encoding");
    expect(result.value.relocationHole).toEqual({
      family: "branch19",
      patchOffsetBytes: 0,
      bitRange: [5, 23],
      target: "target.block",
    });
  });

  test("encodes compare and test branches with operand width and opcode polarity", () => {
    const cases: readonly {
      readonly opcode: string;
      readonly operands: readonly AArch64InstructionOperand[];
      readonly relocation: { readonly family: string; readonly target: string };
      readonly bytes: readonly number[];
    }[] = [
      {
        opcode: "cbz",
        operands: [
          { kind: "register", register: "w4" },
          { kind: "relocation-target", target: "target.block" },
        ],
        relocation: { family: "branch19", target: "target.block" },
        bytes: [0x04, 0x00, 0x00, 0x34],
      },
      {
        opcode: "cbnz",
        operands: [
          { kind: "register", register: "x3" },
          { kind: "relocation-target", target: "target.block" },
        ],
        relocation: { family: "branch19", target: "target.block" },
        bytes: [0x03, 0x00, 0x00, 0xb5],
      },
      {
        opcode: "tbnz",
        operands: [
          { kind: "register", register: "x5" },
          { kind: "immediate", value: 40n },
          { kind: "relocation-target", target: "target.block" },
        ],
        relocation: { family: "branch14", target: "target.block" },
        bytes: [0x05, 0x00, 0x40, 0xb7],
      },
    ];

    for (const testCase of cases) {
      const result = encodeAArch64PhysicalInstructionWithFamilies(
        {
          catalog: RPI5_BACKEND_CATALOGS.encodingCatalog,
          registerModel: RPI5_BACKEND_CATALOGS.registerModel,
          instruction: {
            opcode: testCase.opcode,
            operands: testCase.operands,
            relocation: testCase.relocation,
          },
        },
        aarch64IntegerBranchEncoderFamilies,
      );

      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") throw new Error(`expected ${testCase.opcode} encoding`);
      expect([...result.value.bytes]).toEqual([...testCase.bytes]);
    }
  });

  test("encodes add x2, x0, x1 using known bytes", () => {
    const result = encodeAArch64PhysicalInstructionWithFamilies(
      {
        catalog: RPI5_BACKEND_CATALOGS.encodingCatalog,
        registerModel: RPI5_BACKEND_CATALOGS.registerModel,
        instruction: {
          opcode: "add-shifted-register",
          operands: [
            { kind: "register", register: "x2" },
            { kind: "register", register: "x0" },
            { kind: "register", register: "x1" },
          ],
        },
      },
      aarch64IntegerBranchEncoderFamilies,
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected add encoding");
    expect([...result.value.bytes]).toEqual([0x02, 0x00, 0x01, 0x8b]);
  });

  test("encodes lsl x0, x1, #3 using the immediate bitfield alias", () => {
    const result = encodeAArch64PhysicalInstructionWithFamilies(
      {
        catalog: RPI5_BACKEND_CATALOGS.encodingCatalog,
        registerModel: RPI5_BACKEND_CATALOGS.registerModel,
        instruction: {
          opcode: "lsl-immediate",
          operands: [
            { kind: "register", register: "x0" },
            { kind: "register", register: "x1" },
            { kind: "immediate", value: 3n },
          ],
        },
      },
      aarch64IntegerBranchEncoderFamilies,
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected lsl immediate encoding");
    expect([...result.value.bytes]).toEqual([0x20, 0xf0, 0x7d, 0xd3]);
  });

  test("encodes stack pointer add/sub immediate prologue arithmetic", () => {
    const sub = encodeAArch64PhysicalInstructionWithFamilies(
      {
        catalog: RPI5_BACKEND_CATALOGS.encodingCatalog,
        registerModel: RPI5_BACKEND_CATALOGS.registerModel,
        instruction: {
          opcode: "sub-immediate",
          operands: [
            { kind: "register", register: "sp" },
            { kind: "register", register: "sp" },
            { kind: "immediate", value: 16n },
          ],
        },
      },
      aarch64IntegerBranchEncoderFamilies,
    );
    const add = encodeAArch64PhysicalInstructionWithFamilies(
      {
        catalog: RPI5_BACKEND_CATALOGS.encodingCatalog,
        registerModel: RPI5_BACKEND_CATALOGS.registerModel,
        instruction: {
          opcode: "add-immediate",
          operands: [
            { kind: "register", register: "sp" },
            { kind: "register", register: "sp" },
            { kind: "immediate", value: 16n },
          ],
        },
      },
      aarch64IntegerBranchEncoderFamilies,
    );

    expect(sub.kind).toBe("ok");
    expect(add.kind).toBe("ok");
    if (sub.kind !== "ok" || add.kind !== "ok") throw new Error("expected encodings");
    expect([...sub.value.bytes]).toEqual([0xff, 0x43, 0x00, 0xd1]);
    expect([...add.value.bytes]).toEqual([0xff, 0x43, 0x00, 0x91]);
  });

  test("encodes stack pointer address materialization into the fifth public argument register", () => {
    const result = encodeAArch64PhysicalInstructionWithFamilies(
      {
        catalog: RPI5_BACKEND_CATALOGS.encodingCatalog,
        registerModel: RPI5_BACKEND_CATALOGS.registerModel,
        instruction: {
          opcode: "add-immediate",
          operands: [
            { kind: "register", register: "x4" },
            { kind: "register", register: "sp" },
            { kind: "immediate", value: 24n },
          ],
        },
      },
      aarch64IntegerBranchEncoderFamilies,
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected add encoding");
    expect([...result.value.bytes]).toEqual([0xe4, 0x63, 0x00, 0x91]);
  });

  test("encodes logical shifted-register copy alias with zero register source", () => {
    const result = encodeAArch64PhysicalInstructionWithFamilies(
      {
        catalog: RPI5_BACKEND_CATALOGS.encodingCatalog,
        registerModel: RPI5_BACKEND_CATALOGS.registerModel,
        instruction: {
          opcode: "orr-shifted-register",
          operands: [
            { kind: "register", register: "x0" },
            { kind: "register", register: "xzr" },
            { kind: "register", register: "x2" },
          ],
        },
      },
      aarch64IntegerBranchEncoderFamilies,
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected orr encoding");
    expect([...result.value.bytes]).toEqual([0xe0, 0x03, 0x02, 0xaa]);
  });

  test("rejects zero register source for arithmetic shifted-register instructions", () => {
    const result = encodeAArch64PhysicalInstructionWithFamilies(
      {
        catalog: RPI5_BACKEND_CATALOGS.encodingCatalog,
        registerModel: RPI5_BACKEND_CATALOGS.registerModel,
        instruction: {
          opcode: "add-shifted-register",
          operands: [
            { kind: "register", register: "x0" },
            { kind: "register", register: "xzr" },
            { kind: "register", register: "x2" },
          ],
        },
      },
      aarch64IntegerBranchEncoderFamilies,
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected add encoding error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "encoding:illegal-register:add-shifted-register:x0:xzr:x2",
    ]);
  });

  test("rejects add and sub immediate with zero-register aliases of SP", () => {
    for (const opcode of ["add-immediate", "sub-immediate"]) {
      const result = encodeAArch64PhysicalInstructionWithFamilies(
        {
          catalog: RPI5_BACKEND_CATALOGS.encodingCatalog,
          registerModel: RPI5_BACKEND_CATALOGS.registerModel,
          instruction: {
            opcode,
            operands: [
              { kind: "register", register: "x0" },
              { kind: "register", register: "xzr" },
              { kind: "immediate", value: 16n },
            ],
          },
        },
        aarch64IntegerBranchEncoderFamilies,
      );

      expect(result.kind).toBe("error");
      if (result.kind !== "error") throw new Error(`expected ${opcode} encoding error`);
      expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
        `encoding:illegal-register:${opcode}:x0:xzr`,
      ]);
    }
  });

  test("encodes register branches, barriers, and traps from the emitted pseudo set", () => {
    const cases = [
      {
        opcode: "br",
        operands: [{ kind: "register" as const, register: "x0" }],
        bytes: [0x00, 0x00, 0x1f, 0xd6],
      },
      { opcode: "dmb", operands: [], bytes: [0xbf, 0x3b, 0x03, 0xd5] },
      { opcode: "dsb", operands: [], bytes: [0x9f, 0x3b, 0x03, 0xd5] },
      { opcode: "trap", operands: [], bytes: [0x00, 0x00, 0x20, 0xd4] },
    ];

    for (const testCase of cases) {
      const result = encodeAArch64PhysicalInstructionWithFamilies(
        {
          catalog: RPI5_BACKEND_CATALOGS.encodingCatalog,
          registerModel: RPI5_BACKEND_CATALOGS.registerModel,
          instruction: {
            opcode: testCase.opcode,
            operands: testCase.operands,
          },
        },
        aarch64IntegerBranchEncoderFamilies,
      );

      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") throw new Error(`expected ${testCase.opcode} encoding`);
      expect([...result.value.bytes]).toEqual([...testCase.bytes]);
    }
  });

  test("encodes representative emitted integer/control families using known bytes", () => {
    const cases: readonly {
      readonly opcode: string;
      readonly operands: readonly AArch64InstructionOperand[];
      readonly bytes: readonly number[];
    }[] = [
      {
        opcode: "movk",
        operands: [
          { kind: "register", register: "x0" },
          { kind: "immediate", value: 0x5678n },
        ],
        bytes: [0x00, 0xcf, 0x8a, 0xf2],
      },
      {
        opcode: "movn",
        operands: [
          { kind: "register", register: "x0" },
          { kind: "immediate", value: 0x9abcn },
        ],
        bytes: [0x80, 0x57, 0x93, 0x92],
      },
      {
        opcode: "eor-logical-immediate",
        operands: [
          { kind: "register", register: "x0" },
          { kind: "register", register: "x1" },
          { kind: "immediate", value: 0xffn },
        ],
        bytes: [0x20, 0x1c, 0x40, 0xd2],
      },
      {
        opcode: "mul",
        operands: [
          { kind: "register", register: "x0" },
          { kind: "register", register: "x1" },
          { kind: "register", register: "x2" },
        ],
        bytes: [0x20, 0x7c, 0x02, 0x9b],
      },
      {
        opcode: "cmp-shifted-register",
        operands: [
          { kind: "register", register: "x0" },
          { kind: "register", register: "x1" },
        ],
        bytes: [0x1f, 0x00, 0x01, 0xeb],
      },
      {
        opcode: "cset",
        operands: [
          { kind: "register", register: "x0" },
          { kind: "condition", condition: "eq" },
        ],
        bytes: [0xe0, 0x17, 0x9f, 0x9a],
      },
      {
        opcode: "csel",
        operands: [
          { kind: "register", register: "x0" },
          { kind: "register", register: "x1" },
          { kind: "register", register: "x2" },
          { kind: "condition", condition: "eq" },
        ],
        bytes: [0x20, 0x00, 0x82, 0x9a],
      },
      {
        opcode: "ccmp",
        operands: [
          { kind: "register", register: "x0" },
          { kind: "register", register: "x1" },
          { kind: "immediate", value: 0n },
          { kind: "condition", condition: "eq" },
        ],
        bytes: [0x00, 0x00, 0x41, 0xfa],
      },
      {
        opcode: "blr",
        operands: [{ kind: "register", register: "x0" }],
        bytes: [0x00, 0x00, 0x3f, 0xd6],
      },
    ];

    for (const testCase of cases) {
      const result = encodeAArch64PhysicalInstructionWithFamilies(
        {
          catalog: RPI5_BACKEND_CATALOGS.encodingCatalog,
          registerModel: RPI5_BACKEND_CATALOGS.registerModel,
          instruction: { opcode: testCase.opcode, operands: testCase.operands },
        },
        aarch64IntegerBranchEncoderFamilies,
      );

      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") throw new Error(`expected ${testCase.opcode} encoding`);
      expect([...result.value.bytes]).toEqual([...testCase.bytes]);
    }
  });

  test("rejects movz immediate outside 16-bit range", () => {
    const result = encodeAArch64PhysicalInstructionWithFamilies(
      {
        catalog: RPI5_BACKEND_CATALOGS.encodingCatalog,
        registerModel: RPI5_BACKEND_CATALOGS.registerModel,
        instruction: {
          opcode: "movz",
          operands: [
            { kind: "register", register: "x0" },
            { kind: "immediate", value: 0x10000n },
          ],
        },
      },
      aarch64IntegerBranchEncoderFamilies,
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected range error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "encoding:immediate-out-of-range:movz:65536",
    ]);
  });
});
