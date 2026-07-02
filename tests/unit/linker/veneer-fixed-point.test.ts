import { expect, test } from "bun:test";

import {
  applyResolvedRelocations,
  planPairedRelocations,
} from "../../../src/linker/relocation-application";
import { layoutImageSections } from "../../../src/linker/section-layout";
import { materializeResolvedImageSymbols } from "../../../src/linker/symbol-rva";
import { resolveLinkSymbols } from "../../../src/linker/symbol-resolution";
import {
  runLinkLayoutFixedPoint,
  type LinkLayoutFixedPointFunctions,
} from "../../../src/linker/layout-fixed-point";
import type {
  AArch64LinkInputModule,
  AArch64LinkerVeneerProvider,
  AArch64LinkerVeneerProviderInput,
  AArch64SyntheticObjectModule,
} from "../../../src/linker";
import {
  aarch64ObjectRelocation,
  type AArch64ObjectLinkerVeneerRequest,
} from "../../../src/target/aarch64/backend/object/object-module";
import {
  externalSymbolForLinkTest,
  globalSymbolForLinkTest,
  objectModuleForLinkTest,
  textSectionForLinkTest,
} from "../../support/linker/aarch64-object-link-fixtures";
import { normalizedGraphForTest } from "../../support/linker/aarch64-normalized-link-fixtures";
import { targetSurfaceForTest } from "../../support/linker/linker-fixtures";

const target = targetSurfaceForTest();
const stages: LinkLayoutFixedPointFunctions = Object.freeze({
  layoutSections: layoutImageSections,
  materializeSymbols: materializeResolvedImageSymbols,
  planPairs: planPairedRelocations,
  applyRelocations: applyResolvedRelocations,
});

test("delegated branch fails closed without veneer provider", () => {
  const graph = normalizedGraphForTest({ objectModules: farBranchModulesForTest({}) });
  const resolvedSymbols = resolveLinkSymbols(graph);
  if (resolvedSymbols.kind !== "ok") throw new Error("expected resolved symbols");

  const result = runLinkLayoutFixedPoint(
    { target, graph, resolvedSymbols: resolvedSymbols.value },
    stages,
  );

  expect(result.kind).toBe("error");
  if (result.kind !== "error") throw new Error("expected veneer error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
    "relocation:linker-veneer-provider-missing:module:test:far-branch:caller:reloc:reloc:far-branch",
  ]);
});

test("provider output is normalized and linked as a veneer module", () => {
  const graph = normalizedGraphForTest({ objectModules: farBranchModulesForTest({}) });
  const resolvedSymbols = resolveLinkSymbols(graph);
  if (resolvedSymbols.kind !== "ok") throw new Error("expected resolved symbols");
  let providerInput: AArch64LinkerVeneerProviderInput | undefined;

  const result = runLinkLayoutFixedPoint(
    {
      target,
      graph,
      resolvedSymbols: resolvedSymbols.value,
      veneerProvider: veneerProviderForTest((input) => {
        providerInput = input;
      }),
    },
    stages,
  );

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected fixed point success");
  expect(result.value.graph.modules.map((module) => module.moduleKey)).toContain(
    "module:synthetic:veneer:module:test:far-branch:caller:reloc:reloc:far-branch",
  );
  expect(result.value.appliedRelocations.map((relocation) => relocation.targetSymbolKey)).toContain(
    "module:synthetic:veneer:module:test:far-branch:caller:reloc:reloc:far-branch:symbol:veneer",
  );
  expect(providerInput).toMatchObject({
    sourceModuleKey: "module:test:far-branch:caller",
    sourceRelocationKey: "module:test:far-branch:caller:reloc:reloc:far-branch",
    targetSymbolKey: "module:test:far-branch:target:symbol:target",
    targetLinkageName: "FarBranch.target",
    targetRva: 4,
    addend: 134_217_728n,
  });
});

