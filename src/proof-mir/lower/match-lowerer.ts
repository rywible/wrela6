import { type FactOriginId } from "../../hir/ids";
import { instantiatedHirIdKey } from "../../mono/ids";
import type {
  MonoExpressionId,
  MonoInstantiatedProofId,
  MonoMatchArm,
  MonoMatchStatement,
  MonoStatement,
  MonoStatementId,
} from "../../mono/mono-hir";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import {
  proofMirDiagnostic,
  sortProofMirDiagnostics,
  type ProofMirDiagnostic,
} from "../diagnostics";
import {
  type DraftGraphEdgeView,
  type DraftGraphSwitchCase,
  type DraftGraphTerminator,
} from "../draft/draft-graph-builder";
import { originForStatement } from "./lowering-origins";
import { blockHasExitTerminator } from "./control-flow-terminators";
import {
  createLoweringIdAllocator,
  type ProofMirLoweringIdAllocator,
} from "./expression-lowerer-helpers";
import { operandValueKey } from "./lowering-operands";
import type { DraftProofMirFactDependency } from "../draft/draft-fact-operands";
import {
  type ProofMirControlFlowLowerer,
  type ProofMirControlFlowLoweringInput,
  type ProofMirExpressionLowerer,
  type ProofMirLoweringContext,
  type ProofMirLoweringResult,
  type ProofMirStatementLowerer,
  type ProofMirTerminalLowerer,
} from "./lowering-context";
import {
  createProofMirScopePlaceLowerer,
  type ProofMirFunctionScopePlaceLowerer,
} from "./scope-place-lowerer";
import { bindingLocalEdgeEffects, lowerArmStatements } from "./match-arm-lowering";
import {
  armOwnsScope,
  caseLabelFromPattern,
  hasMonoSwitchExhaustivenessEvidence,
  isWildcardPattern,
} from "./match-exhaustiveness";

export interface CreateProofMirMatchLowererInput {
  readonly expression: ProofMirExpressionLowerer & {};
  readonly statement: ProofMirStatementLowerer;
  readonly terminal: ProofMirTerminalLowerer;
  readonly currentBlockRef?: { blockKey?: ProofMirCanonicalKey };
  readonly continuationBlockRef?: { blockKey?: ProofMirCanonicalKey };
}

export interface MatchLoweringEdgeView {
  readonly edgeKey: ProofMirCanonicalKey;
  readonly kind: string;
  readonly factKeys: readonly ProofMirCanonicalKey[];
  readonly fromBlockKey: ProofMirCanonicalKey;
  readonly toBlockKey?: ProofMirCanonicalKey;
  readonly crossedScopeRoles: readonly string[];
}

export interface MatchLoweringArmView {
  readonly blockKey: ProofMirCanonicalKey;
  readonly label: string;
  readonly usesChildScope: boolean;
  readonly scopeRole?: string;
}

function loweringOk<Value>(value: Value): ProofMirLoweringResult<Value> {
  return { kind: "ok", value };
}

function loweringError(diagnostics: readonly ProofMirDiagnostic[]): ProofMirLoweringResult<never> {
  return { kind: "error", diagnostics: sortProofMirDiagnostics([...diagnostics]) };
}

function statementRolePrefix(statementId: MonoStatementId): string {
  return `stmt:${instantiatedHirIdKey(statementId)}`;
}

function matchArmScopeRole(statementId: MonoStatementId, armIndex: number): string {
  return `matchArm:${statementRolePrefix(statementId)}:${armIndex}`;
}

function draftValueDependency(valueKey: ProofMirCanonicalKey): DraftProofMirFactDependency {
  return { kind: "value", valueKey };
}

function resolveArmScopeKey(input: {
  readonly context: ProofMirLoweringContext;
  readonly parentScopeKey: ProofMirCanonicalKey;
  readonly arm: MonoMatchArm;
  readonly armRole: string;
  readonly originKey: ProofMirCanonicalKey;
}): ProofMirCanonicalKey {
  if (!armOwnsScope(input.arm)) {
    return input.parentScopeKey;
  }
  return input.context.graph.createScope({
    role: input.armRole,
    parentScopeKey: input.parentScopeKey,
    origin: input.originKey,
  });
}

