import type {
  HirBlock,
  HirExpression,
  HirMatchArm,
  HirStatement,
  TypedHirProgram,
} from "../hir/hir";
import { monoDiagnostic, type MonoDiagnostic } from "./diagnostics";
import { cloneExpression } from "./function-expression-cloner";
import { type MonoOutgoingEdge, type MutableMonoFunctionRemap } from "./function-instantiator-body";
import { monoStatementIdFor } from "./function-instantiator-shell";
import {
  cloneForIteration,
  cloneResourcePlace,
  cloneTakeKind,
  cloneTakeOperand,
  reportRecovery,
} from "./function-place-cloner";
import { cloneValidationMatchStatement } from "./function-validation-statement-cloner";
import {
  type MonoBlock,
  type MonoExpression,
  type MonoFunctionInstance,
  type MonoLocal,
  type MonoMatchArm,
  type MonoResourcePlace,
  type MonoStatement,
  type MonoStatementId,
  type MonoStatementKind,
} from "./mono-hir";
import { type MonoResourceKindConcretizationContext } from "./resource-kind-concretizer";
import { type MonoSubstitution } from "./substitution";
export type CloneStatementResult =
  | { readonly kind: "ok"; readonly statement: MonoStatement | null }
  | { readonly kind: "error" };

export function cloneBlock(input: {
  readonly source: HirBlock;
  readonly instance: MonoFunctionInstance;
  readonly substitution: MonoSubstitution;
  readonly remap: MutableMonoFunctionRemap;
  readonly program: TypedHirProgram;
  readonly context: MonoResourceKindConcretizationContext;
  readonly outgoingEdges: MonoOutgoingEdge[];
  readonly diagnostics: MonoDiagnostic[];
}): { readonly kind: "ok"; readonly block: MonoBlock } | { readonly kind: "error" } {
  const statements: MonoStatement[] = [];
  for (const source of input.source.statements) {
    const cloned = cloneStatement({
      source,
      instance: input.instance,
      substitution: input.substitution,
      remap: input.remap,
      program: input.program,
      context: input.context,
      outgoingEdges: input.outgoingEdges,
      diagnostics: input.diagnostics,
    });
    if (cloned.kind === "error") return { kind: "error" };
    if (cloned.statement !== null) statements.push(cloned.statement);
  }
  return {
    kind: "ok",
    block: { statements, sourceOrigin: String(input.source.sourceOrigin) },
  };
}