test("provider output without an onward relocation to the original target is rejected", () => {
  const graph = normalizedGraphForTest({ objectModules: farBranchModulesForTest({}) });
  const resolvedSymbols = resolveLinkSymbols(graph);
  if (resolvedSymbols.kind !== "ok") throw new Error("expected resolved symbols");

  const result = runLinkLayoutFixedPoint(
    {
      target,
      graph,
      resolvedSymbols: resolvedSymbols.value,
      veneerProvider: providerWithoutTargetRelocationForTest(),
    },
    stages,
  );

  expect(result.kind).toBe("error");
  if (result.kind !== "error") throw new Error("expected veneer contract error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
    "relocation:linker-veneer-target-relocation-missing:module:test:far-branch:caller:reloc:reloc:far-branch:FarBranch.target",
  ]);
});

test("malformed veneer provider modules return diagnostics instead of throwing", () => {
  const graph = normalizedGraphForTest({ objectModules: farBranchModulesForTest({}) });
  const resolvedSymbols = resolveLinkSymbols(graph);
  if (resolvedSymbols.kind !== "ok") throw new Error("expected resolved symbols");

  const result = runLinkLayoutFixedPoint(
    {
      target,
      graph,
      resolvedSymbols: resolvedSymbols.value,
      veneerProvider: Object.freeze({
        providerKey: "veneer",
        provideVeneer: () => ({ kind: "ok" as const, modules: {} as never }),
      }),
    },
    stages,
  );

  expect(result.kind).toBe("error");
  if (result.kind !== "error") throw new Error("expected malformed veneer output error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
    "relocation:linker-veneer-provider-modules-malformed:module:test:far-branch:caller:reloc:reloc:far-branch:veneer",
  ]);
});

test("provider output preserves every returned veneer module", () => {
  const graph = normalizedGraphForTest({ objectModules: farBranchModulesForTest({}) });
  const resolvedSymbols = resolveLinkSymbols(graph);
  if (resolvedSymbols.kind !== "ok") throw new Error("expected resolved symbols");

  const result = runLinkLayoutFixedPoint(
    {
      target,
      graph,
      resolvedSymbols: resolvedSymbols.value,
      veneerProvider: multiModuleVeneerProviderForTest(),
    },
    stages,
  );

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected fixed point success");
  expect(result.value.graph.modules.map((module) => module.moduleKey)).toContain(
    "module:synthetic:veneer:module:test:far-branch:caller:reloc:reloc:far-branch:helper",
  );
  expect(result.value.relocationTargets).toContainEqual({
    relocationKey:
      "module:synthetic:veneer:module:test:far-branch:caller:reloc:reloc:far-branch:reloc:reloc:veneer:helper",
    sourceModuleKey: "module:synthetic:veneer:module:test:far-branch:caller:reloc:reloc:far-branch",
    targetSymbolKey:
      "module:synthetic:veneer:module:test:far-branch:caller:reloc:reloc:far-branch:helper:symbol:helper",
  });
});

test("retargets linker-owned veneer modules when nested veneers are requested", () => {
  const graph = normalizedGraphForTest({ objectModules: farBranchModulesForTest({}) });
  const resolvedSymbols = resolveLinkSymbols(graph);
  if (resolvedSymbols.kind !== "ok") throw new Error("expected resolved symbols");
  const provider = nestedVeneerProviderForTest();

  const result = runLinkLayoutFixedPoint(
    {
      target,
      graph,
      resolvedSymbols: resolvedSymbols.value,
      veneerProvider: provider,
    },
    stages,
  );

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected fixed point success");
  const firstVeneerModuleKey =
    "module:synthetic:veneer:module:test:far-branch:caller:reloc:reloc:far-branch";
  const nestedRelocationKey = `${firstVeneerModuleKey}:reloc:reloc:veneer:far-branch`;
  const nestedVeneerModuleKey = `module:synthetic:veneer:${nestedRelocationKey}`;
  expect(result.value.graph.modules.map((module) => module.moduleKey)).toContain(
    nestedVeneerModuleKey,
  );
  expect(result.value.relocationTargets).toContainEqual({
    relocationKey: nestedRelocationKey,
    sourceModuleKey: firstVeneerModuleKey,
    targetSymbolKey: `${nestedVeneerModuleKey}:symbol:veneer`,
  });
});

