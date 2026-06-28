import type { LayoutFactProgram } from "../../../../src/layout/layout-program";
import type { CheckProofAndResourcesInput } from "../../../../src/proof-check/input-contract";
import {
  checkProofAndResources,
  type CheckProofAndResourcesResult,
} from "../../../../src/proof-check/proof-checker";
import { proofCheckResourceLimitsForTest } from "../../../../src/proof-check/kernel/resource-limits";
import type { ProofMirProgram } from "../../../../src/proof-mir/model/program";
import {
  synthesizePlatformContractsForMir,
  synthesizeRuntimeCatalogForMir,
  synthesizeSemanticsCompanionForMir,
  synthesizeTypeFactsForMir,
} from "./authority-synthesis";
import { buildInputForClosedFixtureOptions } from "./fixture-build-input";
import type {
  ProofCheckClosedFixtureOptions,
  ProofCheckInvalidFixtureCase,
  ProofCheckValidFixtureCase,
} from "./fixture-types";
import { buildProofMirProgram, cloneMirProgram } from "./mir-fixture-utils";
import {
  applyInvalidCaseMirMutation,
  withConcurrencyExtensionStatement,
  withEmbeddedRuntimeCatalogFingerprint,
  withTerminalFunction,
} from "./mir-mutations";

function resolveMirForClosedFixture(
  options: ProofCheckClosedFixtureOptions | undefined,
): ProofMirProgram {
  const baseMir = options?.mir ?? buildProofMirProgram(buildInputForClosedFixtureOptions(options));
  let mir = cloneMirProgram(baseMir);
  mir = applyInvalidCaseMirMutation(mir, options?.invalidCase);
  if (options?.validCase === "cross-core-success-transfer") {
    mir = withConcurrencyExtensionStatement(mir);
  }
  if (options?.terminalPlatformBase === true) {
    mir = withTerminalFunction(mir);
  }
  return mir;
}

export function withProofCheckAuthoritiesForTest(input: {
  readonly mir: ProofMirProgram;
  readonly layout?: LayoutFactProgram;
  readonly invalidCase?: ProofCheckInvalidFixtureCase;
  readonly validCase?: ProofCheckValidFixtureCase;
  readonly runtimeCatalogFingerprintName?: string;
  readonly embeddedRuntimeCatalogFingerprintName?: string;
  readonly terminalPlatformBase?: boolean;
}): CheckProofAndResourcesInput {
  const mir = withEmbeddedRuntimeCatalogFingerprint(
    cloneMirProgram(input.mir),
    input.embeddedRuntimeCatalogFingerprintName ?? "runtime",
  );
  const layout = input.layout ?? mir.layout;
  return {
    mir,
    layout,
    limits: proofCheckResourceLimitsForTest(),
    platformContracts: synthesizePlatformContractsForMir(
      mir,
      input.invalidCase,
      input.validCase,
      input.terminalPlatformBase,
    ),
    runtimeCatalog: synthesizeRuntimeCatalogForMir({
      mir,
      invalidCase: input.invalidCase,
      runtimeCatalogFingerprintName: input.runtimeCatalogFingerprintName,
    }),
    typeFacts: synthesizeTypeFactsForMir(mir),
    semantics: synthesizeSemanticsCompanionForMir({
      mir,
      invalidCase: input.invalidCase,
    }),
  };
}

export function proofCheckClosedFixture(
  options?: ProofCheckClosedFixtureOptions,
): CheckProofAndResourcesInput {
  const mir = resolveMirForClosedFixture(options);
  const layout = options?.layout ?? mir.layout;
  return withProofCheckAuthoritiesForTest({
    mir,
    layout,
    ...(options?.invalidCase === undefined ? {} : { invalidCase: options.invalidCase }),
    ...(options?.validCase === undefined ? {} : { validCase: options.validCase }),
    ...(options?.runtimeCatalogFingerprintName === undefined
      ? {}
      : { runtimeCatalogFingerprintName: options.runtimeCatalogFingerprintName }),
    ...(options?.embeddedRuntimeCatalogFingerprintName === undefined
      ? {}
      : { embeddedRuntimeCatalogFingerprintName: options.embeddedRuntimeCatalogFingerprintName }),
    ...(options?.terminalPlatformBase === undefined
      ? {}
      : { terminalPlatformBase: options.terminalPlatformBase }),
  });
}

export function checkProofAndResourcesForTest(
  input: CheckProofAndResourcesInput,
): CheckProofAndResourcesResult {
  return checkProofAndResources(input);
}

export function checkProofAndResourcesForClosedFixture(
  options?: ProofCheckClosedFixtureOptions,
): CheckProofAndResourcesResult {
  return checkProofAndResources(proofCheckClosedFixture(options));
}
