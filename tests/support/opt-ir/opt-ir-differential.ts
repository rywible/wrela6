import {
  compareOptIrSlices,
  type OptIrDifferentialComparison,
  type OptIrDifferentialInput,
} from "../../../src/opt-ir/differential";

export function compareOptIrSlicesForTest(
  input: OptIrDifferentialInput,
): OptIrDifferentialComparison {
  return compareOptIrSlices(input);
}
