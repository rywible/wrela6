import type { LayoutFactProgram } from "../../../../src/layout/layout-program";
import type { ProofMirProgram } from "../../../../src/proof-mir/model/program";

export type ProofCheckInvalidFixtureCase =
  | "forged-summary-facts"
  | "live-loan-return"
  | "live-session-member-return"
  | "wrong-session-discharge"
  | "ignored-validation-result"
  | "divergent-validation-split"
  | "divergent-attempt-split"
  | "wrapper-hidden-affine-linear-content"
  | "runtime-catalog-fingerprint-mismatch"
  | "terminal-self-cycle"
  | "terminal-mutual-cycle"
  | "missing-loop-convergence"
  | "unsupported-extension"
  | "missing-cross-core-certificate"
  | "non-core-movable-move-ring-transfer"
  | "missing-platform-precondition";

export type ProofCheckValidFixtureCase =
  | "source-call-summary-import"
  | "cross-core-success-transfer"
  | "validated-buffer-success"
  | "packet-rich-accepted-program";

export interface ProofCheckClosedFixtureOptions {
  readonly source?: string;
  readonly mir?: ProofMirProgram;
  readonly layout?: LayoutFactProgram;
  readonly invalidCase?: ProofCheckInvalidFixtureCase;
  readonly validCase?: ProofCheckValidFixtureCase;
  readonly runtimeCatalogFingerprintName?: string;
  readonly embeddedRuntimeCatalogFingerprintName?: string;
  readonly terminalPlatformBase?: boolean;
}