function cloneStatement(input: {
  readonly source: HirStatement;
  readonly instance: MonoFunctionInstance;
  readonly substitution: MonoSubstitution;
  readonly remap: MutableMonoFunctionRemap;
  readonly program: TypedHirProgram;
  readonly context: MonoResourceKindConcretizationContext;
  readonly outgoingEdges: MonoOutgoingEdge[];
  readonly diagnostics: MonoDiagnostic[];
}): CloneStatementResult {
  const nextStatementId = input.source.statementId;
  const monoStatementId = monoStatementIdFor(input.remap.instanceId, nextStatementId);
  input.remap.statementRemap.set(nextStatementId, monoStatementId);
  const sourceOrigin = String(input.source.sourceOrigin);
  const inner = input.source.kind;
  switch (inner.kind) {
    case "block":
      return cloneBlockStatement({
        inner,
        statementId: monoStatementId,
        sourceOrigin,
        instance: input.instance,
        substitution: input.substitution,
        remap: input.remap,
        program: input.program,
        context: input.context,
        outgoingEdges: input.outgoingEdges,
        diagnostics: input.diagnostics,
      });
    case "let":
      return cloneLetStatement({
        inner,
        statementId: monoStatementId,
        sourceOrigin,
        instance: input.instance,
        substitution: input.substitution,
        remap: input.remap,
        program: input.program,
        context: input.context,
        outgoingEdges: input.outgoingEdges,
        diagnostics: input.diagnostics,
      });
    case "assignment":
      return cloneAssignmentStatement({
        inner,
        statementId: monoStatementId,
        sourceOrigin,
        instance: input.instance,
        substitution: input.substitution,
        remap: input.remap,
        program: input.program,
        context: input.context,
        outgoingEdges: input.outgoingEdges,
        diagnostics: input.diagnostics,
      });
    case "if":
      return cloneIfStatement({
        inner,
        statementId: monoStatementId,
        sourceOrigin,
        instance: input.instance,
        substitution: input.substitution,
        remap: input.remap,
        program: input.program,
        context: input.context,
        outgoingEdges: input.outgoingEdges,
        diagnostics: input.diagnostics,
      });
    case "while":
      return cloneWhileStatement({
        inner,
        statementId: monoStatementId,
        sourceOrigin,
        instance: input.instance,
        substitution: input.substitution,
        remap: input.remap,
        program: input.program,
        context: input.context,
        outgoingEdges: input.outgoingEdges,
        diagnostics: input.diagnostics,
      });
    case "loop":
      return cloneLoopStatement({
        inner,
        statementId: monoStatementId,
        sourceOrigin,
        instance: input.instance,
        substitution: input.substitution,
        remap: input.remap,
        program: input.program,
        context: input.context,
        outgoingEdges: input.outgoingEdges,
        diagnostics: input.diagnostics,
      });
    case "for":
      return cloneForStatement({
        inner,
        statementId: monoStatementId,
        sourceOrigin,
        instance: input.instance,
        substitution: input.substitution,
        remap: input.remap,
        program: input.program,
        context: input.context,
        outgoingEdges: input.outgoingEdges,
        diagnostics: input.diagnostics,
      });
    case "match":
      return cloneMatchStatement({
        inner,
        statementId: monoStatementId,
        sourceOrigin,
        instance: input.instance,
        substitution: input.substitution,
        remap: input.remap,
        program: input.program,
        context: input.context,
        outgoingEdges: input.outgoingEdges,
        diagnostics: input.diagnostics,
      });
    case "validationMatch":
      return cloneValidationMatchStatement({
        inner,
        statementId: monoStatementId,
        sourceOrigin,
        instance: input.instance,
        substitution: input.substitution,
        remap: input.remap,
        program: input.program,
        context: input.context,
        outgoingEdges: input.outgoingEdges,
        diagnostics: input.diagnostics,
      });
    case "take":
      return cloneTakeStatement({
        inner,
        statementId: monoStatementId,
        sourceOrigin,
        instance: input.instance,
        substitution: input.substitution,
        remap: input.remap,
        program: input.program,
        context: input.context,
        outgoingEdges: input.outgoingEdges,
        diagnostics: input.diagnostics,
      });
    case "return":
      return cloneReturnOrYieldStatement({
        kind: "return",
        expression: inner.expression,
        statementId: monoStatementId,
        sourceOrigin,
        instance: input.instance,
        substitution: input.substitution,
        remap: input.remap,
        program: input.program,
        context: input.context,
        outgoingEdges: input.outgoingEdges,
        diagnostics: input.diagnostics,
      });
    case "yield":
      return cloneReturnOrYieldStatement({
        kind: "yield",
        expression: inner.expression,
        statementId: monoStatementId,
        sourceOrigin,
        instance: input.instance,
        substitution: input.substitution,
        remap: input.remap,
        program: input.program,
        context: input.context,
        outgoingEdges: input.outgoingEdges,
        diagnostics: input.diagnostics,
      });
    case "break":
      return {
        kind: "ok",
        statement: {
          statementId: monoStatementId,
          kind: { kind: "break" },
          sourceOrigin,
        },
      };
    case "continue":
      return {
        kind: "ok",
        statement: {
          statementId: monoStatementId,
          kind: { kind: "continue" },
          sourceOrigin,
        },
      };
    case "expression":
      return cloneExpressionStatement({
        inner,
        statementId: monoStatementId,
        sourceOrigin,
        instance: input.instance,
        substitution: input.substitution,
        remap: input.remap,
        program: input.program,
        context: input.context,
        outgoingEdges: input.outgoingEdges,
        diagnostics: input.diagnostics,
      });
    case "error":
      return reportRecovery({
        diagnostics: input.diagnostics,
        instance: input.instance,
        sourceOrigin,
        reason: inner.reason,
      });
  }
}

