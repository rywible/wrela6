import type { CheckedTakeModeSurface } from "../semantic/surface/proof-contracts";
import { TakeStatementView } from "../frontend/ast/statement-views";
import { functionId, type FunctionId } from "../semantic/ids";
import { isProofRelevantKind } from "../semantic/surface/resource-kind";
import type { CheckedResourceKind } from "../semantic/surface/resource-kind";
import type { CheckedType } from "../semantic/surface/type-model";
import type {
  HirExpression,
  HirForIteration,
  HirLocal,
  HirTakeKind,
  HirTakeOperand,
  HirTakeStatement,
} from "./hir";
import type { HirBlockLowerer, HirLoweringContext } from "./lowering-context";
import type { HirExpressionLowerer } from "./lowering-context";
import { ownedBrandId, ownedObligationId, ownedSessionId } from "./ids";
import type { HirOriginId, HirStatementId } from "./ids";
import { currentHirModuleId, hirDiagnostic } from "./lowering-context";

type CheckedStreamTakeModeSurface = Extract<CheckedTakeModeSurface, { readonly kind: "stream" }>;

function owner(context: HirLoweringContext) {
  return { kind: "function" as const, functionId: context.ownerFunctionId ?? functionId(0) };
}

function sourceOriginForTake(view: TakeStatementView, context: HirLoweringContext): HirOriginId {
  return context.origins.forSyntax({
    moduleId: currentHirModuleId(context),
    node: view.node,
    ownerItemId: context.ownerItemId,
    ownerFunctionId: context.ownerFunctionId,
  });
}

function isProofRelevantExpression(expression: HirExpression): boolean {
  if (expression.resourceKind.kind !== "concrete") return false;
  return isProofRelevantKind(expression.resourceKind.value);
}

function hasNonConcreteProofRelevantKind(expression: HirExpression): boolean {
  return expression.resourceKind.kind !== "concrete" && expression.resourceKind.kind !== "error";
}

function reportUnclassifiedTake(input: {
  readonly context: HirLoweringContext;
  readonly sourceOrigin: HirOriginId;
}): void {
  input.context.diagnostics.report(
    hirDiagnostic({
      code: "HIR_UNCLASSIFIED_TAKE",
      message: "Take expression could not be classified by checked take-mode contracts.",
      originId: input.sourceOrigin,
      ownerKey: `function:${input.context.ownerFunctionId ?? 0}`,
      originKey: `origin:${input.sourceOrigin}`,
      stableDetail: "take",
    }),
  );
}

function reportProofRelevantKindNotConcrete(input: {
  readonly context: HirLoweringContext;
  readonly sourceOrigin: HirOriginId;
}): void {
  input.context.diagnostics.report(
    hirDiagnostic({
      code: "HIR_PROOF_RELEVANT_KIND_NOT_CONCRETE",
      message: "Proof-relevant take classification requires a concrete checked resource kind.",
      originId: input.sourceOrigin,
      ownerKey: `function:${input.context.ownerFunctionId ?? 0}`,
      originKey: `origin:${input.sourceOrigin}`,
      stableDetail: "take-resource-kind",
    }),
  );
}

function reportTakeOnlyCallRequired(input: {
  readonly context: HirLoweringContext;
  readonly sourceOrigin: HirOriginId;
}): void {
  input.context.diagnostics.report(
    hirDiagnostic({
      code: "HIR_TAKE_ONLY_CALL_REQUIRED",
      message: "Stream-producing call is missing checked take-only authorization.",
      originId: input.sourceOrigin,
      ownerKey: `function:${input.context.ownerFunctionId ?? 0}`,
      originKey: `origin:${input.sourceOrigin}`,
      stableDetail: "stream-call",
    }),
  );
}

function isUnauthorizedStreamCall(expression: HirExpression): boolean {
  return (
    expression.kind.kind === "call" &&
    expression.resourceKind.kind === "concrete" &&
    expression.resourceKind.value === "Stream"
  );
}

