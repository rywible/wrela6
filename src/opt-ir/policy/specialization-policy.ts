import type { OptIrFunctionId } from "../ids";
import { reservationDecision, type OptIrExpansionBudgetDecision } from "./expansion-budget";
import type { OptIrCodeSizeDelta, OptIrExpansionBudgetLedger } from "./expansion-budget";

export interface OptIrSpecializationCandidateBudget {
  readonly sourceFunctionId: OptIrFunctionId;
  readonly variantKey: string;
  readonly estimatedGrowth: OptIrCodeSizeDelta;
  readonly sccKey?: string;
}

export type OptIrSpecializationBudgetDecision = OptIrExpansionBudgetDecision;

export function reserveSpecializationExpansionBudget(
  ledger: OptIrExpansionBudgetLedger,
  candidate: OptIrSpecializationCandidateBudget,
): OptIrSpecializationBudgetDecision {
  const reservation = ledger.reserve(
    {
      kind: "function",
      functionId: candidate.sourceFunctionId,
      sccKey: candidate.sccKey,
    },
    candidate.estimatedGrowth,
  );
  return reservationDecision(reservation);
}
