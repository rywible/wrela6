import { describe, expect, test } from "bun:test";

import {
  AARCH64_CLOSED_OPCODE_INVENTORY,
  RPI5_BACKEND_CATALOGS,
  RPI5_BACKEND_RELOCATION_MAPPINGS,
} from "../../../../../src/target/aarch64/backend/catalogs/rpi5-backend-catalog-data";
import { RPI5_KNOWN_BYTE_FIXTURES } from "../../../../../src/target/aarch64/backend/catalogs/known-byte-fixtures";
import { aarch64IntegerBranchEncoderFamilies } from "../../../../../src/target/aarch64/backend/object/encoding-integer-branch";
import { aarch64MemorySimdFpEncoderFamilies } from "../../../../../src/target/aarch64/backend/object/encoding-memory-simd-fp";
import {
  encodeAArch64PhysicalInstructionForTarget,
  IMPLEMENTED_AARCH64_ENCODER_OPCODES,
  type AArch64PhysicalInstructionToEncode,
} from "../../../../../src/target/aarch64/backend/object/encoding";
import type { AArch64InstructionOperand } from "../../../../../src/target/aarch64/backend/object/encoding-core";

describe("RPi5 backend catalog data", () => {
  test("contains required relocation mappings", () => {
    expect(RPI5_BACKEND_RELOCATION_MAPPINGS.map((mapping) => mapping.internalFamily)).toEqual([
      "addr32",
      "addr32nb",
      "addr64",
      "branch14",
      "branch19",
      "branch26",
      "pagebase-rel21",
      "pageoffset-12a",
      "pageoffset-12l",
      "rel32",
      "section-relative",
    ]);
    expect(RPI5_BACKEND_CATALOGS.relocationCatalog.mappingFor("branch26")?.peCoffFamilies).toEqual([
      "IMAGE_REL_ARM64_BRANCH26",
    ]);
  });

  test("contains known bytes for representative emitted fixtures", () => {
    expect(
      AUTHORED_KNOWN_BYTE_FIXTURES.find((fixture) => fixture.fixtureId === "movz-x0-0x1234")?.bytes,
    ).toEqual([0x80, 0x46, 0x82, 0xd2]);
    expect(
      AUTHORED_KNOWN_BYTE_FIXTURES.find((fixture) => fixture.fixtureId === "ldr-x1-x2-16")?.bytes,
    ).toEqual([0x41, 0x08, 0x40, 0xf9]);
    expect(
      AUTHORED_KNOWN_BYTE_FIXTURES.find((fixture) => fixture.fixtureId === "add-x2-x0-x1")?.bytes,
    ).toEqual([0x02, 0x00, 0x01, 0x8b]);
    expect(
      AUTHORED_KNOWN_BYTE_FIXTURES.find((fixture) => fixture.fixtureId === "dmb-ish")?.bytes,
    ).toEqual([0xbf, 0x3b, 0x03, 0xd5]);
    expect(
      AUTHORED_KNOWN_BYTE_FIXTURES.find((fixture) => fixture.fixtureId === "trap-brk-zero")?.bytes,
    ).toEqual([0x00, 0x00, 0x20, 0xd4]);
  });

  test("reserves x18 and covers the closed opcode inventory", () => {
    expect(RPI5_BACKEND_CATALOGS.registerModel.canAllocate("x18")).toBe(false);
    expect(
      RPI5_BACKEND_CATALOGS.encodingCatalog.entries.map((entry) => entry.opcode).sort(),
    ).toEqual([...AARCH64_CLOSED_OPCODE_INVENTORY].sort());
  });

  test("closed opcode inventory matches implemented encoder families", () => {
    const familyOpcodes = [
      ...aarch64IntegerBranchEncoderFamilies,
      ...aarch64MemorySimdFpEncoderFamilies,
    ].flatMap((family) => family.opcodes);

    expect([...IMPLEMENTED_AARCH64_ENCODER_OPCODES].sort()).toEqual([...familyOpcodes].sort());
    const inventory = new Set<string>(AARCH64_CLOSED_OPCODE_INVENTORY);
    expect(familyOpcodes.filter((opcode) => !inventory.has(opcode))).toEqual([]);
  });

  test("every closed inventory opcode has an authored known-byte fixture", () => {
    const fixtureOpcodes = new Set(AUTHORED_KNOWN_BYTE_FIXTURES.map((fixture) => fixture.opcode));
    expect(AARCH64_CLOSED_OPCODE_INVENTORY.filter((opcode) => !fixtureOpcodes.has(opcode))).toEqual(
      [],
    );
    expect(
      RPI5_BACKEND_CATALOGS.encodingCatalog.entries.filter(
        (entry) => (entry.knownByteFixtureIds?.length ?? 0) === 0,
      ),
    ).toEqual([]);
  });

  test("every authored known-byte fixture encodes through the production catalog", () => {
    const failures: string[] = [];
    for (const fixture of AUTHORED_KNOWN_BYTE_FIXTURES) {
      const result = encodeAArch64PhysicalInstructionForTarget({
        instruction: instructionForKnownByteFixture(fixture),
        encodingCatalog: RPI5_BACKEND_CATALOGS.encodingCatalog,
        registerModel: RPI5_BACKEND_CATALOGS.registerModel,
      });

      if (result.kind !== "ok") {
        failures.push(
          `${fixture.fixtureId} failed to encode: ${result.diagnostics
            .map((diagnostic) => diagnostic.stableDetail)
            .join(", ")}`,
        );
        continue;
      }
      const bytes = [...result.value.bytes];
      if (bytes.join(",") !== fixture.bytes.join(",")) {
        failures.push(
          `${fixture.fixtureId} encoded ${bytes.map(hexByte).join(" ")} but fixture has ${fixture.bytes
            .map(hexByte)
            .join(" ")}`,
        );
      }
    }
    expect(failures).toEqual([]);
  });

  test("fingerprints are deterministic", () => {
    expect(RPI5_BACKEND_CATALOGS.registerModel.fingerprint).toBe(
      "backend-register-model:wrela-uefi-aarch64-rpi5-v1:v1",
    );
    expect(RPI5_BACKEND_CATALOGS.encodingCatalog.fingerprint).toBe(
      "backend-encoding-catalog:wrela-uefi-aarch64-rpi5-v1:v1",
    );
  });
});

