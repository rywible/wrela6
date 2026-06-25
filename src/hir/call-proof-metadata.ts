import type { CertifiedPlatformBinding } from "../semantic/surface/checked-program";
import { functionId } from "../semantic/ids";
import type {
  CheckedPredicateFactSurface,
  CheckedTerminalSurface,
} from "../semantic/surface/proof-surface";
import type { CheckedPrivateTransitionSurface } from "../semantic/surface/proof-contracts";
import type { CheckedPlatformEnsuredFactSurface } from "../semantic/surface/proof-contracts";
import type { HirCallExpression, HirRequirement } from "./hir";
import type { HirLoweringContext } from "./lowering-context";
import type { HirExpressionId } from "./ids";
import {
  hirOriginId,
  hirTerminalCallId,
  ownedCallSiteRequirementId,
  ownedHirPlatformContractEdgeId,
  ownedId,
  ownedObligationId,
} from "./ids";
import {
  recordPlatformEnsureFacts,
  recordPredicateFact,
  recordPrivateTransition,
} from "./fact-lowerer";

export function composeCallProofMetadata(input: {
  readonly call: HirCallExpression;
  readonly callExpressionId?: HirExpressionId;
  readonly context: HirLoweringContext;
  readonly sourceRequirements: readonly HirRequirement[];
  readonly platformBinding?: CertifiedPlatformBinding;
  readonly platformEnsuredFacts?: readonly CheckedPlatformEnsuredFactSurface[];
  readonly terminalSurface?: CheckedTerminalSurface;
  readonly predicateSurface?: CheckedPredicateFactSurface;
  readonly privateTransitionSurface?: CheckedPrivateTransitionSurface;
}): void {
  if (input.call.recovered === true) return;
  const owner = {
    kind: "function" as const,
    functionId: input.context.ownerFunctionId ?? functionId(0),
  };
  const sourceOrigin = input.call.sourceOrigin ?? hirOriginId(0);
  const callExpressionId = input.callExpressionId ?? input.call.callee.expressionId;
  for (const requirement of input.sourceRequirements) {
    input.context.proofMetadata.addCallSiteRequirement({
      callSiteRequirementId: ownedCallSiteRequirementId(
        owner,
        input.context.proofMetadata.count("callSiteRequirement"),
      ),
      callExpressionId,
      requirement,
      sourceOrigin,
    });
  }

  if (input.platformBinding !== undefined) {
    const edge = {
      edgeId: ownedHirPlatformContractEdgeId(
        owner,
        input.context.proofMetadata.count("platformContractEdge"),
      ),
      sourceFunctionId: input.platformBinding.functionId,
      primitiveId: input.platformBinding.primitiveId,
      contractId: input.platformBinding.contractId,
      targetId: input.platformBinding.targetId,
      certificate: input.platformBinding.certificate,
      sourceRequirementIds: input.sourceRequirements.map(
        (requirement) => requirement.requirementId,
      ),
      callExpressionId,
      callOrigin: input.call.sourceOrigin,
      ensuredFacts: input.platformEnsuredFacts ?? [],
      sourceOrigin,
    };
    input.context.proofMetadata.addPlatformContractEdge(edge);
    recordPlatformEnsureFacts({
      edge,
      ensuredFacts: edge.ensuredFacts,
      context: input.context,
    });
  }

  if (input.terminalSurface !== undefined) {
    const obligationId = ownedObligationId(
      owner.functionId,
      input.context.proofMetadata.count("obligation"),
    );
    input.context.proofMetadata.addObligation({
      obligationId,
      kind: "terminalClosure",
      sourceOrigin,
    });
    input.context.proofMetadata.addTerminalCall({
      terminalCallId: ownedId(
        owner,
        hirTerminalCallId(input.context.proofMetadata.count("terminalCall")),
        "terminalCall",
      ),
      callExpressionId,
      calleeFunctionId: input.terminalSurface.functionId,
      closureObligationId: obligationId,
      sourceOrigin,
    });
  }

  if (input.predicateSurface !== undefined && input.call.calleeFunctionId !== undefined) {
    recordPredicateFact({
      call: input.call,
      predicateFunctionId: input.predicateSurface.functionId,
      context: input.context,
    });
  }

  if (input.privateTransitionSurface !== undefined) {
    recordPrivateTransition({
      call: input.call,
      surface: input.privateTransitionSurface,
      context: input.context,
    });
  }
}
