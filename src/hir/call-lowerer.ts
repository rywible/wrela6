import {
  ArgumentView,
  CallExpressionView,
  MemberAccessExpressionView,
  NamedArgumentView,
  NameExpressionView,
  TypeApplicationExpressionView,
  type ExpressionView,
} from "../frontend/ast/expression-views";
import { presentTokenSpan } from "../frontend/ast/syntax-query";
import type { TypeReferenceView } from "../frontend/ast/type-views";
import { concreteKind, errorKind } from "../semantic/surface/resource-kind";
import type { CheckedResourceKind } from "../semantic/surface/resource-kind";
import {
  appliedType,
  coreCheckedType,
  errorCheckedType,
  genericParameterCheckedType,
  sourceCheckedType,
  targetCheckedType,
} from "../semantic/surface/type-model";
import { coreTypeId, type CoreTypeId, type TargetTypeId, type TypeId } from "../semantic/ids";
import type { CertifiedPlatformBinding } from "../semantic/surface/checked-program";
import type { CheckedFunctionSignature } from "../semantic/surface/checked-program";
import type { CheckedType } from "../semantic/surface/type-model";
import { checkedTypesEqual } from "../semantic/surface/type-model";
import type { FunctionId, ItemId } from "../semantic/ids";
import type { HirCallArgument, HirCallExpression, HirExpression } from "./hir";
import type { HirLoweringContext } from "./lowering-context";
import { currentHirModuleId, hirDiagnostic } from "./lowering-context";
import { lowerExpression } from "./expression-lowerer";
import { lowerRequirementSurface } from "./requirement-lowerer";
import { lowerValidationCreation } from "./validation-lowerer";
import { composeCallProofMetadata } from "./call-proof-metadata";
import { inferCallTypeArguments } from "./generic-inference";
import { substituteCheckedSignature } from "./generic-substitution";
import { checkConstructibility } from "./constructibility";

export interface LowerCallExpressionInput {
  readonly view: CallExpressionView;
  readonly expectedType?: CheckedType;
  readonly context: HirLoweringContext;
}

function originForCall(view: CallExpressionView, context: HirLoweringContext) {
  return context.origins.forSyntax({
    moduleId: currentHirModuleId(context),
    node: view.node,
    ownerItemId: context.ownerItemId,
    ownerFunctionId: context.ownerFunctionId,
  });
}

function typeReferenceSpan(
  view: TypeReferenceView,
): { readonly start: number; readonly end: number } | undefined {
  const segments = view.qualifiedName()?.segments() ?? [];
  if (segments.length === 0) return undefined;
  const first = presentTokenSpan(segments[0]);
  const last = presentTokenSpan(segments[segments.length - 1]);
  if (first === undefined || last === undefined) return undefined;
  return { start: first.start, end: last.end };
}

type CheckedTypeConstructor =
  | { readonly kind: "source"; readonly typeId: TypeId }
  | { readonly kind: "core"; readonly coreTypeId: CoreTypeId }
  | { readonly kind: "target"; readonly targetTypeId: TargetTypeId };

function typeConstructorFor(type: CheckedType): CheckedTypeConstructor | undefined {
  if (type.kind === "source") return { kind: "source", typeId: type.typeId };
  if (type.kind === "core") return { kind: "core", coreTypeId: type.coreTypeId };
  if (type.kind === "target") return { kind: "target", targetTypeId: type.targetTypeId };
  return undefined;
}

