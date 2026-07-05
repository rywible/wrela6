import { checkedTypesEqual, coreCheckedType } from "../semantic/surface/type-model";
import { coreTypeId } from "../semantic/ids";
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
import { hirDiagnostic, hirOwnerKey, requireHirFunctionOwner } from "./lowering-context";

function nextFactId(input: {
  readonly context: HirLoweringContext;
  readonly sourceOrigin: HirOriginId;
  readonly stableDetail: string;
}) {
  const owner = requireHirFunctionOwner(input);
  if (owner === undefined) return undefined;
  return ownedFactOriginId(owner, input.context.proofMetadata.count("factOrigin"));
}

function predicateArgumentsForCall(call: HirCallExpression): readonly HirExpression[] {
  const expressions: HirExpression[] = [];
  if (call.receiver !== undefined) expressions.push(call.receiver);
  for (const argument of call.arguments) expressions.push(argument.expression);
  return Object.freeze(expressions);
}

export function recordEnsureFact(input: {
  readonly candidate: HirEnsureCandidate;
  readonly expression: HirExpression;
  readonly context: HirLoweringContext;
}): HirFactOrigin | undefined {
  if (!checkedTypesEqual(input.expression.type, coreCheckedType(coreTypeId("bool"))))
    return undefined;
  const factOriginId = nextFactId({
    context: input.context,
    sourceOrigin: input.candidate.sourceOrigin,
    stableDetail: "ensure-fact-owner",
  });
  if (factOriginId === undefined) return undefined;
  const fact: HirFactOrigin = {
    factOriginId,
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
}): HirFactOrigin | undefined {
  const sourceOrigin = input.call.sourceOrigin ?? hirOriginId(0);
  const factOriginId = nextFactId({
    context: input.context,
    sourceOrigin,
    stableDetail: "predicate-fact-owner",
  });
  if (factOriginId === undefined) return undefined;
  const argumentExpressions = predicateArgumentsForCall(input.call);
  const fact: HirFactOrigin = {
    factOriginId,
    fact: {
      kind: "predicateCall",
      predicateFunctionId: input.predicateFunctionId,
      ...(argumentExpressions.length > 0 ? { arguments: argumentExpressions } : {}),
      statePlace: input.statePlace,
    },
    sourceOrigin,
  };
  input.context.proofMetadata.addFactOrigin(fact);
  return fact;
}

export function recordPlatformEnsureFacts(input: {
  readonly edge: HirPlatformContractEdge;
  readonly ensuredFacts: readonly CheckedPlatformEnsuredFactSurface[];
  readonly context: HirLoweringContext;
}): readonly HirFactOrigin[] {
  const origins: HirFactOrigin[] = [];
  for (const ensuredFact of input.ensuredFacts) {
    const factOriginId = nextFactId({
      context: input.context,
      sourceOrigin: input.edge.sourceOrigin,
      stableDetail: "platform-ensure-fact-owner",
    });
    if (factOriginId === undefined) continue;
    const fact: HirFactOrigin = {
      factOriginId,
      fact: {
        kind: "platformEnsure",
        edgeId: input.edge.edgeId,
        fact: ensuredFact.fact,
      },
      sourceOrigin: input.edge.sourceOrigin,
    };
    input.context.proofMetadata.addFactOrigin(fact);
    origins.push(fact);
  }
  return origins;
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
        ownerKey: hirOwnerKey(input.context),
        originKey: `origin:${input.sourceOrigin}`,
        stableDetail: "match-refinement",
      }),
    );
    return undefined;
  }
  const factOriginId = nextFactId({
    context: input.context,
    sourceOrigin: input.sourceOrigin,
    stableDetail: "match-refinement-fact-owner",
  });
  if (factOriginId === undefined) return undefined;
  const fact: HirFactOrigin = {
    factOriginId,
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
  const sourceOrigin = input.call.sourceOrigin ?? hirOriginId(0);
  const owner = requireHirFunctionOwner({
    context: input.context,
    sourceOrigin,
    stableDetail: "private-transition-owner",
  });
  if (owner === undefined) return undefined;
  const place = transitionPlaceForCall({ call: input.call, surface: input.surface });
  const key = placeKey(place);
  const transitionOrdinalForPlace =
    input.context.proofMetadata.countPrivateStateTransitionsForPlace(key);
  const transition = {
    transitionId: ownedPrivateStateTransitionId(
      owner,
      input.context.proofMetadata.count("privateStateTransition"),
    ),
    functionId: input.surface.functionId,
    kind: input.surface.kind,
    ...(place !== undefined ? { place } : {}),
    transitionOrdinalForPlace,
    sourceOrigin,
  };
  input.context.proofMetadata.addPrivateStateTransition(transition);
  return transition;
}