test("provider output retargets to the module object key global when helpers sort earlier", () => {
  const graph = normalizedGraphForTest({ objectModules: farBranchModulesForTest({}) });
  const resolvedSymbols = resolveLinkSymbols(graph);
  if (resolvedSymbols.kind !== "ok") throw new Error("expected resolved symbols");

  const result = runLinkLayoutFixedPoint(
    {
      target,
      graph,
      resolvedSymbols: resolvedSymbols.value,
      veneerProvider: multiGlobalVeneerProviderForTest(),
    },
    stages,
  );

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected fixed point success");
  expect(result.value.appliedRelocations.map((relocation) => relocation.targetSymbolKey)).toContain(
    "module:synthetic:veneer:module:test:far-branch:caller:reloc:reloc:far-branch:symbol:veneer",
  );
  expect(
    result.value.appliedRelocations.map((relocation) => relocation.targetSymbolKey),
  ).not.toContain(
    "module:synthetic:veneer:module:test:far-branch:caller:reloc:reloc:far-branch:symbol:aaa-helper",
  );
});

test("security-labeled delegated branches are rejected before provider calls", () => {
  let providerCalls = 0;
  const graph = normalizedGraphForTest({
    objectModules: farBranchModulesForTest({ securityLabels: ["constant-time"] }),
  });
  const resolvedSymbols = resolveLinkSymbols(graph);
  if (resolvedSymbols.kind !== "ok") throw new Error("expected resolved symbols");

  const result = runLinkLayoutFixedPoint(
    {
      target,
      graph,
      resolvedSymbols: resolvedSymbols.value,
      veneerProvider: veneerProviderForTest(() => {
        providerCalls += 1;
      }),
    },
    stages,
  );

  expect(result.kind).toBe("error");
  expect(providerCalls).toBe(0);
  if (result.kind !== "error") throw new Error("expected security rejection");
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
    "relocation:linker-veneer-security-rejected:module:test:far-branch:caller:reloc:reloc:far-branch",
  ]);
});

test("delegated branches with non-range relocation errors fail instead of requesting veneers", () => {
  let providerCalls = 0;
  const graph = normalizedGraphForTest({
    objectModules: farBranchModulesForTest({ addend: 2n }),
  });
  const resolvedSymbols = resolveLinkSymbols(graph);
  if (resolvedSymbols.kind !== "ok") throw new Error("expected resolved symbols");

  const result = runLinkLayoutFixedPoint(
    {
      target,
      graph,
      resolvedSymbols: resolvedSymbols.value,
      veneerProvider: veneerProviderForTest(() => {
        providerCalls += 1;
      }),
    },
    stages,
  );

  expect(result.kind).toBe("error");
  expect(providerCalls).toBe(0);
  if (result.kind !== "error") throw new Error("expected relocation error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
    "relocation:encoding-failed:relocation:unaligned-branch-distance:module:test:far-branch:caller:reloc:reloc:far-branch:6:module:test:far-branch:caller:.text:reloc:far-branch:branch26:module:test:far-branch:target:symbol:target:patch-rva:0:target-rva:4:addend:2:allowed:-134217728..134217724",
  ]);
});

test("fixed point exhaustion emits the capped diagnostic", () => {
  const graph = normalizedGraphForTest({ objectModules: farBranchModulesForTest({}) });
  const resolvedSymbols = resolveLinkSymbols(graph);
  if (resolvedSymbols.kind !== "ok") throw new Error("expected resolved symbols");

  const result = runLinkLayoutFixedPoint(
    {
      target,
      graph,
      resolvedSymbols: resolvedSymbols.value,
      veneerProvider: endlesslyChangingVeneerProvider(),
    },
    stages,
  );

  expect(result.kind).toBe("error");
  if (result.kind !== "error") throw new Error("expected cap exhaustion");
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
    "section-layout:fixed-point-exhausted:8",
  ]);
});

test("rebuilds linker-owned veneer modules independently of provider key spelling", () => {
  const graph = normalizedGraphForTest({ objectModules: farBranchModulesForTest({}) });
  const resolvedSymbols = resolveLinkSymbols(graph);
  if (resolvedSymbols.kind !== "ok") throw new Error("expected resolved symbols");

  const result = runLinkLayoutFixedPoint(
    {
      target,
      graph,
      resolvedSymbols: resolvedSymbols.value,
      veneerProvider: endlesslyChangingVeneerProvider("aarch64-veneer"),
    },
    stages,
  );

  expect(result.kind).toBe("error");
  if (result.kind !== "error") throw new Error("expected cap exhaustion");
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
    "section-layout:fixed-point-exhausted:8",
  ]);
});

