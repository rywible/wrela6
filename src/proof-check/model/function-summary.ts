import type { MonoInstanceId } from "../../mono/ids";
import type { CheckedFunctionSummaryCertificateId } from "./certificates";
import type {
  CheckedCapabilityFlowFact,
  CheckedFactInvalidation,
  CheckedPrivateStateFact,
  CheckedTerminalClosureFact,
} from "./fact-packet";

import type { ProofCheckPlaceBinder, ProofCheckValueBinder } from "./fact-language";
import type { ProofCheckConcreteResourceKind } from "./resource-kind";

export type { ProofCheckConcreteResourceKind, ProofCheckPlaceBinder, ProofCheckValueBinder };

export interface CheckedRequirementFact {
  readonly termKey: string;
}

export interface CheckedSummaryFact {
  readonly termKey: string;
}

export interface CheckedDivergenceFact {
  readonly divergenceKey: string;
  readonly behavior: "mayDiverge" | "mustDiverge";
}

export type CheckedSummaryPlaceEffect =
  | {
      readonly kind: "observes";
      readonly place: ProofCheckPlaceBinder;
      readonly borrowMode?: "shared" | "exclusive";
    }
  | { readonly kind: "consumes"; readonly place: ProofCheckPlaceBinder }
  | {
      readonly kind: "mutates";
      readonly place: ProofCheckPlaceBinder;
      readonly invalidates: readonly CheckedFactInvalidation[];
    }
  | {
      readonly kind: "produces";
      readonly place: ProofCheckPlaceBinder;
      readonly resourceKind: ProofCheckConcreteResourceKind;
    }
  | {
      readonly kind: "returns";
      readonly value: ProofCheckValueBinder;
      readonly resourceKind: ProofCheckConcreteResourceKind;
    };

export interface CheckedFunctionSummary {
  readonly functionInstanceId: MonoInstanceId;
  readonly requiredFacts: readonly CheckedRequirementFact[];
  readonly observedInputs: readonly CheckedSummaryPlaceEffect[];
  readonly consumedInputs: readonly CheckedSummaryPlaceEffect[];
  readonly mutatedInputs: readonly CheckedSummaryPlaceEffect[];
  readonly producedPlaces: readonly CheckedSummaryPlaceEffect[];
  readonly returnedFacts: readonly CheckedSummaryFact[];
  readonly invalidatedFacts: readonly CheckedFactInvalidation[];
  readonly privateStateEffects: readonly CheckedPrivateStateFact[];
  readonly producedCapabilities: readonly CheckedCapabilityFlowFact[];
  readonly terminalEffects: readonly CheckedTerminalClosureFact[];
  readonly divergence: readonly CheckedDivergenceFact[];
  readonly certificateId: CheckedFunctionSummaryCertificateId;
}

export type CheckedFunctionSummaryTable = ReadonlyMap<MonoInstanceId, CheckedFunctionSummary>;
