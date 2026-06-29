import type { CheckedMirProgram } from "../../../src/proof-check";
import { checkProofAndResourcesForClosedFixture } from "../proof-check/proof-check-fixtures";

export interface CheckedMirProgramForOptIrTestOptions {
  readonly functionCount?: 1;
}

const SINGLE_FUNCTION_SOURCE = [
  "uefi image Boot:",
  "    fn main() -> Never:",
  "        return",
].join("\n");

export function checkedMirProgramForOptIrTest(
  options: CheckedMirProgramForOptIrTestOptions = {},
): CheckedMirProgram {
  const requestedFunctionCount = options.functionCount ?? 1;
  const result = checkProofAndResourcesForClosedFixture({ source: SINGLE_FUNCTION_SOURCE });

  if (result.kind !== "ok") {
    throw new Error(
      `OptIR checked MIR fixture was rejected: ${result.diagnostics
        .map((diagnostic) => diagnostic.stableDetail)
        .join(",")}`,
    );
  }

  if (result.checked.checkedFunctions.size !== requestedFunctionCount) {
    throw new RangeError(
      `OptIR checked MIR fixture accepted ${result.checked.checkedFunctions.size} function(s), expected ${requestedFunctionCount}.`,
    );
  }

  return result.checked;
}
