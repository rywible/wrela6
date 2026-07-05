import type { AttemptId, HirPlatformContractEdgeId, ValidationId } from "../../hir/ids";
import type {
  LayoutFieldKey,
  LayoutImageDeviceKey,
  LayoutTermUnit,
  LayoutTypeKey,
} from "../../layout";
import type {
  MonoCheckedType,
  MonoFunctionSignature,
  MonoInstantiatedProofId,
  MonoLiteralValue,
  MonoLocalId,
  MonoPlaceProjection,
  MonoPlaceRoot,
  MonoResourcePlace,
} from "../../mono/mono-hir";
import type { MonoInstanceId } from "../../mono/ids";
import type { ConcreteResourceKind } from "../../semantic/surface/resource-kind";
import type { FieldId, FunctionId, PlatformPrimitiveId } from "../../semantic/ids";
import type { CallSiteRequirementId } from "../../hir/ids";
import type { ProofMirDeterministicTable } from "../canonicalization/canonical-order";
import type {
  ProofMirBlockId,
  ProofMirCallId,
  ProofMirControlEdgeId,
  ProofMirExitEdgeId,
  ProofMirFactId,
  ProofMirLayoutTermBindingId,
  ProofMirLayoutTermId,
  ProofMirLocalId,
  ProofMirOriginId,
  ProofMirPlaceId,
  ProofMirRuntimeCallId,
  ProofMirRuntimeOperationId,
  ProofMirScopeId,
  ProofMirStatementId,
  ProofMirTerminatorId,
  ProofMirValueId,
} from "../ids";
import type {
  ProofMirConsumedOperand,
  ProofMirObservedOperand,
  ProofMirAttemptAlternative,
  ProofMirAttemptOperand,
  ProofMirCallArgument,
  ProofMirCallReceiver,
  ProofMirProducedOperand,
  ProofMirReturnOperand,
  ProofMirValidationArmBinding,
} from "./operands";
import type {
  ProofMirEdgeEffect,
  ProofMirLoanReference,
  ProofMirObligationReference,
  ProofMirPrivateStateTransitionReference,
  ProofMirResourceBoundarySet,
  ProofMirSessionMemberReference,
  ProofMirStatementExtension,
  ProofMirYieldFrameBoundary,
} from "./effects";

export type {
  ProofMirAttemptAlternative,
  ProofMirAttemptOperand,
  ProofMirCallArgument,
  ProofMirCallReceiver,
  ProofMirConsumedOperand,
  ProofMirObservedOperand,
  ProofMirProducedOperand,
  ProofMirReturnOperand,
  ProofMirValidationArmBinding,
} from "./operands";
export type {
  ProofMirEdgeEffect,
  ProofMirExtensionConstruct,
  ProofMirExtensionGate,
  ProofMirLoanReference,
  ProofMirObligationReference,
  ProofMirPrivateStateGenerationReference,
  ProofMirPrivateStateTransitionReference,
  ProofMirResourceBoundarySet,
  ProofMirSessionMemberReference,
  ProofMirStatementExtension,
  ProofMirStreamLoopExtension,
  ProofMirYieldFrameBoundary,
} from "./effects";

export type ProofMirLayoutReference =
  | { readonly kind: "type"; readonly key: LayoutTypeKey }
  | { readonly kind: "field"; readonly key: LayoutFieldKey }
  | { readonly kind: "validatedBuffer"; readonly instanceId: MonoInstanceId }
  | {
      readonly kind: "validatedBufferField";
      readonly instanceId: MonoInstanceId;
      readonly fieldId: FieldId;
    }
  | { readonly kind: "imageDevice"; readonly key: LayoutImageDeviceKey }
  | {
      readonly kind: "platformAbi";
      readonly edgeId: MonoInstantiatedProofId<HirPlatformContractEdgeId>;
    }
  | { readonly kind: "functionAbi"; readonly functionInstanceId: MonoInstanceId }
  | { readonly kind: "imageEntryAbi"; readonly imageInstanceId: MonoInstanceId };

export interface ProofMirLayoutTermReference {
  readonly termId: ProofMirLayoutTermId;
  readonly path: ProofMirLayoutTermPath;
  readonly unit: LayoutTermUnit;
}

