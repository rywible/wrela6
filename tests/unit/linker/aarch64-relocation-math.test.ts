import { describe, expect, test } from "bun:test";

import { AARCH64_RELOCATION_FIELD_SLICES } from "../../../src/linker/aarch64/aarch64-relocation-policy";
import {
  encodeAArch64RelocationValue,
  patchAArch64InstructionRelocation,
} from "../../../src/linker/aarch64/aarch64-relocations";

describe("AArch64 relocation math", () => {
  test("encodes branch families with exact scaled bounds", () => {
    expect(
      encodeAArch64RelocationValue({
        family: "branch26",
        relocationKey: "branch26-min",
        symbolRva: 0n,
        patchRva: 134217728n,
        addend: 0n,
        preferredImageBase: 0n,
      }),
    ).toMatchObject({
      kind: "ok",
      value: { encodedValue: 0x2000000n, unscaledValue: -134217728n },
    });

    expect(
      encodeAArch64RelocationValue({
        family: "branch19",
        relocationKey: "branch19-max",
        symbolRva: 1048572n,
        patchRva: 0n,
        addend: 0n,
        preferredImageBase: 0n,
      }),
    ).toMatchObject({ kind: "ok", value: { encodedValue: 0x3ffffn, unscaledValue: 1048572n } });

    const outOfRange = encodeAArch64RelocationValue({
      family: "branch14",
      relocationKey: "branch14-high",
      symbolRva: 32768n,
      patchRva: 0n,
      addend: 0n,
      preferredImageBase: 0n,
    });
    expect(outOfRange.kind).toBe("error");
    expect(outOfRange.diagnostics[0]?.stableDetail).toBe(
      "relocation:out-of-range:branch14-high:branch14:32768",
    );
  });

  test("covers exact numeric relocation boundaries across non-branch families", () => {
    expect(
      encodeAArch64RelocationValue({
        family: "branch26",
        relocationKey: "branch26-max",
        symbolRva: 134217724n,
        patchRva: 0n,
        addend: 0n,
        preferredImageBase: 0n,
      }),
    ).toMatchObject({ kind: "ok", value: { encodedValue: 0x1ffffffn } });
    expect(
      encodeAArch64RelocationValue({
        family: "branch19",
        relocationKey: "branch19-min",
        symbolRva: 0n,
        patchRva: 1048576n,
        addend: 0n,
        preferredImageBase: 0n,
      }),
    ).toMatchObject({ kind: "ok", value: { encodedValue: 0x40000n } });
    expect(
      encodeAArch64RelocationValue({
        family: "branch14",
        relocationKey: "branch14-min",
        symbolRva: 0n,
        patchRva: 32768n,
        addend: 0n,
        preferredImageBase: 0n,
      }),
    ).toMatchObject({ kind: "ok", value: { encodedValue: 0x2000n } });
    expect(
      encodeAArch64RelocationValue({
        family: "branch14",
        relocationKey: "branch14-max",
        symbolRva: 32764n,
        patchRva: 0n,
        addend: 0n,
        preferredImageBase: 0n,
      }),
    ).toMatchObject({ kind: "ok", value: { encodedValue: 0x1fffn } });
    expect(
      encodeAArch64RelocationValue({
        family: "pagebase-rel21",
        relocationKey: "pagebase-min",
        symbolRva: 0n,
        patchRva: 4294967296n,
        addend: 0n,
        preferredImageBase: 0n,
      }),
    ).toMatchObject({ kind: "ok", value: { encodedValue: 0x100000n } });
    expect(
      encodeAArch64RelocationValue({
        family: "pagebase-rel21",
        relocationKey: "pagebase-max",
        symbolRva: 4294963200n,
        patchRva: 0n,
        addend: 0n,
        preferredImageBase: 0n,
      }),
    ).toMatchObject({ kind: "ok", value: { encodedValue: 0xfffffn } });
    expect(
      encodeAArch64RelocationValue({
        family: "addr64",
        relocationKey: "addr64-max",
        symbolRva: 18446744073709551615n,
        patchRva: 0n,
        addend: 0n,
        preferredImageBase: 0n,
      }),
    ).toMatchObject({
      kind: "ok",
      value: { encodedValue: 18446744073709551615n },
    });
    expect(
      encodeAArch64RelocationValue({
        family: "addr32nb",
        relocationKey: "addr32nb-max",
        symbolRva: 4294967295n,
        patchRva: 0n,
        addend: 0n,
        preferredImageBase: 0n,
      }),
    ).toMatchObject({ kind: "ok", value: { encodedValue: 4294967295n } });
    expect(
      encodeAArch64RelocationValue({
        family: "rel32",
        relocationKey: "rel32-min",
        symbolRva: 0n,
        patchRva: 2147483648n,
        addend: 0n,
        preferredImageBase: 0n,
      }),
    ).toMatchObject({ kind: "ok", value: { encodedValue: -2147483648n } });
    expect(
      encodeAArch64RelocationValue({
        family: "rel32",
        relocationKey: "rel32-max",
        symbolRva: 2147483647n,
        patchRva: 0n,
        addend: 0n,
        preferredImageBase: 0n,
      }),
    ).toMatchObject({ kind: "ok", value: { encodedValue: 2147483647n } });
    expect(
      encodeAArch64RelocationValue({
        family: "section-relative",
        relocationKey: "section-relative-max",
        symbolRva: 4294967295n,
        patchRva: 0n,
        addend: 0n,
        preferredImageBase: 0n,
        containingSectionRva: 0n,
      }),
    ).toMatchObject({ kind: "ok", value: { encodedValue: 4294967295n } });

    const outOfRange = encodeAArch64RelocationValue({
      family: "addr32nb",
      relocationKey: "addr32nb-high",
      symbolRva: 4294967296n,
      patchRva: 0n,
      addend: 0n,
      preferredImageBase: 0n,
    });
    expect(outOfRange.kind).toBe("error");
    expect(outOfRange.diagnostics[0]?.stableDetail).toBe(
      "relocation:out-of-range:addr32nb-high:addr32nb:4294967296",
    );
  });

  test("rejects unaligned branch distances before scaling", () => {
    const result = encodeAArch64RelocationValue({
      family: "branch26",
      relocationKey: "call-site",
      symbolRva: 6n,
      patchRva: 0n,
      addend: 0n,
      preferredImageBase: 0n,
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics[0]?.stableDetail).toBe(
      "relocation:unaligned-branch-distance:call-site:6",
    );
  });

  test("encodes pagebase, pageoffset, absolute, rva, relative, and section-relative values", () => {
    expect(
      encodeAArch64RelocationValue({
        family: "pagebase-rel21",
        relocationKey: "adrp",
        symbolRva: 0x401234n,
        patchRva: 0x400ffcn,
        addend: 0n,
        preferredImageBase: 0n,
      }),
    ).toMatchObject({ kind: "ok", value: { encodedValue: 1n, unscaledValue: 1n } });

    expect(
      encodeAArch64RelocationValue({
        family: "pageoffset-12a",
        relocationKey: "add-low12",
        symbolRva: 0x1234n,
        patchRva: 0n,
        addend: 5n,
        preferredImageBase: 0n,
      }),
    ).toMatchObject({ kind: "ok", value: { encodedValue: 0x239n, unscaledValue: 0x239n } });

    expect(
      encodeAArch64RelocationValue({
        family: "pageoffset-12l",
        relocationKey: "ldr-low12",
        symbolRva: 0x1238n,
        patchRva: 0n,
        addend: 0n,
        preferredImageBase: 0n,
        accessScaleBytes: 8,
      }),
    ).toMatchObject({ kind: "ok", value: { encodedValue: 0x47n, unscaledValue: 0x238n } });

    expect(
      encodeAArch64RelocationValue({
        family: "addr64",
        relocationKey: "addr64",
        symbolRva: 0x20n,
        patchRva: 0n,
        addend: 2n,
        preferredImageBase: 0x100000n,
      }),
    ).toMatchObject({ kind: "ok", value: { encodedValue: 0x100022n, unscaledValue: 0x100022n } });

    expect(
      encodeAArch64RelocationValue({
        family: "addr32nb",
        relocationKey: "addr32nb",
        symbolRva: 0x20n,
        patchRva: 0n,
        addend: 2n,
        preferredImageBase: 0x100000n,
      }),
    ).toMatchObject({ kind: "ok", value: { encodedValue: 0x22n, unscaledValue: 0x22n } });

    expect(
      encodeAArch64RelocationValue({
        family: "rel32",
        relocationKey: "rel32",
        symbolRva: 0x1010n,
        patchRva: 0x1000n,
        addend: -4n,
        preferredImageBase: 0x100000n,
      }),
    ).toMatchObject({ kind: "ok", value: { encodedValue: 12n, unscaledValue: 12n } });

    expect(
      encodeAArch64RelocationValue({
        family: "section-relative",
        relocationKey: "secrel",
        symbolRva: 0x2080n,
        patchRva: 0n,
        addend: 4n,
        preferredImageBase: 0n,
        containingSectionRva: 0x2000n,
      }),
    ).toMatchObject({ kind: "ok", value: { encodedValue: 0x84n, unscaledValue: 0x84n } });
  });

  test("rejects non-divisible scaled low12 and v1 addr32 absolute", () => {
    const unscaledLow12 = encodeAArch64RelocationValue({
      family: "pageoffset-12l",
      relocationKey: "bad-ldr-low12",
      symbolRva: 0x1234n,
      patchRva: 0n,
      addend: 0n,
      preferredImageBase: 0n,
      accessScaleBytes: 8,
    });
    expect(unscaledLow12.kind).toBe("error");
    expect(unscaledLow12.diagnostics[0]?.stableDetail).toBe(
      "relocation:unaligned-low12:bad-ldr-low12:564:8",
    );

    const addr32 = encodeAArch64RelocationValue({
      family: "addr32",
      relocationKey: "addr32",
      symbolRva: 0x20n,
      patchRva: 0n,
      addend: 0n,
      preferredImageBase: 0n,
    });
    expect(addr32.kind).toBe("error");
    expect(addr32.diagnostics[0]?.stableDetail).toBe("relocation:addr32-absolute-rejected:addr32");
  });

  test("rejects negative page addresses before ADRP page calculation", () => {
    const result = encodeAArch64RelocationValue({
      family: "pagebase-rel21",
      relocationKey: "adrp-negative",
      symbolRva: 0n,
      patchRva: 0n,
      addend: -1n,
      preferredImageBase: 0n,
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics[0]?.stableDetail).toBe(
      "relocation:negative-page-address:adrp-negative",
    );
  });

  test("patches adrp split immlo and immhi fields", () => {
    const result = patchAArch64InstructionRelocation({
      family: "pagebase-rel21",
      relocationKey: "adrp",
      originalBytes: [0x00, 0x00, 0x00, 0x90],
      symbolRva: 0x401000n,
      patchRva: 0x400000n,
      addend: 0n,
      preferredImageBase: 0n,
      bitRange: [5, 30],
      fieldSlices: AARCH64_RELOCATION_FIELD_SLICES["pagebase-rel21"],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected patched ADRP");
    expect(Array.from(result.value.patchedBytes)).toEqual([0x00, 0x00, 0x00, 0xb0]);
    expect(result.value.encodedValue).toBe(1n);

    const preservesNonRelocationBits = patchAArch64InstructionRelocation({
      family: "pagebase-rel21",
      relocationKey: "adrp-preserve",
      originalBytes: [0xff, 0xff, 0xff, 0xff],
      symbolRva: 0x401000n,
      patchRva: 0x400000n,
      addend: 0n,
      preferredImageBase: 0n,
      bitRange: [5, 30],
      fieldSlices: AARCH64_RELOCATION_FIELD_SLICES["pagebase-rel21"],
    });
    expect(preservesNonRelocationBits.kind).toBe("ok");
    if (preservesNonRelocationBits.kind !== "ok") {
      throw new Error("expected patched preserving ADRP");
    }
    expect(Array.from(preservesNonRelocationBits.value.patchedBytes)).toEqual([
      0x1f, 0x00, 0x00, 0xbf,
    ]);
  });

  test("patches only declared branch bits and low12 field slices", () => {
    const branch = patchAArch64InstructionRelocation({
      family: "branch26",
      relocationKey: "branch",
      originalBytes: [0xff, 0xff, 0xff, 0xff],
      symbolRva: 4n,
      patchRva: 0n,
      addend: 0n,
      preferredImageBase: 0n,
      bitRange: [0, 25],
      fieldSlices: AARCH64_RELOCATION_FIELD_SLICES.branch26,
    });
    expect(branch.kind).toBe("ok");
    if (branch.kind !== "ok") throw new Error("expected patched branch");
    expect(Array.from(branch.value.patchedBytes)).toEqual([0x01, 0x00, 0x00, 0xfc]);

    const add = patchAArch64InstructionRelocation({
      family: "pageoffset-12a",
      relocationKey: "add-low12",
      originalBytes: [0xff, 0xff, 0xff, 0xff],
      symbolRva: 0x1234n,
      patchRva: 0n,
      addend: 0n,
      preferredImageBase: 0n,
      bitRange: [10, 21],
      fieldSlices: AARCH64_RELOCATION_FIELD_SLICES["pageoffset-12a"],
    });
    expect(add.kind).toBe("ok");
    if (add.kind !== "ok") throw new Error("expected patched add low12");
    expect(Array.from(add.value.patchedBytes)).toEqual([0xff, 0xd3, 0xc8, 0xff]);
  });

  test("rejects invalid instruction patch requests without throwing", () => {
    const invalidWidth = patchAArch64InstructionRelocation({
      family: "branch26",
      relocationKey: "bad-width",
      originalBytes: [0, 0],
      symbolRva: 4n,
      patchRva: 0n,
      addend: 0n,
      preferredImageBase: 0n,
      bitRange: [0, 25],
      fieldSlices: AARCH64_RELOCATION_FIELD_SLICES.branch26,
    });
    expect(invalidWidth.kind).toBe("error");
    expect(invalidWidth.diagnostics[0]?.stableDetail).toBe(
      "relocation:invalid-instruction-byte-width:bad-width",
    );

    const invalidBitRange = patchAArch64InstructionRelocation({
      family: "branch26",
      relocationKey: "bad-range",
      originalBytes: [0, 0, 0, 0],
      symbolRva: 4n,
      patchRva: 0n,
      addend: 0n,
      preferredImageBase: 0n,
      bitRange: [26, 25],
      fieldSlices: AARCH64_RELOCATION_FIELD_SLICES.branch26,
    });
    expect(invalidBitRange.kind).toBe("error");
    expect(invalidBitRange.diagnostics[0]?.stableDetail).toBe(
      "relocation:invalid-bit-range:bad-range",
    );

    const missingSlices = patchAArch64InstructionRelocation({
      family: "addr64",
      relocationKey: "missing-slices",
      originalBytes: [0, 0, 0, 0],
      symbolRva: 4n,
      patchRva: 0n,
      addend: 0n,
      preferredImageBase: 0n,
      bitRange: [0, 31],
    });
    expect(missingSlices.kind).toBe("error");
    expect(missingSlices.diagnostics[0]?.stableDetail).toBe(
      "relocation:missing-field-slices:missing-slices:addr64",
    );

    const outsideRange = patchAArch64InstructionRelocation({
      family: "branch26",
      relocationKey: "outside-range",
      originalBytes: [0, 0, 0, 0],
      symbolRva: 4n,
      patchRva: 0n,
      addend: 0n,
      preferredImageBase: 0n,
      bitRange: [1, 25],
      fieldSlices: AARCH64_RELOCATION_FIELD_SLICES.branch26,
    });
    expect(outsideRange.kind).toBe("error");
    expect(outsideRange.diagnostics[0]?.stableDetail).toBe(
      "relocation:field-slice-outside-bit-range:outside-range:0:25",
    );

    const invalidSlice = patchAArch64InstructionRelocation({
      family: "branch26",
      relocationKey: "bad-slice",
      originalBytes: [0, 0, 0, 0],
      symbolRva: 4n,
      patchRva: 0n,
      addend: 0n,
      preferredImageBase: 0n,
      bitRange: [0, 25],
      fieldSlices: [{ encodedValueStartBit: -1, instructionStartBit: 0, bitCount: 1 }],
    });
    expect(invalidSlice.kind).toBe("error");
    expect(invalidSlice.diagnostics[0]?.stableDetail).toBe(
      "relocation:invalid-field-slice:bad-slice",
    );
  });
});
