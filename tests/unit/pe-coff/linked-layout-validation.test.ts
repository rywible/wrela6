import { describe, expect, test } from "bun:test";
import { validateLinkedImageForPeCoffWriter } from "../../../src/pe-coff/pe-file-layout";
import {
  linkedImageLayoutForPeCoffTest,
  writerTargetForTest,
} from "../../support/pe-coff/pe-coff-fixtures";

describe("linked image layout validation for PE/COFF writer input", () => {
  test("accepts a complete linked image layout with required PE sections", () => {
    const result = validateLinkedImageForPeCoffWriter({
      target: writerTargetForTest(),
      layout: linkedImageLayoutForPeCoffTest(),
    });

    expect(result.kind).toBe("ok");
  });

  test("accepts a complete linked image layout without optional data section", () => {
    const result = validateLinkedImageForPeCoffWriter({
      target: writerTargetForTest(),
      layout: linkedImageLayoutForPeCoffTest({ includeDataSection: false }),
    });

    expect(result.kind).toBe("ok");
  });

  test("rejects layout whose linker verification failed", () => {
    const layout = linkedImageLayoutForPeCoffTest({
      verification: {
        runs: [
          {
            verifierKey: "linker-fixture",
            runKey: "layout",
            status: "failed",
          },
        ],
      },
    });

    const result = validateLinkedImageForPeCoffWriter({
      target: writerTargetForTest(),
      layout,
    });

    expectStableDetails(result).toContain("layout-verification:failed:linker-fixture:layout");
  });

  test("rejects entry RVA outside executable section", () => {
    const result = validateLinkedImageForPeCoffWriter({
      target: writerTargetForTest(),
      layout: linkedImageLayoutForPeCoffTest({ entryRva: 0x2000 }),
    });

    expectStableDetails(result).toContain("entry:outside-executable-section:8192");
  });

  test("rejects first section below target first section RVA", () => {
    const layout = linkedImageLayoutForPeCoffTest();
    const result = validateLinkedImageForPeCoffWriter({
      target: writerTargetForTest(),
      layout: linkedImageLayoutForPeCoffTest({
        sections: [{ ...layout.sections[0]!, rva: 0 }, ...layout.sections.slice(1)],
      }),
    });

    expectStableDetails(result).toContain("section:first-rva:0:expected:4096");
  });

  test("rejects section alignment bytes that differ from target section alignment", () => {
    const layout = linkedImageLayoutForPeCoffTest();
    const result = validateLinkedImageForPeCoffWriter({
      target: writerTargetForTest(),
      layout: linkedImageLayoutForPeCoffTest({
        sections: [{ ...layout.sections[0]!, alignmentBytes: 16 }, ...layout.sections.slice(1)],
      }),
    });

    expectStableDetails(result).toContain("section:alignment:.text:16:expected:4096");
  });

  test("rejects malformed linked section shape before planning", () => {
    const layout = linkedImageLayoutForPeCoffTest();
    const result = validateLinkedImageForPeCoffWriter({
      target: writerTargetForTest(),
      layout: {
        ...layout,
        sections: [
          {
            ...layout.sections[0]!,
            rva: -1,
            alignmentBytes: 0,
            virtualSizeBytes: 4,
            bytes: [],
            flags: 0x1_0000_0000,
          },
          layout.sections[1]!,
          layout.sections[2]!,
          layout.sections[3]!,
          {
            ...layout.sections[3]!,
          },
        ],
      },
    });

    const stableDetails = expectStableDetails(result);
    stableDetails.toContain("section:duplicate-stable-key:.data");
    stableDetails.toContain("section:rva-invalid:.text");
    stableDetails.toContain("section:alignment:.text:0:expected:4096");
    stableDetails.toContain("section:empty-initialized-bytes:.text");
    stableDetails.toContain("section:flags-u32:.text:4294967296");
  });

  test("rejects non-contiguous aligned virtual section order", () => {
    const layout = linkedImageLayoutForPeCoffTest();
    const result = validateLinkedImageForPeCoffWriter({
      target: writerTargetForTest(),
      layout: linkedImageLayoutForPeCoffTest({
        sections: [
          layout.sections[0]!,
          { ...layout.sections[1]!, rva: 0x3000 },
          { ...layout.sections[2]!, rva: 0x4000 },
          { ...layout.sections[3]!, rva: 0x5000 },
        ],
      }),
    });

    expectStableDetails(result).toContain("section:virtual-order:.text:.pdata:12288:expected:8192");
  });

  test("rejects linked sections without serialized section names", () => {
    const layout = linkedImageLayoutForPeCoffTest();
    const result = validateLinkedImageForPeCoffWriter({
      target: writerTargetForTest(),
      layout: linkedImageLayoutForPeCoffTest({
        sections: [
          ...layout.sections,
          {
            ...layout.sections[3]!,
            stableKey: ".extra",
            classKey: ".extra",
            rva: 0x5000,
          },
        ],
      }),
    });

    expectStableDetails(result).toContain("section:serialized-name-missing:.extra");
  });

  test("rejects data directory sources outside their named section", () => {
    const result = validateLinkedImageForPeCoffWriter({
      target: writerTargetForTest(),
      layout: linkedImageLayoutForPeCoffTest({
        dataDirectorySources: [
          {
            stableKey: "data-directory:exception:.pdata",
            directoryKind: "exception",
            sectionKey: ".pdata",
            rva: 0x2ffc,
            sizeBytes: 8,
          },
        ],
      }),
    });

    expectStableDetails(result).toContain(
      "data-directory:range-outside-section:data-directory:exception:.pdata",
    );
  });

  test("rejects duplicate data directory kinds", () => {
    const result = validateLinkedImageForPeCoffWriter({
      target: writerTargetForTest(),
      layout: linkedImageLayoutForPeCoffTest({
        dataDirectorySources: [
          {
            stableKey: "data-directory:exception:a",
            directoryKind: "exception",
            sectionKey: ".pdata",
            rva: 0x2000,
            sizeBytes: 4,
          },
          {
            stableKey: "data-directory:exception:b",
            directoryKind: "exception",
            sectionKey: ".pdata",
            rva: 0x2004,
            sizeBytes: 4,
          },
        ],
      }),
    });

    expectStableDetails(result).toContain(
      "data-directory:duplicate-kind:exception:data-directory:exception:a:data-directory:exception:b",
    );
  });

  test("rejects exception data directories outside the linked pdata section", () => {
    const result = validateLinkedImageForPeCoffWriter({
      target: writerTargetForTest(),
      layout: linkedImageLayoutForPeCoffTest({
        dataDirectorySources: [
          {
            stableKey: "data-directory:exception:.xdata",
            directoryKind: "exception",
            sectionKey: ".xdata",
            rva: 0x3000,
            sizeBytes: 4,
          },
        ],
      }),
    });

    expectStableDetails(result).toContain(
      "data-directory:exception-section:.xdata:expected:.pdata",
    );
  });

  test("rejects base relocation ranges outside the named section", () => {
    const result = validateLinkedImageForPeCoffWriter({
      target: writerTargetForTest(),
      layout: linkedImageLayoutForPeCoffTest({
        baseRelocations: [
          {
            stableKey: "base-reloc:dir64:.data:12284",
            kind: "dir64",
            sectionKey: ".data",
            rva: 0x2ffc,
            widthBytes: 8,
            sourceRelocationKey: "module:test:reloc:absolute",
          },
        ],
      }),
    });

    expectStableDetails(result).toContain(
      "base-relocation:range-outside-section:base-reloc:dir64:.data:12284",
    );
  });

  test("rejects linked section virtual end above target max image size", () => {
    const layout = linkedImageLayoutForPeCoffTest();
    const result = validateLinkedImageForPeCoffWriter({
      target: writerTargetForTest(),
      layout: linkedImageLayoutForPeCoffTest({
        sections: [
          ...layout.sections.slice(0, 3),
          {
            ...layout.sections[3]!,
            virtualSizeBytes: 128 * 1024 * 1024,
          },
        ],
      }),
    });

    expectStableDetails(result).toContain("section:image-size:.data:134234112:max:134217728");
  });

  test("rejects layout target policy fingerprint mismatch", () => {
    const result = validateLinkedImageForPeCoffWriter({
      target: writerTargetForTest(),
      layout: linkedImageLayoutForPeCoffTest({
        targetPolicyFingerprint: "stable-hash:other-linker-policy",
      }),
    });

    expectStableDetails(result).toContain(
      "layout:target-policy-fingerprint:stable-hash:other-linker-policy:expected:stable-hash:linker-policy",
    );
  });

  test("rejects linked layout target keys outside production v1", () => {
    const result = validateLinkedImageForPeCoffWriter({
      target: writerTargetForTest(),
      layout: linkedImageLayoutForPeCoffTest({
        targetKey: "test-target",
      }),
    });

    expectStableDetails(result).toContain("layout:target-key:test-target");
  });

  test("rejects writer target key outside production v1", () => {
    const result = validateLinkedImageForPeCoffWriter({
      target: {
        ...writerTargetForTest(),
        targetKey: "test-target",
      },
      layout: linkedImageLayoutForPeCoffTest(),
    });

    expectStableDetails(result).toContain("target:key:test-target");
  });
});

function expectStableDetails(result: ReturnType<typeof validateLinkedImageForPeCoffWriter>) {
  expect(result.kind).toBe("error");
  return expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail));
}
