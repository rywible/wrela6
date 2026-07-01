import { describe, expect, test } from "bun:test";

import {
  AARCH64_CLOSED_OPCODE_INVENTORY,
  RPI5_BACKEND_CATALOGS,
  RPI5_BACKEND_RELOCATION_MAPPINGS,
} from "../../../../../src/target/aarch64/backend/catalogs/rpi5-backend-catalog-data";
import { RPI5_KNOWN_BYTE_FIXTURES } from "../../../../../src/target/aarch64/backend/catalogs/known-byte-fixtures";
import { aarch64IntegerBranchEncoderFamilies } from "../../../../../src/target/aarch64/backend/object/encoding-integer-branch";
import { aarch64MemorySimdFpEncoderFamilies } from "../../../../../src/target/aarch64/backend/object/encoding-memory-simd-fp";
import { IMPLEMENTED_AARCH64_ENCODER_OPCODES } from "../../../../../src/target/aarch64/backend/object/encoding-opcodes";

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
      RPI5_KNOWN_BYTE_FIXTURES.find((fixture) => fixture.fixtureId === "movz-x0-0x1234")?.bytes,
    ).toEqual([0x80, 0x46, 0x82, 0xd2]);
    expect(
      RPI5_KNOWN_BYTE_FIXTURES.find((fixture) => fixture.fixtureId === "ldr-x1-x2-16")?.bytes,
    ).toEqual([0x41, 0x08, 0x40, 0xf9]);
    expect(
      RPI5_KNOWN_BYTE_FIXTURES.find((fixture) => fixture.fixtureId === "add-x2-x0-x1")?.bytes,
    ).toEqual([0x02, 0x00, 0x01, 0x8b]);
    expect(
      RPI5_KNOWN_BYTE_FIXTURES.find((fixture) => fixture.fixtureId === "dmb-ish")?.bytes,
    ).toEqual([0xbf, 0x3b, 0x03, 0xd5]);
    expect(
      RPI5_KNOWN_BYTE_FIXTURES.find((fixture) => fixture.fixtureId === "trap-brk-zero")?.bytes,
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
    const fixtureOpcodes = new Set(RPI5_KNOWN_BYTE_FIXTURES.map((fixture) => fixture.opcode));
    expect(AARCH64_CLOSED_OPCODE_INVENTORY.filter((opcode) => !fixtureOpcodes.has(opcode))).toEqual(
      [],
    );
    expect(
      RPI5_BACKEND_CATALOGS.encodingCatalog.entries.filter(
        (entry) => (entry.knownByteFixtureIds?.length ?? 0) === 0,
      ),
    ).toEqual([]);
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
