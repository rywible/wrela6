import { describe, expect, test } from "bun:test";
import {
  PE32_PLUS_MAGIC,
  PE_COFF_FILE_HEADER_SIZE_BYTES,
  PE_DATA_DIRECTORY_COUNT,
  PE_FILE_ALIGNMENT_BYTES,
  PE_FIRST_SECTION_RVA,
  PE_HEADER_OFFSET_BYTES,
  PE_MACHINE_ARM64,
  PE_SECTION_ALIGNMENT_BYTES,
  PE_SUBSYSTEM_EFI_APPLICATION,
  createPeByteWriter,
} from "../../../src/pe-coff";

describe("PE constants", () => {
  test("exports v1 PE/COFF constants", () => {
    expect(PE_HEADER_OFFSET_BYTES).toBe(0x80);
    expect(PE_COFF_FILE_HEADER_SIZE_BYTES).toBe(20);
    expect(PE32_PLUS_MAGIC).toBe(0x20b);
    expect(PE_MACHINE_ARM64).toBe(0xaa64);
    expect(PE_SUBSYSTEM_EFI_APPLICATION).toBe(10);
    expect(PE_FILE_ALIGNMENT_BYTES).toBe(512);
    expect(PE_SECTION_ALIGNMENT_BYTES).toBe(4096);
    expect(PE_FIRST_SECTION_RVA).toBe(0x1000);
    expect(PE_DATA_DIRECTORY_COUNT).toBe(16);
  });
});

describe("PE byte writer", () => {
  test("writes little-endian unsigned integers and bytes", () => {
    const writer = createPeByteWriter();

    expect(writer.writeU8(0x12).kind).toBe("ok");
    expect(writer.writeU16Le(0x3456).kind).toBe("ok");
    expect(writer.writeU32Le(0x789abcde).kind).toBe("ok");
    expect(writer.writeU64Le(0x0102030405060708n).kind).toBe("ok");
    expect(writer.writeBytes([0xaa, 0xbb]).kind).toBe("ok");

    expect(writer.offset()).toBe(17);
    expect(writer.bytes()).toBeInstanceOf(Uint8Array);
    expect([...writer.bytes()]).toEqual([
      0x12, 0x56, 0x34, 0xde, 0xbc, 0x9a, 0x78, 0x08, 0x07, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01,
      0xaa, 0xbb,
    ]);
  });

  test("copies typed byte inputs into writer-owned storage", () => {
    const writer = createPeByteWriter();
    const input = Uint8Array.of(0x11, 0x22, 0x33);

    expect(writer.writeBytes(input).kind).toBe("ok");
    input[1] = 0xff;

    expect([...writer.bytes()]).toEqual([0x11, 0x22, 0x33]);
  });

  test("rejects overflow without truncating", () => {
    const writer = createPeByteWriter();

    const result = writer.writeU32Le(0x1_0000_0000);

    expect(result.kind).toBe("error");
    expect([...writer.bytes()]).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "byte-writer:range:u32:4294967296",
    );
  });

  test("rejects negative values, non-integers, and negative zero counts", () => {
    const writer = createPeByteWriter();

    expect(writer.writeU8(-1).kind).toBe("error");
    expect(writer.writeU16Le(1.5).kind).toBe("error");
    expect(writer.writeU64Le(1 as unknown as bigint).kind).toBe("error");
    expect(writer.writeZeroes(-1).kind).toBe("error");
    expect([...writer.bytes()]).toEqual([]);
  });

  test("writes zeroes and patches existing u32 values", () => {
    const writer = createPeByteWriter();

    expect(writer.writeZeroes(4).kind).toBe("ok");
    expect(writer.patchU32Le(0, 0x12345678).kind).toBe("ok");
    expect([...writer.bytes()]).toEqual([0x78, 0x56, 0x34, 0x12]);

    const result = writer.patchU32Le(1, 0);
    expect(result.kind).toBe("error");
    expect([...writer.bytes()]).toEqual([0x78, 0x56, 0x34, 0x12]);
  });

  test("appends large byte and zero runs without spreading into call arguments", () => {
    const writer = createPeByteWriter();
    const largeBytes = Array.from({ length: 200_000 }, (_unusedValue, index) => index & 0xff);

    expect(writer.writeBytes(largeBytes).kind).toBe("ok");
    expect(writer.writeZeroes(200_000).kind).toBe("ok");

    expect(writer.offset()).toBe(400_000);
    const bytes = writer.bytes();
    expect(bytes[0]).toBe(0);
    expect(bytes[199_999]).toBe(0x3f);
    expect(bytes[200_000]).toBe(0);
    expect(bytes[399_999]).toBe(0);
  });

  test("bytes returns an isolated copy", () => {
    const writer = createPeByteWriter();
    expect(writer.writeU8(1).kind).toBe("ok");

    const bytes = writer.bytes();
    bytes[0] = 99;
    expect([...writer.bytes()]).toEqual([1]);
  });
});