function resolveTypeArgument(input: {
  readonly view: TypeReferenceView;
  readonly context: HirLoweringContext;
  readonly origin: import("./ids").HirOriginId;
}): CheckedType {
  const span = typeReferenceSpan(input.view);
  const reference =
    span !== undefined
      ? (input.context.referenceLookup.referenceForSpan({
          moduleId: currentHirModuleId(input.context),
          span,
          kind: "typeName",
        }) ??
        input.context.referenceLookup.referenceForSpan({
          moduleId: currentHirModuleId(input.context),
          span,
          kind: "typeParameter",
        }))
      : undefined;

  let baseType: CheckedType | undefined;
  if (reference?.kind === "builtinType") {
    baseType = coreCheckedType(reference.coreTypeId);
  } else if (reference?.kind === "type") {
    baseType = sourceCheckedType({ itemId: reference.itemId, typeId: reference.typeId });
  } else if (reference?.kind === "typeParameter") {
    baseType = genericParameterCheckedType({ owner: reference.owner, index: reference.index });
  } else if (reference?.kind === "targetType") {
    baseType = targetCheckedType(reference.targetTypeId);
  }

  if (baseType === undefined) {
    input.context.diagnostics.report(
      hirDiagnostic({
        code: "HIR_EXPLICIT_TYPE_ARGUMENT_NOT_TYPE",
        message: "Explicit call type argument is not a resolved type.",
        originId: input.origin,
        ownerKey: `function:${input.context.ownerFunctionId ?? 0}`,
        originKey: `origin:${input.origin}`,
        stableDetail: input.view.qualifiedNameText() ?? "type-argument",
      }),
    );
    return errorCheckedType();
  }

  const argumentTypes = input.view
    .typeArguments()
    .map((argument) => resolveTypeArgument({ ...input, view: argument }));
  if (argumentTypes.length === 0) return baseType;

  const constructor = typeConstructorFor(baseType);
  if (constructor === undefined) {
    input.context.diagnostics.report(
      hirDiagnostic({
        code: "HIR_EXPLICIT_TYPE_ARGUMENT_NOT_TYPE",
        message: "Explicit call type argument cannot be applied.",
        originId: input.origin,
        ownerKey: `function:${input.context.ownerFunctionId ?? 0}`,
        originKey: `origin:${input.origin}`,
        stableDetail: input.view.qualifiedNameText() ?? "type-argument",
      }),
    );
    return errorCheckedType();
  }

  return appliedType({
    constructor,
    arguments: argumentTypes,
    resourceKind: concreteKind("Copy"),
  });
}

function explicitTypeArguments(
  view: CallExpressionView,
  context: HirLoweringContext,
  origin: import("./ids").HirOriginId,
): readonly CheckedType[] {
  const callee = view.callee();
  if (!(callee instanceof TypeApplicationExpressionView)) return [];
  return callee
    .typeArguments()
    .map((argument) => resolveTypeArgument({ view: argument, context, origin }));
}

function unwrapTypeApplication(view: ExpressionView | undefined): ExpressionView | undefined {
  return view instanceof TypeApplicationExpressionView ? view.expression() : view;
}

function reportCallTypeMismatch(input: {
  readonly context: HirLoweringContext;
  readonly origin: import("./ids").HirOriginId;
  readonly expectedType: CheckedType | undefined;
  readonly actualType: CheckedType;
}): void {
  if (input.expectedType === undefined) return;
  if (input.actualType.kind === "error") return;
  if (checkedTypesEqual(input.expectedType, input.actualType)) return;
  input.context.diagnostics.report(
    hirDiagnostic({
      code: "HIR_EXPRESSION_TYPE_MISMATCH",
      message: "Call expression type does not match expected type.",
      originId: input.origin,
      ownerKey: `function:${input.context.ownerFunctionId ?? 0}`,
      originKey: `origin:${input.origin}`,
      stableDetail: "call-expression-type",
    }),
  );
}

function ownerTypeIdForItemId(
  context: HirLoweringContext,
  itemId: import("../semantic/ids").ItemId | undefined,
): TypeId | undefined {
  if (itemId === undefined) return undefined;
  return context.index.item(itemId)?.typeId;
}

function extractOwnerInfoFromType(type: CheckedType):
  | {
      readonly ownerTypeId: TypeId;
      readonly ownerTypeArguments: readonly CheckedType[];
    }
  | undefined {
  if (type.kind === "source") {
    return { ownerTypeId: type.typeId, ownerTypeArguments: [] };
  }
  if (type.kind === "applied" && type.constructor.kind === "source") {
    return {
      ownerTypeId: type.constructor.typeId,
      ownerTypeArguments: type.arguments,
    };
  }
  return undefined;
}

function containsErrorType(type: CheckedType): boolean {
  if (type.kind === "error") return true;
  if (type.kind !== "applied") return false;
  return type.arguments.some((argument) => containsErrorType(argument));
}

interface ResolvedCallee {
  readonly functionId?: FunctionId;
  readonly compilerIntrinsic?: import("../semantic/surface/checked-program").CheckedCompilerIntrinsicCall;
  readonly receiver?: HirExpression;
  readonly name: string;
}

function syntaxReferenceKeyString(
  key: import("../semantic/names/reference").SyntaxReferenceKey,
): string {
  return `${key.moduleId}:${key.span.start}:${key.span.end}:${key.kind}:${key.ordinal}`;
}

