import type { MonoInstanceId } from "../../mono/ids";
import type { ProofMirCallGraphEdge } from "../../proof-mir/model/calls";
import type { ProofMirProgram } from "../../proof-mir/model/program";
import type { ProofCheckDiagnostic } from "../diagnostics";
import type { ProofCheckPlaceResolver } from "../kernel/registry/transition-helpers";
import type { ProofCheckState } from "../kernel/state";
import type { ProofCheckStatePatchEntry } from "../kernel/state-patch";
import type { ProofCheckCertificateId } from "../model/certificates";
import type { ProofCheckBinderSubstitution } from "../model/fact-environment";
import type {
  CheckedCapabilityFlowFact,
  CheckedFactInvalidation,
  CheckedFactKindId,
  CheckedFactPacketEntry,
  CheckedFactSubject,
  CheckedPrivateStateFact,
  CheckedTerminalClosureFact,
} from "../model/fact-packet";
import type { ProofCheckRequirementTerm } from "../model/fact-language";
import type {
  CheckedDivergenceFact,
  CheckedFunctionSummary,
  CheckedSummaryPlaceEffect,
  ProofCheckConcreteResourceKind,
} from "../model/function-summary";

export type CheckedSummaryFactDependencyKind =
  | "receiver"
  | "parameter"
  | "result"
  | "producedCapability"
  | "internalLocal"
  | "pathLocal"
  | "liveLoan"
  | "openObligation"
  | "liveSession"
  | "liveValidation"
  | "liveAttempt"
  | "livePacketSource"
  | "unclosedPrivateState";

export interface CheckedSummaryFactDependency {
  readonly kind: CheckedSummaryFactDependencyKind;
  readonly key?: string;
  readonly index?: number;
}

export interface CheckedSummaryReturnFactCandidate {
  readonly termKey: string;
  readonly dependencies: readonly CheckedSummaryFactDependency[];
}

export interface CheckedFunctionSummaryPlaceEffectInput {
  readonly kind: CheckedSummaryPlaceEffect["kind"];
  readonly placeKey: string;
  readonly borrowMode?: "shared" | "exclusive";
  readonly resourceKind?: ProofCheckConcreteResourceKind;
}

export interface CheckedFunctionSummaryDivergenceInput {
  readonly divergenceKey: string;
  readonly behavior: CheckedDivergenceFact["behavior"];
}

export interface CheckedFunctionSummaryAcceptanceInput {
  readonly exits?: boolean;
  readonly divergence?: boolean;
  readonly terminal?: boolean;
  readonly privateStateEffects?: boolean;
  readonly packetEntries?: boolean;
}

export interface BuildCheckedFunctionSummaryInput {
  readonly functionInstanceId: MonoInstanceId;
  readonly declaredRequirements: readonly ProofCheckRequirementTerm[];
  readonly diagnostics?: readonly ProofCheckDiagnostic[];
  readonly normalReturnExitStates: readonly ProofCheckState[];
  readonly returnFactCandidates: readonly CheckedSummaryReturnFactCandidate[];
  readonly observedInputs?: readonly CheckedFunctionSummaryPlaceEffectInput[];
  readonly consumedInputs?: readonly CheckedFunctionSummaryPlaceEffectInput[];
  readonly mutatedInputs?: readonly CheckedFunctionSummaryPlaceEffectInput[];
  readonly producedPlaces?: readonly CheckedFunctionSummaryPlaceEffectInput[];
  readonly invalidatedFacts?: readonly CheckedFactInvalidation[];
  readonly privateStateEffects?: readonly CheckedPrivateStateFact[];
  readonly producedCapabilities?: readonly CheckedCapabilityFlowFact[];
  readonly terminalEffects?: readonly CheckedTerminalClosureFact[];
  readonly divergence?: readonly CheckedFunctionSummaryDivergenceInput[];
  readonly packetEntries?: readonly CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[];
  readonly acceptance?: CheckedFunctionSummaryAcceptanceInput;
}

export type BuildCheckedFunctionSummaryResult =
  | { readonly kind: "ok"; readonly summary: CheckedFunctionSummary }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofCheckDiagnostic[] };

export type ProofCheckCallSubstitution = ProofCheckBinderSubstitution;

export interface SourceCallOperandBinding {
  readonly placeKey: string;
  readonly resourceKind: ProofCheckConcreteResourceKind;
}

export interface SourceCallOperandBindings {
  readonly receiver?: SourceCallOperandBinding;
  readonly arguments?: readonly SourceCallOperandBinding[];
  readonly result?: SourceCallOperandBinding;
  readonly placeKeys?: ReadonlyMap<string, string>;
}

export interface CheckedSourceCallTransferInput {
  readonly state: ProofCheckState;
  readonly call: ProofMirCallGraphEdge;
  readonly summary: CheckedFunctionSummary | undefined;
  readonly substitution: ProofCheckCallSubstitution;
  readonly requirementTerms: readonly ProofCheckRequirementTerm[];
  readonly callRequirements?: readonly ProofCheckRequirementTerm[];
  readonly returnedFactTerms?: readonly ProofCheckRequirementTerm[];
  readonly activeFactTerms?: readonly ProofCheckRequirementTerm[];
  readonly diagnostics?: readonly ProofCheckDiagnostic[];
  readonly operandBindings?: SourceCallOperandBindings;
  readonly operationOriginKey?: string;
  readonly mir?: ProofMirProgram;
  readonly placeResolver?: ProofCheckPlaceResolver;
}

export type CheckedSourceCallTransferResult =
  | {
      readonly kind: "ok";
      readonly patches: readonly ProofCheckStatePatchEntry[];
      readonly certificates: readonly ProofCheckCertificateId[];
      readonly packetEntries: readonly CheckedFactPacketEntry<
        CheckedFactKindId,
        CheckedFactSubject
      >[];
      readonly doesNotReturnNormally: boolean;
    }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofCheckDiagnostic[] };