function cloneBlockStatement(input: {
  readonly inner: Extract<HirStatement["kind"], { readonly kind: "block" }>;
  readonly statementId: MonoStatementId;
  readonly sourceOrigin: string;
  readonly instance: MonoFunctionInstance;
  readonly substitution: MonoSubstitution;
  readonly remap: MutableMonoFunctionRemap;
  readonly program: TypedHirProgram;
  readonly context: MonoResourceKindConcretizationContext;
  readonly outgoingEdges: MonoOutgoingEdge[];
  readonly diagnostics: MonoDiagnostic[];
}): CloneStatementResult {
  const blockResult = cloneBlock({
    source: input.inner.block,
    instance: input.instance,
    substitution: input.substitution,
    remap: input.remap,
    program: input.program,
    context: input.context,
    outgoingEdges: input.outgoingEdges,
    diagnostics: input.diagnostics,
  });
  if (blockResult.kind === "error") return { kind: "error" };
  const statement: MonoStatement = {
    statementId: input.statementId,
    kind: { kind: "block", block: blockResult.block },
    sourceOrigin: input.sourceOrigin,
  };
  return { kind: "ok", statement };
}

function cloneLetStatement(input: {
  readonly inner: Extract<HirStatement["kind"], { readonly kind: "let" }>;
  readonly statementId: MonoStatementId;
  readonly sourceOrigin: string;
  readonly instance: MonoFunctionInstance;
  readonly substitution: MonoSubstitution;
  readonly remap: MutableMonoFunctionRemap;
  readonly program: TypedHirProgram;
  readonly context: MonoResourceKindConcretizationContext;
  readonly outgoingEdges: MonoOutgoingEdge[];
  readonly diagnostics: MonoDiagnostic[];
}): CloneStatementResult {
  const monoLocalId = input.remap.localRemap.get(input.inner.statement.local.localId);
  const monoLocal = monoLocalId !== undefined ? input.instance.locals.get(monoLocalId) : undefined;
  if (monoLocal === undefined) {
    return reportRecovery({
      diagnostics: input.diagnostics,
      instance: input.instance,
      sourceOrigin: input.sourceOrigin,
      reason: `missing-local:${input.inner.statement.local.localId}`,
    });
  }
  let value: MonoExpression | undefined;
  if (input.inner.statement.value !== undefined) {
    const clonedValue = cloneExpression({
      source: input.inner.statement.value,
      instance: input.instance,
      substitution: input.substitution,
      remap: input.remap,
      program: input.program,
      context: input.context,
      outgoingEdges: input.outgoingEdges,
      diagnostics: input.diagnostics,
    });
    if (clonedValue.kind === "error") return { kind: "error" };
    value = clonedValue.expression;
  }
  const statement: MonoStatement = {
    statementId: input.statementId,
    kind: {
      kind: "let",
      statement: { local: monoLocal, ...(value !== undefined ? { value } : {}) },
    },
    sourceOrigin: input.sourceOrigin,
  };
  return { kind: "ok", statement };
}

function cloneAssignmentStatement(input: {
  readonly inner: Extract<HirStatement["kind"], { readonly kind: "assignment" }>;
  readonly statementId: MonoStatementId;
  readonly sourceOrigin: string;
  readonly instance: MonoFunctionInstance;
  readonly substitution: MonoSubstitution;
  readonly remap: MutableMonoFunctionRemap;
  readonly program: TypedHirProgram;
  readonly context: MonoResourceKindConcretizationContext;
  readonly outgoingEdges: MonoOutgoingEdge[];
  readonly diagnostics: MonoDiagnostic[];
}): CloneStatementResult {
  const target = cloneExpression({
    source: input.inner.statement.target,
    instance: input.instance,
    substitution: input.substitution,
    remap: input.remap,
    program: input.program,
    context: input.context,
    outgoingEdges: input.outgoingEdges,
    diagnostics: input.diagnostics,
  });
  if (target.kind === "error") return { kind: "error" };
  const value = cloneExpression({
    source: input.inner.statement.value,
    instance: input.instance,
    substitution: input.substitution,
    remap: input.remap,
    program: input.program,
    context: input.context,
    outgoingEdges: input.outgoingEdges,
    diagnostics: input.diagnostics,
  });
  if (value.kind === "error") return { kind: "error" };
  let targetPlace: MonoResourcePlace | undefined;
  if (input.inner.statement.targetPlace !== undefined) {
    const placeResult = cloneResourcePlace({
      place: input.inner.statement.targetPlace,
      instance: input.instance,
      substitution: input.substitution,
      context: input.context,
      program: input.program,
      remap: input.remap,
      diagnostics: input.diagnostics,
    });
    if (placeResult.kind === "error") return { kind: "error" };
    targetPlace = placeResult.place;
  }
  const statement: MonoStatement = {
    statementId: input.statementId,
    kind: {
      kind: "assignment",
      statement: {
        target: target.expression,
        value: value.expression,
        ...(targetPlace !== undefined ? { targetPlace } : {}),
      },
    },
    sourceOrigin: input.sourceOrigin,
  };
  return { kind: "ok", statement };
}