function farBranchModulesForTest(input: {
  readonly securityLabels?: readonly string[];
  readonly addend?: bigint;
}): readonly AArch64LinkInputModule[] {
  const request: AArch64ObjectLinkerVeneerRequest = Object.freeze({
    siteKind: "branch26-call",
    scratchRegisters: Object.freeze(["x16"]),
    securityLabels: Object.freeze([...(input.securityLabels ?? [])]),
    provenanceKeys: Object.freeze(["provenance:.text"]),
    maxSourceReachBytes: 134_217_728,
  });
  return Object.freeze([
    objectModuleForLinkTest({
      moduleKey: "module:test:far-branch:caller",
      sections: [textSectionForLinkTest({ stableKey: ".text", bytes: [0, 0, 0, 0x94] })],
      symbols: [
        globalSymbolForLinkTest({
          stableKey: "caller",
          linkageName: "FarBranch.caller",
          sectionKey: ".text",
        }),
        externalSymbolForLinkTest({
          stableKey: "extern:FarBranch.target",
          linkageName: "FarBranch.target",
        }),
      ],
      relocations: [
        aarch64ObjectRelocation({
          stableKey: "reloc:far-branch",
          sectionKey: ".text",
          offsetBytes: 0,
          widthBytes: 4,
          family: "branch26",
          target: { kind: "linkage-name", linkageName: "FarBranch.target" },
          addend: input.addend ?? 134_217_728n,
          bitRange: [0, 25],
          encodingOwner: instructionEncodingOwnerForTest("bl"),
          linkerVeneer: request,
        }),
      ],
    }),
    objectModuleForLinkTest({
      moduleKey: "module:test:far-branch:target",
      sections: [
        textSectionForLinkTest({
          stableKey: ".text.far",
          bytes: [0xc0, 0x03, 0x5f, 0xd6],
        }),
      ],
      symbols: [
        globalSymbolForLinkTest({
          stableKey: "target",
          linkageName: "FarBranch.target",
          sectionKey: ".text.far",
        }),
      ],
    }),
  ]);
}

function veneerProviderForTest(
  onCall?: (input: AArch64LinkerVeneerProviderInput) => void,
): AArch64LinkerVeneerProvider {
  return Object.freeze({
    providerKey: "veneer",
    provideVeneer: (input: AArch64LinkerVeneerProviderInput) => {
      onCall?.(input);
      return {
        kind: "ok" as const,
        modules: [
          veneerModule(
            "module:synthetic:veneer:module:test:far-branch:caller:reloc:reloc:far-branch",
          ),
        ],
      };
    },
  });
}

function providerWithoutTargetRelocationForTest(): AArch64LinkerVeneerProvider {
  return Object.freeze({
    providerKey: "veneer",
    provideVeneer: () => ({
      kind: "ok" as const,
      modules: [opaqueVeneerModule("module:synthetic:veneer:opaque")],
    }),
  });
}

function multiModuleVeneerProviderForTest(): AArch64LinkerVeneerProvider {
  return Object.freeze({
    providerKey: "veneer",
    provideVeneer: () => ({
      kind: "ok" as const,
      modules: [
        veneerModuleWithHelperReference(),
        helperVeneerModule(
          "module:synthetic:veneer:module:test:far-branch:caller:reloc:reloc:far-branch:helper",
        ),
      ],
    }),
  });
}

function multiGlobalVeneerProviderForTest(): AArch64LinkerVeneerProvider {
  return Object.freeze({
    providerKey: "veneer",
    provideVeneer: () => ({
      kind: "ok" as const,
      modules: [veneerModuleWithEarlierHelperGlobal()],
    }),
  });
}

