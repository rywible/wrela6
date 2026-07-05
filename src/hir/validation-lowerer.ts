import type { MatchStatementView } from "../frontend/ast/statement-views";
import { concreteKind } from "../semantic/surface/resource-kind";
import type { CheckedType } from "../semantic/surface/type-model";
import type { CheckedValidationContractSurface } from "../semantic/surface/proof-contracts";
import type {
  HirCallExpression,
  HirExpression,
  HirLocal,
  HirMatchArm,
  HirValidation,
  HirValidationMatchStatement,
} from "./hir";
import type { HirLoweringContext } from "./lowering-context";
import type { HirBlockLowerer } from "./lowering-context";
import { ownedValidationId } from "./ids";
import type { HirOriginId } from "./ids";
import {
  currentHirModuleId,
  hirDiagnostic,
  hirOwnerKey,
  requireHirFunctionOwner,
} from "./lowering-context";

export function lowerValidationCreation(input: {
  readonly call: HirCallExpression;
  readonly context: HirLoweringContext;
  readonly sourceOrigin: import("./ids").HirOriginId;
  readonly validationExpressionId?: import("./ids").HirExpressionId;
  readonly contracts?: readonly CheckedValidationContractSurface[];
}): HirValidation | undefined {
  const contract = input.contracts?.[0];
  const sourcePlace =
    contract?.sourceParameterId !== undefined
      ? input.call.arguments.find((argument) => argument.parameterId === contract.sourceParameterId)
          ?.place
      : input.call.arguments.find((argument) => argument.place !== undefined)?.place;
  if (contract === undefined || sourcePlace === undefined) return undefined;
  const owner = requireHirFunctionOwner({
    context: input.context,
    sourceOrigin: input.sourceOrigin,
    stableDetail: "validation-owner",
  });
  if (owner === undefined) return undefined;
  const validationId = ownedValidationId(owner, input.context.proofMetadata.count("validation"));
  const pendingResultPlace = input.context.places.placeForProjection({
    root: { kind: "temporary", ordinal: input.context.proofMetadata.count("validation") },
    projection: [],
    type: contract.resultType,
    resourceKind: concreteKind("Affine"),
    sourceOrigin: input.sourceOrigin,
  });
  const validation: HirValidation = {
    validationId,
    validationExpressionId: input.validationExpressionId ?? input.call.callee.expressionId,
    sourcePlace,
    pendingResultPlace,
    validatedBufferTypeId: contract.validatedBufferTypeId,
    okPayloadType: contract.okPayloadType,
    errPayloadType: contract.errPayloadType,
    sourceOrigin: input.sourceOrigin,
  };
  input.context.proofMetadata.addValidation(validation);
  return validation;
}

function sourceOriginForMatch(view: MatchStatementView, context: HirLoweringContext): HirOriginId {
  return context.origins.forSyntax({
    moduleId: currentHirModuleId(context),
    node: view.node,
    ownerItemId: context.ownerItemId,
    ownerFunctionId: context.ownerFunctionId,
  });
}

function placeKey(expression: HirExpression): string | undefined {
  return expression.place?.canonicalKey;
}

function validationForExpression(input: {
  readonly expression: HirExpression;
  readonly context: HirLoweringContext;
}): HirValidation | undefined {
  return input.context.proofMetadata.findValidationByExpressionId(input.expression.expressionId);
}

export function recordValidationResultAlias(input: {
  readonly expression: HirExpression;
  readonly local: HirLocal;
  readonly context: HirLoweringContext;
}): void {
  const validation = validationForExpression({
    expression: input.expression,
    context: input.context,
  });
  if (validation === undefined) return;
  const aliasPlace = input.context.places.placeForProjection({
    root: { kind: "local", localId: input.local.localId },
    projection: [],
    type: input.local.type,
    resourceKind: input.local.resourceKind,
    sourceOrigin: input.local.sourceOrigin,
  });
  if (
    aliasPlace.canonicalKey === undefined ||
    validation.pendingResultPlace.canonicalKey === undefined
  ) {
    return;
  }
  input.context.proofMetadata.bindValidationResultLocal(
    validation.validationId,
    input.local.localId,
  );
  input.context.validationResultAliases.set(
    aliasPlace.canonicalKey,
    validation.pendingResultPlace.canonicalKey,
  );
}

function hasValidationResultType(input: {
  readonly scrutinee: HirExpression;
  readonly context: HirLoweringContext;
}): boolean {
  return input.context.proofMetadata.hasValidationPendingResultType(input.scrutinee.type);
}

