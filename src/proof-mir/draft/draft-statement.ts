import type {
  AttemptId,
  BrandId,
  ObligationId,
  PrivateStateTransitionId,
  SessionId,
  ValidationId,
} from "../../hir/ids";
import type { MonoInstanceId } from "../../mono/ids";
import type {
  MonoInstantiatedProofId,
  MonoLiteralValue,
  MonoLocalId,
  MonoCheckedType,
} from "../../mono/mono-hir";
import type { FieldId } from "../../semantic/ids";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import type { ProofMirLayoutReference } from "../model/layout-bindings";
import type { DraftProofMirLayoutTermReference } from "./draft-layout-term-reference";
import type {
  ProofMirBinaryOperator,
  ProofMirComparisonOperator,
  ProofMirConsumeReason,
  ProofMirLayoutTermBinding,
  ProofMirStatementExtension,
  ProofMirUnaryOperator,
} from "../model/graph";

export type DraftProofMirStatementKind =
  | {
      readonly kind: "load";
      readonly placeKey: ProofMirCanonicalKey;
      readonly resultKey: ProofMirCanonicalKey;
    }
  | {
      readonly kind: "store";
      readonly placeKey: ProofMirCanonicalKey;
      readonly valueKey: ProofMirCanonicalKey;
    }
  | {
      readonly kind: "movePlace";
      readonly placeKey: ProofMirCanonicalKey;
      readonly resultKey?: ProofMirCanonicalKey;
    }
  | {
      readonly kind: "consumePlace";
      readonly placeKey: ProofMirCanonicalKey;
      readonly reason: ProofMirConsumeReason;
    }
  | {
      readonly kind: "borrowPlace";
      readonly placeKey: ProofMirCanonicalKey;
      readonly loanKey: ProofMirCanonicalKey;
      readonly mode: "shared" | "exclusive";
      readonly scopeKey: ProofMirCanonicalKey;
      readonly startOriginKey: ProofMirCanonicalKey;
    }
  | {
      readonly kind: "releaseLoan";
      readonly loanKey: ProofMirCanonicalKey;
      readonly endOriginKey?: ProofMirCanonicalKey;
    }
  | {
      readonly kind: "literal";
      readonly valueKey: ProofMirCanonicalKey;
      readonly literal: MonoLiteralValue;
    }
  | {
      readonly kind: "unary";
      readonly operator: ProofMirUnaryOperator;
      readonly operandKey: ProofMirCanonicalKey;
      readonly resultKey: ProofMirCanonicalKey;
    }
  | {
      readonly kind: "binary";
      readonly operator: ProofMirBinaryOperator;
      readonly leftKey: ProofMirCanonicalKey;
      readonly rightKey: ProofMirCanonicalKey;
      readonly resultKey: ProofMirCanonicalKey;
    }
  | {
      readonly kind: "comparison";
      readonly operator: ProofMirComparisonOperator;
      readonly leftKey: ProofMirCanonicalKey;
      readonly rightKey: ProofMirCanonicalKey;
      readonly resultKey: ProofMirCanonicalKey;
    }
  | {
      readonly kind: "constructObject";
      readonly resultKey: ProofMirCanonicalKey;
      readonly fields: readonly DraftProofMirObjectFieldValue[];
    }
  | { readonly kind: "call"; readonly callKey: ProofMirCanonicalKey }
  | { readonly kind: "validate"; readonly validation: DraftProofMirValidationStart }
  | { readonly kind: "attempt"; readonly attempt: DraftProofMirAttemptStart }
  | { readonly kind: "take"; readonly take: DraftProofMirTakeStart }
  | { readonly kind: "openSessionMember"; readonly member: DraftProofMirSessionMemberReference }
  | { readonly kind: "closeSessionMember"; readonly member: DraftProofMirSessionMemberReference }
  | { readonly kind: "openObligation"; readonly obligation: DraftProofMirObligationReference }
  | {
      readonly kind: "dischargeObligation";
      readonly obligation: DraftProofMirObligationReference;
      readonly evidenceFactKey?: ProofMirCanonicalKey;
    }
  | {
      readonly kind: "advancePrivateState";
      readonly transitionId: MonoInstantiatedProofId<PrivateStateTransitionId>;
      readonly originKey: ProofMirCanonicalKey;
    }
  | { readonly kind: "bindLayoutTerm"; readonly binding: DraftProofMirLayoutTermBinding }
  | { readonly kind: "recordFactEvidence"; readonly factKey: ProofMirCanonicalKey }
  | { readonly kind: "requireFact"; readonly factKey: ProofMirCanonicalKey }
  | { readonly kind: "readValidatedBufferField"; readonly read: DraftProofMirValidatedBufferRead }
  | { readonly kind: "extension"; readonly extension: ProofMirStatementExtension };

