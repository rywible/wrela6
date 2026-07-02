import type { AArch64MachineProgram } from "../../machine-ir/machine-program";
import type { AArch64PreservedFactSet } from "../../machine-ir/fact-set";
import type { AArch64ProvenanceMap } from "../../machine-ir/provenance";
import { importAArch64BackendFacts } from "../facts/backend-fact-import";
import { aarch64ObjectModule, type AArch64ObjectModule } from "../object/object-module";
import { runAArch64LayoutEncodeFixedPoint } from "../object/layout-encode-fixed-point";
import { verifyAArch64BackendInputContract } from "../verify/input-contract-verifier";
import { verifyAArch64ObjectModule } from "../verify/encoding-object-verifier";
import type {
  AArch64BackendDebugArtifactRequest,
  AArch64BackendDebugArtifacts,
} from "./backend-debug-artifacts";
import type { AArch64BackendTargetSurface } from "./backend-target-surface";
import {
  verifyAArch64ClosedImageBackendPlan,
  type AArch64ClosedImageBackendPlan,
} from "./closed-image-backend-plan";
import {
  collectAArch64BackendDebugArtifacts,
  failedAArch64BackendVerification,
  passedAArch64BackendVerification,
} from "./compile-verification";
import {
  buildAArch64LayoutFragmentsForProgram,
  type AArch64FunctionBackendArtifact,
} from "./function-pipeline";
import type { AArch64BackendDiagnostic, AArch64BackendDiagnosticMode } from "./diagnostics";
import {
  annotateAArch64ByteProvenance,
  aarch64FactSpendingFromFacts,
  aarch64ObjectSecurityInputFromFacts,
  aarch64ObjectSymbolsForLayout,
  aarch64UnwindRecordsForProgram,
  initialAArch64ObjectSymbolsForProgram,
} from "./object-assembly";
import type { AArch64BackendVerificationSummary } from "./verification-summary";

export { AARCH64_BACKEND_STAGE_KEYS, defaultAArch64BackendPipeline } from "./backend-pipeline";

export interface CompileAArch64ObjectInput {
  readonly machineProgram: AArch64MachineProgram;
  readonly preservedFacts: AArch64PreservedFactSet;
  readonly provenance: AArch64ProvenanceMap;
  readonly target: AArch64BackendTargetSurface;
  readonly closedImagePlan: AArch64ClosedImageBackendPlan;
  readonly diagnosticMode?: AArch64BackendDiagnosticMode;
  readonly debugArtifacts?: AArch64BackendDebugArtifactRequest;
}

export type CompileAArch64ObjectResult =
  | {
      readonly kind: "ok";
      readonly objectModule: AArch64ObjectModule;
      readonly diagnostics: readonly AArch64BackendDiagnostic[];
      readonly verification: AArch64BackendVerificationSummary;
      readonly debugArtifacts?: AArch64BackendDebugArtifacts;
    }
  | {
      readonly kind: "error";
      readonly diagnostics: readonly AArch64BackendDiagnostic[];
      readonly verification: AArch64BackendVerificationSummary;
      readonly debugArtifacts?: AArch64BackendDebugArtifacts;
    };