function cloneIfStatement(input: {
  readonly inner: Extract<HirStatement["kind"], { readonly kind: "if" }>;
  readonly statementId: MonoStatementId;
  readonly sourceOrigin: string;
  readonly instance: MonoFunctionInstance;
  readonly substitution: MonoSubstitution;
  readonly remap: MutableMonoFunctionRemap;
  readonly program: TypedHirProgram;
  readonly context: MonoResourceKindConcretizationContext;
  readonly outgoingEdges: MonoOutgoingEdge[];
  readonly diagnostics: MonoDiagnostic[];
}): CloneStatementResult {
  const condition = cloneExpression({
    source: input.inner.statement.condition,
    instance: input.instance,
    substitution: input.substitution,
    remap: input.remap,
    program: input.program,
    context: input.context,
    outgoingEdges: input.outgoingEdges,
    diagnostics: input.diagnostics,
  });
  if (condition.kind === "error") return { kind: "error" };
  const thenBlock = cloneBlock({
    source: input.inner.statement.thenBlock,
    instance: input.instance,
    substitution: input.substitution,
    remap: input.remap,
    program: input.program,
    context: input.context,
    outgoingEdges: input.outgoingEdges,
    diagnostics: input.diagnostics,
  });
  if (thenBlock.kind === "error") return { kind: "error" };
  let elseBlock: MonoBlock | undefined;
  if (input.inner.statement.elseBlock !== undefined) {
    const clonedElse = cloneBlock({
      source: input.inner.statement.elseBlock,
      instance: input.instance,
      substitution: input.substitution,
      remap: input.remap,
      program: input.program,
      context: input.context,
      outgoingEdges: input.outgoingEdges,
      diagnostics: input.diagnostics,
    });
    if (clonedElse.kind === "error") return { kind: "error" };
    elseBlock = clonedElse.block;
  }
  const statement: MonoStatement = {
    statementId: input.statementId,
    kind: {
      kind: "if",
      statement: {
        condition: condition.expression,
        thenBlock: thenBlock.block,
        ...(elseBlock !== undefined ? { elseBlock } : {}),
      },
    },
    sourceOrigin: input.sourceOrigin,
  };
  return { kind: "ok", statement };
}

function cloneWhileStatement(input: {
  readonly inner: Extract<HirStatement["kind"], { readonly kind: "while" }>;
  readonly statementId: MonoStatementId;
  readonly sourceOrigin: string;
  readonly instance: MonoFunctionInstance;
  readonly substitution: MonoSubstitution;
  readonly remap: MutableMonoFunctionRemap;
  readonly program: TypedHirProgram;
  readonly context: MonoResourceKindConcretizationContext;
  readonly outgoingEdges: MonoOutgoingEdge[];
  readonly diagnostics: MonoDiagnostic[];
}): CloneStatementResult {
  const condition = cloneExpression({
    source: input.inner.statement.condition,
    instance: input.instance,
    substitution: input.substitution,
    remap: input.remap,
    program: input.program,
    context: input.context,
    outgoingEdges: input.outgoingEdges,
    diagnostics: input.diagnostics,
  });
  if (condition.kind === "error") return { kind: "error" };
  const body = cloneBlock({
    source: input.inner.statement.body,
    instance: input.instance,
    substitution: input.substitution,
    remap: input.remap,
    program: input.program,
    context: input.context,
    outgoingEdges: input.outgoingEdges,
    diagnostics: input.diagnostics,
  });
  if (body.kind === "error") return { kind: "error" };
  const statement: MonoStatement = {
    statementId: input.statementId,
    kind: { kind: "while", statement: { condition: condition.expression, body: body.block } },
    sourceOrigin: input.sourceOrigin,
  };
  return { kind: "ok", statement };
}