export interface ProofMirLayoutTermPath {
  readonly root: ProofMirLayoutTermRoot;
  readonly childPath: readonly ProofMirLayoutTermChild[];
}

export type ProofMirLayoutTermRoot =
  | { readonly kind: "validatedBufferSourceLength"; readonly instanceId: MonoInstanceId }
  | {
      readonly kind: "validatedBufferFieldTerm";
      readonly instanceId: MonoInstanceId;
      readonly fieldId: FieldId;
      readonly slot: "offset" | "byteLength" | "elementCount" | "end" | "derivedValue";
    }
  | {
      readonly kind: "validatedBufferReadRequirement";
      readonly instanceId: MonoInstanceId;
      readonly fieldId: FieldId;
      readonly requirementIndex: number;
      readonly slot: "end" | "left" | "right" | "expression";
    }
  | {
      readonly kind: "validatedBufferDerivedSource";
      readonly instanceId: MonoInstanceId;
      readonly fieldId: FieldId;
    }
  | {
      readonly kind: "validatedBufferDerivedCase";
      readonly instanceId: MonoInstanceId;
      readonly fieldId: FieldId;
      readonly caseIndex: number;
      readonly slot: "conditionValue" | "result";
    };

export type ProofMirLayoutTermChild = "left" | "right";
export type ProofMirCallTarget =
  | {
      readonly kind: "sourceFunction";
      readonly functionInstanceId: MonoInstanceId;
      readonly abi: ProofMirLayoutReference & { readonly kind: "functionAbi" };
    }
  | {
      readonly kind: "certifiedPlatform";
      readonly edgeId: MonoInstantiatedProofId<HirPlatformContractEdgeId>;
      readonly primitiveId: PlatformPrimitiveId;
      readonly abi: ProofMirLayoutReference & { readonly kind: "platformAbi" };
    }
  | {
      readonly kind: "compilerIntrinsic";
      readonly intrinsicKey: string;
      readonly literalValue: string;
      readonly sourceValueKey: string;
      readonly returnTypeKey: string;
    }
  | {
      readonly kind: "compilerRuntime";
      readonly runtimeId: ProofMirRuntimeOperationId;
      readonly runtimeCallId: ProofMirRuntimeCallId;
    };

export type ProofMirBlockTable = ProofMirDeterministicTable<ProofMirBlockId, ProofMirBlock>;
export type ProofMirControlEdgeTable = ProofMirDeterministicTable<
  ProofMirControlEdgeId,
  ProofMirControlEdge
>;
export type ProofMirValueTable = ProofMirDeterministicTable<ProofMirValueId, ProofMirValue>;
export type ProofMirLocalTable = ProofMirDeterministicTable<ProofMirLocalId, ProofMirLocal>;
export type ProofMirPlaceTable = ProofMirDeterministicTable<ProofMirPlaceId, ProofMirPlace>;
export type ProofMirScopeTable = ProofMirDeterministicTable<ProofMirScopeId, ProofMirScope>;

export interface ProofMirFunction {
  readonly functionInstanceId: MonoInstanceId;
  readonly sourceFunctionId: FunctionId;
  readonly signature: MonoFunctionSignature;
  readonly entryBlockId: ProofMirBlockId;
  readonly blocks: ProofMirBlockTable;
  readonly edges: ProofMirControlEdgeTable;
  readonly values: ProofMirValueTable;
  readonly locals: ProofMirLocalTable;
  readonly places: ProofMirPlaceTable;
  readonly scopes: ProofMirScopeTable;
  readonly exits: readonly ProofMirExitEdge[];
  readonly origin: ProofMirOriginId;
}

export interface ProofMirBlockTarget {
  readonly edgeId: ProofMirControlEdgeId;
  readonly blockId: ProofMirBlockId;
}

export interface ProofMirSwitchCase {
  readonly label: string;
  readonly target: ProofMirBlockTarget;
  readonly origin: ProofMirOriginId;
}

export interface ProofMirStatement {
  readonly statementId: ProofMirStatementId;
  readonly kind: ProofMirStatementKind;
  readonly origin: ProofMirOriginId;
}