function compilerIntrinsicSourceValueKey(input: {
  readonly ownerFunctionId?: FunctionId;
  readonly expressionId: import("./ids").HirExpressionId;
}): string {
  const ownerKey =
    input.ownerFunctionId === undefined ? "function:unknown" : `function:${input.ownerFunctionId}`;
  return `hir.expression:${ownerKey}:${input.expressionId}`;
}

function resolveCallee(view: CallExpressionView, context: HirLoweringContext): ResolvedCallee {
  const callee = unwrapTypeApplication(view.callee());
  if (callee instanceof NameExpressionView) {
    const span = presentTokenSpan(callee.nameToken()) ?? callee.node.span;
    const referenceEntry = context.referenceLookup.referenceEntryForSpan({
      moduleId: currentHirModuleId(context),
      span,
      kind: "functionName",
    });
    const reference = referenceEntry?.reference;
    const compilerIntrinsic =
      reference?.kind === "compilerIntrinsic" && referenceEntry !== undefined
        ? context.program.compilerIntrinsicCalls.get(referenceEntry.key)
        : undefined;
    return {
      name: callee.nameText() ?? "",
      ...(reference?.kind === "function" ? { functionId: reference.functionId } : {}),
      ...(compilerIntrinsic !== undefined ? { compilerIntrinsic } : {}),
    };
  }

  if (callee instanceof MemberAccessExpressionView) {
    const receiverView = callee.receiver();
    const receiver =
      receiverView !== undefined ? lowerExpression({ view: receiverView, context }) : undefined;
    const memberSpan =
      presentTokenSpan(callee.memberToken()) ?? callee.memberToken()?.span ?? callee.node.span;
    const reference =
      context.referenceLookup.completedMemberForSpan({
        moduleId: currentHirModuleId(context),
        span: memberSpan,
        kind: "memberName",
      }) ??
      context.referenceLookup.completedMemberForSpan({
        moduleId: currentHirModuleId(context),
        span: memberSpan,
      });
    const fallbackFunctionId =
      reference?.kind === "function" || receiver === undefined
        ? undefined
        : functionIdForReceiverMember({
            context,
            receiver,
            memberName: callee.memberName() ?? "",
          });
    return {
      name: callee.memberName() ?? "",
      ...(receiver !== undefined ? { receiver } : {}),
      ...(reference?.kind === "function"
        ? { functionId: reference.functionId }
        : fallbackFunctionId !== undefined
          ? { functionId: fallbackFunctionId }
          : {}),
    };
  }

  return { name: "" };
}

function ownerItemIdForReceiverType(
  context: HirLoweringContext,
  type: CheckedType,
): ItemId | undefined {
  if (type.kind === "source") return type.itemId;
  if (type.kind !== "applied" || type.constructor.kind !== "source") return undefined;
  return context.index.type(type.constructor.typeId)?.itemId;
}

function functionIdForReceiverMember(input: {
  readonly context: HirLoweringContext;
  readonly receiver: HirExpression;
  readonly memberName: string;
}): FunctionId | undefined {
  const ownerItemId = ownerItemIdForReceiverType(input.context, input.receiver.type);
  if (ownerItemId === undefined) return undefined;
  return input.context.program.functions.entries().find((signature) => {
    if (signature.ownerItemId !== ownerItemId) return false;
    const item = input.context.index.item(signature.itemId);
    return item?.name === input.memberName;
  })?.functionId;
}

function calleeExpression(
  view: CallExpressionView,
  context: HirLoweringContext,
  callee: ResolvedCallee,
) {
  const origin = originForCall(view, context);
  const expression: HirExpression = {
    expressionId: context.bodyIndex.nextExpressionId(),
    kind: {
      kind: "name" as const,
      name: callee.name,
      ...(callee.functionId !== undefined ? { functionId: callee.functionId } : {}),
    },
    type: coreCheckedType(coreTypeId("Function")),
    resourceKind: concreteKind("Copy"),
    sourceOrigin: origin,
  };
  context.bodyIndex.addExpression(expression);
  return expression;
}

function predicateSurface(context: HirLoweringContext, calleeFunctionId: FunctionId | undefined) {
  if (calleeFunctionId === undefined) return undefined;
  return context.program.proofSurface.predicateFactSurfaces
    .entries()
    .find((surface) => surface.functionId === calleeFunctionId);
}

