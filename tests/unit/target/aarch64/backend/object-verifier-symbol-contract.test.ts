import { describe, expect, test } from "bun:test";

import type { AArch64ObjectModule } from "../../../../../src/target/aarch64/backend/object/object-module";
import { verifyAArch64ObjectModule } from "../../../../../src/target/aarch64/backend/verify/encoding-object-verifier";
import {
  aarch64ObjectModuleForTest,
  relocationForTest,
  sectionForTest,
  symbolForTest,
} from "../../../../../tests/support/target/aarch64/backend/object-module-fixtures";

describe("AArch64 object verifier symbol contract", () => {
  test("rejects external declarations that carry section placement fields", () => {
    const valid = aarch64ObjectModuleForTest({
      sections: [sectionForTest({ stableKey: ".text", bytes: [] })],
      symbols: [symbolForTest({ stableKey: "puts", kind: "external-declaration" })],
    });
    const objectModule = {
      ...valid,
      symbols: [
        {
          ...valid.symbols[0]!,
          sectionKey: ".text",
          offsetBytes: 0,
        },
      ],
    } as unknown as AArch64ObjectModule;

    const result = verifyAArch64ObjectModule({ objectModule });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected external symbol contract error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "object-verifier:external-symbol-has-section:puts",
    );
  });

  test("uses structured relocation target for semantic symbol checks", () => {
    const objectModule = aarch64ObjectModuleForTest({
      sections: [sectionForTest({ stableKey: ".text", bytes: [0, 0, 0, 0] })],
      symbols: [symbolForTest({ stableKey: "target", linkageName: "target", sectionKey: ".text" })],
      relocations: [
        relocationForTest({
          stableKey: "reloc:structured",
          sectionKey: ".text",
          offsetBytes: 0,
          widthBytes: 4,
          target: { kind: "linkage-name", linkageName: "missing.linkage" },
          targetSymbol: "missing.linkage",
        }),
      ],
    });

    const result = verifyAArch64ObjectModule({ objectModule });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected structured target error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "object-verifier:symbol-missing:reloc:structured:missing.linkage",
    );
  });

  test("accepts local stable-key targets only when the symbol is in the source module", () => {
    const accepted = aarch64ObjectModuleForTest({
      sections: [sectionForTest({ stableKey: ".text", bytes: [0x00, 0x00, 0x00, 0x14] })],
      symbols: [
        symbolForTest({
          stableKey: "block:1",
          kind: "local-definition",
          sectionKey: ".text",
          offsetBytes: 0,
        }),
      ],
      relocations: [
        relocationForTest({
          stableKey: "reloc:local",
          sectionKey: ".text",
          target: { kind: "symbol-stable-key", stableKey: "block:1" },
          targetSymbol: "block:1",
        }),
      ],
    });
    const rejected = {
      ...accepted,
      relocations: [
        relocationForTest({
          stableKey: "reloc:other-module-local",
          sectionKey: ".text",
          target: { kind: "symbol-stable-key", stableKey: "other-module:block:1" },
          targetSymbol: "other-module:block:1",
        }),
      ],
    };

    expect(verifyAArch64ObjectModule({ objectModule: accepted }).kind).toBe("ok");
    const result = verifyAArch64ObjectModule({ objectModule: rejected });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected missing local target error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "object-verifier:symbol-missing:reloc:other-module-local:other-module:block:1",
    );
  });

  test("accepts linkage-name targets only with a matching global definition or external declaration", () => {
    const accepted = aarch64ObjectModuleForTest({
      sections: [sectionForTest({ stableKey: ".text", bytes: [0x00, 0x00, 0x00, 0x94] })],
      symbols: [
        symbolForTest({
          stableKey: "helper.local-key",
          kind: "global-definition",
          linkageName: "helper",
          sectionKey: ".text",
        }),
      ],
      relocations: [
        relocationForTest({
          stableKey: "reloc:helper",
          sectionKey: ".text",
          target: { kind: "linkage-name", linkageName: "helper" },
          targetSymbol: "helper",
        }),
      ],
    });
    const rejected = {
      ...accepted,
      relocations: [
        relocationForTest({
          stableKey: "reloc:missing-linkage",
          sectionKey: ".text",
          target: { kind: "linkage-name", linkageName: "missing" },
          targetSymbol: "missing",
        }),
      ],
    };

    expect(verifyAArch64ObjectModule({ objectModule: accepted }).kind).toBe("ok");
    const result = verifyAArch64ObjectModule({ objectModule: rejected });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected missing linkage target error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "object-verifier:symbol-missing:reloc:missing-linkage:missing",
    );
  });

  test("rejects duplicate linkage names and ambiguous linkage-name relocation targets", () => {
    const objectModule = aarch64ObjectModuleForTest({
      sections: [sectionForTest({ stableKey: ".text", bytes: [0x00, 0x00, 0x00, 0x94] })],
      symbols: [
        symbolForTest({
          stableKey: "helper.a",
          kind: "global-definition",
          linkageName: "helper",
          sectionKey: ".text",
        }),
        symbolForTest({
          stableKey: "helper.b",
          kind: "external-declaration",
          linkageName: "helper",
        }),
      ],
      relocations: [
        relocationForTest({
          stableKey: "reloc:helper",
          sectionKey: ".text",
          target: { kind: "linkage-name", linkageName: "helper" },
          targetSymbol: "helper",
        }),
      ],
    });

    const result = verifyAArch64ObjectModule({ objectModule });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected duplicate linkage error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "object-verifier:duplicate-linkage-name:helper:helper.a,helper.b",
    );
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "object-verifier:linkage-target-ambiguous:reloc:helper:helper:helper.a,helper.b",
    );
  });

  test("reports stale fact subjects and nondeterministic symbol order", () => {
    const valid = aarch64ObjectModuleForTest({
      sections: [sectionForTest({ stableKey: ".text", bytes: [0xe0, 0x00, 0x80, 0xd2] })],
      symbols: [
        symbolForTest({ stableKey: "a", sectionKey: ".text" }),
        symbolForTest({ stableKey: "z", sectionKey: ".text" }),
      ],
    });
    const objectModule = { ...valid, symbols: [...valid.symbols].reverse() };

    const result = verifyAArch64ObjectModule({
      objectModule,
      staleFactSubjectKeys: ["deleted:fragment"],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected verifier errors");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "object-verifier:nondeterministic-symbol-order:z,a",
      "object-verifier:stale-fact-subject:deleted:fragment",
    ]);
  });
});
