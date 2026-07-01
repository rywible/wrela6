import { describe, expect, test } from "bun:test";

import { RPI5_BACKEND_CATALOGS } from "../../../../../src/target/aarch64/backend/catalogs/rpi5-backend-catalog-data";
import {
  buildAArch64RelocationRecords,
  type AArch64EncodedRelocationHole,
} from "../../../../../src/target/aarch64/backend/object/relocation-records";

describe("AArch64 relocation records", () => {
  test("creates paired ADRP and ADD low12 relocation records", () => {
    const result = buildAArch64RelocationRecords({
      relocationCatalog: RPI5_BACKEND_CATALOGS.relocationCatalog,
      encodedHoles: [
        hole({
          stableKey: "page",
          family: "pagebase-rel21",
          targetSymbol: "global",
          patchOffsetBytes: 0,
          pairKey: "pair:global",
        }),
        hole({
          stableKey: "low12",
          family: "pageoffset-12a",
          targetSymbol: "global",
          patchOffsetBytes: 4,
          pairKey: "pair:global",
        }),
      ],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected relocation records");
    expect(result.value.map((relocation) => relocation.pairedRelocationKey)).toEqual([
      "low12",
      "page",
    ]);
  });

  test("rejects branch26 relocation without PE/COFF mapping", () => {
    const result = buildAArch64RelocationRecords({
      relocationCatalog: {
        ...RPI5_BACKEND_CATALOGS.relocationCatalog,
        mappings: RPI5_BACKEND_CATALOGS.relocationCatalog.mappings.filter(
          (mapping) => mapping.internalFamily !== "branch26",
        ),
        mappingFor: (family) =>
          family === "branch26"
            ? undefined
            : RPI5_BACKEND_CATALOGS.relocationCatalog.mappingFor(family),
      },
      encodedHoles: [hole({ family: "branch26", targetSymbol: "far_target" })],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected mapping error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "relocation:missing-pe-coff-mapping:branch26",
    ]);
  });

  test("rejects paired relocation target mismatch", () => {
    const result = buildAArch64RelocationRecords({
      relocationCatalog: RPI5_BACKEND_CATALOGS.relocationCatalog,
      encodedHoles: [
        hole({
          stableKey: "page",
          family: "pagebase-rel21",
          targetSymbol: "left",
          pairKey: "pair:x",
        }),
        hole({
          stableKey: "low12",
          family: "pageoffset-12l",
          targetSymbol: "right",
          patchOffsetBytes: 4,
          pairKey: "pair:x",
        }),
      ],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected pair error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "relocation:paired-target-mismatch:pair:x:left:right",
    ]);
  });

  test("sorts relocation records deterministically", () => {
    const result = buildAArch64RelocationRecords({
      relocationCatalog: RPI5_BACKEND_CATALOGS.relocationCatalog,
      encodedHoles: [
        hole({ stableKey: "z", patchOffsetBytes: 4 }),
        hole({ stableKey: "a", patchOffsetBytes: 0 }),
      ],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected relocation records");
    expect(result.value.map((relocation) => relocation.stableKey)).toEqual(["a", "z"]);
  });
});

function hole(overrides: Partial<AArch64EncodedRelocationHole> = {}): AArch64EncodedRelocationHole {
  return {
    stableKey: "reloc",
    sectionStableKey: ".text",
    fragmentStableKey: "fragment:text",
    patchOffsetBytes: 0,
    bitRange: [0, 25],
    family: "branch26",
    targetSymbol: "target",
    addend: 0n,
    ...overrides,
  };
}
