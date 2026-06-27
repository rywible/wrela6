import type { TypedHirProgram } from "../hir/hir";
import {
  type HirExpressionId,
  type HirLocalId,
  type HirRequirementId,
  type HirStatementId,
} from "../hir/ids";
import type { FunctionId, ImageId, TypeId } from "../semantic/ids";
import { walkMonoBlock } from "./body-walker";
import { monoDiagnostic, type MonoDiagnostic } from "./diagnostics";
import { createConcretizationContext, type MonoFunctionRemap } from "./function-instantiator-shell";
import { cloneBlock } from "./function-statement-cloner";
import { instantiatedHirIdKey, type MonoInstanceId } from "./ids";
import {
  type MonoBlock,
  type MonoBodyIndex,
  type MonoCheckedType,
  type MonoExpression,
  type MonoExpressionId,
  type MonoFunctionInstance,
  type MonoInstantiatedProofId,
  type MonoLocalId,
  type MonoProofExpressionId,
  type MonoStatement,
  type MonoStatementId,
} from "./mono-hir";
import { type MonoSubstitution } from "./substitution";
export interface MonoOutgoingEdge {
  readonly source: { readonly kind: "function"; readonly functionId: MonoInstanceId };
  readonly targetKind: "function" | "type" | "platform";
  readonly targetKey: string;
  readonly sourceOrigin: string;
  readonly callExpressionId?: MonoExpressionId;
  readonly targetFunctionId?: FunctionId;
  readonly targetOwnerTypeId?: TypeId;
  readonly targetOwnerTypeArguments?: readonly MonoCheckedType[];
  readonly targetFunctionTypeArguments?: readonly MonoCheckedType[];
}

export interface InstantiateMonoFunctionBodyInput {
  readonly program: TypedHirProgram;
  readonly instance: MonoFunctionInstance;
  readonly substitution: MonoSubstitution;
  readonly remap: MonoFunctionRemap;
  readonly source: { readonly kind: "image"; readonly imageId: ImageId };
}

export type InstantiateMonoFunctionBodyResult =
  | {
      readonly kind: "ok";
      readonly body: MonoBlock;
      readonly bodyIndex: MonoBodyIndex;
      readonly remap: MonoFunctionRemap;
      readonly outgoingEdges: readonly MonoOutgoingEdge[];
    }
  | { readonly kind: "error"; readonly diagnostics: readonly MonoDiagnostic[] };

export function instantiateMonoFunctionBody(
  input: InstantiateMonoFunctionBodyInput,
): InstantiateMonoFunctionBodyResult {
  return instantiateMonoFunctionBodyInternal(input);
}

function instantiateMonoFunctionBodyInternal(
  input: InstantiateMonoFunctionBodyInput,
): InstantiateMonoFunctionBodyResult {
  const sourceFunction = input.program.functions.get(input.instance.sourceFunctionId);
  if (sourceFunction === undefined) {
    return {
      kind: "error",
      diagnostics: [
        monoDiagnostic({
          severity: "error",
          code: "MONO_MISSING_REACHABLE_FUNCTION",
          message: "Source function is missing from the program during body cloning.",
          ownerKey: `function:${input.instance.sourceFunctionId}`,
          rootCauseKey: "source-function",
          stableDetail: `missing:${input.instance.sourceFunctionId}`,
          sourceOrigin: input.instance.sourceOrigin,
        }),
      ],
    };
  }
  if (sourceFunction.body === undefined) {
    const mutableRemap = mutableRemapFrom(input.remap);
    return {
      kind: "ok",
      body: { statements: [], sourceOrigin: String(input.instance.sourceOrigin) },
      bodyIndex: rebuildMonoBodyIndex({ statements: [], expressions: [] }),
      remap: immutableRemapFrom(mutableRemap),
      outgoingEdges: [],
    };
  }

  const outgoingEdges: MonoOutgoingEdge[] = [];
  const diagnostics: MonoDiagnostic[] = [];
  const context = createConcretizationContext({
    program: input.program,
    substitution: input.substitution,
    canonicalInstanceKey: String(input.instance.instanceId),
    source: input.source,
  });
  const mutableRemap = mutableRemapFrom(input.remap);

  const cloned = cloneBlock({
    source: sourceFunction.body,
    instance: input.instance,
    substitution: input.substitution,
    remap: mutableRemap,
    program: input.program,
    context,
    outgoingEdges,
    diagnostics,
  });
  if (cloned.kind === "error") {
    if (diagnostics.length === 0) {
      diagnostics.push(
        monoDiagnostic({
          severity: "error",
          code: "MONO_REACHABLE_HIR_RECOVERY",
          message: "Function body cloning failed without a more specific closure diagnostic.",
          ownerKey: `function:${input.instance.sourceFunctionId}`,
          rootCauseKey: "hir-recovery",
          stableDetail: `silent-clone-error:${input.instance.sourceFunctionId}`,
          sourceOrigin: String(input.instance.sourceOrigin),
        }),
      );
    }
    return { kind: "error", diagnostics };
  }
  if (diagnostics.length > 0) {
    return { kind: "error", diagnostics };
  }
  const bodyIndex = rebuildMonoBodyIndex(collectBodyIndexEntries(cloned.block));
  return {
    kind: "ok",
    body: cloned.block,
    bodyIndex,
    remap: immutableRemapFrom(mutableRemap),
    outgoingEdges,
  };
}