export interface DraftProofMirObjectFieldValue {
  readonly fieldId?: FieldId;
  readonly name: string;
  readonly valueKey: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
}

export interface DraftProofMirValidationStart {
  readonly validationId: MonoInstantiatedProofId<ValidationId>;
  readonly sourcePlaceKey: ProofMirCanonicalKey;
  readonly pendingResultPlaceKey: ProofMirCanonicalKey;
  readonly okPacketPlaceKey: ProofMirCanonicalKey;
  readonly okPayloadPlaceKey?: ProofMirCanonicalKey;
  readonly errPayloadPlaceKey?: ProofMirCanonicalKey;
  readonly okPayloadType: MonoCheckedType;
  readonly errPayloadType: MonoCheckedType;
  readonly validatedBufferInstanceId: MonoInstanceId;
  readonly layout: ProofMirLayoutReference & { readonly kind: "validatedBuffer" };
  readonly originKey: ProofMirCanonicalKey;
}

export type DraftProofMirAttemptOperand = {
  readonly kind: "observe" | "consume";
  readonly placeKey: ProofMirCanonicalKey;
};

export type DraftProofMirAttemptAlternative = {
  readonly kind: "value";
  readonly placeKey: ProofMirCanonicalKey;
};

export interface DraftProofMirAttemptStart {
  readonly attemptId: MonoInstantiatedProofId<AttemptId>;
  readonly fallible: DraftProofMirAttemptOperand;
  readonly alternative?: DraftProofMirAttemptAlternative;
  readonly pendingResultPlaceKey: ProofMirCanonicalKey;
  readonly inputPlaceKeys: readonly ProofMirCanonicalKey[];
  readonly originKey: ProofMirCanonicalKey;
}

export type DraftProofMirTakeOperand =
  | {
      readonly kind: "observe";
      readonly placeKey: ProofMirCanonicalKey;
      readonly originKey: ProofMirCanonicalKey;
    }
  | {
      readonly kind: "consume";
      readonly placeKey: ProofMirCanonicalKey;
      readonly originKey: ProofMirCanonicalKey;
    };

export interface DraftProofMirTakeStart {
  readonly operand: DraftProofMirTakeOperand;
  readonly obligation: DraftProofMirObligationReference;
  readonly sessionMember?: DraftProofMirSessionMemberReference;
  readonly aliasMonoLocalId?: MonoLocalId;
  readonly originKey: ProofMirCanonicalKey;
}

export interface DraftProofMirSessionMemberReference {
  readonly sessionId: MonoInstantiatedProofId<SessionId>;
  readonly brandId: MonoInstantiatedProofId<BrandId>;
  readonly obligationId?: MonoInstantiatedProofId<ObligationId>;
  readonly placeKey?: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
}

export interface DraftProofMirObligationReference {
  readonly obligationId: MonoInstantiatedProofId<ObligationId>;
  readonly originKey: ProofMirCanonicalKey;
}

export interface DraftProofMirValidatedBufferRead {
  readonly sourcePlaceKey: ProofMirCanonicalKey;
  readonly packetPlaceKey?: ProofMirCanonicalKey;
  readonly validatedBufferInstanceId: MonoInstanceId;
  readonly fieldId: FieldId;
  readonly layoutField: ProofMirLayoutReference & {
    readonly kind: "validatedBufferField";
  };
  readonly offsetTerm: DraftProofMirLayoutTermReference;
  readonly endTerm: DraftProofMirLayoutTermReference;
  readonly termBindingKeys: readonly ProofMirCanonicalKey[];
  readonly readRequiresFactKeys: readonly ProofMirCanonicalKey[];
  readonly resultKey: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
}

export type DraftProofMirLayoutTermBinding = Omit<
  ProofMirLayoutTermBinding,
  "bindingId" | "value" | "sourcePlace" | "origin" | "term"
> & {
  readonly key: ProofMirCanonicalKey;
  readonly term: DraftProofMirLayoutTermReference;
  readonly valueKey: ProofMirCanonicalKey;
  readonly sourcePlaceKey?: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
};

export interface DraftProofMirGraphStatementSnapshot {
  readonly statementKey: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
  readonly kind: DraftProofMirStatementKind;
}