export function compileAArch64Object(input: CompileAArch64ObjectInput): CompileAArch64ObjectResult {
  const contract = verifyAArch64BackendInputContract(input);
  if (contract.kind === "error") {
    return errorResult(
      input,
      failedAArch64BackendVerification("input-contract", true),
      contract.diagnostics,
    );
  }

  const factImport = importAArch64BackendFacts({ preservedFacts: input.preservedFacts });
  if (factImport.kind === "error") {
    return errorResult(
      input,
      failedAArch64BackendVerification("import-backend-facts"),
      factImport.diagnostics,
    );
  }
  const closedPlan = verifyAArch64ClosedImageBackendPlan({
    plan: input.closedImagePlan,
    machineProgram: input.machineProgram,
    target: input.target,
  });
  if (closedPlan.kind === "error") {
    return errorResult(
      input,
      failedAArch64BackendVerification("verify-closed-image-plan"),
      closedPlan.diagnostics,
      { factIndex: factImport.factIndex },
    );
  }
  const fragmentResult = buildAArch64LayoutFragmentsForProgram(
    input.machineProgram,
    input.closedImagePlan,
    factImport.factIndex,
    input.target,
  );
  if (fragmentResult.kind === "error") {
    return errorResult(
      input,
      failedAArch64BackendVerification(fragmentResult.failedStage),
      fragmentResult.diagnostics,
      { factIndex: factImport.factIndex },
    );
  }

  const layout = runAArch64LayoutEncodeFixedPoint({
    fragments: fragmentResult.fragments,
    encodingCatalog: input.target.encodingCatalog,
    registerModel: input.target.registerModel,
    targetBackendSurfaceFingerprint: input.target.backendSurfaceFingerprint,
    closedImagePlanFingerprint: input.closedImagePlan.authorityFingerprint,
    symbols: initialAArch64ObjectSymbolsForProgram(input.machineProgram),
  });
  if (layout.kind === "error") {
    return errorResult(
      input,
      failedAArch64BackendVerification("layout-and-encode"),
      layout.diagnostics,
      { factIndex: factImport.factIndex },
    );
  }
  const verification = passedAArch64BackendVerification();
  const objectSections = Object.freeze([...layout.value.sections]);
  const objectSymbols = aarch64ObjectSymbolsForLayout(
    objectSections,
    layout.value.symbols,
    input.machineProgram,
    input.closedImagePlan,
    layout.value.objectRelocations,
  );
  const objectModule = aarch64ObjectModule({
    targetBackendSurfaceFingerprint: input.target.backendSurfaceFingerprint,
    closedImagePlanFingerprint: input.closedImagePlan.authorityFingerprint,
    sections: objectSections,
    symbols: objectSymbols,
    relocations: layout.value.objectRelocations,
    literalPools: layout.value.literalPools,
    veneers: layout.value.veneers,
    unwindRecords: aarch64UnwindRecordsForProgram(
      input.machineProgram,
      fragmentResult.functionArtifacts,
    ),
    byteProvenance: annotateAArch64ByteProvenance(
      layout.value.byteProvenance,
      factImport.factIndex,
    ),
    factSpending: aarch64FactSpendingFromFacts(factImport.factIndex),
    verification,
  });
  const objectVerification = verifyAArch64ObjectModule({
    objectModule,
    target: input.target,
    security: aarch64ObjectSecurityInputFromFacts(
      factImport.factIndex,
      fragmentResult.functionArtifacts,
      input.target.securityCatalog,
    ),
  });
  if (objectVerification.kind === "error") {
    const failed = failedAArch64BackendVerification("verify-object-module");
    return errorResult(input, failed, objectVerification.diagnostics, {
      factIndex: factImport.factIndex,
      objectModule,
    });
  }
  const debugContext = {
    factIndex: factImport.factIndex,
    objectModule,
    layoutTrace: layout.value.branchDecisions.map(
      (decision) => `${decision.siteKey}:${decision.state}`,
    ),
    allocationPlan: fragmentResult.functionArtifacts.flatMap((artifact) =>
      artifact.allocationPlan.map((entry) => `${artifact.functionKey}:${entry}`),
    ),
    framePlan: framePlanArtifacts(fragmentResult.functionArtifacts),
  } satisfies DebugArtifactContext;
  return {
    kind: "ok",
    objectModule,
    diagnostics: [],
    verification,
    debugArtifacts: debugArtifactsFor(input, verification, debugContext),
  };
}

type DebugArtifactContext = Parameters<typeof collectAArch64BackendDebugArtifacts>[2];

function errorResult(
  input: CompileAArch64ObjectInput,
  verification: AArch64BackendVerificationSummary,
  diagnostics: readonly AArch64BackendDiagnostic[],
  context?: DebugArtifactContext,
): CompileAArch64ObjectResult {
  return {
    kind: "error",
    diagnostics,
    verification,
    debugArtifacts: debugArtifactsFor(input, verification, context),
  };
}

function debugArtifactsFor(
  input: CompileAArch64ObjectInput,
  verification: AArch64BackendVerificationSummary,
  context?: DebugArtifactContext,
): AArch64BackendDebugArtifacts | undefined {
  return collectAArch64BackendDebugArtifacts(
    input.debugArtifacts,
    verification.runs.map((run) => run.verifierKey),
    context,
  );
}

function framePlanArtifacts(
  artifacts: readonly AArch64FunctionBackendArtifact[],
): readonly string[] {
  return Object.freeze(
    artifacts.map(
      (artifact) =>
        `${artifact.functionKey}:${artifact.frameShape}:size:${artifact.frameSizeBytes}${frameWipeSummary(
          artifact.wipeSlotKeys,
        )}`,
    ),
  );
}

function frameWipeSummary(wipeSlotKeys: readonly string[]): string {
  return wipeSlotKeys.length === 0 ? "" : `:wipe:${wipeSlotKeys.join(",")}`;
}