export interface ProofMirTerminator {
  readonly terminatorId: ProofMirTerminatorId;
  readonly kind: ProofMirTerminatorKind;
  readonly outgoingEdges: readonly ProofMirControlEdgeId[];
  readonly origin: ProofMirOriginId;
}

export interface ProofMirControlEdge {
  readonly edgeId: ProofMirControlEdgeId;
  readonly fromBlockId: ProofMirBlockId;
  readonly toBlockId?: ProofMirBlockId;
  readonly kind:
    | "normal"
    | "branchTrue"
    | "branchFalse"
    | "switchCase"
    | "validationOk"
    | "validationErr"
    | "attemptSuccess"
    | "attemptError"
    | "scopeBreak"
    | "scopeContinue"
    | "yieldSuspend"
    | "yieldResume"
    | "returnExit"
    | "panicExit";
  readonly arguments: readonly ProofMirValueId[];
  readonly facts: readonly ProofMirFactId[];
  readonly effects: readonly ProofMirEdgeEffect[];
  readonly crossedScopes: readonly ProofMirScopeId[];
  readonly exit?: ProofMirExitEdgeId;
  readonly origin: ProofMirOriginId;
}

export interface ProofMirBlock {
  readonly blockId: ProofMirBlockId;
  readonly scopeId: ProofMirScopeId;
  readonly parameters: readonly ProofMirBlockParameter[];
  readonly statements: readonly ProofMirStatement[];
  readonly terminator: ProofMirTerminator;
  readonly incomingEdges: readonly ProofMirControlEdgeId[];
  readonly stateMerge?: ProofMirBlockStateMerge;
  readonly origin: ProofMirOriginId;
}

export type ProofMirBlockStateMerge = {
  readonly kind: "loopHeader";
  readonly loopScopeId: ProofMirScopeId;
  readonly boundaryResources: ProofMirResourceBoundarySet;
  readonly origin: ProofMirOriginId;
};

export interface ProofMirBlockParameter {
  readonly valueId: ProofMirValueId;
  readonly type: MonoCheckedType;
  readonly parameterKind: ProofMirBlockParameterKind;
  readonly origin: ProofMirOriginId;
}

export type ProofMirBlockParameterKind =
  | { readonly kind: "copyScalar"; readonly resourceKind: ConcreteResourceKind }
  | { readonly kind: "proofFact"; readonly factId?: ProofMirFactId };

export type ProofMirProofOnlyReason =
  | "obligation"
  | "sessionMember"
  | "brand"
  | "validationResult"
  | "validatedPacket"
  | "privateState"
  | "factToken"
  | "zeroSizedCapability";

export interface ProofMirValue {
  readonly valueId: ProofMirValueId;
  readonly type: MonoCheckedType;
  readonly resourceKind: ConcreteResourceKind;
  readonly representation: ProofMirValueRepresentation;
  readonly origin: ProofMirOriginId;
}

export type ProofMirValueRepresentation =
  | { readonly kind: "runtime"; readonly layoutType?: LayoutTypeKey }
  | { readonly kind: "proofOnly"; readonly reason: ProofMirProofOnlyReason }
  | { readonly kind: "fact"; readonly factId: ProofMirFactId }
  | { readonly kind: "never" };

export type ProofMirLocalStorage =
  | { readonly kind: "scalarSsa"; readonly currentValue?: ProofMirValueId }
  | { readonly kind: "placeBacked"; readonly placeId: ProofMirPlaceId };

export interface ProofMirLocal {
  readonly localId: ProofMirLocalId;
  readonly monoLocalId: MonoLocalId;
  readonly storage: ProofMirLocalStorage;
  readonly type: MonoCheckedType;
  readonly resourceKind: ConcreteResourceKind;
  readonly origin: ProofMirOriginId;
}

export interface ProofMirScope {
  readonly scopeId: ProofMirScopeId;
  readonly parentScopeId?: ProofMirScopeId;
  readonly kind:
    | "function"
    | "block"
    | "loop"
    | "matchArm"
    | "validationArm"
    | "attemptArm"
    | "take"
    | "suspendResume";
  readonly ownedLocals: readonly MonoLocalId[];
  readonly openedObligations: readonly ProofMirObligationReference[];
  readonly openedSessionMembers: readonly ProofMirSessionMemberReference[];
  readonly origin: ProofMirOriginId;
}