function platformEnsuredFactsForBinding(input: {
  readonly context: HirLoweringContext;
  readonly binding: CertifiedPlatformBinding;
}) {
  return input.context.program.proofSurface.platformEnsuredFacts.getByBinding({
    sourceFunctionId: input.binding.functionId,
    primitiveId: input.binding.primitiveId,
    contractId: input.binding.contractId,
    targetId: input.binding.targetId,
  });
}

function platformEnsuredFactsForFunction(
  context: HirLoweringContext,
  calleeFunctionId: FunctionId,
) {
  return context.program.proofSurface.platformEnsuredFacts.getByFunction(calleeFunctionId);
}

function reportUncertifiedPlatformEnsure(input: {
  readonly context: HirLoweringContext;
  readonly origin: import("./ids").HirOriginId;
  readonly calleeFunctionId: FunctionId;
  readonly count: number;
}): void {
  input.context.diagnostics.report(
    hirDiagnostic({
      code: "HIR_PLATFORM_ENSURE_NOT_CERTIFIED",
      message: "Platform ensured facts require a certified platform contract edge.",
      originId: input.origin,
      ownerKey: `function:${input.context.ownerFunctionId ?? 0}`,
      originKey: `origin:${input.origin}`,
      stableDetail: `platform-ensure:${input.calleeFunctionId}:${input.count}`,
    }),
  );
}

function lowerArgumentExpression(
  view: ArgumentView | NamedArgumentView,
  context: HirLoweringContext,
  expected: ExpectedCallArgument | undefined,
): HirExpression {
  const expressionView = view instanceof NamedArgumentView ? view.value() : view.expression();
  if (expressionView === undefined) {
    const origin = context.origins.forSyntax({
      moduleId: currentHirModuleId(context),
      node: view.node,
    });
    const expression: HirExpression = {
      expressionId: context.bodyIndex.nextExpressionId(),
      kind: { kind: "error", reason: "missing-argument" },
      type: errorCheckedType(),
      resourceKind: errorKind(),
      sourceOrigin: origin,
    };
    context.bodyIndex.addExpression(expression);
    return expression;
  }
  return lowerExpression({
    view: expressionView,
    context,
    ...(expected?.type === undefined ? {} : { expectedType: expected.type }),
    ...(expected?.resourceKind === undefined
      ? {}
      : { expectedResourceKind: expected.resourceKind }),
  });
}

interface ExpectedCallArgument {
  readonly type?: CheckedType;
  readonly resourceKind?: CheckedResourceKind;
}

function expectedForCallArgument(input: {
  readonly argument: ArgumentView | NamedArgumentView;
  readonly positionalIndex: number;
  readonly signature: CheckedFunctionSignature | undefined;
}): ExpectedCallArgument | undefined {
  const signature = input.signature;
  if (signature === undefined) return undefined;
  const parameter = (() => {
    if (input.argument instanceof NamedArgumentView) {
      const name = input.argument.nameText();
      return signature.parameters.find((candidate) => candidate.name === name);
    }
    return signature.parameters[input.positionalIndex];
  })();
  if (parameter === undefined) return undefined;
  return {
    ...(canUseAsCallArgumentExpectedType(parameter.type) ? { type: parameter.type } : {}),
    resourceKind: parameter.resourceKind,
  };
}

function canUseAsCallArgumentExpectedType(type: CheckedType): boolean {
  switch (type.kind) {
    case "core":
    case "source":
    case "target":
      return true;
    case "applied":
      return type.arguments.every(canUseAsCallArgumentExpectedType);
    case "genericParameter":
    case "error":
      return false;
  }
}

function reportCallArgumentMismatch(input: {
  readonly context: HirLoweringContext;
  readonly origin: import("./ids").HirOriginId;
  readonly stableDetail: string;
}): void {
  input.context.diagnostics.report(
    hirDiagnostic({
      code: "HIR_CALL_ARGUMENT_MISMATCH",
      message: "Call arguments do not match the checked function signature.",
      originId: input.origin,
      ownerKey: `function:${input.context.ownerFunctionId ?? 0}`,
      originKey: `origin:${input.origin}`,
      stableDetail: input.stableDetail,
    }),
  );
}

