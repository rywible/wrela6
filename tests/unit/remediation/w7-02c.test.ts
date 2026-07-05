import { describe, expect, test } from "bun:test";

import {
  aarch64ObjectLiteralPoolEntry,
  aarch64ObjectSection,
} from "../../../src/target/aarch64/backend/object/object-module";

describe("W7-02c AArch64 object typed-array byte payloads", () => {
  test("object sections and literal pools expose Uint8Array bytes", () => {
    const section = aarch64ObjectSection({
      stableKey: ".text",
      classKey: "executable-text",
      bytes: [0xc0, 0x03, 0x5f, 0xd6],
    });
    const literalPool = aarch64ObjectLiteralPoolEntry({
      stableKey: "literal:one",
      sectionKey: ".text",
      offsetBytes: 0,
      data: [1, 2, 3, 4],
    });

    expect(section.bytes).toBeInstanceOf(Uint8Array);
    expect(literalPool.data).toBeInstanceOf(Uint8Array);
    expect([...section.bytes]).toEqual([0xc0, 0x03, 0x5f, 0xd6]);
    expect([...literalPool.data]).toEqual([1, 2, 3, 4]);
  });
});
