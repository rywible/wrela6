import { describe, expect, test } from "bun:test";

import { recomputeLinkedImageContributions } from "../../../src/linker/contribution-recompute";
import { verifyLinkedImageLayout } from "../../../src/linker/verifier";
import {
  createAArch64LinkedImageLayout,
  type AArch64LinkedImageLayout,
  type LinkedImageSection,
} from "../../../src/linker/linked-image-layout";
import { targetSurfaceForTest } from "../../support/linker/linker-fixtures";
import { validateLinkedImageLayoutSlowly } from "../../support/linker/slow-linked-image-validator";

describe("W2-03b production contribution recomputation", () => {
  test("exposes the production contribution recompute module", () => {
    const result = recomputeLinkedImageContributions(
      imageWithContributions([contribution(".text", 0, 4)]),
    );

    expect(result.diagnostics).toEqual([]);
  });

  test("rejects contribution offset corruption in the production verifier", () => {
    const layout = imageWithContributions([contribution(".text", 4, 4)]);

    const result = verifyLinkedImageLayout({ layout, target: targetSurfaceForTest() });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "image-layout:contribution-offset-mismatch:module:test:boot:section:.text:4:0",
    );
  });

  test("keeps test support on the same recomputation source of truth", () => {
    const layout = imageWithContributions([contribution(".text", 4, 4)]);
    const productionResult = recomputeLinkedImageContributions(layout);
    const slowResult = validateLinkedImageLayoutSlowly(layout);

    expect(productionResult.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "image-layout:contribution-offset-mismatch:module:test:boot:section:.text:4:0",
    );
    expect(slowResult.kind).toBe("error");
    expect(slowResult.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "slow-image-layout:contribution-offset-mismatch:module:test:boot:section:.text:4:0",
    );
  });
});

function imageWithContributions(
  contributions: readonly LinkedImageSection["contributions"][number][],
): AArch64LinkedImageLayout {
  return createAArch64LinkedImageLayout({
    targetKey: "target:test",
    targetFingerprint: "target:fingerprint:test",
    targetPolicyFingerprint: "target-policy:fingerprint:test",
    inputModules: [
      {
        moduleKey: "module:test:boot",
        moduleFingerprint: "fingerprint:module:test:boot",
      },
    ],
    sections: [
      {
        stableKey: ".text",
        classKey: "executable-text",
        flags: 0x60000020,
        alignmentBytes: 4096,
        rva: 0x1000,
        virtualSizeBytes: 4,
        bytes: [0xc0, 0x03, 0x5f, 0xd6],
        contributions,
      },
    ],
    symbols: [],
    appliedRelocations: [],
    baseRelocations: [],
    entry: {
      loaderEntryLinkageName: "__wrela_uefi_entry",
      loaderEntryRva: 0,
      wrelaBootLinkageName: "Boot.main",
      wrelaBootRva: 0,
    },
    unwindRecords: [],
    dataDirectorySources: [],
    provenance: [
      {
        stableKey: "provenance:.text",
        sectionKey: ".text",
        rva: 0x1000,
        byteLength: 4,
        sourceModuleKey: "module:test:boot",
        sourceObjectSectionKey: ".text",
        sourceObjectProvenanceKey: "provenance:.text",
        factFamilies: ["fixture-bytes"],
      },
    ],
    factSpending: [
      {
        stableKey: "fact-spent:test:boot",
        authority: "test",
        payload: "boot",
        sourceModuleKeys: ["module:test:boot"],
      },
    ],
    verification: {
      runs: [
        {
          verifierKey: "linker-fixture",
          runKey: "w2-03b",
          status: "passed",
        },
      ],
    },
  });
}

function contribution(
  outputSectionKey: string,
  offsetBytes: number,
  sizeBytes: number,
): LinkedImageSection["contributions"][number] {
  return {
    stableKey: `module:test:boot:section:${outputSectionKey}`,
    sourceModuleKey: "module:test:boot",
    sourceObjectSectionKey: outputSectionKey,
    sourceObjectSectionClass: "executable-text",
    outputSectionKey,
    offsetBytes,
    sizeBytes,
    alignmentBytes: 4,
  };
}
