import { describe, expect, test } from "bun:test";

import {
  canonicalUefiAArch64EntryProfile,
  createUefiAArch64EntryThunkObjectFactory,
  decodeEntryThunkXdataBytes,
  entryThunkUnwindMetadata,
  planUefiAArch64EntryThunk,
} from "../../../../src/target/uefi-aarch64";
import type { AArch64BackendTargetSurface } from "../../../../src/target/aarch64/backend/api/backend-target-surface";
import { createAArch64UefiEntrySyntheticObjectProvider } from "../../../../src/linker/aarch64/aarch64-entry-objects";
import { authenticateAArch64LinkerTargetSurface } from "../../../../src/linker/image-layout-policy";
import { authenticatedBackendTargetSurfaceForTest } from "../../../support/target/aarch64/backend/backend-target-surface-fakes";

describe("UEFI AArch64 entry thunk", () => {
  test("plans a framed call thunk that preserves firmware x30 before BL", () => {
    const plan = planUefiAArch64EntryThunk({
      entryProfile: canonicalUefiAArch64EntryProfile(),
      backendTarget: authenticatedBackendTargetSurfaceForTest(),
    });

    expect(plan.kind).toBe("ok");
    if (plan.kind !== "ok") throw new Error("expected entry thunk plan");
    expect(plan.value.strategy).toBe("framed-call");
    expect(plan.value.frameSizeBytes).toBe(48);
    expect(plan.value.frameSlots).toEqual([
      { key: "image-handle", offsetBytes: 0, sizeBytes: 8 },
      { key: "system-table", offsetBytes: 8, sizeBytes: 8 },
      { key: "boot-result", offsetBytes: 16, sizeBytes: 8 },
      { key: "saved-x29", offsetBytes: 32, sizeBytes: 8 },
      { key: "saved-x30", offsetBytes: 40, sizeBytes: 8 },
    ]);
    expect(plan.value.instructions.map((instruction) => instruction.operationKey)).toEqual([
      "sub-sp-frame",
      "stp-x29-x30-frame",
      "add-x29-frame",
      "store-image-handle",
      "store-system-table",
      "call-entry-initialize-context",
      "branch-if-entry-initialization-failed",
      "reload-entry-context-for-boot",
      "call-boot-function",
      "store-boot-result",
      "reload-boot-result-for-status-conversion",
      "call-status-conversion",
      "ldp-x29-x30-frame",
      "add-sp-frame",
      "ret",
    ]);

    const firstCallIndex = plan.value.instructions.findIndex((instruction) =>
      instruction.operationKey.startsWith("call-"),
    );
    const frameIndex = plan.value.instructions.findIndex(
      (instruction) => instruction.operationKey === "stp-x29-x30-frame",
    );
    expect(frameIndex).toBeGreaterThan(-1);
    expect(frameIndex).toBeLessThan(firstCallIndex);
    expect(plan.value.relocations.map((relocation) => relocation.targetLinkageName)).toEqual([
      "__wrela_uefi_entry_initialize_context",
      "wrela.image.boot",
      "__wrela_uefi_status_from_boot_result",
    ]);
  });

  test("creates a verified synthetic object with expected symbols and plural relocations", () => {
    const backendTarget = authenticatedBackendTargetSurfaceForTest();
    const factory = createUefiAArch64EntryThunkObjectFactory({
      entryProfile: canonicalUefiAArch64EntryProfile(),
      backendTarget,
    });
    const provider = createAArch64UefiEntrySyntheticObjectProvider({
      factory,
      backendTarget,
      encodingCatalog: backendTarget.encodingCatalog,
      relocationCatalog: backendTarget.relocationCatalog,
    });
    const linkerTarget = authenticateAArch64LinkerTargetSurface();
    if (linkerTarget.kind !== "ok") throw new Error("expected linker target");

    const factoryResult = factory.createEntryObject({ wrelaBootLinkageName: "wrela.image.boot" });
    expect(factoryResult.kind).toBe("ok");
    if (factoryResult.kind !== "ok") throw new Error("expected entry object");
    const relocations = factoryResult.relocations;
    if (relocations === undefined) throw new Error("expected plural relocations");
    expect(relocations.map((relocation) => relocation.targetLinkageName)).toEqual([
      "__wrela_uefi_entry_initialize_context",
      "wrela.image.boot",
      "__wrela_uefi_status_from_boot_result",
    ]);
    expect(factoryResult.unwindRecords).toHaveLength(1);

    const renamedBootResult = factory.createEntryObject({
      wrelaBootLinkageName: "custom.boot.entry",
    });
    expect(renamedBootResult.kind).toBe("ok");
    if (renamedBootResult.kind !== "ok") throw new Error("expected renamed entry object");
    expect(
      renamedBootResult.relocations?.map((relocation) => relocation.targetLinkageName),
    ).toEqual([
      "__wrela_uefi_entry_initialize_context",
      "custom.boot.entry",
      "__wrela_uefi_status_from_boot_result",
    ]);

    const result = provider.provideObjects({
      target: linkerTarget.value,
      entry: { wrelaBootLinkageName: "wrela.image.boot" },
      objectModules: [],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected synthetic object");
    const objectModule = result.modules[0]!.objectModule;
    expect(
      objectModule.symbols.filter(
        (symbol) =>
          symbol.kind === "global-definition" && symbol.linkageName === "__wrela_uefi_entry",
      ),
    ).toHaveLength(1);
    expect(objectModule.relocations.map((relocation) => relocation.target)).toEqual([
      { kind: "linkage-name", linkageName: "wrela.image.boot" },
      { kind: "linkage-name", linkageName: "__wrela_uefi_entry_initialize_context" },
      { kind: "linkage-name", linkageName: "__wrela_uefi_status_from_boot_result" },
    ]);
    expect(objectModule.unwindRecords).toContainEqual(
      expect.objectContaining({
        stableKey: "unwind:symbol:__wrela_uefi_entry",
        sectionKey: ".text",
        frameShape: "frame-record",
      }),
    );
  });

  test("plans relocation offsets from the encoded entry thunk byte walk", () => {
    const backendTarget = authenticatedBackendTargetSurfaceForTest();
    const plan = planUefiAArch64EntryThunk({
      entryProfile: canonicalUefiAArch64EntryProfile(),
      backendTarget,
    });
    const factory = createUefiAArch64EntryThunkObjectFactory({
      entryProfile: canonicalUefiAArch64EntryProfile(),
      backendTarget,
    });

    const factoryResult = factory.createEntryObject({ wrelaBootLinkageName: "wrela.image.boot" });

    expect(plan.kind).toBe("ok");
    if (plan.kind !== "ok") throw new Error("expected entry thunk plan");
    expect(factoryResult.kind).toBe("ok");
    if (factoryResult.kind !== "ok") throw new Error("expected entry object");
    expect(plan.value.relocations.map((relocation) => relocation.offsetBytes)).toEqual(
      factoryResult.relocations?.map((relocation) => relocation.offsetBytes),
    );
  });

  test("encodes spec-shaped entry unwind pdata and xdata records", () => {
    const backendTarget = authenticatedBackendTargetSurfaceForTest();
    const factory = createUefiAArch64EntryThunkObjectFactory({
      entryProfile: canonicalUefiAArch64EntryProfile(),
      backendTarget,
    });
    const entryObject = factory.createEntryObject({ wrelaBootLinkageName: "wrela.image.boot" });
    expect(entryObject.kind).toBe("ok");
    if (entryObject.kind !== "ok") throw new Error("expected entry object");

    const unwindObjects = factory.createUnwindObjects({
      unwindRecords: [
        {
          sourceModuleKey: "module:entry",
          stableKey: "unwind:symbol:__wrela_uefi_entry",
          frameShape: "frame-record",
          functionStableKey: "symbol:__wrela_uefi_entry",
          functionLinkageName: "__wrela_uefi_entry",
          functionLengthBytes: entryObject.codeBytes.length,
        },
        {
          sourceModuleKey: "module:boot",
          stableKey: "unwind:symbol:wrela.image.boot",
          frameShape: "frameless-leaf",
          functionStableKey: "symbol:wrela.image.boot",
          functionLinkageName: "wrela.image.boot",
          functionLengthBytes: 8,
        },
      ],
    });

    expect(unwindObjects.kind).toBe("ok");
    if (unwindObjects.kind !== "ok") throw new Error("expected unwind objects");
    expect(unwindObjects.objects).toHaveLength(1);
    const unwindObject = unwindObjects.objects[0]!;
    expect(Array.from(unwindObject.pdataBytes)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(unwindObject.pdataRelocation).toMatchObject({
      family: "addr32nb",
      offsetBytes: 0,
      widthBytes: 4,
    });
    expect(unwindObject.xdataRelocation).toMatchObject({
      family: "addr32nb",
      offsetBytes: 4,
      widthBytes: 4,
    });
    expect(unwindObject.xdataSymbolStableKey).toBe("symbol:xdata:0");
    expect(Array.from(unwindObject.xdataBytes)).toEqual([
      1, 16, 3, 1, 13, 3, 3, 4, 129, 4, 225, 6, 228, 228, 0, 0,
    ]);
    expect(decodeEntryThunkXdataBytes(unwindObject.xdataBytes)).toEqual(entryThunkUnwindMetadata());
  });

  test("encodes backend serializable stack frames with frame-size metadata", () => {
    const backendTarget = authenticatedBackendTargetSurfaceForTest();
    const factory = createUefiAArch64EntryThunkObjectFactory({
      entryProfile: canonicalUefiAArch64EntryProfile(),
      backendTarget,
    });

    const unwindObjects = factory.createUnwindObjects({
      unwindRecords: [
        {
          sourceModuleKey: "module:boot",
          stableKey: "unwind:symbol:wrela.image.boot",
          frameShape: "serializable-unwind",
          functionStableKey: "symbol:wrela.image.boot",
          functionLinkageName: "wrela.image.boot",
          functionLengthBytes: 48,
          frameSizeBytes: 32,
          savedRegisters: ["x30"],
        },
      ],
    });

    expect(unwindObjects.kind).toBe("ok");
    if (unwindObjects.kind !== "ok") throw new Error("expected unwind objects");
    expect(unwindObjects.objects).toHaveLength(1);
    expect(decodeEntryThunkXdataBytes(unwindObjects.objects[0]!.xdataBytes)).toMatchObject({
      functionLengthBytes: 48,
      prologueLengthBytes: 8,
      epilogueStartOffsetBytes: 36,
      epilogueLengthBytes: 12,
      stackAllocationBytes: 32,
    });
  });

  test("rejects non-leaf unwind records that have unsupported frame shapes", () => {
    const backendTarget = authenticatedBackendTargetSurfaceForTest();
    const factory = createUefiAArch64EntryThunkObjectFactory({
      entryProfile: canonicalUefiAArch64EntryProfile(),
      backendTarget,
    });

    const unwindObjects = factory.createUnwindObjects({
      unwindRecords: [
        {
          sourceModuleKey: "module:boot",
          stableKey: "unwind:symbol:wrela.image.boot",
          frameShape: "unreachable-body",
          functionStableKey: "symbol:wrela.image.boot",
          functionLinkageName: "wrela.image.boot",
          functionLengthBytes: 32,
        },
      ],
    });

    expect(unwindObjects.kind).toBe("error");
    if (unwindObjects.kind !== "error") throw new Error("expected unwind error");
    expect(unwindObjects.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "unwind:frame-shape-unsupported:unwind:symbol:wrela.image.boot:unreachable-body",
    ]);
  });

  test("entry object factory encodes with the injected backend target catalogs", () => {
    const backendTarget = authenticatedBackendTargetSurfaceForTest();
    const rejectingBackendTarget: AArch64BackendTargetSurface = {
      ...backendTarget,
      encodingCatalog: {
        ...backendTarget.encodingCatalog,
        fingerprint: "backend-encoding-catalog:rejecting-entry-thunk-test",
        entryForOpcode: () => undefined,
      },
    };
    const factory = createUefiAArch64EntryThunkObjectFactory({
      entryProfile: canonicalUefiAArch64EntryProfile(),
      backendTarget: rejectingBackendTarget,
    });

    const result = factory.createEntryObject({ wrelaBootLinkageName: "wrela.image.boot" });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected injected catalog rejection");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "entry-thunk:instruction-encoding-failed:encoding:unsupported-opcode:sub-immediate",
    );
  });

  test("rejects tail-entry profiles for v1 thunk materialization", () => {
    const plan = planUefiAArch64EntryThunk({
      entryProfile: canonicalUefiAArch64EntryProfile({
        thunkStrategy: "tail-entry" as never,
      }),
      backendTarget: authenticatedBackendTargetSurfaceForTest(),
    });

    expect(plan.kind).toBe("error");
    if (plan.kind !== "error") throw new Error("expected tail-entry rejection");
    expect(plan.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "entry-thunk:unsupported-strategy:tail-entry",
    ]);
  });
});