function armFromView(input: {
  readonly context: HirLoweringContext;
  readonly arm: ReturnType<MatchStatementView["arms"]>[number];
  readonly patternText: string;
  readonly payloadType: CheckedType;
  readonly lowerBlock: HirBlockLowerer;
  readonly sourceOrigin: HirOriginId;
}): HirMatchArm {
  const bindingLocals = (input.arm.pattern()?.patternList()?.patterns() ?? [])
    .map((pattern) => pattern.qualifiedName()?.text())
    .filter((name): name is string => name !== undefined && name !== "_")
    .map((name) =>
      input.context.locals.addSourceLocal({
        name,
        type: input.payloadType,
        resourceKind: concreteKind("Copy"),
        sourceOrigin: input.sourceOrigin,
        introducedBy: "validationArm",
      }),
    );
  for (const result of bindingLocals) {
    for (const diagnostic of result.diagnostics) input.context.diagnostics.report(diagnostic);
  }
  return {
    patternText: input.patternText,
    body: input.lowerBlock({
      block: input.arm.body(),
      context: input.context,
      sourceOrigin: input.sourceOrigin,
    }),
    bindingLocals: bindingLocals.map((result) => result.local),
    sourceOrigin: input.sourceOrigin,
  };
}

type ValidationArmRole = "ok" | "err";

function validationArmRole(
  arm: ReturnType<MatchStatementView["arms"]>[number],
): ValidationArmRole | undefined {
  const patternText = arm.pattern()?.qualifiedName()?.text();
  const tag = patternText?.split(".").at(-1)?.toLowerCase();
  if (tag === "ok") return "ok";
  if (tag === "err") return "err";
  return undefined;
}

function reportAmbiguousValidationMatch(input: {
  readonly context: HirLoweringContext;
  readonly sourceOrigin: HirOriginId;
  readonly stableDetail: string;
}): void {
  input.context.diagnostics.report(
    hirDiagnostic({
      code: "HIR_AMBIGUOUS_VALIDATION_MATCH",
      message: "Validation match arms must contain exactly one Ok arm and one Err arm.",
      originId: input.sourceOrigin,
      ownerKey: hirOwnerKey(input.context),
      originKey: `origin:${input.sourceOrigin}`,
      stableDetail: input.stableDetail,
    }),
  );
}

export function lowerValidationMatch(input: {
  readonly view: MatchStatementView;
  readonly scrutinee: HirExpression;
  readonly context: HirLoweringContext;
  readonly lowerBlock: HirBlockLowerer;
}): HirValidationMatchStatement | undefined {
  const scrutineePlaceKey = placeKey(input.scrutinee);
  const validationPlaceKey =
    scrutineePlaceKey !== undefined
      ? (input.context.validationResultAliases.get(scrutineePlaceKey) ?? scrutineePlaceKey)
      : undefined;
  const validation =
    input.context.proofMetadata.findValidationByPendingResultPlaceKey(validationPlaceKey) ??
    input.context.proofMetadata.findValidationByExpressionId(input.scrutinee.expressionId);
  if (validation === undefined) {
    if (input.scrutinee.type.kind === "error") return undefined;
    if (!hasValidationResultType({ scrutinee: input.scrutinee, context: input.context })) {
      return undefined;
    }
    const sourceOrigin = sourceOriginForMatch(input.view, input.context);
    input.context.diagnostics.report(
      hirDiagnostic({
        code: "HIR_UNLINKED_VALIDATION_MATCH",
        message: "Validation match scrutinee is not a recorded validation result.",
        originId: sourceOrigin,
        ownerKey: hirOwnerKey(input.context),
        originKey: `origin:${sourceOrigin}`,
        stableDetail: "validation-match",
      }),
    );
    const owner = requireHirFunctionOwner({
      context: input.context,
      sourceOrigin,
      stableDetail: "validation-match-owner",
    });
    if (owner === undefined) return undefined;
    return {
      validationMatchId: ownedValidationId(owner, input.context.proofMetadata.count("validation")),
      scrutinee: input.scrutinee,
      sourceOrigin,
      recovered: true,
    };
  }

  const sourceOrigin = sourceOriginForMatch(input.view, input.context);
  const arms = input.view.arms();
  const okArmViews = arms.filter((arm) => validationArmRole(arm) === "ok");
  const errArmViews = arms.filter((arm) => validationArmRole(arm) === "err");
  const unknownArmCount = arms.length - okArmViews.length - errArmViews.length;
  if (okArmViews.length !== 1 || errArmViews.length !== 1 || unknownArmCount > 0) {
    reportAmbiguousValidationMatch({
      context: input.context,
      sourceOrigin,
      stableDetail: `ok:${okArmViews.length}:err:${errArmViews.length}:unknown:${unknownArmCount}`,
    });
    return {
      validationMatchId: validation.validationId,
      scrutinee: input.scrutinee,
      validation,
      sourceOrigin,
      recovered: true,
    };
  }

  const okArmView = okArmViews[0]!;
  const errArmView = errArmViews[0]!;
  return {
    validationMatchId: validation.validationId,
    scrutinee: input.scrutinee,
    validation,
    okArm: armFromView({
      context: input.context,
      arm: okArmView,
      patternText: okArmView.pattern()?.qualifiedName()?.text() ?? "Ok",
      payloadType: validation.okPayloadType,
      lowerBlock: input.lowerBlock,
      sourceOrigin,
    }),
    errArm: armFromView({
      context: input.context,
      arm: errArmView,
      patternText: errArmView.pattern()?.qualifiedName()?.text() ?? "Err",
      payloadType: validation.errPayloadType,
      lowerBlock: input.lowerBlock,
      sourceOrigin,
    }),
    sourceOrigin,
  };
}