function cloneLoopStatement(input: {
  readonly inner: Extract<HirStatement["kind"], { readonly kind: "loop" }>;
  readonly statementId: MonoStatementId;
  readonly sourceOrigin: string;
  readonly instance: MonoFunctionInstance;
  readonly substitution: MonoSubstitution;
  readonly remap: MutableMonoFunctionRemap;
  readonly program: TypedHirProgram;
  readonly context: MonoResourceKindConcretizationContext;
  readonly outgoingEdges: MonoOutgoingEdge[];
  readonly diagnostics: MonoDiagnostic[];
}): CloneStatementResult {
  const body = cloneBlock({
    source: input.inner.body,
    instance: input.instance,
    substitution: input.substitution,
    remap: input.remap,
    program: input.program,
    context: input.context,
    outgoingEdges: input.outgoingEdges,
    diagnostics: input.diagnostics,
  });
  if (body.kind === "error") return { kind: "error" };
  const statement: MonoStatement = {
    statementId: input.statementId,
    kind: { kind: "loop", body: body.block },
    sourceOrigin: input.sourceOrigin,
  };
  return { kind: "ok", statement };
}

function cloneForStatement(input: {
  readonly inner: Extract<HirStatement["kind"], { readonly kind: "for" }>;
  readonly statementId: MonoStatementId;
  readonly sourceOrigin: string;
  readonly instance: MonoFunctionInstance;
  readonly substitution: MonoSubstitution;
  readonly remap: MutableMonoFunctionRemap;
  readonly program: TypedHirProgram;
  readonly context: MonoResourceKindConcretizationContext;
  readonly outgoingEdges: MonoOutgoingEdge[];
  readonly diagnostics: MonoDiagnostic[];
}): CloneStatementResult {
  const iterable = cloneExpression({
    source: input.inner.statement.iterable,
    instance: input.instance,
    substitution: input.substitution,
    remap: input.remap,
    program: input.program,
    context: input.context,
    outgoingEdges: input.outgoingEdges,
    diagnostics: input.diagnostics,
  });
  if (iterable.kind === "error") return { kind: "error" };
  const iteration = cloneForIteration({
    iteration: input.inner.statement.iteration,
    instance: input.instance,
    substitution: input.substitution,
    context: input.context,
    program: input.program,
    diagnostics: input.diagnostics,
    sourceOrigin: input.sourceOrigin,
  });
  if (iteration.kind === "error") return { kind: "error" };
  const body = cloneBlock({
    source: input.inner.statement.body,
    instance: input.instance,
    substitution: input.substitution,
    remap: input.remap,
    program: input.program,
    context: input.context,
    outgoingEdges: input.outgoingEdges,
    diagnostics: input.diagnostics,
  });
  if (body.kind === "error") return { kind: "error" };
  let binding: MonoLocal | undefined;
  if (input.inner.statement.binding !== undefined) {
    const monoBindingLocalId = input.remap.localRemap.get(input.inner.statement.binding.localId);
    const monoBinding =
      monoBindingLocalId !== undefined ? input.instance.locals.get(monoBindingLocalId) : undefined;
    if (monoBinding === undefined) {
      return reportRecovery({
        diagnostics: input.diagnostics,
        instance: input.instance,
        sourceOrigin: input.sourceOrigin,
        reason: `missing-for-binding-local:${input.inner.statement.binding.localId}`,
      });
    }
    binding = monoBinding;
  }
  const statement: MonoStatement = {
    statementId: input.statementId,
    kind: {
      kind: "for",
      statement: {
        ...(binding !== undefined ? { binding } : {}),
        iterable: iterable.expression,
        iteration: iteration.iteration,
        body: body.block,
      },
    },
    sourceOrigin: input.sourceOrigin,
  };
  return { kind: "ok", statement };
}