function isStreamSurfaceForCall(
  surface: CheckedTakeModeSurface,
  call: Extract<HirExpression["kind"], { readonly kind: "call" }>["call"] | undefined,
): surface is CheckedStreamTakeModeSurface {
  return surface.kind === "stream" && call?.calleeFunctionId === surface.producerFunctionId;
}

function takeSurfaces(context: HirLoweringContext): readonly CheckedTakeModeSurface[] {
  return context.program.proofSurface.takeModeSurfaces.entries();
}

function functionBrandCount(input: {
  readonly context: HirLoweringContext;
  readonly functionId: FunctionId;
}): number {
  return input.context.proofMetadata.countBrandsForFunction(input.functionId);
}

function addStreamMetadata(input: {
  readonly context: HirLoweringContext;
  readonly sourceOrigin: HirOriginId;
  readonly kind: "take" | "streamFor";
  readonly itemType: CheckedType;
  readonly itemResourceKind: CheckedResourceKind;
  readonly statementOrdinal: number;
}): Pick<
  Extract<HirTakeKind, { readonly kind: "stream" }>,
  "sessionId" | "itemBrandId" | "closureObligationId" | "itemType" | "itemResourceKind"
> {
  const currentOwner = owner(input.context);
  const ordinal = input.context.proofMetadata.count("session");
  const brandOrdinal = functionBrandCount({
    context: input.context,
    functionId: currentOwner.functionId,
  });
  const sessionId = ownedSessionId(currentOwner, ordinal);
  const itemBrandId = ownedBrandId(currentOwner, brandOrdinal);
  const closureObligationId = ownedObligationId(
    currentOwner.functionId,
    input.context.proofMetadata.count("obligation"),
  );
  input.context.proofMetadata
    .addSession({ sessionId, kind: input.kind, sourceOrigin: input.sourceOrigin })
    .addBrand({
      brandId: itemBrandId,
      canonicalKey: `function:${currentOwner.functionId}:take:${input.statementOrdinal}`,
      origin: {
        kind: "functionTake",
        functionId: currentOwner.functionId,
        statementOrdinal: input.statementOrdinal,
      },
      sourceOrigin: input.sourceOrigin,
    })
    .addObligation({
      obligationId: closureObligationId,
      kind: "streamClosure",
      sourceOrigin: input.sourceOrigin,
    });
  return {
    sessionId,
    itemBrandId,
    closureObligationId,
    itemType: input.itemType,
    itemResourceKind: input.itemResourceKind,
  };
}