function matchRefinementFactKeys(input: {
  readonly context: ProofMirLoweringContext;
  readonly scrutineeExpressionId: MonoExpressionId;
  readonly scrutineeValueKey: ProofMirCanonicalKey;
  readonly caseLabel: string;
  readonly originKey: ProofMirCanonicalKey;
  readonly idAllocator: ProofMirLoweringIdAllocator;
  readonly matchRefinements?: readonly {
    readonly caseLabel: string;
    readonly originId: MonoInstantiatedProofId<FactOriginId>;
  }[];
}): readonly ProofMirCanonicalKey[] {
  const factKeys: ProofMirCanonicalKey[] = [];
  const configured = input.matchRefinements?.find(
    (refinement) => refinement.caseLabel === input.caseLabel,
  );
  if (configured !== undefined) {
    const factKey = input.context.factRecorder.recordMatchRefinementFact({
      role: "evidence",
      originId: configured.originId,
      scrutinee: { kind: "enumCase", label: input.caseLabel },
      caseLabel: input.caseLabel,
      dependsOn: [draftValueDependency(input.scrutineeValueKey)],
      origin: input.originKey,
    });
    if (factKey !== undefined) {
      factKeys.push(factKey);
    }
    return factKeys;
  }

  for (const factOrigin of input.context.program.proofMetadata.factOrigins.entries()) {
    const content = factOrigin.fact ?? factOrigin.content;
    if (content?.kind !== "matchRefinement") {
      continue;
    }
    if (content.scrutineeExpressionId !== input.scrutineeExpressionId) {
      continue;
    }
    if (caseLabelFromPattern(content.variantReferenceKey) !== input.caseLabel) {
      continue;
    }
    const factKey = input.context.factRecorder.recordMatchRefinementFact({
      role: "evidence",
      originId: factOrigin.factOriginId,
      scrutinee: { kind: "enumCase", label: input.caseLabel },
      caseLabel: input.caseLabel,
      dependsOn: [draftValueDependency(input.scrutineeValueKey)],
      origin: input.originKey,
    });
    if (factKey !== undefined) {
      factKeys.push(factKey);
    }
  }
  return factKeys;
}

function wireFallThroughEdge(input: {
  readonly context: ProofMirLoweringContext;
  readonly scopePlaceLowerer: ProofMirFunctionScopePlaceLowerer;
  readonly fromBlockKey: ProofMirCanonicalKey;
  readonly toBlockKey: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
  readonly role: string;
}): ProofMirLoweringResult<ProofMirCanonicalKey> {
  const fromScope = input.context.graph.block(input.fromBlockKey).scopeKey;
  const toScope = input.context.graph.block(input.toBlockKey).scopeKey;
  const edgeKey = input.context.graph.createNormalEdge({
    role: input.role,
    fromBlock: input.fromBlockKey,
    toBlock: input.toBlockKey,
    sourceScope: fromScope,
    targetScope: toScope,
    origin: input.originKey,
    argumentKeys: [],
  });
  const setTerminatorResult = input.context.graph.setTerminator(input.fromBlockKey, {
    kind: "goto",
    target: { edge: edgeKey, block: input.toBlockKey },
    origin: input.originKey,
  });
  if (setTerminatorResult.kind === "error") {
    return setTerminatorResult;
  }
  void input.scopePlaceLowerer;
  return loweringOk(edgeKey);
}