function nestedVeneerProviderForTest(): AArch64LinkerVeneerProvider {
  return Object.freeze({
    providerKey: "veneer",
    provideVeneer: (input: AArch64LinkerVeneerProviderInput) => ({
      kind: "ok" as const,
      modules:
        input.request.siteKind === "branch26-call"
          ? [veneerModule("module:synthetic:veneer:first", true)]
          : [veneerModule("module:synthetic:veneer:terminal")],
    }),
  });
}

function endlesslyChangingVeneerProvider(providerKey = "veneer"): AArch64LinkerVeneerProvider {
  let counter = 0;
  return Object.freeze({
    providerKey,
    provideVeneer: () => {
      counter += 1;
      return {
        kind: "ok" as const,
        modules: [
          veneerModule(
            `module:synthetic:veneer:module:test:far-branch:caller:reloc:reloc:far-branch:${counter}`,
            true,
          ),
        ],
      };
    },
  });
}

function veneerModuleWithEarlierHelperGlobal(): AArch64SyntheticObjectModule {
  const moduleKey = "module:synthetic:veneer:module:test:far-branch:caller:reloc:reloc:far-branch";
  const linkModule = objectModuleForLinkTest({
    moduleKey,
    syntheticProviderKey: "veneer",
    syntheticObjectKey: "veneer",
    sections: [
      textSectionForLinkTest({
        stableKey: ".text.veneer",
        bytes: [0, 0, 0, 0x14, 0xc0, 0x03, 0x5f, 0xd6],
      }),
    ],
    symbols: [
      globalSymbolForLinkTest({
        stableKey: "aaa-helper",
        linkageName: `${moduleKey}.aaa-helper`,
        sectionKey: ".text.veneer",
        offsetBytes: 4,
      }),
      globalSymbolForLinkTest({
        stableKey: "veneer",
        linkageName: `${moduleKey}.veneer`,
        sectionKey: ".text.veneer",
      }),
      externalSymbolForLinkTest({
        stableKey: "extern:FarBranch.target",
        linkageName: "FarBranch.target",
      }),
    ],
    relocations: [
      aarch64ObjectRelocation({
        stableKey: "reloc:veneer:target",
        sectionKey: ".text.veneer",
        offsetBytes: 0,
        widthBytes: 4,
        family: "branch26",
        target: { kind: "linkage-name", linkageName: "FarBranch.target" },
        addend: 0n,
        bitRange: [0, 25],
        encodingOwner: instructionEncodingOwnerForTest("b"),
      }),
    ],
  });
  return Object.freeze({
    objectKey: "veneer",
    moduleKey,
    objectModule: linkModule.objectModule,
  });
}

function veneerModuleWithHelperReference(): AArch64SyntheticObjectModule {
  const moduleKey = "module:synthetic:veneer:module:test:far-branch:caller:reloc:reloc:far-branch";
  const linkModule = objectModuleForLinkTest({
    moduleKey,
    syntheticProviderKey: "veneer",
    syntheticObjectKey: "veneer",
    sections: [
      textSectionForLinkTest({
        stableKey: ".text.veneer",
        bytes: [0, 0, 0, 0x14, 0xc0, 0x03, 0x5f, 0xd6],
      }),
    ],
    symbols: [
      globalSymbolForLinkTest({
        stableKey: "veneer",
        linkageName: `${moduleKey}.veneer`,
        sectionKey: ".text.veneer",
      }),
      externalSymbolForLinkTest({
        stableKey: "extern:helper",
        linkageName: `${moduleKey}.helper`,
      }),
    ],
    relocations: [
      aarch64ObjectRelocation({
        stableKey: "reloc:veneer:helper",
        sectionKey: ".text.veneer",
        offsetBytes: 0,
        widthBytes: 4,
        family: "branch26",
        target: { kind: "linkage-name", linkageName: `${moduleKey}.helper` },
        addend: 0n,
        bitRange: [0, 25],
        encodingOwner: instructionEncodingOwnerForTest("b"),
      }),
    ],
  });
  return Object.freeze({
    objectKey: "veneer",
    moduleKey,
    objectModule: linkModule.objectModule,
  });
}