function cloneMatchStatement(input: {
  readonly inner: Extract<HirStatement["kind"], { readonly kind: "match" }>;
  readonly statementId: MonoStatementId;
  readonly sourceOrigin: string;
  readonly instance: MonoFunctionInstance;
  readonly substitution: MonoSubstitution;
  readonly remap: MutableMonoFunctionRemap;
  readonly program: TypedHirProgram;
  readonly context: MonoResourceKindConcretizationContext;
  readonly outgoingEdges: MonoOutgoingEdge[];
  readonly diagnostics: MonoDiagnostic[];
}): CloneStatementResult {
  const scrutinee = cloneExpression({
    source: input.inner.statement.scrutinee,
    instance: input.instance,
    substitution: input.substitution,
    remap: input.remap,
    program: input.program,
    context: input.context,
    outgoingEdges: input.outgoingEdges,
    diagnostics: input.diagnostics,
  });
  if (scrutinee.kind === "error") return { kind: "error" };
  const arms: MonoMatchArm[] = [];
  for (const arm of input.inner.statement.arms) {
    const clonedArm = cloneMatchArm({
      arm,
      instance: input.instance,
      substitution: input.substitution,
      remap: input.remap,
      program: input.program,
      context: input.context,
      outgoingEdges: input.outgoingEdges,
      diagnostics: input.diagnostics,
    });
    if (clonedArm.kind === "error") return { kind: "error" };
    arms.push(clonedArm.arm);
  }
  const statement: MonoStatement = {
    statementId: input.statementId,
    kind: {
      kind: "match",
      statement: { scrutinee: scrutinee.expression, arms },
    },
    sourceOrigin: input.sourceOrigin,
  };
  return { kind: "ok", statement };
}

export function cloneMatchArm(input: {
  readonly arm: HirMatchArm;
  readonly instance: MonoFunctionInstance;
  readonly substitution: MonoSubstitution;
  readonly remap: MutableMonoFunctionRemap;
  readonly program: TypedHirProgram;
  readonly context: MonoResourceKindConcretizationContext;
  readonly outgoingEdges: MonoOutgoingEdge[];
  readonly diagnostics: MonoDiagnostic[];
}): { readonly kind: "ok"; readonly arm: MonoMatchArm } | { readonly kind: "error" } {
  const body = cloneBlock({
    source: input.arm.body,
    instance: input.instance,
    substitution: input.substitution,
    remap: input.remap,
    program: input.program,
    context: input.context,
    outgoingEdges: input.outgoingEdges,
    diagnostics: input.diagnostics,
  });
  if (body.kind === "error") return { kind: "error" };
  const bindingLocals: MonoLocal[] = [];
  for (const local of input.arm.bindingLocals) {
    const monoBindingLocalId = input.remap.localRemap.get(local.localId);
    const monoLocal =
      monoBindingLocalId !== undefined ? input.instance.locals.get(monoBindingLocalId) : undefined;
    if (monoLocal === undefined) {
      input.diagnostics.push(
        monoDiagnostic({
          severity: "error",
          code: "MONO_MISSING_REACHABLE_FUNCTION",
          message: "Match arm binding local is missing from the mono function instance.",
          ownerKey: `function:${input.instance.sourceFunctionId}`,
          rootCauseKey: "source-function",
          stableDetail: `missing-binding-local:${local.localId}`,
          sourceOrigin: String(local.sourceOrigin),
        }),
      );
      return { kind: "error" };
    }
    bindingLocals.push(monoLocal);
  }
  return {
    kind: "ok",
    arm: {
      patternText: input.arm.patternText,
      body: body.block,
      bindingLocals,
      sourceOrigin: String(input.arm.sourceOrigin),
    },
  };
}

