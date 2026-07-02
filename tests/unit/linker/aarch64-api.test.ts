import { describe, expect, test } from "bun:test";

import {
  linkAArch64Image,
  materializeAArch64SyntheticObjectsForLink,
  type AArch64ImageEntryRequest,
  type AArch64LinkInputModule,
  type AArch64LinkerVeneerProvider,
  type AArch64SyntheticObjectProvider,
  type AArch64SyntheticObjectProviderResult,
} from "../../../src/linker";
import { linkerDiagnostic } from "../../../src/linker/diagnostics";
import { authenticateAArch64LinkerTargetSurface } from "../../../src/linker/image-layout-policy";
import { aarch64ObjectModule } from "../../../src/target/aarch64/backend/object/object-module";
import type { AArch64LinkerTargetSurface } from "../../../src/linker/image-layout-policy";

function objectModuleForApiTest(moduleKey: string): AArch64LinkInputModule {
  return {
    moduleKey,
    objectModule: aarch64ObjectModule({
      targetBackendSurfaceFingerprint: "backend-target-surface-fingerprint",
      closedImagePlanFingerprint: `closed-image-plan:${moduleKey}`,
    }),
  };
}

function targetSurfaceForApiTest(): AArch64LinkerTargetSurface {
  const result = authenticateAArch64LinkerTargetSurface();
  if (result.kind !== "ok") throw new Error("expected authenticated target surface");
  return result.value;
}

function syntheticProviderForApiTest(input: {
  readonly providerKey: string;
  readonly objectKey: string;
  readonly moduleKey?: string;
  readonly result?: AArch64SyntheticObjectProviderResult;
}): AArch64SyntheticObjectProvider {
  return {
    providerKey: input.providerKey,
    provideObjects: () =>
      input.result ?? {
        kind: "ok",
        modules: [
          {
            objectKey: input.objectKey,
            moduleKey:
              input.moduleKey ?? `module:synthetic:${input.providerKey}:${input.objectKey}`,
            objectModule: objectModuleForApiTest(
              input.moduleKey ?? `module:synthetic:${input.providerKey}:${input.objectKey}`,
            ).objectModule,
          },
        ],
      },
  };
}

describe("AArch64 linker public API", () => {
  test("exports the public contract types and link shell", () => {
    const module: AArch64LinkInputModule = objectModuleForApiTest("module:user:boot");
    const entry: AArch64ImageEntryRequest = { wrelaBootLinkageName: "Boot.main" };
    const syntheticProvider: AArch64SyntheticObjectProvider = syntheticProviderForApiTest({
      providerKey: "entry",
      objectKey: "shim",
    });
    const veneerProvider: AArch64LinkerVeneerProvider = {
      providerKey: "veneer",
      provideVeneer: () => ({
        kind: "error",
        diagnostics: [
          linkerDiagnostic({
            code: "LINKER_INPUT_INVALID",
            ownerKey: "veneer",
            stableDetail: "veneer:not-wired",
          }),
        ],
      }),
    };

    expect(module.moduleKey).toBe("module:user:boot");
    expect(entry.wrelaBootLinkageName).toBe("Boot.main");
    expect(syntheticProvider.providerKey).toBe("entry");
    expect(veneerProvider.providerKey).toBe("veneer");
    expect(typeof linkAArch64Image).toBe("function");
    expect(typeof materializeAArch64SyntheticObjectsForLink).toBe("function");
  });

  test("preflight rejects empty object module lists", () => {
    const result = materializeAArch64SyntheticObjectsForLink({
      objectModules: [],
      target: targetSurfaceForApiTest(),
      entry: { wrelaBootLinkageName: "Boot.main" },
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected empty input error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code as string)).toEqual([
      "LINKER_INPUT_INVALID",
    ]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "linker-input:empty-object-modules",
    ]);
  });

  test("provider errors short-circuit before module validation and return sorted diagnostics", () => {
    const result = materializeAArch64SyntheticObjectsForLink({
      objectModules: [objectModuleForApiTest("module:user:boot")],
      target: targetSurfaceForApiTest(),
      entry: { wrelaBootLinkageName: "Boot.main" },
      syntheticObjects: [
        syntheticProviderForApiTest({
          providerKey: "bad-provider",
          objectKey: "bad-object",
          result: {
            kind: "error",
            diagnostics: [
              linkerDiagnostic({
                code: "LINKER_INPUT_INVALID",
                ownerKey: "provider:z",
                stableDetail: "provider-error:z",
              }),
              linkerDiagnostic({
                code: "LINKER_INPUT_INVALID",
                ownerKey: "provider:a",
                stableDetail: "provider-error:a",
              }),
            ],
          },
        }),
        syntheticProviderForApiTest({
          providerKey: "also-invalid",
          objectKey: "entry",
          moduleKey: "not-a-stable-synthetic-key",
        }),
      ],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected provider error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "provider-error:a",
      "provider-error:z",
    ]);
  });

  test("preflight rejects duplicate provider module keys", () => {
    const bootModule = objectModuleForApiTest("module:user:boot");
    const target = targetSurfaceForApiTest();
    const duplicateSyntheticObject = syntheticProviderForApiTest({
      providerKey: "test",
      objectKey: "entry",
      moduleKey: "module:synthetic:test:entry",
    });

    const result = materializeAArch64SyntheticObjectsForLink({
      objectModules: [bootModule],
      syntheticObjects: [duplicateSyntheticObject, duplicateSyntheticObject],
      target,
      entry: { wrelaBootLinkageName: "Boot.main" },
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected duplicate key error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "linker-input:duplicate-module-key:module:synthetic:test:entry",
    ]);
  });

  test("preflight rejects provider modules without stable synthetic key prefix", () => {
    const result = materializeAArch64SyntheticObjectsForLink({
      objectModules: [objectModuleForApiTest("module:user:boot")],
      target: targetSurfaceForApiTest(),
      entry: { wrelaBootLinkageName: "Boot.main" },
      syntheticObjects: [
        syntheticProviderForApiTest({
          providerKey: "entry",
          objectKey: "shim",
          moduleKey: "module:synthetic:other:shim",
        }),
      ],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected invalid key prefix error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "linker-input:invalid-synthetic-module-key:module:synthetic:other:shim:expected-prefix:module:synthetic:entry:",
    ]);
  });

  test("materializes provider modules with stable module sorting", () => {
    const result = materializeAArch64SyntheticObjectsForLink({
      objectModules: [
        objectModuleForApiTest("module:user:z"),
        objectModuleForApiTest("module:user:a"),
      ],
      target: targetSurfaceForApiTest(),
      entry: { wrelaBootLinkageName: "Boot.main" },
      syntheticObjects: [
        syntheticProviderForApiTest({ providerKey: "runtime", objectKey: "z" }),
        syntheticProviderForApiTest({ providerKey: "entry", objectKey: "a" }),
      ],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected materialized modules");
    expect(result.value.modules.map((module) => module.moduleKey)).toEqual([
      "module:synthetic:entry:a",
      "module:synthetic:runtime:z",
      "module:user:a",
      "module:user:z",
    ]);
    expect(Object.isFrozen(result.value.modules)).toBe(true);
    expect(Object.isFrozen(result.value.modules[0])).toBe(true);
  });

  test("link shell returns deterministic preflight result without producing a layout", () => {
    const result = linkAArch64Image({
      objectModules: [],
      target: targetSurfaceForApiTest(),
      entry: { wrelaBootLinkageName: "Boot.main" },
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected preflight error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "linker-input:empty-object-modules",
    ]);
  });
});