export function classifyTakeExpression(input: {
  readonly expression: HirExpression;
  readonly context: HirLoweringContext;
  readonly takeSurfaces?: readonly CheckedTakeModeSurface[];
  readonly statementId?: HirStatementId;
}): { readonly kind: HirTakeKind } {
  const currentOwner = owner(input.context);
  const statementOrdinal = (input.statementId ??
    input.context.bodyIndex.peekNextStatementId()) as number;
  const legacyExpression = input.expression as unknown as {
    readonly kind?: unknown;
    readonly call?: unknown;
  };
  const call =
    input.expression.kind?.kind === "call"
      ? input.expression.kind.call
      : legacyExpression.kind === "call"
        ? (legacyExpression.call as Extract<
            HirExpression["kind"],
            { readonly kind: "call" }
          >["call"])
        : undefined;
  const streamSurface = input.takeSurfaces?.find((surface) =>
    isStreamSurfaceForCall(surface, call),
  );
  if (streamSurface !== undefined) {
    const { sessionId, itemBrandId, closureObligationId } = addStreamMetadata({
      context: input.context,
      sourceOrigin: input.expression.sourceOrigin,
      kind: "take",
      itemType: streamSurface.itemType,
      itemResourceKind: streamSurface.itemResourceKind,
      statementOrdinal,
    });
    return {
      kind: {
        kind: "stream",
        sessionId,
        itemBrandId,
        closureObligationId,
        itemType: streamSurface.itemType,
        itemResourceKind: streamSurface.itemResourceKind,
      },
    };
  }

  const bufferSurface = input.takeSurfaces?.find(
    (surface) =>
      surface.kind === "buffer" &&
      input.expression.type?.kind === "source" &&
      input.expression.type.typeId === surface.sourceTypeId,
  );
  if (bufferSurface !== undefined) {
    const bufferPlace = input.expression.place;
    if (bufferPlace === undefined) return { kind: { kind: "error" } };
    const obligationId = ownedObligationId(
      currentOwner.functionId,
      input.context.proofMetadata.count("obligation"),
    );
    input.context.proofMetadata.addObligation({
      obligationId,
      kind: "bufferDischarge",
      sourceOrigin: input.expression.sourceOrigin,
      place: bufferPlace,
    });
    return { kind: { kind: "buffer", bufferPlace, obligationId } };
  }

  const validatedBufferSurface = input.takeSurfaces?.find(
    (surface) =>
      surface.kind === "validatedBuffer" &&
      input.expression.type.kind === "source" &&
      input.expression.type.typeId === surface.validatedBufferTypeId,
  );
  if (validatedBufferSurface !== undefined) {
    const validatedBufferPlace = input.expression.place;
    if (validatedBufferPlace === undefined) return { kind: { kind: "error" } };
    const ordinal = input.context.proofMetadata.count("session");
    const brandOrdinal = functionBrandCount({
      context: input.context,
      functionId: currentOwner.functionId,
    });
    const sessionId = ownedSessionId(currentOwner, ordinal);
    const memberBrandId = ownedBrandId(currentOwner, brandOrdinal);
    const closureObligationId = ownedObligationId(
      currentOwner.functionId,
      input.context.proofMetadata.count("obligation"),
    );
    input.context.proofMetadata
      .addSession({
        sessionId,
        kind: "take",
        sourceOrigin: input.expression.sourceOrigin,
        place: validatedBufferPlace,
      })
      .addBrand({
        brandId: memberBrandId,
        canonicalKey: `function:${currentOwner.functionId}:take:${statementOrdinal}`,
        origin: {
          kind: "functionTake",
          functionId: currentOwner.functionId,
          statementOrdinal,
        },
        sourceOrigin: input.expression.sourceOrigin,
      })
      .addObligation({
        obligationId: closureObligationId,
        kind: "validatedBufferClosure",
        sourceOrigin: input.expression.sourceOrigin,
        place: validatedBufferPlace,
      });
    return { kind: { kind: "validatedBuffer", sessionId, memberBrandId, closureObligationId } };
  }

  return { kind: { kind: "error" } };
}

function operandForExpression(input: {
  readonly expression: HirExpression;
  readonly context: HirLoweringContext;
  readonly takeKind: HirTakeKind;
  readonly sourceOrigin: HirOriginId;
}): HirTakeOperand {
  if (input.expression.kind.kind === "call" && input.takeKind.kind === "stream") {
    const resultPlace = input.context.places.temporaryForExpression({
      type: input.expression.type,
      resourceKind: input.expression.resourceKind,
      sourceOrigin: input.sourceOrigin,
      proofRelevant: true,
    });
    if (resultPlace !== undefined) {
      return {
        kind: "takeOnlyCall",
        call: input.expression.kind.call,
        callExpressionId: input.expression.expressionId,
        resultType: input.expression.type,
        resultResourceKind: input.expression.resourceKind,
        resultPlace,
      };
    }
  }
  if (input.expression.place !== undefined) {
    return { kind: "place", place: input.expression.place, expression: input.expression };
  }
  return { kind: "error", expression: input.expression };
}

