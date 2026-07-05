import { describe, expect, test } from "bun:test";
import type { ImageBaseRelocation } from "../../../src/linker";
import { serializePeBaseRelocations } from "../../../src/pe-coff/pe-relocations";
import {
  dir64RelocationForTest,
  writerTargetForTest,
} from "../../support/pe-coff/pe-coff-fixtures";

function stableDetails(result: {
  readonly diagnostics: readonly { readonly stableDetail: string }[];
}) {
  return result.diagnostics.map((diagnostic) => diagnostic.stableDetail);
}

describe("PE base relocation serialization", () => {
  test("serializes empty base relocations as empty bytes and planned records", () => {
    const result = serializePeBaseRelocations({
      target: writerTargetForTest(),
      relocations: [],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected serialized relocations");
    expect(result.value.bytes).toEqual(new Uint8Array());
    expect(result.value.blocks).toEqual([]);
  });

  test("serializes one DIR64 base relocation block", () => {
    const result = serializePeBaseRelocations({
      target: writerTargetForTest(),
      relocations: [dir64RelocationForTest({ rva: 0x2000 })],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected serialized relocations");
    expect(Array.from(result.value.bytes)).toEqual([
      0x00, 0x20, 0x00, 0x00, 0x0c, 0x00, 0x00, 0x00, 0x00, 0xa0, 0x00, 0x00,
    ]);
    expect(result.value.blocks).toEqual([
      {
        pageRva: 0x2000,
        blockSizeBytes: 12,
        entries: [
          {
            stableKey: "base-reloc:dir64:.data:8192",
            kind: "dir64",
            sectionKey: ".data",
            sourceRelocationKey: "module:test:reloc:absolute",
            rva: 0x2000,
            pageOffset: 0,
            peType: 10,
            widthBytes: 8,
            encodedEntry: 0xa000,
            padding: false,
          },
          {
            stableKey: "base-reloc:absolute-padding:8192:1",
            kind: "absolute-padding",
            sectionKey: ".reloc",
            sourceRelocationKey: "pe-coff:base-relocation-padding",
            rva: 0x2000,
            pageOffset: 0,
            peType: 0,
            widthBytes: 0,
            encodedEntry: 0,
            padding: true,
          },
        ],
      },
    ]);
  });

  test("sorts relocations by RVA then stable key across multiple pages", () => {
    const result = serializePeBaseRelocations({
      target: writerTargetForTest(),
      relocations: [
        dir64RelocationForTest({ stableKey: "reloc:c", rva: 0x3010 }),
        dir64RelocationForTest({ stableKey: "reloc:a", rva: 0x1008 }),
        dir64RelocationForTest({ stableKey: "reloc:b", rva: 0x3008 }),
      ],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected serialized relocations");
    expect(Array.from(result.value.bytes)).toEqual([
      0x00, 0x10, 0x00, 0x00, 0x0c, 0x00, 0x00, 0x00, 0x08, 0xa0, 0x00, 0x00, 0x00, 0x30, 0x00,
      0x00, 0x0c, 0x00, 0x00, 0x00, 0x08, 0xa0, 0x10, 0xa0,
    ]);
    expect(result.value.blocks.map((block) => block.pageRva)).toEqual([0x1000, 0x3000]);
    expect(
      result.value.blocks.flatMap((block) => block.entries.map((entry) => entry.stableKey)),
    ).toEqual(["reloc:a", "base-reloc:absolute-padding:4096:1", "reloc:b", "reloc:c"]);
  });

  test("adds one ABSOLUTE padding entry for odd entry counts", () => {
    const result = serializePeBaseRelocations({
      target: writerTargetForTest(),
      relocations: [
        dir64RelocationForTest({ stableKey: "reloc:one", rva: 0x2008 }),
        dir64RelocationForTest({ stableKey: "reloc:two", rva: 0x2010 }),
        dir64RelocationForTest({ stableKey: "reloc:three", rva: 0x2018 }),
      ],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected serialized relocations");
    expect(result.value.blocks[0]?.blockSizeBytes).toBe(16);
    expect(result.value.blocks[0]?.entries.map((entry) => entry.peType)).toEqual([10, 10, 10, 0]);
    expect(Array.from(result.value.bytes.slice(-2))).toEqual([0x00, 0x00]);
  });

  test("rejects duplicate base relocation RVAs", () => {
    const result = serializePeBaseRelocations({
      target: writerTargetForTest(),
      relocations: [
        dir64RelocationForTest({ stableKey: "a", rva: 0x2008 }),
        dir64RelocationForTest({ stableKey: "b", rva: 0x2008 }),
      ],
    });

    expect(result.kind).toBe("error");
    expect(stableDetails(result)).toContain("base-relocation:duplicate-rva:8200");
  });

  test("rejects non-integer and negative base relocation RVAs before encoding", () => {
    const result = serializePeBaseRelocations({
      target: writerTargetForTest(),
      relocations: [
        dir64RelocationForTest({ stableKey: "fractional-rva", rva: 4096.5 }),
        dir64RelocationForTest({ stableKey: "negative-rva", rva: -1 }),
      ],
    });

    expect(result.kind).toBe("error");
    expect(stableDetails(result)).toContain("base-relocation:rva:fractional-rva:4096.5");
    expect(stableDetails(result)).toContain("base-relocation:rva:negative-rva:-1");
  });

  test("rejects DIR64 base relocations with non-eight-byte width", () => {
    const result = serializePeBaseRelocations({
      target: writerTargetForTest(),
      relocations: [dir64RelocationForTest({ stableKey: "bad-dir64", widthBytes: 4 })],
    });

    expect(result.kind).toBe("error");
    expect(stableDetails(result)).toContain("base-relocation:dir64-width:bad-dir64:4");
  });

  test("rejects HIGHLOW base relocations for production AArch64 v1", () => {
    const result = serializePeBaseRelocations({
      target: writerTargetForTest(),
      relocations: [
        {
          stableKey: "base-reloc:highlow:.data:8192",
          kind: "highlow",
          sectionKey: ".data",
          rva: 0x2000,
          widthBytes: 4,
          sourceRelocationKey: "module:test:reloc:absolute32",
        },
      ],
    });

    expect(result.kind).toBe("error");
    expect(stableDetails(result)).toContain(
      "base-relocation:unsupported-kind:base-reloc:highlow:.data:8192:highlow",
    );
  });

  test("rejects target-specific base relocations in v1", () => {
    const relocation: ImageBaseRelocation = {
      stableKey: "base-reloc:target-specific:.text:4100",
      kind: "target-specific",
      sectionKey: ".text",
      rva: 0x1004,
      widthBytes: 4,
      sourceRelocationKey: "module:test:reloc:target-specific",
    };

    const result = serializePeBaseRelocations({
      target: writerTargetForTest(),
      relocations: [relocation],
    });

    expect(result.kind).toBe("error");
    expect(stableDetails(result)).toContain(
      "base-relocation:unsupported-kind:base-reloc:target-specific:.text:4100:target-specific",
    );
  });
});