interface KnownByteFixture {
  readonly fixtureId: string;
  readonly opcode: string;
  readonly operands: readonly string[];
  readonly bytes: readonly number[];
}

const AUTHORED_KNOWN_BYTE_FIXTURES = RPI5_KNOWN_BYTE_FIXTURES as readonly KnownByteFixture[];

function instructionForKnownByteFixture(
  fixture: KnownByteFixture,
): AArch64PhysicalInstructionToEncode {
  return {
    opcode: encoderOpcodeForKnownByteFixture(fixture),
    operands: operandsForKnownByteFixture(fixture),
    accessWidthBytes: accessWidthBytesForKnownByteFixture(fixture),
    relocation: relocationForKnownByteFixture(fixture),
  };
}

function encoderOpcodeForKnownByteFixture(fixture: KnownByteFixture): string {
  // `frame-address` is a catalog-level pseudo opcode for materializing an address from SP;
  // its bytes are produced by the real add-immediate encoder branch.
  if (fixture.opcode === "frame-address") return "add-immediate";
  return fixture.opcode;
}

function operandsForKnownByteFixture(
  fixture: KnownByteFixture,
): readonly AArch64InstructionOperand[] {
  return fixture.operands.flatMap((operand, operandIndex): readonly AArch64InstructionOperand[] => {
    if (fixture.opcode === "prfm" && operandIndex === 0) {
      return [];
    }
    if (operand === "label" || operand === "symbol@PAGE") {
      return [{ kind: "relocation-target", target: operand }];
    }
    if (operand === "symbol@PAGEOFF") {
      return [{ kind: "relocation-low12", target: "symbol", addend: 0n }];
    }
    if (isConditionOperand(operand)) {
      return [{ kind: "condition", condition: operand }];
    }
    if (operand.startsWith("#")) {
      return [{ kind: "immediate", value: BigInt(operand.slice(1)) }];
    }

    const memoryOperand = /^\[([^,\]]+)(?:,#?(-?\d+)|,([^,\]]+))?\]$/.exec(operand);
    if (memoryOperand !== null) {
      const base = memoryOperand[1]!;
      const immediateOffset = memoryOperand[2];
      const registerOffset = memoryOperand[3];
      return [
        { kind: "memory-base", register: base },
        ...(immediateOffset === undefined
          ? []
          : ([
              { kind: "immediate", value: BigInt(immediateOffset) },
            ] satisfies readonly AArch64InstructionOperand[])),
        ...(registerOffset === undefined
          ? []
          : ([
              { kind: "register", register: registerOffset },
            ] satisfies readonly AArch64InstructionOperand[])),
      ];
    }

    return [{ kind: "register", register: registerKeyForKnownByteOperand(operand) }];
  });
}

function registerKeyForKnownByteOperand(operand: string): string {
  return operand.replace(/[{}]/g, "").replace(/\..*$/, "");
}

function hexByte(byte: number): string {
  return `0x${byte.toString(16).padStart(2, "0")}`;
}

function accessWidthBytesForKnownByteFixture(fixture: KnownByteFixture): number | undefined {
  const destination = fixture.operands[0];
  if (fixture.opcode === "ldr-unsigned-immediate" || fixture.opcode === "str-unsigned-immediate") {
    if (destination?.startsWith("d")) return 8;
    if (destination?.startsWith("s") || destination?.startsWith("w")) return 4;
    if (destination?.startsWith("h")) return 2;
    if (destination?.startsWith("b")) return 1;
    if (destination?.startsWith("q") || destination?.startsWith("v")) return 16;
  }
  return undefined;
}

function relocationForKnownByteFixture(
  fixture: KnownByteFixture,
): AArch64PhysicalInstructionToEncode["relocation"] {
  if (fixture.opcode === "b" || fixture.opcode === "bl") {
    return { family: "branch26", target: "label" };
  }
  if (fixture.opcode === "b-cond" || fixture.opcode === "cbz" || fixture.opcode === "cbnz") {
    return { family: "branch19", target: "label" };
  }
  if (fixture.opcode === "tbz" || fixture.opcode === "tbnz") {
    return { family: "branch14", target: "label" };
  }
  return undefined;
}

function isConditionOperand(operand: string): boolean {
  return new Set([
    "eq",
    "ne",
    "cs",
    "hs",
    "cc",
    "lo",
    "mi",
    "pl",
    "vs",
    "vc",
    "hi",
    "ls",
    "ge",
    "lt",
    "gt",
    "le",
    "al",
    "nv",
  ]).has(operand);
}
