import {
  CallExpressionView,
  MemberAccessExpressionView,
  NameExpressionView,
} from "../frontend/ast/expression-views";
import { presentTokenSpan } from "../frontend/ast/syntax-query";
import type { FunctionId, ItemId } from "../semantic/ids";
import type { CheckedCompilerIntrinsicCall } from "../semantic/surface/checked-program";
import type { CheckedType } from "../semantic/surface/type-model";
import type { HirExpression } from "./hir";
import type { HirOriginId } from "./ids";
import type { HirLoweringContext } from "./lowering-context";
import { currentHirModuleId, hirDiagnostic, hirOwnerKey } from "./lowering-context";
import { lowerExpression } from "./expression-lowerer";

export interface ResolvedCallee {
  readonly functionId?: FunctionId;
  readonly enumCaseItemId?: ItemId;
  readonly compilerIntrinsic?: CheckedCompilerIntrinsicCall;
  readonly receiver?: HirExpression;
  readonly name: string;
}

export function resolveCallee(input: {
  readonly view: CallExpressionView;
  readonly context: HirLoweringContext;
  readonly origin: HirOriginId;
  readonly unwrapTypeApplication: (
    view: ReturnType<CallExpressionView["callee"]>,
  ) => ReturnType<CallExpressionView["callee"]>;
}): ResolvedCallee {
  const callee = input.unwrapTypeApplication(input.view.callee());
  if (callee instanceof NameExpressionView) {
    const name = callee.nameText();
    if (name === undefined) {
      reportMissingCallName({
        context: input.context,
        origin: input.origin,
        stableDetail: "callee",
      });
      return { name: "missing-callee-name" };
    }
    const span = presentTokenSpan(callee.nameToken()) ?? callee.node.span;
    const referenceEntry = input.context.referenceLookup.referenceEntryForSpan({
      moduleId: currentHirModuleId(input.context),
      span,
      kind: "functionName",
    });
    const reference = referenceEntry?.reference;
    const compilerIntrinsic =
      reference?.kind === "compilerIntrinsic" && referenceEntry !== undefined
        ? input.context.program.compilerIntrinsicCalls.get(referenceEntry.key)
        : undefined;
    return {
      name,
      ...(reference?.kind === "function" ? { functionId: reference.functionId } : {}),
      ...(compilerIntrinsic !== undefined ? { compilerIntrinsic } : {}),
    };
  }

  if (callee instanceof MemberAccessExpressionView) {
    const memberName = callee.memberName();
    if (memberName === undefined) {
      reportMissingCallName({
        context: input.context,
        origin: input.origin,
        stableDetail: "member",
      });
      return { name: "missing-member-name" };
    }
    const receiverView = callee.receiver();
    const receiver =
      receiverView !== undefined
        ? lowerExpression({ view: receiverView, context: input.context })
        : undefined;
    const memberSpan =
      presentTokenSpan(callee.memberToken()) ?? callee.memberToken()?.span ?? callee.node.span;
    const reference =
      input.context.referenceLookup.completedMemberForSpan({
        moduleId: currentHirModuleId(input.context),
        span: memberSpan,
        kind: "memberName",
      }) ??
      input.context.referenceLookup.completedMemberForSpan({
        moduleId: currentHirModuleId(input.context),
        span: memberSpan,
      }) ??
      input.context.referenceLookup.referenceForSpan({
        moduleId: currentHirModuleId(input.context),
        span: memberSpan,
        kind: "enumCase",
      });
    const fallbackFunctionId =
      reference?.kind === "function" || receiver === undefined
        ? undefined
        : functionIdForReceiverMember({
            context: input.context,
            receiver,
            memberName,
          });
    return {
      name: memberName,
      ...(receiver !== undefined ? { receiver } : {}),
      ...(reference?.kind === "function"
        ? { functionId: reference.functionId }
        : fallbackFunctionId !== undefined
          ? { functionId: fallbackFunctionId }
          : {}),
      ...(reference?.kind === "item" ? { enumCaseItemId: reference.itemId } : {}),
    };
  }

  return { name: "unsupported-callee" };
}

function reportMissingCallName(input: {
  readonly context: HirLoweringContext;
  readonly origin: HirOriginId;
  readonly stableDetail: string;
}): void {
  input.context.diagnostics.report(
    hirDiagnostic({
      code: "HIR_MISSING_NAME_TEXT",
      message: "Call expression is missing source name text.",
      originId: input.origin,
      ownerKey: hirOwnerKey(input.context),
      originKey: `origin:${input.origin}`,
      stableDetail: input.stableDetail,
    }),
  );
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