export function lowerMatchStatement(input: {
  readonly context: ProofMirLoweringContext;
  readonly scopePlaceLowerer: ProofMirFunctionScopePlaceLowerer;
  readonly statement: MonoStatement;
  readonly matchStatement: MonoMatchStatement;
  readonly blockKey: ProofMirCanonicalKey;
  readonly expression: ProofMirExpressionLowerer & {};
  readonly statementLowerer: ProofMirStatementLowerer;
  readonly terminalLowerer: ProofMirTerminalLowerer;
  readonly continuationBlockKey: ProofMirCanonicalKey;
  readonly idAllocator: ProofMirLoweringIdAllocator;
  readonly monoExhaustiveOverride?: boolean;
  readonly matchRefinements?: readonly {
    readonly caseLabel: string;
    readonly originId: MonoInstantiatedProofId<FactOriginId>;
  }[];
}): ProofMirLoweringResult<{
  readonly afterBlockKey: ProofMirCanonicalKey;
  readonly switchTerminator: DraftGraphTerminator;
  readonly caseEdges: readonly { readonly label: string; readonly edge: DraftGraphEdgeView }[];
  readonly fallbackEdge?: DraftGraphEdgeView;
  readonly arms: readonly MatchLoweringArmView[];
}> {
  const originKey = originForStatement(input.context, input.statement);
  input.context.graph.addStatement(input.blockKey, {
    origin: originKey,
  });

  if (
    !hasMonoSwitchExhaustivenessEvidence({
      context: input.context,
      matchStatement: input.matchStatement,
      monoExhaustiveOverride: input.monoExhaustiveOverride,
    })
  ) {
    return loweringError([
      proofMirDiagnostic({
        severity: "error",
        code: "PROOF_MIR_MISSING_SWITCH_EXHAUSTIVENESS",
        message: "Proof MIR switch lowering requires mono exhaustiveness evidence.",
        functionInstanceId: input.context.functionInstanceId,
        ownerKey: `function:${String(input.context.functionInstanceId)}`,
        rootCauseKey: "switch-exhaustiveness",
        stableDetail: `cases:${input.matchStatement.arms.map((arm) => arm.patternText).join(",")}`,
        sourceOrigin: input.statement.sourceOrigin,
      }),
    ]);
  }

  const loweredScrutinee = input.expression.lowerExpression({
    context: input.context,
    expression: input.matchStatement.scrutinee,
    blockKey: input.blockKey,
  });
  if (loweredScrutinee.kind === "error") {
    return loweredScrutinee;
  }
  const scrutineeValueKey = operandValueKey(loweredScrutinee.value);
  if (scrutineeValueKey === undefined) {
    return loweringError([
      proofMirDiagnostic({
        severity: "error",
        code: "PROOF_MIR_INVALID_VALUE_RESOURCE_KIND",
        message: "Proof MIR match scrutinee must lower to a value operand.",
        functionInstanceId: input.context.functionInstanceId,
        ownerKey: `function:${String(input.context.functionInstanceId)}`,
        rootCauseKey: "match-scrutinee",
        stableDetail: "missing-value-operand",
        sourceOrigin: input.statement.sourceOrigin,
      }),
    ]);
  }

  const parentScope = input.context.graph.block(input.blockKey).scopeKey;
  let fallbackArm: MonoMatchArm | undefined;
  for (const arm of input.matchStatement.arms) {
    if (isWildcardPattern(arm.patternText)) {
      fallbackArm = arm;
    }
  }

  const armViews: MatchLoweringArmView[] = [];
  const switchCases: DraftGraphSwitchCase[] = [];
  const caseEdges: { readonly label: string; readonly edge: DraftGraphEdgeView }[] = [];
  let fallbackEdge: DraftGraphEdgeView | undefined;
  let fallbackTarget:
    | { readonly edge: ProofMirCanonicalKey; readonly block: ProofMirCanonicalKey }
    | undefined;

  for (const [index, arm] of input.matchStatement.arms.entries()) {
    if (isWildcardPattern(arm.patternText)) {
      continue;
    }
    const armRole = matchArmScopeRole(input.statement.statementId, index);
    const armScope = resolveArmScopeKey({
      context: input.context,
      parentScopeKey: parentScope,
      arm,
      armRole,
      originKey: originKey,
    });
    const armBlockKey = input.context.graph.createBlock({
      role: `match.arm:${caseLabelFromPattern(arm.patternText)}`,
      scope: armScope,
      origin: originKey,
      sourceOrigin: `${input.statement.sourceOrigin}:arm:${index}`,
    });
    armViews.push({
      blockKey: armBlockKey,
      label: caseLabelFromPattern(arm.patternText),
      usesChildScope: armOwnsScope(arm),
      ...(armOwnsScope(arm) ? { scopeRole: armRole } : {}),
    });

    const factKeys = matchRefinementFactKeys({
      context: input.context,
      scrutineeExpressionId: input.matchStatement.scrutinee.expressionId,
      scrutineeValueKey,
      caseLabel: caseLabelFromPattern(arm.patternText),
      originKey,
      idAllocator: input.idAllocator,
      matchRefinements: input.matchRefinements,
    });
    const edgeKey = input.context.graph.createSwitchEdge({
      fromBlock: input.blockKey,
      toBlock: armBlockKey,
      sourceScope: parentScope,
      targetScope: armScope,
      origin: originKey,
      factKeys,
      effects: bindingLocalEdgeEffects({ context: input.context, arm, originKey }),
    });
    const edge = input.context.graph.edge(edgeKey);
    caseEdges.push({ label: caseLabelFromPattern(arm.patternText), edge });
    switchCases.push({
      label: caseLabelFromPattern(arm.patternText),
      target: { edge: edgeKey, block: armBlockKey },
      origin: originKey,
    });

    const loweredArm = lowerArmStatements({
      context: input.context,
      expression: input.expression,
      statementLowerer: input.statementLowerer,
      terminalLowerer: input.terminalLowerer,
      blockKey: armBlockKey,
      statements: arm.body.statements,
      idAllocator: input.idAllocator,
    });
    if (loweredArm.kind === "error") {
      return loweredArm;
    }
    const finalArmBlockKey = loweredArm.value.finalBlockKey;

    if (!blockHasExitTerminator(input.context, finalArmBlockKey)) {
      const wired = wireFallThroughEdge({
        context: input.context,
        scopePlaceLowerer: input.scopePlaceLowerer,
        fromBlockKey: finalArmBlockKey,
        toBlockKey: input.continuationBlockKey,
        originKey,
        role: `match.continuation:${caseLabelFromPattern(arm.patternText)}`,
      });
      if (wired.kind === "error") {
        return wired;
      }
    }
  }

  if (fallbackArm !== undefined) {
    const fallbackIndex = input.matchStatement.arms.indexOf(fallbackArm);
    const armRole = matchArmScopeRole(input.statement.statementId, fallbackIndex);
    const armScope = resolveArmScopeKey({
      context: input.context,
      parentScopeKey: parentScope,
      arm: fallbackArm,
      armRole,
      originKey: originKey,
    });
    const fallbackBlockKey = input.context.graph.createBlock({
      role: "match.fallback",
      scope: armScope,
      origin: originKey,
      sourceOrigin: `${input.statement.sourceOrigin}:fallback`,
    });
    armViews.push({
      blockKey: fallbackBlockKey,
      label: "_",
      usesChildScope: armOwnsScope(fallbackArm),
      ...(armOwnsScope(fallbackArm) ? { scopeRole: armRole } : {}),
    });
    const edgeKey = input.context.graph.createSwitchEdge({
      fromBlock: input.blockKey,
      toBlock: fallbackBlockKey,
      sourceScope: parentScope,
      targetScope: armScope,
      origin: originKey,
    });
    fallbackEdge = input.context.graph.edge(edgeKey);
    fallbackTarget = { edge: edgeKey, block: fallbackBlockKey };

    const loweredFallback = lowerArmStatements({
      context: input.context,
      expression: input.expression,
      statementLowerer: input.statementLowerer,
      terminalLowerer: input.terminalLowerer,
      blockKey: fallbackBlockKey,
      statements: fallbackArm.body.statements,
      idAllocator: input.idAllocator,
    });
    if (loweredFallback.kind === "error") {
      return loweredFallback;
    }
    const finalFallbackBlockKey = loweredFallback.value.finalBlockKey;
    if (!blockHasExitTerminator(input.context, finalFallbackBlockKey)) {
      const wired = wireFallThroughEdge({
        context: input.context,
        scopePlaceLowerer: input.scopePlaceLowerer,
        fromBlockKey: finalFallbackBlockKey,
        toBlockKey: input.continuationBlockKey,
        originKey,
        role: "match.continuation:fallback",
      });
      if (wired.kind === "error") {
        return wired;
      }
    }
  }

  const switchTerminator: DraftGraphTerminator = {
    kind: "switch",
    scrutinee: scrutineeValueKey,
    cases: switchCases,
    ...(fallbackTarget === undefined ? {} : { fallback: fallbackTarget }),
    origin: originKey,
  };
  const setTerminatorResult = input.context.graph.setTerminator(input.blockKey, switchTerminator);
  if (setTerminatorResult.kind === "error") {
    return setTerminatorResult;
  }

  return loweringOk({
    afterBlockKey: input.continuationBlockKey,
    switchTerminator,
    caseEdges,
    ...(fallbackEdge === undefined ? {} : { fallbackEdge }),
    arms: armViews,
  });
}

