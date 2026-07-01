import { describe, expect, test } from "bun:test";

import { verifyAArch64ObjectModule } from "../../../../../src/target/aarch64/backend/verify/encoding-object-verifier";
import {
  aarch64ObjectModuleForTest,
  byteProvenanceForTest,
  relocationForTest,
  sectionForTest,
  symbolForTest,
} from "../../../../../tests/support/target/aarch64/backend/object-module-fixtures";

describe("AArch64 object verifier relocation policy", () => {
  test("accepts page-offset relocations for aligned symbols outside the first page", () => {
    const objectModule = aarch64ObjectModuleForTest({
      sections: [
        sectionForTest({
          stableKey: ".text",
          bytes: [
            0xe0,
            0x00,
            0x80,
            0xd2,
            0x41,
            0x00,
            0x40,
            0xf9,
            ...Array.from({ length: 8188 }, () => 0),
          ],
        }),
      ],
      symbols: [symbolForTest({ stableKey: "pageoff", sectionKey: ".text", offsetBytes: 0 })],
      relocations: [
        relocationForTest({
          stableKey: "reloc:pageoff",
          sectionKey: ".text",
          offsetBytes: 4,
          family: "pageoffset-12l",
          targetSymbol: "pageoff",
          bitRange: [10, 21],
        }),
      ],
      byteProvenance: [
        byteProvenanceForTest({
          stableKey: "byte:.text:insns",
          sectionKey: ".text",
          startOffsetBytes: 0,
          byteLength: 8,
        }),
        byteProvenanceForTest({
          stableKey: "byte:.text:align:tail",
          sectionKey: ".text",
          startOffsetBytes: 8,
          byteLength: 8188,
          source: "align:tail",
        }),
      ],
    });

    expect(verifyAArch64ObjectModule({ objectModule }).kind).toBe("ok");
  });

  test("rejects page-offset relocations whose encoded low-12 field is stale", () => {
    const objectModule = aarch64ObjectModuleForTest({
      sections: [
        sectionForTest({
          stableKey: ".text",
          bytes: [0x41, 0x08, 0x40, 0xf9],
        }),
      ],
      symbols: [symbolForTest({ stableKey: "pageoff", sectionKey: ".text", offsetBytes: 0 })],
      relocations: [
        relocationForTest({
          stableKey: "reloc:pageoff",
          sectionKey: ".text",
          offsetBytes: 0,
          family: "pageoffset-12l",
          targetSymbol: "pageoff",
          bitRange: [10, 21],
        }),
      ],
      byteProvenance: [
        byteProvenanceForTest({
          stableKey: "byte:.text:insn",
          sectionKey: ".text",
          startOffsetBytes: 0,
          byteLength: 4,
        }),
      ],
    });

    const result = verifyAArch64ObjectModule({ objectModule });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected stale page offset error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "object-verifier:relocation-pageoffset-mismatch:reloc:pageoff:pageoffset-12l:encoded:16:expected:0",
    ]);
  });

  test("rejects branch range and page-offset addend policy mismatches", () => {
    const valid = aarch64ObjectModuleForTest({
      sections: [
        sectionForTest({
          stableKey: ".text",
          bytes: [0x00, 0x00, 0x00, 0x54, 0x41, 0x08, 0x40, 0xf9],
        }),
      ],
      symbols: [
        symbolForTest({ stableKey: "far", sectionKey: ".text", offsetBytes: 0 }),
        symbolForTest({ stableKey: "pageoff", sectionKey: ".text", offsetBytes: 0 }),
      ],
      relocations: [
        relocationForTest({
          stableKey: "reloc:far",
          sectionKey: ".text",
          offsetBytes: 0,
          family: "branch19",
          targetSymbol: "far",
          bitRange: [5, 23],
        }),
        relocationForTest({
          stableKey: "reloc:pageoff",
          sectionKey: ".text",
          offsetBytes: 4,
          family: "pageoffset-12l",
          targetSymbol: "pageoff",
          bitRange: [10, 21],
        }),
      ],
      byteProvenance: [
        byteProvenanceForTest({
          stableKey: "bytes",
          sectionKey: ".text",
          startOffsetBytes: 0,
          byteLength: 8,
        }),
      ],
    });
    const objectModule = {
      ...valid,
      symbols: [
        symbolForTest({ stableKey: "far", sectionKey: ".text", offsetBytes: 2_000_000 }),
        {
          ...symbolForTest({ stableKey: "pageoff", sectionKey: ".text", offsetBytes: 0 }),
          offsetBytes: -1,
        },
      ],
    };

    const result = verifyAArch64ObjectModule({ objectModule });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected relocation policy errors");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "object-verifier:relocation-addend-out-of-range:reloc:pageoff:pageoffset-12l:-1",
      "object-verifier:relocation-range-out-of-bounds:reloc:far:branch19:distance:2000000:limit:1048576",
      "object-verifier:symbol-offset-out-of-range:far:2000000:size:8",
      "object-verifier:symbol-offset-out-of-range:pageoff:-1:size:8",
    ]);
  });

  test("checks branch relocation ranges with asymmetric signed scaled boundaries", () => {
    const cases = [
      { family: "branch26", limitBytes: 128 * 1024 * 1024, bitRange: [0, 25] as const },
      { family: "branch19", limitBytes: 1024 * 1024, bitRange: [5, 23] as const },
      { family: "branch14", limitBytes: 32 * 1024, bitRange: [5, 18] as const },
    ];

    for (const { family, limitBytes, bitRange } of cases) {
      const valid = aarch64ObjectModuleForTest({
        sections: [sectionForTest({ stableKey: ".text", bytes: [0x00, 0x00, 0x00, 0x14] })],
        symbols: [symbolForTest({ stableKey: "target", sectionKey: ".text", offsetBytes: 0 })],
        relocations: [
          relocationForTest({
            stableKey: `reloc:${family}:base`,
            sectionKey: ".text",
            offsetBytes: 0,
            family,
            targetSymbol: "target",
            bitRange,
          }),
        ],
      });
      const acceptedNegativeLimit = verifyAArch64ObjectModule({
        objectModule: {
          ...valid,
          relocations: [
            relocationForTest({
              stableKey: `reloc:${family}:negative-limit`,
              sectionKey: ".text",
              offsetBytes: limitBytes,
              family,
              targetSymbol: "target",
              bitRange,
            }),
          ],
        },
      });
      const acceptedPositiveLimitMinus4 = verifyAArch64ObjectModule({
        objectModule: {
          ...valid,
          symbols: [
            symbolForTest({
              stableKey: "target",
              sectionKey: ".text",
              offsetBytes: limitBytes - 4,
            }),
          ],
          relocations: [
            relocationForTest({
              stableKey: `reloc:${family}:positive-limit-minus-4`,
              sectionKey: ".text",
              offsetBytes: 0,
              family,
              targetSymbol: "target",
              bitRange,
            }),
          ],
        },
      });
      const rejectedPositiveLimit = verifyAArch64ObjectModule({
        objectModule: {
          ...valid,
          symbols: [
            symbolForTest({
              stableKey: "target",
              sectionKey: ".text",
              offsetBytes: limitBytes,
            }),
          ],
          relocations: [
            relocationForTest({
              stableKey: `reloc:${family}:positive-limit`,
              sectionKey: ".text",
              offsetBytes: 0,
              family,
              targetSymbol: "target",
              bitRange,
            }),
          ],
        },
      });

      const rangeDiagnostics = [
        ...diagnosticStableDetails(acceptedNegativeLimit),
        ...diagnosticStableDetails(acceptedPositiveLimitMinus4),
      ].filter((stableDetail) =>
        stableDetail.startsWith("object-verifier:relocation-range-out-of-bounds:"),
      );
      expect(rangeDiagnostics).toEqual([]);
      expect(diagnosticStableDetails(rejectedPositiveLimit)).toContain(
        `object-verifier:relocation-range-out-of-bounds:reloc:${family}:positive-limit:${family}:distance:${limitBytes}:limit:${limitBytes}`,
      );
    }
  });
});

function diagnosticStableDetails(
  result: ReturnType<typeof verifyAArch64ObjectModule>,
): readonly string[] {
  return result.kind === "error"
    ? result.diagnostics.map((diagnostic) => diagnostic.stableDetail)
    : [];
}
