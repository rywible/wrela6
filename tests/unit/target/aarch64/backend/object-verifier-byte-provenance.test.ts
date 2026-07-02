import { describe, expect, test } from "bun:test";

import type { AArch64ObjectModule } from "../../../../../src/target/aarch64/backend/object/object-module";
import { verifyAArch64ObjectModule } from "../../../../../src/target/aarch64/backend/verify/encoding-object-verifier";
import {
  aarch64ObjectModuleForTest,
  byteProvenanceForTest,
  sectionForTest,
} from "../../../../../tests/support/target/aarch64/backend/object-module-fixtures";

describe("AArch64 object verifier byte provenance", () => {
  test("requires byte provenance coverage for every emitted byte", () => {
    const valid = aarch64ObjectModuleForTest({
      sections: [sectionForTest({ stableKey: ".text", bytes: [0xe0, 0x00, 0x80, 0xd2] })],
    });
    const objectModule = {
      ...valid,
      byteProvenance: [
        byteProvenanceForTest({
          stableKey: "partial",
          sectionKey: ".text",
          startOffsetBytes: 0,
          byteLength: 3,
        }),
      ],
    };

    const result = verifyAArch64ObjectModule({ objectModule });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected provenance gap");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "object-verifier:byte-provenance-gap:.text:offset:3",
    ]);
  });

  test("rejects duplicate byte provenance stable keys in malformed object surfaces", () => {
    const valid = aarch64ObjectModuleForTest({
      sections: [sectionForTest({ stableKey: ".text", bytes: [0xe0, 0x00, 0x80, 0xd2] })],
    });
    const objectModule = {
      ...valid,
      byteProvenance: [
        byteProvenanceForTest({
          stableKey: "bytes:duplicate",
          sectionKey: ".text",
          startOffsetBytes: 0,
          byteLength: 2,
        }),
        byteProvenanceForTest({
          stableKey: "bytes:duplicate",
          sectionKey: ".text",
          startOffsetBytes: 2,
          byteLength: 2,
        }),
      ],
    } as unknown as AArch64ObjectModule;

    const result = verifyAArch64ObjectModule({ objectModule });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected duplicate provenance error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "object-verifier:duplicate-byte-provenance-stable-key:.text:bytes:duplicate",
    );
  });

  test("rejects overlapping byte provenance records", () => {
    const valid = aarch64ObjectModuleForTest({
      sections: [sectionForTest({ stableKey: ".text", bytes: [0xe0, 0x00, 0x80, 0xd2] })],
    });
    const objectModule = {
      ...valid,
      byteProvenance: [
        byteProvenanceForTest({
          stableKey: "whole",
          sectionKey: ".text",
          startOffsetBytes: 0,
          byteLength: 4,
        }),
        byteProvenanceForTest({
          stableKey: "overlap",
          sectionKey: ".text",
          startOffsetBytes: 2,
          byteLength: 2,
        }),
      ],
    };

    const result = verifyAArch64ObjectModule({ objectModule });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected provenance overlap");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "object-verifier:byte-provenance-overlap:.text:offset:2",
    ]);
  });
});