export function createProofMirMatchLowerer(
  input: CreateProofMirMatchLowererInput,
): ProofMirControlFlowLowerer {
  const idAllocator = createLoweringIdAllocator();
  return {
    lowerControlFlowStatement(
      loweringInput: ProofMirControlFlowLoweringInput,
    ): ProofMirLoweringResult<void> {
      if (loweringInput.statement.kind.kind !== "match") {
        return loweringError([
          proofMirDiagnostic({
            severity: "error",
            code: "PROOF_MIR_UNLOWERABLE_MONO_STATEMENT",
            message: "Proof MIR match lowerer does not handle this mono statement kind.",
            functionInstanceId: loweringInput.context.functionInstanceId,
            ownerKey: `function:${String(loweringInput.context.functionInstanceId)}`,
            rootCauseKey: "mono-statement",
            stableDetail: loweringInput.statement.kind.kind,
            sourceOrigin: loweringInput.statement.sourceOrigin,
          }),
        ]);
      }

      const scopePlaceLowererResult = createProofMirScopePlaceLowerer({
        functionInstanceId: loweringInput.context.functionInstanceId,
        body: {
          statements: [loweringInput.statement],
          sourceOrigin: loweringInput.statement.sourceOrigin,
        },
        originMap: loweringInput.context.originMap,
        effectsResources: loweringInput.context.effects,
      });
      if (scopePlaceLowererResult.kind === "error") {
        return scopePlaceLowererResult;
      }

      const continuationBlockKey =
        input.continuationBlockRef?.blockKey ??
        loweringInput.context.graph.createBlock({
          role: "continuation",
          scope: loweringInput.context.graph.block(loweringInput.blockKey).scopeKey,
          origin: originForStatement(loweringInput.context, loweringInput.statement),
        });
      if (input.continuationBlockRef !== undefined) {
        input.continuationBlockRef.blockKey = continuationBlockKey;
      }

      const lowered = lowerMatchStatement({
        context: loweringInput.context,
        scopePlaceLowerer: scopePlaceLowererResult.value,
        statement: loweringInput.statement,
        matchStatement: loweringInput.statement.kind.statement,
        blockKey: loweringInput.blockKey,
        expression: input.expression,
        statementLowerer: input.statement,
        terminalLowerer: input.terminal,
        continuationBlockKey,
        idAllocator,
      });
      if (lowered.kind === "error") {
        return lowered;
      }

      if (input.currentBlockRef !== undefined) {
        input.currentBlockRef.blockKey = lowered.value.afterBlockKey;
      }
      return loweringOk(undefined);
    },
  };
}
