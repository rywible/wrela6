import { aarch64MachineFunctionForTest } from "../machine-ir/builders";
import {
  aarch64MachineProgramId,
  aarch64SymbolId,
} from "../../../../../src/target/aarch64/machine-ir/ids";
import { aarch64MachineProgram } from "../../../../../src/target/aarch64/machine-ir/machine-program";
import { emptyAArch64ProvenanceMap } from "../../../../../src/target/aarch64/machine-ir/provenance";
import type {
  AArch64ClosedImageBackendPlan,
  AArch64FinalAddressTakenRecord,
  AArch64FinalAddressTakenTable,
  AArch64FinalSymbolVisibilityRecord,
  AArch64FinalSymbolVisibilityTable,
  AArch64ReplacementBoundaryRecord,
  AArch64ReplacementBoundaryTable,
  AArch64PublicBoundaryRecord,
  AArch64PublicBoundaryTable,
  AArch64FinalPrivateConventionRecord,
} from "../../../../../src/target/aarch64/backend/api/closed-image-backend-plan";
import { normalizeAArch64ClosedImageBackendPlan } from "../../../../../src/target/aarch64/backend/api/closed-image-backend-plan";

export function privateConventionForTest(
  input: Partial<AArch64FinalPrivateConventionRecord> = {},
): AArch64FinalPrivateConventionRecord {
  const { caller = "caller", callee = "private.callee", ...rest } = input;
  return {
    caller,
    callee,
    ...rest,
  };
}

export function finalSymbolVisibilityTableForTest(
  records: readonly AArch64FinalSymbolVisibilityRecord[] = [
    { symbol: "private.callee", visibility: "private" },
  ],
): AArch64FinalSymbolVisibilityTable {
  return {
    records: Object.freeze([...records]),
  };
}

export function finalAddressTakenTableForTest(
  records: readonly AArch64FinalAddressTakenRecord[] = [
    { symbol: "private.callee", addressTaken: false },
  ],
): AArch64FinalAddressTakenTable {
  return {
    records: Object.freeze([...records]),
  };
}

export function replacementBoundaryTableForTest(
  records: readonly AArch64ReplacementBoundaryRecord[] = [],
): AArch64ReplacementBoundaryTable {
  return {
    records: Object.freeze([...records]),
  };
}

export function publicBoundaryTableForTest(
  records: readonly AArch64PublicBoundaryRecord[] = [
    { caller: "caller", callee: "private.callee" },
  ],
): AArch64PublicBoundaryTable {
  return {
    records: Object.freeze([...records]),
  };
}

export function closedImageBackendPlanForTest(
  overrides: Partial<AArch64ClosedImageBackendPlan> = {},
): AArch64ClosedImageBackendPlan {
  const normalized = {
    closureKind: "closed-image" as const,
    participatingModules: Object.freeze(["module.a", "module.b"]),
    symbolVisibility: finalSymbolVisibilityTableForTest(),
    addressTaken: finalAddressTakenTableForTest(),
    replacementBoundaries: replacementBoundaryTableForTest(),
    publicAbiBoundaries: publicBoundaryTableForTest(),
    privateConventions: [privateConventionForTest()],
    authorityFingerprint: "placeholder",
    ...overrides,
  };

  return normalizeAArch64ClosedImageBackendPlan(normalized);
}

export function singleFunctionMachineProgramForTest(
  input: {
    readonly targetFingerprint?: string;
    readonly entrySymbol?: string;
  } = {},
): ReturnType<typeof aarch64MachineProgram> {
  return aarch64MachineProgram({
    programId: aarch64MachineProgramId(0),
    functions: [aarch64MachineFunctionForTest()],
    globalSymbols: [],
    entrySymbol: aarch64SymbolId(input.entrySymbol ?? "entry"),
    targetFingerprint: input.targetFingerprint ?? "target:fingerprint",
    consultedSubsurfaceFingerprints: [],
    provenance: emptyAArch64ProvenanceMap(),
  });
}
