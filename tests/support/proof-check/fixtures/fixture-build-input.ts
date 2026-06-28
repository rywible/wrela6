import type { TargetSurfaceProofPlaceholder } from "../../../../src/proof-check/authority/platform-contracts";
import {
  closedProofMirFixture,
  proofMirBuildInputForSource,
  type ProofMirBuildInput,
} from "../../proof-mir/proof-mir-build-input";
import {
  platformCallProofMirFixture,
  readTagWorkedExampleFixture,
} from "../../proof-mir/proof-mir-layout-fixtures";
import type { ProofCheckClosedFixtureOptions } from "./fixture-types";

const SOURCE_CALL_SUMMARY_IMPORT_SOURCE = [
  "fn callee() -> Never:",
  "    return",
  "fn caller() -> Never:",
  "    callee()",
  "uefi image Boot:",
  "    fn main() -> Never:",
  "        caller()",
].join("\n");

function sourceCallSummaryImportProofMirBuildInput(): ProofMirBuildInput {
  return proofMirBuildInputForSource(SOURCE_CALL_SUMMARY_IMPORT_SOURCE);
}

export function defaultPlatformPlaceholders(): readonly TargetSurfaceProofPlaceholder[] {
  return [{ kind: "receiver", name: "self" }, { kind: "parameter", index: 0 }, { kind: "result" }];
}

export function defaultTypeFactPlaceholders(): readonly TargetSurfaceProofPlaceholder[] {
  return [{ kind: "layoutTerm", layoutKey: "subject" }];
}

export function buildInputForClosedFixtureOptions(
  options: ProofCheckClosedFixtureOptions | undefined,
): ProofMirBuildInput {
  if (options?.validCase === "validated-buffer-success") {
    return readTagWorkedExampleFixture();
  }
  if (options?.validCase === "packet-rich-accepted-program") {
    return platformCallProofMirFixture();
  }
  if (
    options?.validCase === "source-call-summary-import" ||
    options?.validCase === "cross-core-success-transfer"
  ) {
    if (options.validCase === "source-call-summary-import") {
      return sourceCallSummaryImportProofMirBuildInput();
    }
    return closedProofMirFixture();
  }
  if (options?.terminalPlatformBase === true) {
    return platformCallProofMirFixture();
  }
  if (options?.invalidCase === "missing-platform-precondition") {
    return platformCallProofMirFixture();
  }
  if (options?.invalidCase === "forged-summary-facts") {
    return sourceCallSummaryImportProofMirBuildInput();
  }
  if (
    options?.invalidCase === "ignored-validation-result" ||
    options?.invalidCase === "divergent-validation-split" ||
    options?.invalidCase === "divergent-attempt-split"
  ) {
    if (options.invalidCase === "ignored-validation-result") {
      return readTagWorkedExampleFixture();
    }
    if (options.invalidCase === "divergent-attempt-split") {
      return closedProofMirFixture();
    }
    if (options.invalidCase === "divergent-validation-split") {
      return closedProofMirFixture();
    }
    return closedProofMirFixture();
  }
  if (options?.source !== undefined) {
    return proofMirBuildInputForSource(options.source);
  }
  return closedProofMirFixture();
}