function helperVeneerModule(moduleKey: string): AArch64SyntheticObjectModule {
  const linkModule = objectModuleForLinkTest({
    moduleKey,
    syntheticProviderKey: "veneer",
    syntheticObjectKey: "helper",
    sections: [textSectionForLinkTest({ stableKey: ".text.helper", bytes: [0, 0, 0, 0x14] })],
    symbols: [
      globalSymbolForLinkTest({
        stableKey: "helper",
        linkageName:
          "module:synthetic:veneer:module:test:far-branch:caller:reloc:reloc:far-branch.helper",
        sectionKey: ".text.helper",
      }),
      externalSymbolForLinkTest({
        stableKey: "extern:FarBranch.target",
        linkageName: "FarBranch.target",
      }),
    ],
    relocations: [
      aarch64ObjectRelocation({
        stableKey: "reloc:helper:target",
        sectionKey: ".text.helper",
        offsetBytes: 0,
        widthBytes: 4,
        family: "branch26",
        target: { kind: "linkage-name", linkageName: "FarBranch.target" },
        addend: 0n,
        bitRange: [0, 25],
        encodingOwner: instructionEncodingOwnerForTest("b"),
      }),
    ],
  });
  return Object.freeze({
    objectKey: "helper",
    moduleKey,
    objectModule: linkModule.objectModule,
  });
}

function veneerModule(
  moduleKey: string,
  delegatesAnotherVeneer = false,
): AArch64SyntheticObjectModule {
  const linkModule = objectModuleForLinkTest({
    moduleKey,
    syntheticProviderKey: "veneer",
    syntheticObjectKey: "veneer",
    sections: [
      textSectionForLinkTest({
        stableKey: ".text.veneer",
        bytes: [0, 0, 0, 0x14],
      }),
    ],
    symbols: [
      globalSymbolForLinkTest({
        stableKey: "veneer",
        linkageName: `${moduleKey}.veneer`,
        sectionKey: ".text.veneer",
      }),
      ...(delegatesAnotherVeneer
        ? [
            externalSymbolForLinkTest({
              stableKey: "extern:FarBranch.target",
              linkageName: "FarBranch.target",
            }),
          ]
        : [
            externalSymbolForLinkTest({
              stableKey: "extern:FarBranch.target",
              linkageName: "FarBranch.target",
            }),
          ]),
    ],
    relocations: [
      aarch64ObjectRelocation({
        stableKey: delegatesAnotherVeneer ? "reloc:veneer:far-branch" : "reloc:veneer:target",
        sectionKey: ".text.veneer",
        offsetBytes: 0,
        widthBytes: 4,
        family: "branch26",
        target: { kind: "linkage-name", linkageName: "FarBranch.target" },
        addend: delegatesAnotherVeneer ? 134_217_728n : 0n,
        bitRange: [0, 25],
        encodingOwner: instructionEncodingOwnerForTest("b"),
        ...(delegatesAnotherVeneer
          ? {
              linkerVeneer: {
                siteKind: "branch26-jump",
                scratchRegisters: ["x16"],
                securityLabels: [],
                provenanceKeys: ["provenance:.text.veneer"],
                maxSourceReachBytes: 134_217_728,
              },
            }
          : {}),
      }),
    ],
  });
  return Object.freeze({
    objectKey: "veneer",
    moduleKey,
    objectModule: linkModule.objectModule,
  });
}

function opaqueVeneerModule(moduleKey: string): AArch64SyntheticObjectModule {
  const linkModule = objectModuleForLinkTest({
    moduleKey,
    syntheticProviderKey: "veneer",
    syntheticObjectKey: "veneer",
    sections: [
      textSectionForLinkTest({
        stableKey: ".text.veneer",
        bytes: [0xc0, 0x03, 0x5f, 0xd6],
      }),
    ],
    symbols: [
      globalSymbolForLinkTest({
        stableKey: "veneer",
        linkageName: `${moduleKey}.veneer`,
        sectionKey: ".text.veneer",
      }),
    ],
  });
  return Object.freeze({
    objectKey: "veneer",
    moduleKey,
    objectModule: linkModule.objectModule,
  });
}

function instructionEncodingOwnerForTest(opcode: string) {
  return Object.freeze({
    opcode,
    catalogEntryKey: `encoding:${opcode}`,
  });
}