export interface ProofMirPlace {
  readonly placeId: ProofMirPlaceId;
  readonly monoPlace?: MonoResourcePlace;
  readonly root: ProofMirPlaceRoot;
  readonly projection: readonly ProofMirPlaceProjection[];
  readonly type: MonoCheckedType;
  readonly resourceKind: ConcreteResourceKind;
  readonly layout?: ProofMirPlaceLayout;
  readonly origin: ProofMirOriginId;
}

export type ProofMirPlaceRoot =
  | MonoPlaceRoot
  | { readonly kind: "blockParameter"; readonly valueId: ProofMirValueId }
  | { readonly kind: "runtimeTemporary"; readonly valueId: ProofMirValueId };

export type ProofMirPlaceProjection =
  | MonoPlaceProjection
  | {
      readonly kind: "validatedPacketPayload";
      readonly validationId: MonoInstantiatedProofId<ValidationId>;
    }
  | { readonly kind: "imageDevice"; readonly fieldId: FieldId };

export interface ProofMirPlaceLayout {
  readonly type?: ProofMirLayoutReference & { readonly kind: "type" };
  readonly field?: ProofMirLayoutReference & { readonly kind: "field" };
  readonly imageDevice?: ProofMirLayoutReference;
}

export type ProofMirConsumeReason =
  | "move"
  | "callArgument"
  | "return"
  | "validationOk"
  | "attemptSuccess"
  | "terminalDischarge";

export interface ProofMirValidationStart {
  readonly validationId: MonoInstantiatedProofId<ValidationId>;
  readonly sourcePlace: ProofMirPlaceId;
  readonly pendingResultPlace: ProofMirPlaceId;
  readonly okPacketPlace: ProofMirPlaceId;
  readonly okPayloadPlace?: ProofMirPlaceId;
  readonly errPayloadPlace?: ProofMirPlaceId;
  readonly okPayloadType: MonoCheckedType;
  readonly errPayloadType: MonoCheckedType;
  readonly validatedBufferInstanceId: MonoInstanceId;
  readonly layout: ProofMirLayoutReference & { readonly kind: "validatedBuffer" };
  readonly origin: ProofMirOriginId;
}

export interface ProofMirLayoutTermBinding {
  readonly bindingId: ProofMirLayoutTermBindingId;
  readonly term: ProofMirLayoutTermReference;
  readonly value: ProofMirValueId;
  readonly sourcePlace?: ProofMirPlaceId;
  readonly origin: ProofMirOriginId;
}

export interface ProofMirAttemptStart {
  readonly attemptId: MonoInstantiatedProofId<AttemptId>;
  readonly fallible: ProofMirAttemptOperand;
  readonly alternative?: ProofMirAttemptAlternative;
  readonly pendingResultPlace: ProofMirPlaceId;
  readonly inputPlaces: readonly ProofMirPlaceId[];
  readonly origin: ProofMirOriginId;
}

export interface ProofMirTakeStart {
  readonly operand: ProofMirObservedOperand | ProofMirConsumedOperand;
  readonly obligation: ProofMirObligationReference;
  readonly sessionMember?: ProofMirSessionMemberReference;
  readonly aliasMonoLocalId?: MonoLocalId;
  readonly origin: ProofMirOriginId;
}

export interface ProofMirCall {
  readonly callId: ProofMirCallId;
  readonly target: ProofMirCallTarget;
  readonly receiver?: ProofMirCallReceiver;
  readonly arguments: readonly ProofMirCallArgument[];
  readonly requirements: readonly MonoInstantiatedProofId<CallSiteRequirementId>[];
  readonly result?: ProofMirProducedOperand;
  readonly origin: ProofMirOriginId;
}