function checkCallArguments(input: {
  readonly context: HirLoweringContext;
  readonly origin: import("./ids").HirOriginId;
  readonly sourceArgumentCount: number;
  readonly orderedArguments: readonly HirCallArgument[];
  readonly signature: CheckedFunctionSignature;
}): boolean {
  let hasMismatch = false;
  if (
    input.sourceArgumentCount !== input.signature.parameters.length ||
    input.orderedArguments.length !== input.signature.parameters.length
  ) {
    hasMismatch = true;
    reportCallArgumentMismatch({
      context: input.context,
      origin: input.origin,
      stableDetail: `arity:${input.sourceArgumentCount}:${input.signature.parameters.length}`,
    });
  }

  for (const argument of input.orderedArguments) {
    if (argument.parameterId !== undefined) continue;
    hasMismatch = true;
    reportCallArgumentMismatch({
      context: input.context,
      origin: input.origin,
      stableDetail: `unknown-named:${argument.name ?? ""}`,
    });
  }

  for (const parameter of input.signature.parameters) {
    const argument = input.orderedArguments.find(
      (candidate) => candidate.parameterId === parameter.parameterId,
    );
    if (argument === undefined) continue;
    if (argument.expression.type.kind === "error") continue;
    if (checkedTypesEqual(parameter.type, argument.expression.type)) continue;
    hasMismatch = true;
    reportCallArgumentMismatch({
      context: input.context,
      origin: input.origin,
      stableDetail: `type:${parameter.parameterId}`,
    });
  }
  return hasMismatch;
}

function constructorAuthorized(input: {
  readonly context: HirLoweringContext;
  readonly signature: CheckedFunctionSignature;
  readonly calleeFunctionId: FunctionId;
  readonly sourceSpan: import("../shared/source-span").SourceSpan;
}): boolean {
  if (!input.signature.modifiers.isConstructor) return true;
  const result = checkConstructibility({
    targetType: input.signature.returnType,
    targetKind: input.signature.returnKind,
    constructorFunctionId: input.calleeFunctionId,
    surfaces: input.context.program.proofSurface.constructibilitySurfaces,
    sourceOrigin: input.sourceSpan,
    moduleId: currentHirModuleId(input.context),
  });
  for (const diagnostic of result.diagnostics) input.context.diagnostics.report(diagnostic);
  return result.allowed;
}

