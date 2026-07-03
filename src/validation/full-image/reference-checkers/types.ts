import type {
  CompileUefiAArch64ImageTrace,
  UefiAArch64ImageArtifact,
  UefiAArch64TargetMetadata,
} from "../../../target/uefi-aarch64";
import type { CompilerPackageInput } from "../../../target/uefi-aarch64/package-input";
import type { FullImageValidationFixtureSpec } from "../fixture-catalog";
import type {
  FullImageValidationCompileStatus,
  FullImageValidationCheckReport,
  FullImageValidationEvidenceRecord,
} from "../report";
import type { FullImageValidationScenarioKey, FullImageValidationStdlibMode } from "../matrix";

export type FullImageReferenceCheckerKey =
  | "stdlib-source-root-reference"
  | "semantic-platform-reference"
  | "proof-fact-reference"
  | "opt-ir-reference"
  | "aarch64-object-reference"
  | "linked-layout-reference"
  | "pe-coff-reference"
  | "uefi-tcb-golden-reference";

export interface FullImageReferenceCheckerInput {
  readonly caseKey: string;
  readonly scenario: FullImageValidationScenarioKey;
  readonly stdlibMode: FullImageValidationStdlibMode;
  readonly fixtureSpec: FullImageValidationFixtureSpec;
  readonly packageInput: CompilerPackageInput;
  readonly compileStatus: FullImageValidationCompileStatus;
  readonly artifact?: UefiAArch64ImageArtifact;
  readonly trace?: CompileUefiAArch64ImageTrace;
  readonly targetMetadata?: UefiAArch64TargetMetadata;
}

export interface FullImageReferenceChecker {
  readonly checkerKey: FullImageReferenceCheckerKey;
  readonly allowedAuthorities: readonly FullImageValidationEvidenceRecord["authority"][];
  readonly requiredWhenCompilePassed?: boolean;
  readonly run: (
    input: FullImageReferenceCheckerInput,
  ) => readonly FullImageValidationCheckReport[];
}

export interface RunFullImageReferenceCheckersInput {
  readonly input: FullImageReferenceCheckerInput;
  readonly checkers?: readonly FullImageReferenceChecker[];
}