export interface ProofMirValidatedBufferRead {
  readonly sourcePlace: ProofMirPlaceId;
  readonly packetPlace?: ProofMirPlaceId;
  readonly validatedBufferInstanceId: MonoInstanceId;
  readonly fieldId: FieldId;
  readonly layoutField: ProofMirLayoutReference & { readonly kind: "validatedBufferField" };
  readonly offsetTerm: ProofMirLayoutTermReference;
  readonly endTerm: ProofMirLayoutTermReference;
  readonly termBindings: readonly ProofMirLayoutTermBindingId[];
  readonly readRequires: readonly ProofMirFactId[];
  readonly result: ProofMirValueId;
  readonly origin: ProofMirOriginId;
}

export interface ProofMirObjectFieldValue {
  readonly fieldId?: FieldId;
  readonly name: string;
  readonly value: ProofMirValueId;
  readonly origin: ProofMirOriginId;
}

export type ProofMirUnaryOperator = "logicalNot" | "numericNegate" | "bitwiseNot";

export type ProofMirBinaryOperator =
  | "add"
  | "subtract"
  | "multiply"
  | "divide"
  | "remainder"
  | "bitwiseAnd"
  | "bitwiseOr"
  | "bitwiseXor"
  | "shiftLeft"
  | "shiftRight";

export type ProofMirComparisonOperator = "eq" | "ne" | "lt" | "le" | "gt" | "ge";

export type ProofMirStatementKind =
  | { readonly kind: "load"; readonly place: ProofMirPlaceId; readonly result: ProofMirValueId }
  | { readonly kind: "store"; readonly place: ProofMirPlaceId; readonly value: ProofMirValueId }
  | {
      readonly kind: "movePlace";
      readonly place: ProofMirPlaceId;
      readonly result?: ProofMirValueId;
    }
  | {
      readonly kind: "consumePlace";
      readonly place: ProofMirPlaceId;
      readonly reason: ProofMirConsumeReason;
    }
  | {
      readonly kind: "borrowPlace";
      readonly place: ProofMirPlaceId;
      readonly loan: ProofMirLoanReference;
    }
  | { readonly kind: "releaseLoan"; readonly loan: ProofMirLoanReference }
  | {
      readonly kind: "literal";
      readonly value: ProofMirValueId;
      readonly literal: MonoLiteralValue;
    }
  | {
      readonly kind: "unary";
      readonly operator: ProofMirUnaryOperator;
      readonly operand: ProofMirValueId;
      readonly result: ProofMirValueId;
    }
  | {
      readonly kind: "binary";
      readonly operator: ProofMirBinaryOperator;
      readonly left: ProofMirValueId;
      readonly right: ProofMirValueId;
      readonly result: ProofMirValueId;
    }
  | {
      readonly kind: "comparison";
      readonly operator: ProofMirComparisonOperator;
      readonly left: ProofMirValueId;
      readonly right: ProofMirValueId;
      readonly result: ProofMirValueId;
    }
  | {
      readonly kind: "constructObject";
      readonly result: ProofMirValueId;
      readonly fields: readonly ProofMirObjectFieldValue[];
    }
  | { readonly kind: "call"; readonly call: ProofMirCall }
  | { readonly kind: "validate"; readonly validation: ProofMirValidationStart }
  | { readonly kind: "attempt"; readonly attempt: ProofMirAttemptStart }
  | { readonly kind: "take"; readonly take: ProofMirTakeStart }
  | { readonly kind: "openSessionMember"; readonly member: ProofMirSessionMemberReference }
  | { readonly kind: "closeSessionMember"; readonly member: ProofMirSessionMemberReference }
  | { readonly kind: "openObligation"; readonly obligation: ProofMirObligationReference }
  | {
      readonly kind: "dischargeObligation";
      readonly obligation: ProofMirObligationReference;
      readonly evidence?: ProofMirFactId;
    }
  | {
      readonly kind: "advancePrivateState";
      readonly transition: ProofMirPrivateStateTransitionReference;
    }
  | { readonly kind: "bindLayoutTerm"; readonly binding: ProofMirLayoutTermBinding }
  | { readonly kind: "recordFactEvidence"; readonly factId: ProofMirFactId }
  | { readonly kind: "requireFact"; readonly factId: ProofMirFactId }
  | { readonly kind: "readValidatedBufferField"; readonly read: ProofMirValidatedBufferRead }
  | { readonly kind: "extension"; readonly extension: ProofMirStatementExtension };

