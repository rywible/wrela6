import { aarch64PatternId } from "../machine-ir/ids";

export function chooseAArch64BranchShape(input: {
  readonly chainLength: number;
  readonly takenPermille?: number;
  readonly nzcvSerialCost: number;
  readonly ifConversionLegal?: boolean;
}):
  | {
      readonly kind: "predictedBranches";
      readonly reason: string;
      readonly patternId: ReturnType<typeof aarch64PatternId>;
    }
  | {
      readonly kind: "ifConverted";
      readonly reason: string;
      readonly patternId: ReturnType<typeof aarch64PatternId>;
    } {
  if ((input.takenPermille ?? 500) >= 900 && input.chainLength <= input.nzcvSerialCost + 1) {
    return {
      kind: "predictedBranches",
      reason: "hot-predictable-edge",
      patternId: aarch64PatternId("branch.test-and-conditional"),
    };
  }
  if (input.ifConversionLegal === false) {
    return {
      kind: "predictedBranches",
      reason: "missing-probability-or-illegal-if-conversion",
      patternId: aarch64PatternId("branch.test-and-conditional"),
    };
  }
  return {
    kind: "ifConverted",
    reason: "short-unpredictable-diamond",
    patternId: aarch64PatternId("branch.ccmp-csel"),
  };
}

export function chooseAArch64SwitchShape(input: {
  readonly caseCount: number;
  readonly valueSpan: bigint;
  readonly densityPermille?: number;
}): "jumpTable" | "compareTree" | "bitTestTree" | "hotCaseSplit" {
  if ((input.densityPermille ?? 0) >= 750 && input.caseCount >= 4) return "jumpTable";
  if (input.caseCount <= 3) return "compareTree";
  if (input.valueSpan <= 64n) return "bitTestTree";
  return "hotCaseSplit";
}
