import type {
  UefiAArch64SmokeReport,
  UefiAArch64TargetDiagnostic,
  UefiAArch64TargetMetadata,
} from "../../target/uefi-aarch64";
import type { FullImageValidationDiagnostic } from "./diagnostics";
import type { FullImageValidationScenarioKey, FullImageValidationStdlibMode } from "./matrix";

export type FullImageValidationCompileStatus = "passed" | "failed";

export interface FullImageValidationSourceRootReport {
  readonly kind: "project" | "toolchain";
  readonly rootKey: string;
  readonly rootPath: string;
  readonly trustedForAuthority: false;
  readonly moduleCount: number;
}

export interface FullImageValidationStageRunReport {
  readonly verifierKey: string;
  readonly runKey: string;
  readonly status: "passed" | "failed" | "skipped";
  readonly stableDetail?: string;
}

export type FullImageValidationEvidenceAuthority =
  | "final-bytes"
  | "linked-layout"
  | "compiler-trace"
  | "source-package"
  | "golden";

export interface FullImageValidationEvidenceRecord {
  readonly evidenceKey: string;
  readonly authority: FullImageValidationEvidenceAuthority;
  readonly stableDetail: string;
}

export interface FullImageValidationCheckReport {
  readonly checkerKey: string;
  readonly status: "passed" | "failed" | "skipped";
  readonly stableDetail: string;
  readonly inputAuthority: readonly FullImageValidationEvidenceAuthority[];
  readonly evidence: readonly FullImageValidationEvidenceRecord[];
}

export interface FullImageValidationEquivalenceEvidence {
  readonly groupKey: string;
  readonly comparedCases: readonly string[];
  readonly status: "passed" | "failed";
  readonly stableDetail: string;
}

export interface FullImageValidationCaseReport {
  readonly caseKey: string;
  readonly scenario: FullImageValidationScenarioKey;
  readonly stdlibMode: FullImageValidationStdlibMode;
  readonly packageKey: string;
  readonly artifactName?: string;
  readonly compileStatus: FullImageValidationCompileStatus;
  readonly sourceRoots: readonly FullImageValidationSourceRootReport[];
  readonly sourceFileCount: number;
  readonly moduleCount: number;
  readonly targetMetadata?: UefiAArch64TargetMetadata;
  readonly stageRuns: readonly FullImageValidationStageRunReport[];
  readonly binaryChecks: readonly FullImageValidationCheckReport[];
  readonly referenceChecks: readonly FullImageValidationCheckReport[];
  readonly equivalenceEvidence: readonly FullImageValidationEquivalenceEvidence[];
  readonly smoke?: UefiAArch64SmokeReport;
  readonly artifactFingerprint?: string;
  readonly artifactByteLength?: number;
  readonly compilerDiagnostics: readonly UefiAArch64TargetDiagnostic[];
  readonly diagnostics: readonly FullImageValidationDiagnostic[];
}

export interface FullImageValidationReport {
  readonly schema: "wrela.full-image-validation";
  readonly schemaVersion: 1;
  readonly targetKey: "wrela-uefi-aarch64-rpi5-v1";
  readonly status: "passed" | "failed" | "skipped";
  readonly cases: readonly FullImageValidationCaseReport[];
  readonly diagnostics: readonly FullImageValidationDiagnostic[];
}
