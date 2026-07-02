import { describe, expect, test } from "bun:test";

import { resolveLinkSymbols } from "../../../src/linker/symbol-resolution";
import type { AArch64ObjectRelocation } from "../../../src/target/aarch64/backend/object/object-module";
import {
  externalSymbolForLinkTest,
  globalSymbolForLinkTest,
  localSymbolForLinkTest,
  objectModuleForLinkTest,
  relocationForLinkTest,
} from "../../support/linker/aarch64-object-link-fixtures";
import {
  normalizedGraphForTest,
  twoModuleCallFixture,
} from "../../support/linker/aarch64-normalized-link-fixtures";

describe("linker symbol resolution", () => {
  test("same local stable keys in different modules resolve locally", () => {
    const result = resolveLinkSymbols(
      normalizedGraphForTest({
        objectModules: [
          moduleWithLocalTarget("module:test:a", "local.loop"),
          moduleWithLocalTarget("module:test:b", "local.loop"),
        ],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected symbol resolution");

    expect(result.value.relocationTargets).toEqual([
      {
        relocationKey: "module:test:a:reloc:reloc:local.loop",
        sourceModuleKey: "module:test:a",
        targetSymbolKey: "module:test:a:symbol:local.loop",
      },
      {
        relocationKey: "module:test:b:reloc:reloc:local.loop",
        sourceModuleKey: "module:test:b",
        targetSymbolKey: "module:test:b:symbol:local.loop",
      },
    ]);
  });

  test("duplicate global definitions fail deterministically", () => {
    const result = resolveLinkSymbols(
      normalizedGraphForTest({
        objectModules: [
          moduleWithGlobal("module:test:z", "duplicate"),
          moduleWithGlobal("module:test:a", "duplicate"),
        ],
      }),
    );

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toEqual([
      "LINKER_SYMBOL_RESOLUTION_FAILED",
    ]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "symbol-resolution:duplicate-global-definition:duplicate:module:test:a:symbol:global:module:test:z:symbol:global",
    ]);
  });

  test("same-module global definitions win for same-module linkage-name relocations", () => {
    const result = resolveLinkSymbols(
      normalizedGraphForTest({
        objectModules: [
          objectModuleForLinkTest({
            moduleKey: "module:test:owner",
            symbols: [
              globalSymbolForLinkTest({
                stableKey: "same",
                linkageName: "Shared.name",
                sectionKey: ".text",
              }),
            ],
            relocations: [
              relocationForLinkTest({
                stableKey: "call",
                target: { kind: "linkage-name", linkageName: "Shared.name" },
                encodingOwner: instructionEncodingOwnerForTest("bl"),
              }),
            ],
          }),
          objectModuleForLinkTest({
            moduleKey: "module:test:decl",
            symbols: [
              externalSymbolForLinkTest({
                stableKey: "extern:Shared.name",
                linkageName: "Shared.name",
              }),
            ],
          }),
        ],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected symbol resolution");

    expect(result.value.relocationTargets).toEqual([
      {
        relocationKey: "module:test:owner:reloc:call",
        sourceModuleKey: "module:test:owner",
        targetSymbolKey: "module:test:owner:symbol:same",
      },
    ]);
  });

  test("external declarations resolve to single cross-module global definitions", () => {
    const result = resolveLinkSymbols(normalizedGraphForTest(twoModuleCallFixture()));

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected symbol resolution");

    expect(result.value.relocationTargets).toEqual([
      {
        relocationKey: "module:test:caller:reloc:reloc:caller:callee",
        sourceModuleKey: "module:test:caller",
        targetSymbolKey: "module:test:callee:symbol:callee",
      },
    ]);
  });

  test("stable-key relocation targets are constrained to the source module", () => {
    const graph = normalizedGraphForTest({
      objectModules: [
        objectModuleForLinkTest({
          moduleKey: "module:test:caller",
          symbols: [
            globalSymbolForLinkTest({
              stableKey: "caller",
              linkageName: "Caller.main",
              sectionKey: ".text",
            }),
          ],
        }),
        objectModuleForLinkTest({
          moduleKey: "module:test:other",
          symbols: [
            localSymbolForLinkTest({
              stableKey: "local.only.in.other",
              sectionKey: ".text",
            }),
          ],
        }),
      ],
    });
    const result = resolveLinkSymbols({
      ...graph,
      modules: graph.modules.map((module) =>
        module.moduleKey === "module:test:caller"
          ? {
              ...module,
              objectModule: {
                ...module.objectModule,
                relocations: [
                  {
                    stableKey: "call-local",
                    sectionKey: ".text",
                    offsetBytes: 0,
                    widthBytes: 4,
                    family: "branch26",
                    target: { kind: "symbol-stable-key", stableKey: "local.only.in.other" },
                    addend: 0n,
                    bitRange: [0, 25],
                    encodingOwner: instructionEncodingOwnerForTest("b"),
                  } as unknown as AArch64ObjectRelocation,
                ],
              },
            }
          : module,
      ),
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "symbol-resolution:unresolved-symbol-stable-key:module:test:caller:reloc:call-local:local.only.in.other",
    ]);
  });

  test("unresolved external declarations are rejected for UEFI v1", () => {
    const result = resolveLinkSymbols(
      normalizedGraphForTest({
        objectModules: [
          objectModuleForLinkTest({
            moduleKey: "module:test:extern",
            symbols: [
              externalSymbolForLinkTest({
                stableKey: "extern:Missing.main",
                linkageName: "Missing.main",
              }),
            ],
            relocations: [
              relocationForLinkTest({
                stableKey: "missing",
                target: { kind: "linkage-name", linkageName: "Missing.main" },
                encodingOwner: instructionEncodingOwnerForTest("bl"),
              }),
            ],
          }),
        ],
      }),
    );

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "symbol-resolution:unresolved-external:Missing.main:module:test:extern:symbol:extern:Missing.main",
      "symbol-resolution:unresolved-linkage-name:module:test:extern:reloc:missing:Missing.main",
    ]);
  });
});

function moduleWithLocalTarget(moduleKey: string, localStableKey: string) {
  return objectModuleForLinkTest({
    moduleKey,
    symbols: [
      localSymbolForLinkTest({ stableKey: localStableKey, sectionKey: ".text" }),
      globalSymbolForLinkTest({
        stableKey: "entry",
        linkageName: `${moduleKey}.entry`,
        sectionKey: ".text",
      }),
    ],
    relocations: [
      relocationForLinkTest({
        stableKey: `reloc:${localStableKey}`,
        target: { kind: "symbol-stable-key", stableKey: localStableKey },
        encodingOwner: instructionEncodingOwnerForTest("b"),
      }),
    ],
  });
}

function moduleWithGlobal(moduleKey: string, linkageName: string) {
  return objectModuleForLinkTest({
    moduleKey,
    symbols: [
      globalSymbolForLinkTest({
        stableKey: "global",
        linkageName,
        sectionKey: ".text",
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
