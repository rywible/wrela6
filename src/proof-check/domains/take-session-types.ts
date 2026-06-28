import type { ProofCheckLoanTransferResult } from "./loans";
import type { ProofCheckState, ProofCheckStreamMember } from "../kernel/state";

export type TakeSessionOperation =
  | "takeStream"
  | "takeBuffer"
  | "takeValidated"
  | "discharge"
  | "close";

export type TakeSessionTransferResult = ProofCheckLoanTransferResult;

export type TakeCrossedScopeExitKind =
  | "return"
  | "break"
  | "continue"
  | "yield"
  | "attemptError"
  | "validationReject";

export interface TakeSessionTransferInput {
  readonly state: ProofCheckState;
  readonly operation: TakeSessionOperation;
  readonly sessionKey: string;
  readonly obligationKey?: string;
  readonly brandKey?: string;
  readonly producerEdgePathKey?: string;
  readonly bufferPlaceKey?: string;
  readonly validatedPlaceKey?: string;
  readonly member?: ProofCheckStreamMember;
  readonly operationOriginKey?: string;
}

export interface OpenTakeStreamInput {
  readonly state: ProofCheckState;
  readonly sessionKey: string;
  readonly brandKey: string;
  readonly closureObligationKey: string;
  readonly producerEdgePathKey: string;
  readonly operationOriginKey?: string;
}

export interface OpenTakeBufferInput {
  readonly state: ProofCheckState;
  readonly obligationKey: string;
  readonly bufferPlaceKey: string;
  readonly operationOriginKey?: string;
}

export interface OpenTakeValidatedInput {
  readonly state: ProofCheckState;
  readonly sessionKey: string;
  readonly brandKey: string;
  readonly closureObligationKey: string;
  readonly validatedPlaceKey: string;
  readonly operationOriginKey?: string;
}

export interface YieldStreamMemberInput {
  readonly state: ProofCheckState;
  readonly sessionKey: string;
  readonly memberKey: string;
  readonly operationOriginKey?: string;
}

export interface DischargeTakeMemberInput {
  readonly state: ProofCheckState;
  readonly member: ProofCheckStreamMember;
  readonly obligationKey?: string;
  readonly operationOriginKey?: string;
}

export interface DischargeTakeObligationInput {
  readonly state: ProofCheckState;
  readonly obligationKey: string;
  readonly sessionKey?: string;
  readonly operationOriginKey?: string;
}

export interface CloseTakeSessionInput {
  readonly state: ProofCheckState;
  readonly sessionKey: string;
  readonly operationOriginKey?: string;
}

export interface CheckCrossedScopeExitInput {
  readonly state: ProofCheckState;
  readonly exitKind: TakeCrossedScopeExitKind;
  readonly allowedDischargeObligationKeys?: readonly string[];
  readonly allowedCloseSessionKeys?: readonly string[];
  readonly operationOriginKey?: string;
}

export interface CheckValidatedTakePlaceOperationInput {
  readonly state: ProofCheckState;
  readonly placeKey: string;
  readonly operation: "copy" | "store" | "return" | "move";
  readonly hasTransferContract?: boolean;
  readonly operationOriginKey?: string;
}
