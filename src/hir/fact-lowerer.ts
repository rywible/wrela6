import { checkedTypesEqual, coreCheckedType } from "../semantic/surface/type-model";
import { coreTypeId, functionId } from "../semantic/ids";
import type {
  CheckedMatchRefinementSurface,
  CheckedPlatformEnsuredFactSurface,
  CheckedPrivateTransitionSurface,
} from "../semantic/surface/proof-contracts";
import type {
  HirCallExpression,
  HirEnsureCandidate,
  HirExpression,
  HirFactOrigin,
  HirPlatformContractEdge,
  HirResourcePlace,
} from "./hir";
import type { HirLoweringContext } from "./lowering-context";
import { hirOriginId, ownedFactOriginId, ownedPrivateStateTransitionId } from "./ids";
import type { HirExpressionId, HirOriginId } from "./ids";
import { hirDiagnostic } from "./lowering-context";

function nextFactId(context: HirLoweringContext) {
  return ownedFactOriginId(
    { kind: "function", functionId: context.ownerFunctionId ?? functionId(0) },
    context.proofMetadata.count("factOrigin"),
  );
}

export function recordEnsureFact(input: {
  readonly candidate: HirEnsureCandidate;
  readonly expression: HirExpression;
  readonly context: HirLoweringContext;
}): HirFactOrigin | undefined {
  if (!checkedTypesEqual(input.expression.type, coreCheckedType(coreTypeId("bool"))))
    return undefined;
  const fact: HirFactOrigin = {
    factOriginId: nextFactId(input.context),
    fact: { kind: "ensure", expressionId: input.expression.expressionId },
    sourceOrigin: input.candidate.sourceOrigin,
  };
  input.context.proofMetadata.addFactOrigin(fact);
  return fact;
}

export function recordPredicateFact(input: {
  readonly call: HirCallExpression;
  readonly predicateFunctionId: import("../semantic/ids").FunctionId;
  readonly statePlace?: HirResourcePlace;
  readonly context: HirLoweringContext;
}): HirFactOrigin {
  const fact: HirFactOrigin = {
    factOriginId: nextFactId(input.context),
    fact: {
      kind: "predicateCall",
      predicateFunctionId: input.predicateFunctionId,
      statePlace: input.statePlace,
    },
    sourceOrigin: input.call.sourceOrigin ?? hirOriginId(0),
  };
  input.context.proofMetadata.addFactOrigin(fact);
  return fact;
}

export function recordPlatformEnsureFacts(input: {
  readonly edge: HirPlatformContractEdge;
  readonly ensuredFacts: readonly CheckedPlatformEnsuredFactSurface[];
  readonly context: HirLoweringContext;
}): readonly HirFactOrigin[] {
  return input.ensuredFacts.map((ensuredFact) => {
    const fact: HirFactOrigin = {
      factOriginId: nextFactId(input.context),
      fact: {
        kind: "platformEnsure",
        edgeId: input.edge.edgeId,
        fact: ensuredFact.fact,
      },
      sourceOrigin: input.edge.sourceOrigin,
    };
    input.context.proofMetadata.addFactOrigin(fact);
    return fact;
  });
}

export function recordMatchRefinement(input: {
  readonly scrutineeExpressionId: HirExpressionId;
  readonly surface?: CheckedMatchRefinementSurface;
  readonly context: HirLoweringContext;
  readonly sourceOrigin: HirOriginId;
}): HirFactOrigin | undefined {
  if (input.surface === undefined) {
    input.context.diagnostics.report(
      hirDiagnostic({
        code: "HIR_MATCH_REFINEMENT_UNSUPPORTED",
        message: "Match refinement could not be linked to checked semantic refinement data.",
        originId: input.sourceOrigin,
        ownerKey: `function:${input.context.ownerFunctionId ?? 0}`,
        originKey: `origin:${input.sourceOrigin}`,
        stableDetail: "match-refinement",
      }),
    );
    return undefined;
  }
  const fact: HirFactOrigin = {
    factOriginId: nextFactId(input.context),
    fact: {
      kind: "matchRefinement",
      scrutineeExpressionId: input.scrutineeExpressionId,
      variantReferenceKey: input.surface.variantReferenceKey,
      fieldBindingKeys: input.surface.fieldBindingKeys,
    },
    sourceOrigin: input.sourceOrigin,
  };
  input.context.proofMetadata.addFactOrigin(fact);
  return fact;
}

function placeKey(place: HirResourcePlace | undefined): string {
  return place?.canonicalKey ?? "unknown";
}

function transitionPlaceForCall(input: {
  readonly call: HirCallExpression;
  readonly surface: CheckedPrivateTransitionSurface;
}): HirResourcePlace | undefined {
  if (input.surface.receiverParameterId === undefined) {
    return input.call.receiver?.place ?? input.call.arguments[0]?.place;
  }
  return (
    input.call.arguments.find(
      (argument) => argument.parameterId === input.surface.receiverParameterId,
    )?.place ?? input.call.receiver?.place
  );
}

export function recordPrivateTransition(input: {
  readonly call: HirCallExpression;
  readonly surface: CheckedPrivateTransitionSurface;
  readonly context: HirLoweringContext;
}): import("./hir").HirPrivateStateTransition | undefined {
  if (input.surface.kind === "predicate") return undefined;
  const place = transitionPlaceForCall({ call: input.call, surface: input.surface });
  const key = placeKey(place);
  const transitionOrdinalForPlace =
    input.context.proofMetadata.countPrivateStateTransitionsForPlace(key);
  const transition = {
    transitionId: ownedPrivateStateTransitionId(
      { kind: "function", functionId: input.context.ownerFunctionId ?? functionId(0) },
      input.context.proofMetadata.count("privateStateTransition"),
    ),
    functionId: input.surface.functionId,
    kind: input.surface.kind,
    ...(place !== undefined ? { place } : {}),
    transitionOrdinalForPlace,
    sourceOrigin: input.call.sourceOrigin ?? hirOriginId(0),
  };
  input.context.proofMetadata.addPrivateStateTransition(transition);
  return transition;
}