function cloneTakeStatement(input: {
  readonly inner: Extract<HirStatement["kind"], { readonly kind: "take" }>;
  readonly statementId: MonoStatementId;
  readonly sourceOrigin: string;
  readonly instance: MonoFunctionInstance;
  readonly substitution: MonoSubstitution;
  readonly remap: MutableMonoFunctionRemap;
  readonly program: TypedHirProgram;
  readonly context: MonoResourceKindConcretizationContext;
  readonly outgoingEdges: MonoOutgoingEdge[];
  readonly diagnostics: MonoDiagnostic[];
}): CloneStatementResult {
  const operand = cloneTakeOperand({
    operand: input.inner.statement.operand,
    instance: input.instance,
    substitution: input.substitution,
    remap: input.remap,
    program: input.program,
    context: input.context,
    outgoingEdges: input.outgoingEdges,
    diagnostics: input.diagnostics,
  });
  if (operand.kind === "error") return { kind: "error" };
  const takeKind = cloneTakeKind({
    takeKind: input.inner.statement.takeKind,
    instance: input.instance,
    substitution: input.substitution,
    remap: input.remap,
    program: input.program,
    context: input.context,
    outgoingEdges: input.outgoingEdges,
    diagnostics: input.diagnostics,
    sourceOrigin: input.sourceOrigin,
  });
  if (takeKind.kind === "error") return { kind: "error" };
  const body = cloneBlock({
    source: input.inner.statement.body,
    instance: input.instance,
    substitution: input.substitution,
    remap: input.remap,
    program: input.program,
    context: input.context,
    outgoingEdges: input.outgoingEdges,
    diagnostics: input.diagnostics,
  });
  if (body.kind === "error") return { kind: "error" };
  let aliasLocal: MonoLocal | undefined;
  if (input.inner.statement.aliasLocal !== undefined) {
    const monoAliasLocalId = input.remap.localRemap.get(input.inner.statement.aliasLocal.localId);
    const monoAlias =
      monoAliasLocalId !== undefined ? input.instance.locals.get(monoAliasLocalId) : undefined;
    if (monoAlias === undefined) {
      return reportRecovery({
        diagnostics: input.diagnostics,
        instance: input.instance,
        sourceOrigin: input.sourceOrigin,
        reason: `missing-take-alias-local:${input.inner.statement.aliasLocal.localId}`,
      });
    }
    aliasLocal = monoAlias;
  }
  const statement: MonoStatement = {
    statementId: input.statementId,
    kind: {
      kind: "take",
      statement: {
        operand: operand.operand,
        takeKind: takeKind.takeKind,
        ...(aliasLocal !== undefined ? { aliasLocal } : {}),
        body: body.block,
        sourceOrigin: input.sourceOrigin,
      },
    },
    sourceOrigin: input.sourceOrigin,
  };
  return { kind: "ok", statement };
}

function cloneReturnOrYieldStatement(input: {
  readonly kind: "return" | "yield";
  readonly expression: HirExpression | undefined;
  readonly statementId: MonoStatementId;
  readonly sourceOrigin: string;
  readonly instance: MonoFunctionInstance;
  readonly substitution: MonoSubstitution;
  readonly remap: MutableMonoFunctionRemap;
  readonly program: TypedHirProgram;
  readonly context: MonoResourceKindConcretizationContext;
  readonly outgoingEdges: MonoOutgoingEdge[];
  readonly diagnostics: MonoDiagnostic[];
}): CloneStatementResult {
  let expression: MonoExpression | undefined;
  if (input.expression !== undefined) {
    const cloned = cloneExpression({
      source: input.expression,
      instance: input.instance,
      substitution: input.substitution,
      remap: input.remap,
      program: input.program,
      context: input.context,
      outgoingEdges: input.outgoingEdges,
      diagnostics: input.diagnostics,
    });
    if (cloned.kind === "error") return { kind: "error" };
    expression = cloned.expression;
  }
  const kind: MonoStatementKind =
    input.kind === "return"
      ? { kind: "return", ...(expression !== undefined ? { expression } : {}) }
      : { kind: "yield", ...(expression !== undefined ? { expression } : {}) };
  const statement: MonoStatement = {
    statementId: input.statementId,
    kind,
    sourceOrigin: input.sourceOrigin,
  };
  return { kind: "ok", statement };
}

function cloneExpressionStatement(input: {
  readonly inner: Extract<HirStatement["kind"], { readonly kind: "expression" }>;
  readonly statementId: MonoStatementId;
  readonly sourceOrigin: string;
  readonly instance: MonoFunctionInstance;
  readonly substitution: MonoSubstitution;
  readonly remap: MutableMonoFunctionRemap;
  readonly program: TypedHirProgram;
  readonly context: MonoResourceKindConcretizationContext;
  readonly outgoingEdges: MonoOutgoingEdge[];
  readonly diagnostics: MonoDiagnostic[];
}): CloneStatementResult {
  const cloned = cloneExpression({
    source: input.inner.expression,
    instance: input.instance,
    substitution: input.substitution,
    remap: input.remap,
    program: input.program,
    context: input.context,
    outgoingEdges: input.outgoingEdges,
    diagnostics: input.diagnostics,
  });
  if (cloned.kind === "error") return { kind: "error" };
  const statement: MonoStatement = {
    statementId: input.statementId,
    kind: { kind: "expression", expression: cloned.expression },
    sourceOrigin: input.sourceOrigin,
  };
  return { kind: "ok", statement };
}