export type MutableMonoFunctionRemap = ReturnType<typeof mutableRemapFrom>;

export function mutableRemapFrom(remap: MonoFunctionRemap): {
  readonly instanceId: MonoInstanceId;
  readonly localRemap: Map<HirLocalId, MonoLocalId>;
  readonly expressionRemap: Map<HirExpressionId, MonoExpressionId>;
  readonly statementRemap: Map<HirStatementId, MonoStatementId>;
  readonly requirementIdRemap: Map<HirRequirementId, MonoInstantiatedProofId<HirRequirementId>>;
  readonly proofExpressionIdRemap: Map<number, MonoProofExpressionId>;
} {
  return {
    instanceId: remap.instanceId,
    localRemap: new Map(remap.localRemap),
    expressionRemap: new Map(remap.expressionRemap),
    statementRemap: new Map(remap.statementRemap),
    requirementIdRemap: new Map(remap.requirementIdRemap),
    proofExpressionIdRemap: new Map(remap.proofExpressionIdRemap),
  };
}

function immutableRemapFrom(remap: ReturnType<typeof mutableRemapFrom>): MonoFunctionRemap {
  return {
    instanceId: remap.instanceId,
    localRemap: new Map(remap.localRemap),
    expressionRemap: new Map(remap.expressionRemap),
    statementRemap: new Map(remap.statementRemap),
    requirementIdRemap: new Map(remap.requirementIdRemap),
    proofExpressionIdRemap: new Map(remap.proofExpressionIdRemap),
  };
}

export function collectBodyIndexEntries(block: MonoBlock): {
  readonly statements: readonly MonoStatement[];
  readonly expressions: readonly MonoExpression[];
} {
  const statements = new Map<string, MonoStatement>();
  const expressions = new Map<string, MonoExpression>();
  walkMonoBlock(block, {
    statement: (statement) =>
      statements.set(instantiatedHirIdKey(statement.statementId), statement),
    expression: (expression) =>
      expressions.set(instantiatedHirIdKey(expression.expressionId), expression),
  });
  return {
    statements: [...statements.values()],
    expressions: [...expressions.values()],
  };
}

export function rebuildMonoBodyIndex(input: {
  readonly statements: readonly MonoStatement[];
  readonly expressions: readonly MonoExpression[];
}): MonoBodyIndex {
  const statements = [...input.statements].sort((left, right) =>
    compareInstantiatedId(left.statementId, right.statementId),
  );
  const expressions = [...input.expressions].sort((left, right) =>
    compareInstantiatedId(left.expressionId, right.expressionId),
  );
  const statementLookup = new Map<string, MonoStatement>();
  for (const statement of statements) {
    statementLookup.set(instantiatedHirIdKey(statement.statementId), statement);
  }
  const expressionLookup = new Map<string, MonoExpression>();
  for (const expression of expressions) {
    expressionLookup.set(instantiatedHirIdKey(expression.expressionId), expression);
  }
  return {
    statements: {
      get: (id) => statementLookup.get(instantiatedHirIdKey(id)),
      entries: () => statements,
    },
    expressions: {
      get: (id) => expressionLookup.get(instantiatedHirIdKey(id)),
      entries: () => expressions,
    },
  };
}

function compareInstantiatedId(
  left: MonoExpressionId | MonoStatementId | MonoLocalId,
  right: MonoExpressionId | MonoStatementId | MonoLocalId,
): number {
  const leftKey = instantiatedHirIdKey(left);
  const rightKey = instantiatedHirIdKey(right);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}