function aliasLocal(input: {
  readonly view: TakeStatementView;
  readonly expression: HirExpression;
  readonly context: HirLoweringContext;
  readonly takeKind: HirTakeKind;
}): HirLocal | undefined {
  const alias = input.view.aliasText();
  if (alias === undefined) return undefined;
  const span = input.view.aliasSpan() ?? input.view.node.span;
  const sourceOrigin = input.context.origins.forSynthetic({
    moduleId: currentHirModuleId(input.context),
    span,
    stableDetail: `take-alias:${alias}`,
    ownerItemId: input.context.ownerItemId,
    ownerFunctionId: input.context.ownerFunctionId,
  });
  const result = input.context.locals.addSourceLocal({
    name: alias,
    type: input.takeKind.kind === "stream" ? input.takeKind.itemType : input.expression.type,
    resourceKind:
      input.takeKind.kind === "stream"
        ? input.takeKind.itemResourceKind
        : input.expression.resourceKind,
    sourceOrigin,
    introducedBy: "takeAlias",
  });
  for (const diagnostic of result.diagnostics) input.context.diagnostics.report(diagnostic);
  return result.local;
}

export function lowerTakeStatement(input: {
  readonly view: TakeStatementView;
  readonly context: HirLoweringContext;
  readonly lowerExpression: HirExpressionLowerer;
  readonly lowerBlock: HirBlockLowerer;
  readonly statementId: HirStatementId;
}): HirTakeStatement {
  const sourceOrigin = sourceOriginForTake(input.view, input.context);
  const expressionView = input.view.expression();
  const expression =
    expressionView !== undefined
      ? input.lowerExpression({ view: expressionView, context: input.context })
      : undefined;
  if (expression === undefined) {
    reportUnclassifiedTake({ context: input.context, sourceOrigin });
    return {
      operand: { kind: "error" },
      takeKind: { kind: "error" },
      body: input.lowerBlock({ block: input.view.body(), context: input.context, sourceOrigin }),
      sourceOrigin,
    };
  }
  const classified = classifyTakeExpression({
    expression,
    context: input.context,
    takeSurfaces: takeSurfaces(input.context),
    statementId: input.statementId,
  });
  if (classified.kind.kind === "error" && isProofRelevantExpression(expression)) {
    if (isUnauthorizedStreamCall(expression)) {
      reportTakeOnlyCallRequired({ context: input.context, sourceOrigin });
    } else {
      reportUnclassifiedTake({ context: input.context, sourceOrigin });
    }
  } else if (classified.kind.kind === "error" && hasNonConcreteProofRelevantKind(expression)) {
    reportProofRelevantKindNotConcrete({ context: input.context, sourceOrigin });
  }
  return {
    operand: operandForExpression({
      expression,
      context: input.context,
      takeKind: classified.kind,
      sourceOrigin,
    }),
    takeKind: classified.kind,
    ...(input.view.aliasText() !== undefined
      ? {
          aliasLocal: aliasLocal({
            view: input.view,
            expression,
            context: input.context,
            takeKind: classified.kind,
          }),
        }
      : {}),
    body: input.lowerBlock({ block: input.view.body(), context: input.context, sourceOrigin }),
    sourceOrigin,
  };
}

export function classifyForIteration(input: {
  readonly iterable: HirExpression;
  readonly context: HirLoweringContext;
  readonly sourceOrigin: HirOriginId;
  readonly statementId?: HirStatementId;
}): HirForIteration {
  const statementOrdinal = (input.statementId ??
    input.context.bodyIndex.peekNextStatementId()) as number;
  const call = input.iterable.kind.kind === "call" ? input.iterable.kind.call : undefined;
  const streamSurface = takeSurfaces(input.context).find((surface) =>
    isStreamSurfaceForCall(surface, call),
  );
  if (streamSurface === undefined) {
    if (isUnauthorizedStreamCall(input.iterable)) {
      reportTakeOnlyCallRequired({
        context: input.context,
        sourceOrigin: input.sourceOrigin,
      });
      return { kind: "error" };
    }
    return { kind: "ordinary" };
  }
  const { sessionId, itemBrandId, closureObligationId } = addStreamMetadata({
    context: input.context,
    sourceOrigin: input.sourceOrigin,
    kind: "streamFor",
    itemType: streamSurface.itemType,
    itemResourceKind: streamSurface.itemResourceKind,
    statementOrdinal,
  });
  return {
    kind: "stream",
    sessionId,
    itemBrandId,
    closureObligationId,
    itemType: streamSurface.itemType,
    itemResourceKind: streamSurface.itemResourceKind,
  };
}
