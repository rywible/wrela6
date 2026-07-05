import { compileAArch64Object } from "../../../src/target/aarch64/backend/api/compile-aarch64-object";
import type { CompileAArch64ObjectResult } from "../../../src/target/aarch64/backend/api/compile-aarch64-object";
import { aarch64ObjectModule } from "../../../src/target/aarch64/backend/object/object-module";
import type { AArch64ObjectSymbol } from "../../../src/target/aarch64/backend/object/object-module";
import {
  normalizeAArch64LinkInputs,
  type NormalizedLinkGraph,
} from "../../../src/linker/object-normalization";
import type { AArch64LinkInputModule, LinkAArch64ImageInput } from "../../../src/linker";
import type { AArch64LinkerTargetSurface } from "../../../src/linker/image-layout-policy";
import { backendInputForTest } from "../target/aarch64/backend/backend-fixtures";
import { bootModuleForTest, targetSurfaceForTest, veneerProviderForTest } from "./linker-fixtures";
import {
  dataSectionForLinkTest,
  externalSymbolForLinkTest,
  globalSymbolForLinkTest,
  localSymbolForLinkTest,
  objectModuleForLinkTest,
  relocationForLinkTest,
  textSectionForLinkTest,
} from "./aarch64-object-link-fixtures";

export interface NormalizedGraphForTestInput {
  readonly target?: AArch64LinkerTargetSurface;
  readonly objectModules?: readonly AArch64LinkInputModule[];
}

export interface ApplyRelocationsFixtureInput {
  readonly graph: NormalizedLinkGraph;
  readonly relocationKey: string;
  readonly targetSymbolKey: string;
  readonly patchModuleKey: string;
  readonly patchSectionKey: string;
}

export interface SectionLayoutFixtureInput {
  readonly graph: NormalizedLinkGraph;
  readonly orderedModuleKeys: readonly string[];
  readonly outputSectionKey: string;
}

export interface SymbolRvaFixtureInput {
  readonly graph: NormalizedLinkGraph;
  readonly symbolKey: string;
  readonly contributionKey: string;
}

export interface LinkLayoutFixedPointFixtureInput {
  readonly graph: NormalizedLinkGraph;
  readonly relocationKey: string;
  readonly targetSymbolKey: string;
  readonly veneerProvider?: ReturnType<typeof veneerProviderForTest>;
}

export function normalizedGraphForTest(
  input: NormalizedGraphForTestInput = {},
): NormalizedLinkGraph {
  const result = normalizeAArch64LinkInputs({
    target: input.target ?? targetSurfaceForTest(),
    objectModules: input.objectModules ?? [bootModuleForTest()],
  });
  if (result.kind !== "ok") {
    throw new Error(
      `expected normalized linker fixture graph: ${result.diagnostics
        .map((diagnostic) => diagnostic.stableDetail)
        .join(",")}`,
    );
  }
  return result.value;
}

