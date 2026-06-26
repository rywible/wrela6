import type { HirStatement, TypedHirProgram } from "../hir/hir";
import { type MonoDiagnostic } from "./diagnostics";
import { cloneExpression, cloneValidation } from "./function-expression-cloner";
import type { MonoOutgoingEdge, MutableMonoFunctionRemap } from "./function-instantiator-body";
import { remapOwnedProofId, reportRecovery } from "./function-place-cloner";
import { cloneMatchArm, type CloneStatementResult } from "./function-statement-cloner";
import type {
  MonoFunctionInstance,
  MonoMatchArm,
  MonoStatement,
  MonoStatementId,
  MonoValidation,
} from "./mono-hir";
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
  if (input.inner.statement.recovered === true) {
    return reportRecovery({
      diagnostics: input.diagnostics,
      instance: input.instance,
      sourceOrigin: input.sourceOrigin,
      reason: "validation-match-recovered",
    });
  }
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
  let validation: MonoValidation | undefined;
  if (input.inner.statement.validation !== undefined) {
    const clonedValidation = cloneValidation({
      validation: input.inner.statement.validation,
      instance: input.instance,
      substitution: input.substitution,
      remap: input.remap,
      program: input.program,
      context: input.context,
      outgoingEdges: input.outgoingEdges,
      diagnostics: input.diagnostics,
    });
    if (clonedValidation.kind === "error") return { kind: "error" };
    validation = clonedValidation.validation;
  }
  let okArm: MonoMatchArm | undefined;
  if (input.inner.statement.okArm !== undefined) {
    const clonedOkArm = cloneMatchArm({
      arm: input.inner.statement.okArm,
      instance: input.instance,
      substitution: input.substitution,
      remap: input.remap,
      program: input.program,
      context: input.context,
      outgoingEdges: input.outgoingEdges,
      diagnostics: input.diagnostics,
    });
    if (clonedOkArm.kind === "error") return { kind: "error" };
    okArm = clonedOkArm.arm;
  }
  let errArm: MonoMatchArm | undefined;
  if (input.inner.statement.errArm !== undefined) {
    const clonedErrArm = cloneMatchArm({
      arm: input.inner.statement.errArm,
      instance: input.instance,
      substitution: input.substitution,
      remap: input.remap,
      program: input.program,
      context: input.context,
      outgoingEdges: input.outgoingEdges,
      diagnostics: input.diagnostics,
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
