import { describe, expect, test } from "bun:test";

import { createAArch64LinkedImageLayout } from "../../../src/linker/linked-image-layout";

describe("W7-02b linked image typed-array byte payloads", () => {
  test("linked layout preserves section and relocation bytes as Uint8Array", () => {
    const layout = createAArch64LinkedImageLayout({
      targetKey: "target",
      targetFingerprint: "target:fingerprint",
      targetPolicyFingerprint: "target:policy",
      inputModules: [{ moduleKey: "module", moduleFingerprint: "module:fingerprint" }],
      sections: [
        {
          stableKey: ".text",
          classKey: "executable-text",
          flags: 0x60000020,
          alignmentBytes: 4096,
          rva: 0x1000,
          virtualSizeBytes: 4,
          bytes: Uint8Array.of(0, 0, 0, 0x94),
          contributions: [],
        },
      ],
      symbols: [],
      appliedRelocations: [
        {
          relocationKey: "reloc:call",
          sourceModuleKey: "module",
          family: "branch26",
          patchSectionKey: ".text",
          patchRva: 0x1000,
          targetSymbolKey: "symbol:target",
          targetRva: 0x1000,
          addend: 0n,
          expectedEncodedValue: 0n,
          patchedBytes: Uint8Array.of(0, 0, 0, 0x94),
        },
      ],
      baseRelocations: [],
      entry: {
        loaderEntryLinkageName: "EfiMain",
        loaderEntryRva: 0x1000,
        wrelaBootLinkageName: "wrela_boot",
        wrelaBootRva: 0x1000,
      },
      unwindRecords: [],
      dataDirectorySources: [],
      provenance: [],
      factSpending: [],
      verification: { runs: [] },
    });

    expect(layout.sections[0]!.bytes).toBeInstanceOf(Uint8Array);
    expect(layout.appliedRelocations[0]!.patchedBytes).toBeInstanceOf(Uint8Array);
    expect([...layout.sections[0]!.bytes]).toEqual([0, 0, 0, 0x94]);
  });
});
