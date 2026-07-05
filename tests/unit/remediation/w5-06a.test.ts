import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  createDefaultAArch64LinkerVeneerProvider,
  linkAArch64Image,
  type AArch64LinkInputModule,
} from "../../../src/linker";
import {
  aarch64ObjectRelocation,
  type AArch64ObjectLinkerVeneerRequest,
} from "../../../src/target/aarch64/backend/object/object-module";
import { verifyAArch64ObjectModule } from "../../../src/target/aarch64/backend/verify/encoding-object-verifier";
import { runUefiAArch64BinarySpine } from "../../../src/target/uefi-aarch64/binary-spine";
import {
  externalSymbolForLinkTest,
  globalSymbolForLinkTest,
  objectModuleForLinkTest,
  textSectionForLinkTest,
} from "../../support/linker/aarch64-object-link-fixtures";
import {
  entryShimProviderForTest,
  targetSurfaceForTest,
} from "../../support/linker/linker-fixtures";

test("default AArch64 veneer provider is defined", () => {
  const provider = createDefaultAArch64LinkerVeneerProvider();

  expect(provider.providerKey).toBe("veneer");
  expect(typeof provider.provideVeneer).toBe("function");
});

test("default AArch64 veneer provider returns deterministic verifier-valid modules", () => {
  const provider = createDefaultAArch64LinkerVeneerProvider();
  const input = {
    providerKey: provider.providerKey,
    request: {
      siteKind: "branch26-call" as const,
      scratchRegisters: ["x16"],
      securityLabels: [],
      provenanceKeys: ["provenance:caller"],
      maxSourceReachBytes: 134_217_728,
    },
    target: targetSurfaceForTest(),
    sourceModuleKey: "module:test:caller",
    sourceRelocationKey: "module:test:caller:reloc:call",
    sourcePatchRva: 0x1000,
    targetSymbolKey: "module:test:target:symbol:target",
    targetLinkageName: "Target.symbol",
    targetRva: 0x2000,
    addend: 0n,
  };

  const left = provider.provideVeneer(input);
  const right = provider.provideVeneer(input);

  expect(left).toEqual(right);
  expect(left.kind).toBe("ok");
  if (left.kind !== "ok") throw new Error("expected veneer modules");
  expect(left.modules).toHaveLength(1);
  const module = left.modules[0];
  expect(module?.moduleKey).toBe("module:synthetic:veneer:veneer");
  expect(Array.from(module?.objectModule.sections[0]?.bytes ?? [])).toEqual([
    0x10, 0x00, 0x00, 0x90, 0x10, 0x02, 0x00, 0x91, 0x00, 0x02, 0x1f, 0xd6,
  ]);
  expect(
    module?.objectModule.relocations.map(
      (relocation) => relocation.instructionPatch?.encodingOwner?.opcode,
    ),
  ).toEqual(["adrp", "add-pageoff"]);
  expect(module?.objectModule.relocations.map((relocation) => relocation.family)).toEqual([
    "pagebase-rel21",
    "pageoffset-12a",
  ]);
  expect(
    module?.objectModule.relocations.map((relocation) => String(relocation.pairedRelocationKey)),
  ).toEqual(["reloc:veneer:target:1:low12", "reloc:veneer:target:0:page"]);
  expect(
    module?.objectModule.relocations.some(
      (relocation) =>
        relocation.target.kind === "linkage-name" &&
        relocation.target.linkageName === "Target.symbol",
    ),
  ).toBe(true);

  const verification = verifyAArch64ObjectModule({ objectModule: module!.objectModule });
  expect(verification.kind).toBe("ok");
});

test("default AArch64 veneer provider links a far branch through a veneer", () => {
  const target = targetSurfaceForTest();
  const result = linkAArch64Image({
    target,
    objectModules: farBranchModulesForDefaultVeneerTest(target.backendSurfaceFingerprint),
    entry: { wrelaBootLinkageName: "FarBranch.caller" },
    syntheticObjects: [entryShimProviderForTest()],
    veneerProvider: createDefaultAArch64LinkerVeneerProvider(),
  });

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected linked far branch veneer");
  expect(result.layout.inputModules.map((module) => module.moduleKey)).toContain(
    "module:synthetic:veneer:module:test:far-branch:caller:reloc:reloc:far-branch",
  );
  expect(result.layout.appliedRelocations.map((relocation) => relocation.targetSymbolKey)).toEqual(
    expect.arrayContaining([
      "module:synthetic:veneer:module:test:far-branch:caller:reloc:reloc:far-branch:symbol:veneer",
      "module:test:far-branch:target:symbol:target",
    ]),
  );
});

test("UEFI AArch64 binary spine passes a default veneer provider to the linker", () => {
  expect(runUefiAArch64BinarySpine).toBeDefined();
  const source = readFileSync("src/target/uefi-aarch64/binary-spine.ts", "utf8");

  expect(source).toContain("createDefaultAArch64LinkerVeneerProvider");
  expect(source).toContain("const veneerProvider = createDefaultAArch64LinkerVeneerProvider();");
  expect(source).toContain("veneerProvider,");
});

function farBranchModulesForDefaultVeneerTest(
  targetBackendSurfaceFingerprint: string,
): readonly AArch64LinkInputModule[] {
  const request: AArch64ObjectLinkerVeneerRequest = Object.freeze({
    siteKind: "branch26-call",
    scratchRegisters: Object.freeze(["x16"]),
    securityLabels: Object.freeze([]),
    provenanceKeys: Object.freeze(["provenance:.text"]),
    maxSourceReachBytes: 134_217_728,
  });
  return Object.freeze([
    objectModuleForLinkTest({
      moduleKey: "module:test:far-branch:caller",
      targetBackendSurfaceFingerprint,
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
          addend: 134_217_728n,
          bitRange: [0, 25],
          encodingOwner: instructionEncodingOwnerForDefaultVeneerTest("bl"),
          linkerVeneer: request,
        }),
      ],
    }),
    objectModuleForLinkTest({
      moduleKey: "module:test:far-branch:target",
      targetBackendSurfaceFingerprint,
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

function instructionEncodingOwnerForDefaultVeneerTest(opcode: string) {
  return Object.freeze({
    opcode,
    catalogEntryKey: `encoding:${opcode}`,
  });
}
