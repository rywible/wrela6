import { readdirSync, readFileSync, statSync } from "node:fs";
import {
  canonicalUefiAArch64FirmwareAbiSurface,
  canonicalUefiAArch64FirmwareTableSurface,
  canonicalUefiAArch64PlatformLowerings,
  canonicalUefiAArch64RuntimeMaterializations,
  canonicalUefiAArch64SemanticTargetSurface,
  canonicalUefiAArch64StatusPolicy,
  canonicalUefiAArch64TargetDriverSurfaceInput,
  fingerprintUefiAArch64FirmwareAbi,
  fingerprintUefiAArch64FirmwareTables,
  fingerprintUefiAArch64ProofMirRuntimeCatalog,
  fingerprintUefiAArch64StatusPolicy,
  fingerprintUefiPlatformPrimitiveSpec,
  fingerprintUefiSemanticPlatformCatalog,
  compilerPackageInput,
  type CompilerPackageInput,
  type FixtureProjectFilesystem,
  type UefiAArch64TargetDriverSurfaceInput,
  type UefiAArch64TargetResult,
} from "../../../../src/target/uefi-aarch64";
import { proofMirRuntimeCatalogWithUefiOperations } from "../../proof-mir/proof-mir-fakes";

export function uefiTargetSurfaceFixture(
  overrides: Partial<UefiAArch64TargetDriverSurfaceInput> = {},
): UefiAArch64TargetDriverSurfaceInput {
  const semanticTarget = canonicalUefiAArch64SemanticTargetSurface();
  const runtimeCatalog = proofMirRuntimeCatalogWithUefiOperations();
  const firmwareAbi = canonicalUefiAArch64FirmwareAbiSurface();
  const firmwareTables = canonicalUefiAArch64FirmwareTableSurface();
  const statusPolicy = canonicalUefiAArch64StatusPolicy();
  const platformLowerings = canonicalUefiAArch64PlatformLowerings(semanticTarget);
  const runtimeMaterializations = canonicalUefiAArch64RuntimeMaterializations(runtimeCatalog);

  return canonicalUefiAArch64TargetDriverSurfaceInput({
    firmwareAbi,
    firmwareTables,
    statusPolicy,
    semanticTarget,
    semanticPlatformCatalogFingerprint: fingerprintUefiSemanticPlatformCatalog(semanticTarget),
    proofMirRuntimeCatalog: runtimeCatalog,
    proofMirRuntimeCatalogFingerprint: fingerprintUefiAArch64ProofMirRuntimeCatalog(runtimeCatalog),
    firmwareAbiFingerprint: fingerprintUefiAArch64FirmwareAbi(firmwareAbi),
    firmwareTablesFingerprint: fingerprintUefiAArch64FirmwareTables(firmwareTables),
    statusPolicyFingerprint: fingerprintUefiAArch64StatusPolicy(statusPolicy),
    platformLowerings,
    runtimeMaterializations,
    componentFingerprints: {
      semanticPrimitives: platformLowerings.map((lowering) => ({
        componentKey: String(lowering.primitiveId),
        fingerprint: lowering.semanticPrimitiveFingerprint,
      })),
      runtimeOperations: runtimeMaterializations.map((materialization) => ({
        componentKey: String(materialization.runtimeId),
        fingerprint: materialization.runtimeOperationFingerprint,
      })),
      firmwareCalls: platformLowerings
        .filter((lowering) => lowering.lowering.kind === "firmware-call")
        .map((lowering) => ({
          componentKey: String(lowering.primitiveId),
          fingerprint: fingerprintUefiPlatformPrimitiveSpec(
            semanticTarget.platformPrimitives.get(lowering.primitiveId)!,
          ),
        })),
    },
    ...overrides,
  });
}

export function uefiCompilePackageInputFixture(
  variant: "success" = "success",
): UefiAArch64TargetResult<CompilerPackageInput> {
  switch (variant) {
    case "success":
      return compilerPackageInput({
        packageKey: "smoke-basic",
        entryModuleName: "image",
        sourceRoots: [
          { kind: "project", rootKey: "project", rootPath: "src", trustedForAuthority: false },
        ],
        sourceFiles: [
          {
            sourceKey: "src/image.wr",
            moduleName: "image",
            text: "module image\n",
          },
        ],
      });
  }
}

export const nodeFixtureProjectFilesystem: FixtureProjectFilesystem = Object.freeze({
  readDirectory: (path: string) => readdirSync(path),
  isDirectory: (path: string) => statSync(path).isDirectory(),
  readTextFile: (path: string) => readFileSync(path, "utf8"),
});
