import type { MonoCheckedType, MonoExpressionId, MonoLocalId } from "../../mono/mono-hir";
import type { ParameterId } from "../../semantic/ids";
import type { ProofMirOriginId, ProofMirPlaceId, ProofMirValueId } from "../ids";

export type ProofMirValueOperand = {
  readonly kind: "value";
  readonly value: ProofMirValueId;
};

export type ProofMirPlaceOperand = {
  readonly kind: "place";
  readonly place: ProofMirPlaceId;
};

export type ProofMirValueAndPlaceOperand = {
  readonly kind: "valueAndPlace";
  readonly value: ProofMirValueId;
  readonly place: ProofMirPlaceId;
};

export type ProofMirOperand =
  | ProofMirValueOperand
  | ProofMirPlaceOperand
  | ProofMirValueAndPlaceOperand;

export type ProofMirObservedOperand = ProofMirOperand;

export type ProofMirConsumedOperand = ProofMirPlaceOperand | ProofMirValueAndPlaceOperand;

export type ProofMirProducedOperand = ProofMirOperand;

export type ProofMirReturnOperand =
  | { readonly mode: "observe"; readonly operand: ProofMirObservedOperand }
  | { readonly mode: "consume"; readonly operand: ProofMirConsumedOperand };

export interface ProofMirAttemptOperand {
  readonly expressionId: MonoExpressionId;
  readonly result?: ProofMirProducedOperand;
  readonly origin: ProofMirOriginId;
}

export interface ProofMirAttemptAlternative {
  readonly expressionId: MonoExpressionId;
  readonly result?: ProofMirProducedOperand;
  readonly origin: ProofMirOriginId;
}

export type ProofMirCallReceiver =
  | {
      readonly mode: "observe";
      readonly operand: ProofMirObservedOperand;
      readonly origin: ProofMirOriginId;
    }
  | {
      readonly mode: "consume";
      readonly operand: ProofMirConsumedOperand;
      readonly origin: ProofMirOriginId;
    };

export type ProofMirCallArgument =
  | {
      readonly parameterId?: ParameterId;
      readonly mode: "observe";
      readonly operand: ProofMirObservedOperand;
      readonly origin: ProofMirOriginId;
    }
  | {
      readonly parameterId?: ParameterId;
      readonly mode: "consume";
      readonly operand: ProofMirConsumedOperand;
      readonly origin: ProofMirOriginId;
    };

export interface ProofMirValidationArmBinding {
  readonly monoLocalId?: MonoLocalId;
  readonly bindingKind: "packet" | "payload" | "error";
  readonly operand: ProofMirProducedOperand;
  readonly type: MonoCheckedType;
  readonly origin: ProofMirOriginId;
}
