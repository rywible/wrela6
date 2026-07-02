import { describe, expect, test } from "bun:test";

import { verifyAArch64ObjectModule } from "../../../../../src/target/aarch64/backend/verify/encoding-object-verifier";
import {
  aarch64ObjectModuleForTest,
  byteProvenanceForTest,
  relocationForTest,
  sectionForTest,
  symbolForTest,
  veneerForTest,
} from "../../../../../tests/support/target/aarch64/backend/object-module-fixtures";

describe("AArch64 object verifier veneers", () => {
  test("rejects veneers without a branch encoding at their recorded bytes", () => {
    const objectModule = aarch64ObjectModuleForTest({
      sections: [sectionForTest({ stableKey: ".text", bytes: [0xc0, 0x03, 0x5f, 0xd6] })],
      symbols: [symbolForTest({ stableKey: "target", sectionKey: ".text" })],
      veneers: [veneerForTest({ stableKey: "veneer:bad", targetKey: "target" })],
      byteProvenance: [
        byteProvenanceForTest({
          stableKey: "byte:veneer:bad",
          sectionKey: ".text",
          startOffsetBytes: 0,
          byteLength: 4,
        }),
      ],
    });

    const result = verifyAArch64ObjectModule({ objectModule });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected veneer byte error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "object-verifier:veneer-encoding-invalid:veneer:bad:opcode:ret",
      "object-verifier:veneer-relocation-missing:veneer:bad",
    ]);
  });

  test("accepts backend-owned veneer bytes with relocation to original target", () => {
    const objectModule = aarch64ObjectModuleForTest({
      sections: [
        sectionForTest({
          stableKey: ".text",
          bytes: [0x00, 0x00, 0x00, 0x94, 0x00, 0x00, 0x00, 0x14],
          fragments: [{ stableKey: "text.main", startOffsetBytes: 0, sizeBytes: 4 }],
        }),
      ],
      symbols: [
        symbolForTest({ stableKey: "target", sectionKey: ".text", offsetBytes: 0 }),
        symbolForTest({ stableKey: "veneer:call", sectionKey: ".text", offsetBytes: 4 }),
      ],
      relocations: [
        relocationForTest({
          stableKey: "reloc:call",
          sectionKey: ".text",
          offsetBytes: 0,
          family: "branch26",
          targetSymbol: "veneer:call",
          bitRange: [0, 25],
        }),
        relocationForTest({
          stableKey: "reloc:veneer:call",
          sectionKey: ".text",
          offsetBytes: 4,
          family: "branch26",
          targetSymbol: "target",
          bitRange: [0, 25],
        }),
      ],
      veneers: [veneerForTest({ stableKey: "veneer:call", targetKey: "target" })],
      byteProvenance: [
        byteProvenanceForTest({
          stableKey: "bytes:call",
          sectionKey: ".text",
          startOffsetBytes: 0,
          byteLength: 4,
        }),
        byteProvenanceForTest({
          stableKey: "byte:veneer:call",
          sectionKey: ".text",
          startOffsetBytes: 4,
          byteLength: 4,
        }),
      ],
    });

    expect(verifyAArch64ObjectModule({ objectModule }).kind).toBe("ok");
  });

  test("validates veneer branch26 reach with asymmetric signed branch scaling", () => {
    const validObjectModule = aarch64ObjectModuleForTest({
      sections: [sectionForTest({ stableKey: ".text", bytes: [0x00, 0x00, 0x00, 0x14] })],
      symbols: [
        symbolForTest({
          stableKey: "target",
          sectionKey: ".text",
          offsetBytes: 0,
        }),
      ],
      relocations: [
        relocationForTest({
          stableKey: "reloc:veneer:far",
          sectionKey: ".text",
          offsetBytes: 0,
          family: "branch26",
          targetSymbol: "target",
          bitRange: [0, 25],
        }),
      ],
      veneers: [veneerForTest({ stableKey: "veneer:far", targetKey: "target" })],
      byteProvenance: [
        byteProvenanceForTest({
          stableKey: "byte:veneer:far",
          sectionKey: ".text",
          startOffsetBytes: 0,
          byteLength: 4,
        }),
      ],
    });
    const objectModule = {
      ...validObjectModule,
      symbols: Object.freeze([
        {
          ...validObjectModule.symbols[0]!,
          offsetBytes: 128 * 1024 * 1024,
        },
      ]),
    };

    const result = verifyAArch64ObjectModule({ objectModule });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected veneer range error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "object-verifier:veneer-target-out-of-range:veneer:far:target:distance:134217728",
    );
  });

  test("rejects backend-owned veneer relocation metadata that targets the wrong symbol", () => {
    const objectModule = aarch64ObjectModuleForTest({
      sections: [sectionForTest({ stableKey: ".text", bytes: [0x00, 0x00, 0x00, 0x14] })],
      symbols: [
        symbolForTest({ stableKey: "target", sectionKey: ".text" }),
        symbolForTest({ stableKey: "wrong", sectionKey: ".text" }),
      ],
      relocations: [
        relocationForTest({
          stableKey: "reloc:veneer:bad",
          sectionKey: ".text",
          offsetBytes: 0,
          family: "branch26",
          targetSymbol: "wrong",
          bitRange: [0, 25],
        }),
      ],
      veneers: [veneerForTest({ stableKey: "veneer:bad", targetKey: "target" })],
      byteProvenance: [
        byteProvenanceForTest({
          stableKey: "byte:veneer:bad",
          sectionKey: ".text",
          startOffsetBytes: 0,
          byteLength: 4,
        }),
      ],
    });

    const result = verifyAArch64ObjectModule({ objectModule });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected veneer relocation error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "object-verifier:veneer-relocation-target-mismatch:veneer:bad:wrong:expected:target",
    ]);
  });
});
