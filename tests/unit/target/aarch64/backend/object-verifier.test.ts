import { describe, expect, test } from "bun:test";

import { verifyAArch64ObjectModule } from "../../../../../src/target/aarch64/backend/verify/encoding-object-verifier";
import {
  aarch64ObjectModuleForTest,
  byteProvenanceForTest,
  literalPoolForTest,
  sectionForTest,
  symbolForTest,
  unwindRecordForTest,
  veneerForTest,
} from "../../../../../tests/support/target/aarch64/backend/object-module-fixtures";

describe("AArch64 object verifier", () => {
  test("accepts a valid object module", () => {
    const objectModule = aarch64ObjectModuleForTest({
      sections: [
        sectionForTest({
          stableKey: ".text",
          bytes: [0xe0, 0x00, 0x80, 0xd2, 0x02, 0x00, 0x01, 0x8b],
        }),
      ],
      symbols: [symbolForTest({ stableKey: "main", sectionKey: ".text" })],
      byteProvenance: [
        byteProvenanceForTest({
          stableKey: "bytes",
          sectionKey: ".text",
          startOffsetBytes: 0,
          byteLength: 8,
        }),
      ],
    });

    expect(verifyAArch64ObjectModule({ objectModule }).kind).toBe("ok");
  });

  test("rejects unknown section classes", () => {
    const objectModule = aarch64ObjectModuleForTest({
      sections: [
        sectionForTest({
          stableKey: ".mystery",
          classKey: "not-a-linker-section-class",
          bytes: [],
        }),
      ],
    });

    const result = verifyAArch64ObjectModule({ objectModule });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected section class error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "object-verifier:section-class-unknown:.mystery:not-a-linker-section-class",
    );
  });

  test("rejects literal pool byte mismatches, overlaps, and secret provenance", () => {
    const valid = aarch64ObjectModuleForTest({
      sections: [
        sectionForTest({
          stableKey: ".text",
          bytes: [0xc0, 0x03, 0x5f, 0xd6, 1, 2, 3, 4],
        }),
      ],
      literalPools: [
        literalPoolForTest({
          stableKey: "literal:a",
          sectionKey: ".text",
          offsetBytes: 4,
          data: [4, 3, 2, 1],
        }),
        literalPoolForTest({
          stableKey: "literal:b",
          sectionKey: ".text",
          offsetBytes: 6,
          data: [7, 8],
        }),
      ],
      byteProvenance: [
        byteProvenanceForTest({
          stableKey: "insn",
          sectionKey: ".text",
          startOffsetBytes: 0,
          byteLength: 4,
        }),
        byteProvenanceForTest({
          stableKey: "literal",
          sectionKey: ".text",
          startOffsetBytes: 4,
          byteLength: 4,
          factFamilies: ["security-and-secret-lifetime"],
        }),
      ],
    });

    const result = verifyAArch64ObjectModule({ objectModule: valid });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected literal verifier errors");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "object-verifier:literal-pool-data-mismatch:literal:a",
      "object-verifier:literal-pool-data-mismatch:literal:b",
      "object-verifier:literal-pool-overlap:literal:a:literal:b:.text:offset:6",
      "object-verifier:literal-pool-secret:literal:a",
      "object-verifier:literal-pool-secret:literal:b",
    ]);
  });

  test("rejects literal pool entries outside declared user reach", () => {
    const objectModule = aarch64ObjectModuleForTest({
      sections: [
        sectionForTest({
          stableKey: ".text",
          bytes: [0xc0, 0x03, 0x5f, 0xd6, 0, 0, 0, 0, 1, 2, 3, 4],
        }),
      ],
      literalPools: [
        literalPoolForTest({
          stableKey: "literal:far",
          sectionKey: ".text",
          offsetBytes: 8,
          data: [1, 2, 3, 4],
          users: [{ stableKey: "literal:user", useOffsetBytes: 0, maxReachBytes: 4 }],
        }),
      ],
      byteProvenance: [
        byteProvenanceForTest({
          stableKey: "byte:.text:ret",
          sectionKey: ".text",
          startOffsetBytes: 0,
          byteLength: 4,
        }),
        byteProvenanceForTest({
          stableKey: "byte:.text:align:literal:offset:4",
          sectionKey: ".text",
          startOffsetBytes: 4,
          byteLength: 4,
          source: "align:literal",
        }),
        byteProvenanceForTest({
          stableKey: "byte:literal:far",
          sectionKey: ".text",
          startOffsetBytes: 8,
          byteLength: 4,
        }),
      ],
    });

    const result = verifyAArch64ObjectModule({ objectModule });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected literal reach error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "object-verifier:literal-pool-reach-out-of-bounds:literal:far:user:literal:user:distance:8:limit:4",
    ]);
  });

  test("rejects malformed literal pools, veneers, and unwind records", () => {
    const valid = aarch64ObjectModuleForTest({
      sections: [sectionForTest({ stableKey: ".text", bytes: [0xe0, 0x00, 0x80, 0xd2] })],
      symbols: [symbolForTest({ stableKey: "main", sectionKey: ".text" })],
      byteProvenance: [
        byteProvenanceForTest({
          stableKey: "bytes",
          sectionKey: ".text",
          startOffsetBytes: 0,
          byteLength: 4,
        }),
      ],
    });
    const objectModule = {
      ...valid,
      literalPools: [literalPoolForTest({ stableKey: "literal:bad", offsetBytes: 4, data: [1] })],
      veneers: [veneerForTest({ stableKey: "veneer:bad", targetKey: "missing" })],
      unwindRecords: [
        unwindRecordForTest({
          stableKey: "unwind:missing",
          frameShape: "mystery-frame",
        }),
      ],
    };

    const result = verifyAArch64ObjectModule({ objectModule });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected object metadata errors");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "object-verifier:literal-pool-out-of-range:.text:offset:4:size:4",
      "object-verifier:unwind-frame-shape-unknown:unwind:missing:mystery-frame",
      "object-verifier:unwind-symbol-missing:unwind:missing:missing",
      "object-verifier:veneer-bytes-missing:veneer:bad",
      "object-verifier:veneer-target-missing:veneer:bad:missing",
    ]);
  });
});