export function moduleWithLocalTarget(
  moduleKey: string,
  localStableKey: string,
): AArch64LinkInputModule {
  return objectModuleForLinkTest({
    moduleKey,
    symbols: [
      localSymbolForLinkTest({ stableKey: localStableKey, sectionKey: ".text" }),
      globalSymbolForLinkTest({
        stableKey: `${moduleKey}:global`,
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

export function moduleWithTextSection(moduleKey = "module:test:text"): AArch64LinkInputModule {
  return objectModuleForLinkTest({
    moduleKey,
    sections: [textSectionForLinkTest({ stableKey: ".text", bytes: [0xc0, 0x03, 0x5f, 0xd6] })],
    symbols: [
      globalSymbolForLinkTest({
        stableKey: "main",
        linkageName: `${moduleKey}.main`,
        sectionKey: ".text",
      }),
    ],
  });
}

export function twoModuleCallFixture(): NormalizedGraphForTestInput {
  return {
    objectModules: [
      objectModuleForLinkTest({
        moduleKey: "module:test:caller",
        symbols: [
          globalSymbolForLinkTest({
            stableKey: "caller",
            linkageName: "Caller.main",
            sectionKey: ".text",
          }),
          externalSymbolForLinkTest({
            stableKey: "extern:Callee.main",
            linkageName: "Callee.main",
          }),
        ],
        relocations: [
          relocationForLinkTest({
            stableKey: "reloc:caller:callee",
            target: { kind: "linkage-name", linkageName: "Callee.main" },
            encodingOwner: instructionEncodingOwnerForTest("bl"),
          }),
        ],
      }),
      objectModuleForLinkTest({
        moduleKey: "module:test:callee",
        symbols: [
          globalSymbolForLinkTest({
            stableKey: "callee",
            linkageName: "Callee.main",
            sectionKey: ".text",
          }),
        ],
      }),
    ],
  };
}

export function addr64Fixture(): ApplyRelocationsFixtureInput {
  return addressRelocationFixture("addr64", "reloc:data:addr64", 8);
}

export function addr32FixtureForTest(): ApplyRelocationsFixtureInput {
  return addressRelocationFixture("addr32", "reloc:data:addr32", 4);
}

export function pairTargetMismatchFixture(): ApplyRelocationsFixtureInput {
  const graph = normalizedGraphForTest({
    objectModules: [
      objectModuleForLinkTest({
        moduleKey: "module:test:pair-target-mismatch",
        sections: [textSectionForLinkTest({ stableKey: ".text", bytes: [0, 0, 0, 0, 0, 0, 0, 0] })],
        symbols: [
          globalSymbolForLinkTest({
            stableKey: "page",
            linkageName: "Pair.page",
            sectionKey: ".text",
          }),
          globalSymbolForLinkTest({
            stableKey: "offset",
            linkageName: "Pair.offset",
            sectionKey: ".text",
            offsetBytes: 4,
          }),
        ],
        relocations: [
          relocationForLinkTest({
            stableKey: "reloc:pair:page",
            family: "pagebase-rel21",
            target: { kind: "linkage-name", linkageName: "Pair.page" },
            encodingOwner: instructionEncodingOwnerForTest("adrp"),
            pairedRelocationKey: "reloc:pair:offset",
          }),
          relocationForLinkTest({
            stableKey: "reloc:pair:offset",
            offsetBytes: 4,
            family: "pageoffset-12a",
            target: { kind: "linkage-name", linkageName: "Pair.offset" },
            bitRange: [10, 21],
            encodingOwner: instructionEncodingOwnerForTest("add"),
            pairedRelocationKey: "reloc:pair:page",
          }),
        ],
      }),
    ],
  });
  return {
    graph,
    relocationKey: "reloc:pair:page",
    targetSymbolKey: "page",
    patchModuleKey: "module:test:pair-target-mismatch",
    patchSectionKey: ".text",
  };
}

export function paddingFixtureForTest(): SectionLayoutFixtureInput {
  const objectModules = [
    moduleWithTextSection("module:test:padding:a"),
    objectModuleForLinkTest({
      moduleKey: "module:test:padding:b",
      sections: [textSectionForLinkTest({ stableKey: ".text", alignmentBytes: 16 })],
      symbols: [
        globalSymbolForLinkTest({
          stableKey: "padding-b",
          linkageName: "Padding.b",
          sectionKey: ".text",
        }),
      ],
    }),
  ];
  return {
    graph: normalizedGraphForTest({ objectModules }),
    orderedModuleKeys: objectModules.map((module) => module.moduleKey),
    outputSectionKey: ".text",
  };
}

export function symbolRvaFixtureForTest(): SymbolRvaFixtureInput {
  return {
    graph: normalizedGraphForTest({
      objectModules: [moduleWithTextSection("module:test:symbol-rva")],
    }),
    symbolKey: "main",
    contributionKey: "module:test:symbol-rva:section:.text",
  };
}

export function nonExecutableEntryFixture(): NormalizedGraphForTestInput {
  return {
    objectModules: [
      objectModuleForLinkTest({
        moduleKey: "module:test:non-executable-entry",
        sections: [dataSectionForLinkTest({ stableKey: ".data", bytes: [0, 0, 0, 0] })],
        symbols: [
          globalSymbolForLinkTest({
            stableKey: "main",
            linkageName: "Boot.main",
            sectionKey: ".data",
          }),
        ],
      }),
    ],
  };
}

export function unwindInDataSectionFixture(): NormalizedGraphForTestInput {
  const data = dataSectionForLinkTest({ stableKey: ".data", bytes: [0, 0, 0, 0] });
  const base = objectModuleForLinkTest({
    moduleKey: "module:test:unwind-in-data",
    sections: [data],
    symbols: [
      globalSymbolForLinkTest({
        stableKey: "main",
        linkageName: "Boot.main",
        sectionKey: ".data",
      }),
    ],
  });
  return {
    objectModules: [
      {
        ...base,
        objectModule: aarch64ObjectModule({
          ...base.objectModule,
          unwindRecords: [
            {
              stableKey: "unwind:main",
              sectionKey: data.stableKey,
              frameShape: "fixture-data-section",
              savedRegisters: [],
            },
          ],
        }),
      },
    ],
  };
}

export function farBranchModulesForTest(): readonly AArch64LinkInputModule[] {
  return [
    objectModuleForLinkTest({
      moduleKey: "module:test:far-branch:caller",
      sections: [textSectionForLinkTest({ stableKey: ".text", bytes: [0, 0, 0, 0] })],
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
        relocationForLinkTest({
          stableKey: "reloc:far-branch",
          family: "branch26",
          target: { kind: "linkage-name", linkageName: "FarBranch.target" },
          encodingOwner: instructionEncodingOwnerForTest("bl"),
        }),
      ],
    }),
    objectModuleForLinkTest({
      moduleKey: "module:test:far-branch:target",
      sections: [
        textSectionForLinkTest({ stableKey: ".text.far", bytes: [0xc0, 0x03, 0x5f, 0xd6] }),
      ],
      symbols: [
        globalSymbolForLinkTest({
          stableKey: "target",
          linkageName: "FarBranch.target",
          sectionKey: ".text.far",
        }),
      ],
    }),
  ];
}

export function farBranchWithoutProviderFixture(): LinkLayoutFixedPointFixtureInput {
  return {
    graph: normalizedGraphForTest({ objectModules: farBranchModulesForTest() }),
    relocationKey: "reloc:far-branch",
    targetSymbolKey: "target",
  };
}

export function unresolvedExternalLinkInput(): LinkAArch64ImageInput {
  return {
    target: targetSurfaceForTest(),
    entry: { wrelaBootLinkageName: "Missing.main" },
    objectModules: [
      objectModuleForLinkTest({
        moduleKey: "module:test:unresolved-external",
        symbols: [
          globalSymbolForLinkTest({
            stableKey: "main",
            linkageName: "Boot.main",
            sectionKey: ".text",
          }),
          externalSymbolForLinkTest({
            stableKey: "extern:Missing.main",
            linkageName: "Missing.main",
          }),
        ],
      }),
    ],
  };
}

export function compileTinyAArch64ObjectForLinkTest(): CompileAArch64ObjectResult & {
  readonly kind: "ok";
} {
  const result = compileAArch64Object(backendInputForTest());
  if (result.kind !== "ok") {
    throw new Error(
      `expected tiny AArch64 backend object: ${result.diagnostics
        .map((diagnostic) => diagnostic.stableDetail)
        .join(",")}`,
    );
  }
  return result;
}

function addressRelocationFixture(
  family: "addr32" | "addr64",
  relocationKey: string,
  widthBytes: number,
): ApplyRelocationsFixtureInput {
  const graph = normalizedGraphForTest({
    objectModules: [
      objectModuleForLinkTest({
        moduleKey: `module:test:${family}`,
        sections: [
          dataSectionForLinkTest({
            stableKey: ".data",
            bytes: Array.from({ length: widthBytes }, () => 0),
          }),
          textSectionForLinkTest({ stableKey: ".text" }),
        ],
        symbols: [
          globalSymbolForLinkTest({
            stableKey: "target",
            linkageName: "Address.target",
            sectionKey: ".text",
          }),
          dataPointerSymbolForTest(),
        ],
        relocations: [
          relocationForLinkTest({
            stableKey: relocationKey,
            sectionKey: ".data",
            offsetBytes: 0,
            widthBytes,
            family,
            target: { kind: "linkage-name", linkageName: "Address.target" },
            bitRange: undefined,
            encodingOwner: undefined,
          }),
        ],
      }),
    ],
  });
  return {
    graph,
    relocationKey,
    targetSymbolKey: "target",
    patchModuleKey: `module:test:${family}`,
    patchSectionKey: ".data",
  };
}

function dataPointerSymbolForTest(): AArch64ObjectSymbol {
  return globalSymbolForLinkTest({
    stableKey: "pointer",
    linkageName: "Address.pointer",
    sectionKey: ".data",
  });
}

function instructionEncodingOwnerForTest(opcode: string) {
  return Object.freeze({
    opcode,
    catalogEntryKey: `encoding:${opcode}`,
  });
}
