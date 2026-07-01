import { describe, expect, test } from "bun:test";

import { RPI5_BACKEND_CATALOGS } from "../../../../../src/target/aarch64/backend/catalogs/rpi5-backend-catalog-data";
import {
  encodeAArch64PhysicalInstructionWithFamilies,
  type AArch64InstructionOperand,
} from "../../../../../src/target/aarch64/backend/object/encoding-core";
import { aarch64MemorySimdFpEncoderFamilies } from "../../../../../src/target/aarch64/backend/object/encoding-memory-simd-fp";

describe("AArch64 memory/SIMD/FP encoder", () => {
  test("encodes ldr x1, [x2, #16] with unsigned scaled offset", () => {
    const result = encodeAArch64PhysicalInstructionWithFamilies(
      {
        catalog: RPI5_BACKEND_CATALOGS.encodingCatalog,
        registerModel: RPI5_BACKEND_CATALOGS.registerModel,
        instruction: {
          opcode: "ldr-unsigned-immediate",
          operands: [
            { kind: "register", register: "x1" },
            { kind: "memory-base", register: "x2" },
            { kind: "immediate", value: 16n },
          ],
          accessWidthBytes: 8,
        },
      },
      aarch64MemorySimdFpEncoderFamilies,
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected ldr encoding");
    expect([...result.value.bytes]).toEqual([0x41, 0x08, 0x40, 0xf9]);
  });

  test("pageoffset-12l rejects offset not scaled for 64-bit load", () => {
    const result = encodeAArch64PhysicalInstructionWithFamilies(
      {
        catalog: RPI5_BACKEND_CATALOGS.encodingCatalog,
        registerModel: RPI5_BACKEND_CATALOGS.registerModel,
        instruction: {
          opcode: "ldr-unsigned-immediate",
          operands: [
            { kind: "register", register: "x0" },
            { kind: "memory-base", register: "x1" },
            { kind: "relocation-low12", target: "global", addend: 6n },
          ],
          accessWidthBytes: 8,
        },
      },
      aarch64MemorySimdFpEncoderFamilies,
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected scale error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "encoding:pageoffset-12l-scale-mismatch:ldr-unsigned-immediate:offset:6:width:8",
    ]);
  });

  test("rejects unsupported unsigned load/store access widths instead of misencoding size bits", () => {
    const result = encodeAArch64PhysicalInstructionWithFamilies(
      {
        catalog: RPI5_BACKEND_CATALOGS.encodingCatalog,
        registerModel: RPI5_BACKEND_CATALOGS.registerModel,
        instruction: {
          opcode: "ldr-unsigned-immediate",
          operands: [
            { kind: "register", register: "x1" },
            { kind: "memory-base", register: "x2" },
            { kind: "immediate", value: 4n },
          ],
          accessWidthBytes: 4,
        },
      },
      aarch64MemorySimdFpEncoderFamilies,
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected unsupported width rejection");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "encoding:unsupported-access-width:ldr-unsigned-immediate:4",
    ]);
  });

  test("rejects zero register as a memory base instead of treating it as sp", () => {
    const result = encodeAArch64PhysicalInstructionWithFamilies(
      {
        catalog: RPI5_BACKEND_CATALOGS.encodingCatalog,
        registerModel: RPI5_BACKEND_CATALOGS.registerModel,
        instruction: {
          opcode: "ldr-unsigned-immediate",
          operands: [
            { kind: "register", register: "x0" },
            { kind: "memory-base", register: "xzr" },
            { kind: "immediate", value: 0n },
          ],
          accessWidthBytes: 8,
        },
      },
      aarch64MemorySimdFpEncoderFamilies,
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected illegal memory base");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "encoding:illegal-register:ldr-unsigned-immediate",
    ]);
  });

  test("rejects SIMD registers as memory bases", () => {
    const result = encodeAArch64PhysicalInstructionWithFamilies(
      {
        catalog: RPI5_BACKEND_CATALOGS.encodingCatalog,
        registerModel: RPI5_BACKEND_CATALOGS.registerModel,
        instruction: {
          opcode: "ldr-unsigned-immediate",
          operands: [
            { kind: "register", register: "x0" },
            { kind: "memory-base", register: "v0" },
            { kind: "immediate", value: 0n },
          ],
          accessWidthBytes: 8,
        },
      },
      aarch64MemorySimdFpEncoderFamilies,
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected illegal memory base");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "encoding:illegal-register:ldr-unsigned-immediate",
    ]);
  });

  test("encodes str x30, [sp, #8] with unsigned scaled offset", () => {
    const result = encodeAArch64PhysicalInstructionWithFamilies(
      {
        catalog: RPI5_BACKEND_CATALOGS.encodingCatalog,
        registerModel: RPI5_BACKEND_CATALOGS.registerModel,
        instruction: {
          opcode: "str-unsigned-immediate",
          operands: [
            { kind: "register", register: "x30" },
            { kind: "memory-base", register: "sp" },
            { kind: "immediate", value: 8n },
          ],
          accessWidthBytes: 8,
        },
      },
      aarch64MemorySimdFpEncoderFamilies,
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected str encoding");
    expect([...result.value.bytes]).toEqual([0xfe, 0x07, 0x00, 0xf9]);
  });

  test("add-pageoff rejects stack and zero-register aliases", () => {
    const cases = [
      { destination: "xzr", source: "x1" },
      { destination: "sp", source: "x1" },
      { destination: "x0", source: "xzr" },
      { destination: "x0", source: "sp" },
    ];

    for (const currentCase of cases) {
      const result = encodeAArch64PhysicalInstructionWithFamilies(
        {
          catalog: RPI5_BACKEND_CATALOGS.encodingCatalog,
          registerModel: RPI5_BACKEND_CATALOGS.registerModel,
          instruction: {
            opcode: "add-pageoff",
            operands: [
              { kind: "register", register: currentCase.destination },
              { kind: "register", register: currentCase.source },
              { kind: "relocation-low12", target: "global", addend: 0n },
            ],
          },
        },
        aarch64MemorySimdFpEncoderFamilies,
      );

      expect(result.kind).toBe("error");
      if (result.kind !== "error") throw new Error("expected illegal add-pageoff register");
      expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
        `encoding:illegal-register:add-pageoff:${currentCase.destination}:${currentCase.source}`,
      ]);
    }
  });

  test("encodes rev16 x1, x2 using known bytes", () => {
    const result = encodeAArch64PhysicalInstructionWithFamilies(
      {
        catalog: RPI5_BACKEND_CATALOGS.encodingCatalog,
        registerModel: RPI5_BACKEND_CATALOGS.registerModel,
        instruction: {
          opcode: "rev16",
          operands: [
            { kind: "register", register: "x1" },
            { kind: "register", register: "x2" },
          ],
        },
      },
      aarch64MemorySimdFpEncoderFamilies,
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected rev16 encoding");
    expect([...result.value.bytes]).toEqual([0x41, 0x04, 0xc0, 0xda]);
  });

  test("encodes representative emitted memory/SIMD/FP families using known bytes", () => {
    const cases: readonly {
      readonly opcode: string;
      readonly operands: readonly AArch64InstructionOperand[];
      readonly bytes: readonly number[];
    }[] = [
      {
        opcode: "ldp-signed-offset",
        operands: [
          { kind: "register", register: "x0" },
          { kind: "register", register: "x1" },
          { kind: "memory-base", register: "x2" },
          { kind: "immediate", value: 16n },
        ],
        bytes: [0x40, 0x04, 0x41, 0xa9],
      },
      {
        opcode: "ldar",
        operands: [
          { kind: "register", register: "x0" },
          { kind: "memory-base", register: "x1" },
        ],
        bytes: [0x20, 0xfc, 0xdf, 0xc8],
      },
      {
        opcode: "ldadd",
        operands: [
          { kind: "register", register: "x0" },
          { kind: "register", register: "x2" },
          { kind: "memory-base", register: "x1" },
        ],
        bytes: [0x22, 0x00, 0x20, 0xf8],
      },
      {
        opcode: "ld1",
        operands: [
          { kind: "register", register: "v0" },
          { kind: "memory-base", register: "x1" },
        ],
        bytes: [0x20, 0x70, 0x40, 0x4c],
      },
      {
        opcode: "crc32",
        operands: [
          { kind: "register", register: "w0" },
          { kind: "register", register: "w1" },
          { kind: "register", register: "w2" },
        ],
        bytes: [0x20, 0x48, 0xc2, 0x1a],
      },
      {
        opcode: "pmull",
        operands: [
          { kind: "register", register: "v0" },
          { kind: "register", register: "v1" },
          { kind: "register", register: "v2" },
        ],
        bytes: [0x20, 0xe0, 0xe2, 0x0e],
      },
      {
        opcode: "fmadd",
        operands: [
          { kind: "register", register: "d0" },
          { kind: "register", register: "d1" },
          { kind: "register", register: "d2" },
          { kind: "register", register: "d3" },
        ],
        bytes: [0x20, 0x0c, 0x42, 0x1f],
      },
      {
        opcode: "dotprod",
        operands: [
          { kind: "register", register: "v0" },
          { kind: "register", register: "v1" },
          { kind: "register", register: "v2" },
        ],
        bytes: [0x20, 0x94, 0x82, 0x6e],
      },
    ];

    for (const testCase of cases) {
      const result = encodeAArch64PhysicalInstructionWithFamilies(
        {
          catalog: RPI5_BACKEND_CATALOGS.encodingCatalog,
          registerModel: RPI5_BACKEND_CATALOGS.registerModel,
          instruction: { opcode: testCase.opcode, operands: testCase.operands },
        },
        aarch64MemorySimdFpEncoderFamilies,
      );

      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") throw new Error(`expected ${testCase.opcode} encoding`);
      expect([...result.value.bytes]).toEqual([...testCase.bytes]);
    }
  });
});
