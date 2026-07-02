import { describe, expect, test } from "bun:test";

import { planPairedRelocations } from "../../../src/linker/relocation-application";
import type { NormalizedLinkGraph } from "../../../src/linker/object-normalization";
import { resolveLinkSymbols } from "../../../src/linker/symbol-resolution";
import {
  globalSymbolForLinkTest,
  objectModuleForLinkTest,
  relocationForLinkTest,
  textSectionForLinkTest,
} from "../../support/linker/aarch64-object-link-fixtures";
import {
  normalizedGraphForTest,
  pairTargetMismatchFixture,
} from "../../support/linker/aarch64-normalized-link-fixtures";

describe("paired relocation planning", () => {
  test("plans pagebase plus low-12 relocations with matching explicit pair keys", () => {
    const result = planPairedRelocations(planInput(pairedGraph()));

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected paired relocation plan");
    expect(result.value).toEqual([
      {
        stableKey:
          "relocation-pair:module:test:pair:reloc:reloc:pair:page:module:test:pair:reloc:reloc:pair:offset",
        pageRelocationKey: "module:test:pair:reloc:reloc:pair:page",
        low12RelocationKey: "module:test:pair:reloc:reloc:pair:offset",
        targetSymbolKey: "module:test:pair:symbol:target",
      },
    ]);
  });

  test("rejects pagebase relocations missing paired relocation keys", () => {
    const result = planPairedRelocations(
      planInput(
        pairedGraph({
          pagePairedRelocationKey: null,
          low12PairedRelocationKey: "reloc:pair:page",
        }),
      ),
    );

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toEqual([
      "LINKER_RELOCATION_FAILED",
    ]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "relocation:pair-missing-key:module:test:pair:reloc:reloc:pair:page",
    ]);
  });

  test("rejects missing same-module pair partners", () => {
    const result = planPairedRelocations(
      planInput(pairedGraph({ pagePairedRelocationKey: "reloc:pair:missing" })),
    );

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "relocation:pair-partner-missing:module:test:pair:reloc:reloc:pair:page:reloc:pair:missing",
    ]);
  });

  test("rejects wrong family pairings", () => {
    const result = planPairedRelocations(planInput(pairedGraph({ low12Family: "branch26" })));

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "relocation:pair-family-mismatch:module:test:pair:reloc:reloc:pair:page:module:test:pair:reloc:reloc:pair:offset:pagebase-rel21:branch26",
    ]);
  });

  test("rejects asymmetric pair keys", () => {
    const result = planPairedRelocations(
      planInput(pairedGraph({ low12PairedRelocationKey: "reloc:pair:other-page" })),
    );

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "relocation:pair-reciprocal-mismatch:module:test:pair:reloc:reloc:pair:page:module:test:pair:reloc:reloc:pair:offset:reloc:pair:other-page",
    ]);
  });

  test("rejects pair partners that only exist in another module", () => {
    const result = planPairedRelocations(planInput(crossModulePairGraph()));

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "relocation:pair-partner-missing:module:test:pair:page:reloc:reloc:pair:page:reloc:pair:offset",
    ]);
  });

  test("rejects paired relocations that target different symbols", () => {
    const fixture = pairTargetMismatchFixture();
    const result = planPairedRelocations(planInput(fixture.graph));

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "relocation:pair-target-mismatch:module:test:pair-target-mismatch:reloc:reloc:pair:page:module:test:pair-target-mismatch:reloc:reloc:pair:offset",
    ]);
  });
});

function planInput(graph: NormalizedLinkGraph) {
  const resolved = resolveLinkSymbols(graph);
  if (resolved.kind !== "ok") {
    throw new Error(
      `expected resolved symbols: ${resolved.diagnostics
        .map((diagnostic) => diagnostic.stableDetail)
        .join(",")}`,
    );
  }
  return { graph, relocationTargets: resolved.value.relocationTargets };
}

function pairedGraph(
  input: {
    readonly pagePairedRelocationKey?: string | null;
    readonly low12PairedRelocationKey?: string;
    readonly low12Family?: string;
  } = {},
): NormalizedLinkGraph {
  return normalizedGraphForTest({
    objectModules: [
      objectModuleForLinkTest({
        moduleKey: "module:test:pair",
        sections: [textSectionForLinkTest({ stableKey: ".text", bytes: Array(8).fill(0) })],
        symbols: [
          globalSymbolForLinkTest({
            stableKey: "target",
            linkageName: "Pair.target",
            sectionKey: ".text",
          }),
        ],
        relocations: [
          relocationForLinkTest({
            stableKey: "reloc:pair:page",
            family: "pagebase-rel21",
            target: { kind: "linkage-name", linkageName: "Pair.target" },
            encodingOwner: instructionEncodingOwnerForTest("adrp"),
            pairedRelocationKey:
              input.pagePairedRelocationKey === null
                ? undefined
                : (input.pagePairedRelocationKey ?? "reloc:pair:offset"),
          }),
          relocationForLinkTest({
            stableKey: "reloc:pair:offset",
            offsetBytes: 4,
            family: input.low12Family ?? "pageoffset-12a",
            target: { kind: "linkage-name", linkageName: "Pair.target" },
            bitRange: [10, 21],
            encodingOwner: instructionEncodingOwnerForTest("add"),
            pairedRelocationKey: input.low12PairedRelocationKey ?? "reloc:pair:page",
          }),
        ],
      }),
    ],
  });
}

function crossModulePairGraph(): NormalizedLinkGraph {
  return normalizedGraphForTest({
    objectModules: [
      objectModuleForLinkTest({
        moduleKey: "module:test:pair:page",
        sections: [textSectionForLinkTest({ stableKey: ".text", bytes: [0, 0, 0, 0] })],
        symbols: [
          globalSymbolForLinkTest({
            stableKey: "target",
            linkageName: "Pair.cross.page",
            sectionKey: ".text",
          }),
        ],
        relocations: [
          relocationForLinkTest({
            stableKey: "reloc:pair:page",
            family: "pagebase-rel21",
            target: { kind: "linkage-name", linkageName: "Pair.cross.page" },
            encodingOwner: instructionEncodingOwnerForTest("adrp"),
            pairedRelocationKey: "reloc:pair:offset",
          }),
        ],
      }),
      objectModuleForLinkTest({
        moduleKey: "module:test:pair:offset",
        sections: [textSectionForLinkTest({ stableKey: ".text", bytes: [0, 0, 0, 0] })],
        symbols: [
          globalSymbolForLinkTest({
            stableKey: "target",
            linkageName: "Pair.cross.offset",
            sectionKey: ".text",
          }),
        ],
        relocations: [
          relocationForLinkTest({
            stableKey: "reloc:pair:offset",
            family: "pageoffset-12a",
            target: { kind: "linkage-name", linkageName: "Pair.cross.offset" },
            bitRange: [10, 21],
            encodingOwner: instructionEncodingOwnerForTest("add"),
            pairedRelocationKey: "reloc:pair:page",
          }),
        ],
      }),
    ],
  });
}

function instructionEncodingOwnerForTest(opcode: string) {
  return Object.freeze({
    opcode,
    catalogEntryKey: `encoding:${opcode}`,
  });
}