export function lowerCallExpression(input: LowerCallExpressionInput): HirExpression {
  const origin = originForCall(input.view, input.context);
  const resolvedCallee = resolveCallee(input.view, input.context);
  const calleeFunctionId = resolvedCallee.functionId;
  const originalSignature =
    calleeFunctionId !== undefined
      ? input.context.program.functions.get(calleeFunctionId)
      : undefined;

  if (
    resolvedCallee.compilerIntrinsic === undefined &&
    (calleeFunctionId === undefined || originalSignature === undefined)
  ) {
    input.context.diagnostics.report(
      hirDiagnostic({
        code: "HIR_CALL_CALLEE_NOT_FUNCTION",
        message: "Call callee is not a resolved function.",
        originId: origin,
        ownerKey: `function:${input.context.ownerFunctionId ?? 0}`,
        originKey: `origin:${origin}`,
        stableDetail: "callee",
      }),
    );
  }

  const sourceArguments = input.view.argumentList()?.arguments() ?? [];
  const loweredByName = new Map<string, HirCallArgument>();
  const positional: HirCallArgument[] = [];
  for (const sourceArgument of sourceArguments) {
    const loweredExpression = lowerArgumentExpression(
      sourceArgument,
      input.context,
      expectedForCallArgument({
        argument: sourceArgument,
        positionalIndex: positional.length,
        signature: originalSignature,
      }),
    );
    if (sourceArgument instanceof NamedArgumentView) {
      const name = sourceArgument.nameText() ?? "";
      loweredByName.set(name, { name, expression: loweredExpression });
    } else {
      positional.push({ expression: loweredExpression });
    }
  }

  const orderedArguments: HirCallArgument[] = [];
  if (originalSignature !== undefined) {
    const consumedNamed = new Set<string>();
    for (const parameter of originalSignature.parameters) {
      const named = loweredByName.get(parameter.name);
      if (named !== undefined) consumedNamed.add(parameter.name);
      const next = named ?? positional.shift();
      if (next !== undefined) {
        orderedArguments.push({
          ...next,
          name: parameter.name,
          parameterId: parameter.parameterId,
          mode: parameter.mode,
          place: next.expression.place,
        });
      }
    }
    for (const [name, argument] of loweredByName) {
      if (!consumedNamed.has(name)) orderedArguments.push(argument);
    }
    orderedArguments.push(...positional);
  } else {
    orderedArguments.push(...loweredByName.values(), ...positional);
  }

  let typeArguments: readonly CheckedType[] = [];
  let signature = originalSignature;
  let hasGenericMismatch = false;
  if (originalSignature !== undefined) {
    const explicitArguments = explicitTypeArguments(input.view, input.context, origin);
    const inference = inferCallTypeArguments({
      signature: originalSignature,
      explicitTypeArguments: explicitArguments,
      ...(resolvedCallee.receiver !== undefined
        ? { receiver: { type: resolvedCallee.receiver.type } }
        : {}),
      arguments: orderedArguments.map((argument) => ({ type: argument.expression.type })),
      expectedReturnType: input.expectedType,
      sourceSpan: input.view.node.span,
      moduleId: currentHirModuleId(input.context),
    });
    typeArguments = inference.typeArguments;
    hasGenericMismatch =
      explicitArguments.some((argument) => containsErrorType(argument)) ||
      typeArguments.some((argument) => containsErrorType(argument)) ||
      inference.diagnostics.length > 0;
    for (const diagnostic of inference.diagnostics) input.context.diagnostics.report(diagnostic);
    signature = substituteCheckedSignature({
      signature: originalSignature,
      typeArguments,
    });
  }

  const hasArgumentMismatch =
    signature !== undefined &&
    checkCallArguments({
      context: input.context,
      origin,
      sourceArgumentCount: sourceArguments.length,
      orderedArguments,
      signature,
    });
  const hasConstructibilityAuthority =
    signature !== undefined && calleeFunctionId !== undefined
      ? constructorAuthorized({
          context: input.context,
          signature,
          calleeFunctionId,
          sourceSpan: input.view.node.span,
        })
      : true;

  let ownerTypeId: TypeId | undefined;
  let ownerTypeArguments: readonly CheckedType[] = [];
  let ownerTypeArgumentSource: HirCallExpression["ownerTypeArgumentSource"] = "none";
  let ownerArgumentDerivationFailed = false;
  if (originalSignature?.modifiers.isConstructor === true) {
    const returnOwnerInfo = extractOwnerInfoFromType(
      signature?.returnType ?? originalSignature.returnType,
    );
    const expectedOwnerInfo =
      input.expectedType !== undefined ? extractOwnerInfoFromType(input.expectedType) : undefined;
    const ownerInfo =
      expectedOwnerInfo !== undefined &&
      (returnOwnerInfo === undefined ||
        expectedOwnerInfo.ownerTypeId === returnOwnerInfo.ownerTypeId)
        ? expectedOwnerInfo
        : returnOwnerInfo;
    if (ownerInfo !== undefined) {
      ownerTypeId = ownerInfo.ownerTypeId;
      ownerTypeArguments = ownerInfo.ownerTypeArguments;
      ownerTypeArgumentSource = "constructorExpectedType";
    } else {
      ownerTypeArgumentSource = "error";
      ownerArgumentDerivationFailed = true;
    }
  } else if (resolvedCallee.receiver !== undefined) {
    const ownerInfo = extractOwnerInfoFromType(resolvedCallee.receiver.type);
    if (ownerInfo !== undefined) {
      ownerTypeId = ownerInfo.ownerTypeId;
      ownerTypeArguments = ownerInfo.ownerTypeArguments;
      ownerTypeArgumentSource = "receiverType";
    } else {
      const receiverDerivedOwner = ownerTypeIdForItemId(
        input.context,
        originalSignature?.ownerItemId,
      );
      if (receiverDerivedOwner !== undefined) {
        ownerTypeId = receiverDerivedOwner;
        ownerTypeArguments = [];
        ownerTypeArgumentSource = "receiverType";
      } else {
        ownerTypeArgumentSource = "error";
        ownerArgumentDerivationFailed = true;
      }
    }
  } else if (originalSignature?.ownerItemId !== undefined) {
    const freeOwner = ownerTypeIdForItemId(input.context, originalSignature.ownerItemId);
    if (freeOwner !== undefined) {
      ownerTypeId = freeOwner;
      ownerTypeArguments = [];
      ownerTypeArgumentSource = "receiverType";
    }
  }

  const calleeExpressionValue = calleeExpression(input.view, input.context, resolvedCallee);
  const expressionId = input.context.bodyIndex.nextExpressionId();
  const compilerIntrinsic =
    resolvedCallee.compilerIntrinsic !== undefined
      ? {
          intrinsicKey: resolvedCallee.compilerIntrinsic.intrinsicKey,
          literalValue: resolvedCallee.compilerIntrinsic.literalValue,
          returnTypeKey: resolvedCallee.compilerIntrinsic.returnTypeKey,
          sourceValueKey: compilerIntrinsicSourceValueKey({
            ownerFunctionId: input.context.ownerFunctionId,
            expressionId,
          }),
          hirExpressionId: expressionId,
          semanticReferenceKey: syntaxReferenceKeyString(resolvedCallee.compilerIntrinsic.key),
        }
      : undefined;

  const call: HirCallExpression = {
    callee: calleeExpressionValue,
    ...(calleeFunctionId !== undefined ? { calleeFunctionId } : {}),
    ...(compilerIntrinsic !== undefined ? { compilerIntrinsic } : {}),
    ...(ownerTypeId !== undefined ? { ownerTypeId } : {}),
    ownerTypeArguments,
    ownerTypeArgumentSource,
    arguments: orderedArguments,
    typeArguments,
    ...(resolvedCallee.receiver !== undefined ? { receiver: resolvedCallee.receiver } : {}),
    sourceOrigin: origin,
    recovered:
      (resolvedCallee.compilerIntrinsic === undefined &&
        (calleeFunctionId === undefined || signature === undefined)) ||
      hasGenericMismatch ||
      hasArgumentMismatch ||
      !hasConstructibilityAuthority ||
      ownerArgumentDerivationFailed,
  };

  const expression: HirExpression = {
    expressionId,
    kind: { kind: "call", call },
    type:
      resolvedCallee.compilerIntrinsic?.returnType ?? signature?.returnType ?? errorCheckedType(),
    resourceKind:
      resolvedCallee.compilerIntrinsic !== undefined
        ? concreteKind("Copy")
        : (signature?.returnKind ?? errorKind()),
    sourceOrigin: origin,
  };
  input.context.bodyIndex.addExpression(expression);
  reportCallTypeMismatch({
    context: input.context,
    origin,
    expectedType: input.expectedType,
    actualType: expression.type,
  });
  if (!call.recovered && calleeFunctionId !== undefined && signature !== undefined) {
    const requirementSurfaces =
      input.context.program.proofSurface.requirementSurfaces.get(calleeFunctionId) ?? [];
    const sourceRequirements = requirementSurfaces.map((surface, ordinal) =>
      lowerRequirementSurface({
        surface,
        owner: { kind: "function", functionId: calleeFunctionId },
        context: input.context,
        ordinal,
      }),
    );
    const platformBinding = input.context.program.certifiedPlatformBindings.get(calleeFunctionId);
    if (platformBinding === undefined) {
      const uncertifiedEnsuredFacts = platformEnsuredFactsForFunction(
        input.context,
        calleeFunctionId,
      );
      if (uncertifiedEnsuredFacts.length > 0) {
        reportUncertifiedPlatformEnsure({
          context: input.context,
          origin,
          calleeFunctionId,
          count: uncertifiedEnsuredFacts.length,
        });
      }
    }
    composeCallProofMetadata({
      call,
      callExpressionId: expression.expressionId,
      context: input.context,
      sourceRequirements,
      ...(platformBinding !== undefined
        ? {
            platformBinding,
            platformEnsuredFacts: platformEnsuredFactsForBinding({
              context: input.context,
              binding: platformBinding,
            }),
          }
        : {}),
      terminalSurface: input.context.program.proofSurface.terminalSurfaces.get(calleeFunctionId),
      predicateSurface: predicateSurface(input.context, calleeFunctionId),
      privateTransitionSurface:
        input.context.program.proofSurface.privateTransitions.get(calleeFunctionId)[0],
    });
    lowerValidationCreation({
      call,
      validationExpressionId: expression.expressionId,
      context: input.context,
      sourceOrigin: origin,
      contracts: input.context.program.proofSurface.validationContracts.getByResultType(
        signature.returnType,
      ),
    });
  }
  return expression;
}
