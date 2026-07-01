import { describe, expect, test } from "bun:test";

import { authenticateAArch64BackendTargetSurface } from "../../../../../src/target/aarch64/backend/api/backend-target-surface";
import {
  authenticatedBackendTargetSurfaceForTest,
  fakeBackendSurfaceAuthenticationInput,
  fakeEncodingCatalog,
  fakeRegisterModel,
  fakeRelocationCatalog,
  fakeUnwindCatalog,
} from "../../../../../tests/support/target/aarch64/backend/backend-target-surface-fakes";

describe("AArch64 backend target surface", () => {
  test("authenticates canonical rpi5 source surface and catalogs", () => {
    const result = authenticateAArch64BackendTargetSurface(fakeBackendSurfaceAuthenticationInput());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected backend target surface authentication");
    expect(result.value.securityCatalog.constantTimeInstructions).toEqual(["ccmp", "csel"]);
    expect(result.value.profile.profileId).toBe("wrela-uefi-aarch64-rpi5-v1");
  });

  test("reports missing catalog diagnostics", () => {
    const result = authenticateAArch64BackendTargetSurface(
      fakeBackendSurfaceAuthenticationInput({ registerModel: undefined }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected failed backend target authentication");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "backend-target:missing-catalog:register-model",
    );
  });

  test("rejects mismatched source fingerprint", () => {
    const result = authenticateAArch64BackendTargetSurface(
      fakeBackendSurfaceAuthenticationInput({ sourceSurfaceFingerprint: "mismatch:fingerprint" }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected source fingerprint mismatch");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "backend-target:source-fingerprint-mismatch",
    ]);
  });

  test("rejects rpi5 surfaces that make x18 allocatable", () => {
    const result = authenticateAArch64BackendTargetSurface(
      fakeBackendSurfaceAuthenticationInput({
        registerModel: fakeRegisterModel({ x18Policy: "allocatable" }),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected x18 reservation violation");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "backend-target:register-model:x18-must-be-reserved:wrela-uefi-aarch64-rpi5-v1",
    ]);
  });

  test("rejects duplicate register identities before rebuilding register lookups", () => {
    const result = authenticateAArch64BackendTargetSurface(
      fakeBackendSurfaceAuthenticationInput({
        registerModel: fakeRegisterModel({
          registerRecords: [
            { stableKey: "x0", encodingNumber: 0, aliasSet: "gpr:0", isAllocatable: true },
            { stableKey: "x0", encodingNumber: 31, aliasSet: "zr", isAllocatable: false },
            { stableKey: "x18", encodingNumber: 18, aliasSet: "gpr:18", isAllocatable: false },
          ],
        }),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected duplicate register rejection");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "backend-target:register-model:duplicate-register:x0",
    );
  });

  test("rejects relocation families with no PE/COFF mapping", () => {
    const result = authenticateAArch64BackendTargetSurface(
      fakeBackendSurfaceAuthenticationInput({
        relocationCatalog: fakeRelocationCatalog({
          mappingEntries: [
            {
              internalFamily: "private-only",
              peCoffFamilies: [],
            },
          ],
        }),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected missing PE/COFF mapping");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "backend-target:relocation-mapping-missing-pe-coff-family",
    );
  });

  test("rejects duplicate relocation families before rebuilding relocation lookups", () => {
    const result = authenticateAArch64BackendTargetSurface(
      fakeBackendSurfaceAuthenticationInput({
        relocationCatalog: fakeRelocationCatalog({
          mappingEntries: [
            {
              internalFamily: "branch26",
              peCoffFamilies: ["IMAGE_REL_ARM64_REL32"],
            },
          ],
        }),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected duplicate relocation rejection");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "backend-target:relocation-mapping-duplicate:branch26",
    );
  });

  test("rejects malformed caller-provided encoding catalogs during target authentication", () => {
    const result = authenticateAArch64BackendTargetSurface(
      fakeBackendSurfaceAuthenticationInput({
        encodingCatalog: fakeEncodingCatalog({
          entries: [
            {
              opcode: "malformed-custom",
              stableKey: "enc:malformed-custom",
              family: "custom",
              requiredFeatures: [],
              knownByteFixtureIds: ["missing-fixture"],
              permitsSp: true,
              permitsZr: true,
            },
          ],
        }),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected malformed encoding catalog");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "encoding-catalog:missing-known-byte-fixture:malformed-custom:missing-fixture",
    );
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "encoding-catalog:sp-zr-ambiguous:malformed-custom",
    );
  });

  test("rejects encoding catalogs missing emitted backend opcodes", () => {
    const baseCatalog = fakeEncodingCatalog();
    const result = authenticateAArch64BackendTargetSurface(
      fakeBackendSurfaceAuthenticationInput({
        encodingCatalog: {
          ...baseCatalog,
          entries: baseCatalog.entries.filter((entry) => entry.opcode !== "movz"),
        },
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected missing emitted opcode error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "backend-target:encoding-missing-emitted-opcode:movz",
    );
  });

  test("rejects encoding relocation holes without authenticated relocation mapping", () => {
    const result = authenticateAArch64BackendTargetSurface(
      fakeBackendSurfaceAuthenticationInput({
        encodingCatalog: fakeEncodingCatalog({
          entries: [
            {
              opcode: "custom-unmapped-branch",
              stableKey: "enc:custom-unmapped-branch",
              relocationHole: {
                family: "not-mapped",
                bitRange: [0, 25],
                owner: "enc:custom-unmapped-branch",
              },
            },
          ],
        }),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected unmapped relocation hole family");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "backend-target:encoding-relocation-family-unmapped:custom-unmapped-branch:not-mapped",
    );
  });

  test("rebuilds encoding lookup instead of trusting caller-provided functions", () => {
    const target = authenticatedBackendTargetSurfaceForTest({
      encodingCatalog: fakeEncodingCatalog({
        entryForOpcode: (opcode) => ({
          opcode,
          stableKey: `forged:${opcode}`,
          family: "forged",
          requiredFeatures: [],
          knownByteFixtureIds: [],
          permitsSp: true,
          permitsZr: true,
        }),
      }),
    });

    expect(target.encodingCatalog.entryForOpcode("ret")?.stableKey).toBe("enc:ret");
    expect(target.encodingCatalog.entryForOpcode("forged-only")).toBeUndefined();
  });

  test("rebuilds register, relocation, and unwind lookup callbacks during authentication", () => {
    const target = authenticatedBackendTargetSurfaceForTest({
      registerModel: fakeRegisterModel({
        encodingNumberOf: () => 0,
        canAllocate: () => false,
      }),
      relocationCatalog: fakeRelocationCatalog({
        mappingFor: () => undefined,
      }),
      unwindCatalog: fakeUnwindCatalog({
        templateForFrame: () => undefined,
      }),
    });

    expect(target.registerModel.encodingNumberOf("x9")).toBe(9);
    expect(target.registerModel.canAllocate("x0")).toBe(true);
    expect(target.relocationCatalog.mappingFor("branch26")?.peCoffFamilies).toEqual([
      "IMAGE_REL_ARM64_BRANCH26",
    ]);
    expect(target.unwindCatalog.templateForFrame("prologue")?.stableKey).toBe("unwind:prologue");
  });

  test("requires the fixed PE/COFF relocation mapping set", () => {
    const result = authenticateAArch64BackendTargetSurface(
      fakeBackendSurfaceAuthenticationInput({
        relocationCatalog: fakeRelocationCatalog({
          mappings: Object.freeze([
            {
              internalFamily: "branch26",
              peCoffFamilies: Object.freeze(["IMAGE_REL_ARM64_BRANCH26"]),
            },
            { internalFamily: "addr32", peCoffFamilies: Object.freeze(["IMAGE_REL_ARM64_ADDR32"]) },
          ]),
        }),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected missing relocation mappings");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "backend-target:relocation-mapping-missing:addr32nb",
      "backend-target:relocation-mapping-missing:addr64",
      "backend-target:relocation-mapping-missing:branch14",
      "backend-target:relocation-mapping-missing:branch19",
      "backend-target:relocation-mapping-missing:pagebase-rel21",
      "backend-target:relocation-mapping-missing:pageoffset-12a",
      "backend-target:relocation-mapping-missing:pageoffset-12l",
      "backend-target:relocation-mapping-missing:rel32",
      "backend-target:relocation-mapping-missing:section-relative",
    ]);
  });

  test("normalizes catalog ordering during authentication", () => {
    const baseline = fakeBackendSurfaceAuthenticationInput({
      encodingCatalog: fakeEncodingCatalog({
        entries: [
          { opcode: "z", stableKey: "enc:z" },
          { opcode: "a", stableKey: "enc:a" },
        ],
      }),
    });

    const randomized = fakeBackendSurfaceAuthenticationInput({
      encodingCatalog: fakeEncodingCatalog({
        entries: [
          { opcode: "a", stableKey: "enc:a" },
          { opcode: "z", stableKey: "enc:z" },
        ],
      }),
    });

    const first = authenticatedBackendTargetSurfaceForTest(baseline);
    const second = authenticatedBackendTargetSurfaceForTest(randomized);

    expect(first.backendSurfaceFingerprint).toBe(second.backendSurfaceFingerprint);

    expect(first.encodingCatalog.entries.map((entry) => entry.stableKey)).toEqual(
      first.encodingCatalog.entries.map((entry) => entry.stableKey).sort(),
    );
  });

  test("changes backend fingerprint when normalized encoding entry payload changes", () => {
    const baseline = authenticatedBackendTargetSurfaceForTest({
      encodingCatalog: fakeEncodingCatalog({
        entries: [
          {
            opcode: "custom-payload",
            stableKey: "enc:custom-payload",
            instructionWordPatterns: [{ mask: 0xff800000, value: 0xd2800000, source: "decoder" }],
          },
        ],
      }),
    });
    const changedPayload = authenticatedBackendTargetSurfaceForTest({
      encodingCatalog: fakeEncodingCatalog({
        entries: [
          {
            opcode: "custom-payload",
            stableKey: "enc:custom-payload",
            instructionWordPatterns: [{ mask: 0xff800000, value: 0x92800000, source: "decoder" }],
          },
        ],
      }),
    });

    expect(baseline.encodingCatalog.entries.map((entry) => entry.stableKey)).toEqual(
      changedPayload.encodingCatalog.entries.map((entry) => entry.stableKey),
    );
    expect(baseline.encodingCatalog.fingerprint).not.toBe(
      changedPayload.encodingCatalog.fingerprint,
    );
    expect(baseline.backendSurfaceFingerprint).not.toBe(changedPayload.backendSurfaceFingerprint);
  });

  test("recomputes catalog fingerprints instead of preserving caller-provided fingerprints", () => {
    const target = authenticatedBackendTargetSurfaceForTest({
      registerModel: fakeRegisterModel({ fingerprint: "forged:registers" }),
      relocationCatalog: fakeRelocationCatalog({ fingerprint: "forged:relocations" }),
      unwindCatalog: fakeUnwindCatalog({ fingerprint: "forged:unwind" }),
      encodingCatalog: fakeEncodingCatalog({ fingerprint: "forged:encoding" }),
    });

    expect(target.registerModel.fingerprint).not.toBe("forged:registers");
    expect(target.relocationCatalog.fingerprint).not.toBe("forged:relocations");
    expect(target.unwindCatalog.fingerprint).not.toBe("forged:unwind");
    expect(target.encodingCatalog.fingerprint).not.toBe("forged:encoding");
    expect(target.backendSurfaceFingerprint).toBe(
      authenticatedBackendTargetSurfaceForTest({
        registerModel: fakeRegisterModel({ fingerprint: "different:registers" }),
        relocationCatalog: fakeRelocationCatalog({ fingerprint: "different:relocations" }),
        unwindCatalog: fakeUnwindCatalog({ fingerprint: "different:unwind" }),
        encodingCatalog: fakeEncodingCatalog({ fingerprint: "different:encoding" }),
      }).backendSurfaceFingerprint,
    );
  });

  test("normalizes encoding catalog entries by opcode, not mixed fields", () => {
    const target = authenticatedBackendTargetSurfaceForTest({
      encodingCatalog: fakeEncodingCatalog({
        entries: [
          { opcode: "zz-custom", stableKey: "enc:aa" },
          { opcode: "aa-custom", stableKey: "enc:zz" },
        ],
      }),
    });

    const customEntries = target.encodingCatalog.entries.filter((entry) =>
      entry.opcode.endsWith("-custom"),
    );

    expect(customEntries.map((entry) => entry.opcode)).toEqual(["aa-custom", "zz-custom"]);
  });
});