export type ProofMirUnreachableReason = "afterNever" | "emptyMatch" | "unreachableSource";

export interface ProofMirValidationMatch {
  readonly validationId: MonoInstantiatedProofId<ValidationId>;
  readonly okTarget: ProofMirBlockTarget;
  readonly errTarget: ProofMirBlockTarget;
  readonly okBindings: readonly ProofMirValidationArmBinding[];
  readonly errBindings: readonly ProofMirValidationArmBinding[];
  readonly origin: ProofMirOriginId;
}

export interface ProofMirAttemptMatch {
  readonly attemptId: MonoInstantiatedProofId<AttemptId>;
  readonly successTarget: ProofMirBlockTarget;
  readonly errorTarget: ProofMirBlockTarget;
  readonly inputPlaces: readonly ProofMirPlaceId[];
  readonly origin: ProofMirOriginId;
}

export interface ProofMirYieldSuspension {
  readonly payload?: ProofMirReturnOperand;
  readonly suspendEdge: ProofMirControlEdgeId;
  readonly resumeTarget: ProofMirBlockTarget;
  readonly frameBoundary: ProofMirYieldFrameBoundary;
  readonly origin: ProofMirOriginId;
}

export type ProofMirCoreTerminatorKind =
  | { readonly kind: "goto"; readonly target: ProofMirBlockTarget }
  | {
      readonly kind: "branch";
      readonly condition: ProofMirValueId;
      readonly whenTrue: ProofMirBlockTarget;
      readonly whenFalse: ProofMirBlockTarget;
    }
  | {
      readonly kind: "switch";
      readonly scrutinee: ProofMirValueId;
      readonly cases: readonly ProofMirSwitchCase[];
      readonly fallback?: ProofMirBlockTarget;
    }
  | { readonly kind: "matchValidation"; readonly match: ProofMirValidationMatch }
  | { readonly kind: "matchAttempt"; readonly match: ProofMirAttemptMatch }
  | {
      readonly kind: "return";
      readonly value?: ProofMirReturnOperand;
      readonly edgeId: ProofMirControlEdgeId;
      readonly exit: ProofMirExitEdgeId;
    }
  | {
      readonly kind: "panic";
      readonly reason?: ProofMirValueId;
      readonly edgeId: ProofMirControlEdgeId;
      readonly exit: ProofMirExitEdgeId;
    }
  | { readonly kind: "unreachable"; readonly reason: ProofMirUnreachableReason };

export type ProofMirTerminatorKind =
  | ProofMirCoreTerminatorKind
  | {
      readonly gate: "coroutineYield";
      readonly kind: "yield";
      readonly suspension: ProofMirYieldSuspension;
    };

export interface ProofMirExitEdge {
  readonly exitId: ProofMirExitEdgeId;
  readonly fromBlockId: ProofMirBlockId;
  readonly kind:
    | "ordinaryReturn"
    | "terminalReturn"
    | "panic"
    | "scopeBreak"
    | "scopeContinue"
    | "attemptError"
    | "validationReject";
  readonly boundary: ProofMirExitBoundary;
  readonly crossedScopes: readonly ProofMirScopeId[];
  readonly closure: ProofMirExitClosurePolicy;
  readonly origin: ProofMirOriginId;
}

export type ProofMirExitBoundary =
  | { readonly kind: "function"; readonly unwind: "none" | "abortNoUnwind" }
  | { readonly kind: "scope"; readonly targetScopeId: ProofMirScopeId };

export type ProofMirExitClosurePolicy =
  | {
      readonly kind: "functionExit";
      readonly requireNoLiveLoans: true;
      readonly requireNoOpenObligations: true;
      readonly requireNoLiveSessionMembers: true;
      readonly requireNoPendingValidationResults: true;
      readonly terminalReachability: "required" | "notRequired";
    }
  | {
      readonly kind: "scopeExit";
      readonly checkedScopes: readonly ProofMirScopeId[];
      readonly evaluateAfterEdgeEffects: true;
      readonly allowedTransfers: readonly ProofMirEdgeEffect[];
    };
