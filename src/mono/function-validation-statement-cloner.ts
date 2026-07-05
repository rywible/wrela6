import type { HirStatement, TypedHirProgram } from "../hir/hir";
import { type MonoDiagnostic } from "./diagnostics";
import {
  cloneExpressionWithContext,
  cloneValidationWithContext,
} from "./function-expression-cloner";
import type { MonoOutgoingEdge, MutableMonoFunctionRemap } from "./function-instantiator-body";
import { remapOwnedProofId, reportRecovery } from "./function-place-cloner";
import { cloneMatchArmWithContext, type CloneStatementResult } from "./function-statement-cloner";
import type {
  MonoFunctionInstance,
  MonoMatchArm,
  MonoStatement,
  MonoStatementId,
  MonoValidation,
} from "./mono-hir";
import {
  monoTransformContextFromLegacyCloneState,
  type MonoTransformContext,
} from "./mono-transform-context";
import type { MonoResourceKindConcretizationContext } from "./resource-kind-concretizer";
import type { MonoSubstitution } from "./substitution";

export function cloneValidationMatchStatement(input: {
  readonly inner: Extract<HirStatement["kind"], { readonly kind: "validationMatch" }>;
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
  return cloneValidationMatchStatementWithContext({
    inner: input.inner,
    statementId: input.statementId,
    sourceOrigin: input.sourceOrigin,
    instance: input.instance,
    substitution: input.substitution,
    program: input.program,
    transformContext: monoTransformContextFromLegacyCloneState({
      remap: input.remap,
      resourceKinds: input.context,
      outgoingEdges: input.outgoingEdges,
      diagnostics: input.diagnostics,
    }),
  });
}

export function cloneValidationMatchStatementWithContext(input: {
  readonly inner: Extract<HirStatement["kind"], { readonly kind: "validationMatch" }>;
  readonly statementId: MonoStatementId;
  readonly sourceOrigin: string;
  readonly instance: MonoFunctionInstance;
  readonly substitution: MonoSubstitution;
  readonly program: TypedHirProgram;
  readonly transformContext: MonoTransformContext;
}): CloneStatementResult {
  if (input.inner.statement.recovered === true) {
    return reportRecovery({
      diagnostics: input.transformContext.diagnostics,
      instance: input.instance,
      sourceOrigin: input.sourceOrigin,
      reason: "validation-match-recovered",
    });
  }
  const scrutinee = cloneExpressionWithContext({
    source: input.inner.statement.scrutinee,
    instance: input.instance,
    substitution: input.substitution,
    program: input.program,
    transformContext: input.transformContext,
  });
  if (scrutinee.kind === "error") return { kind: "error" };
  let validation: MonoValidation | undefined;
  if (input.inner.statement.validation !== undefined) {
    const clonedValidation = cloneValidationWithContext({
      validation: input.inner.statement.validation,
      instance: input.instance,
      substitution: input.substitution,
      program: input.program,
      transformContext: input.transformContext,
    });
    if (clonedValidation.kind === "error") return { kind: "error" };
    validation = clonedValidation.validation;
  }
  let okArm: MonoMatchArm | undefined;
  if (input.inner.statement.okArm !== undefined) {
    const clonedOkArm = cloneMatchArmWithContext({
      arm: input.inner.statement.okArm,
      instance: input.instance,
      substitution: input.substitution,
      program: input.program,
      transformContext: input.transformContext,
    });
    if (clonedOkArm.kind === "error") return { kind: "error" };
    okArm = clonedOkArm.arm;
  }
  let errArm: MonoMatchArm | undefined;
  if (input.inner.statement.errArm !== undefined) {
    const clonedErrArm = cloneMatchArmWithContext({
      arm: input.inner.statement.errArm,
      instance: input.instance,
      substitution: input.substitution,
      program: input.program,
      transformContext: input.transformContext,
    });
    if (clonedErrArm.kind === "error") return { kind: "error" };
    errArm = clonedErrArm.arm;
  }
  const validationMatchId = remapOwnedProofId(
    input.instance.instanceId,
    input.inner.statement.validationMatchId,
  );
  const statement: MonoStatement = {
    statementId: input.statementId,
    kind: {
      kind: "validationMatch",
      statement: {
        validationMatchId,
        scrutinee: scrutinee.expression,
        ...(validation !== undefined ? { validation } : {}),
        ...(okArm !== undefined ? { okArm } : {}),
        ...(errArm !== undefined ? { errArm } : {}),
        sourceOrigin: input.sourceOrigin,
      },
    },
    sourceOrigin: input.sourceOrigin,
  };
  return { kind: "ok", statement };
}
