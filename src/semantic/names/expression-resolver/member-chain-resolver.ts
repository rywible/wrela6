import * as exprViews from "../../../frontend/ast/expression-views";
import type { ExpressionView } from "../../../frontend/ast/expression-views";
import { presentTokenSpan } from "../../../frontend/ast/syntax-query";
import { SourceSpan } from "../../../frontend";
import type { ItemId, ModuleId } from "../../ids";
import { resolvedReferenceForItem } from "../scope";
import type { NameReferenceKind } from "../diagnostics";
import * as DiagnosticsModule from "../diagnostics";
import type { ResolvedReference } from "../reference";
import type { ResolutionWalkContext } from "../expression-resolver";
import { referenceKindFromResolved } from "../expression-resolver";

interface FlattenedChain {
  readonly base: ExpressionView;
  readonly segments: string[];
  readonly memberSpans: SourceSpan[];
}

function flattenMemberChain(
  expr: exprViews.MemberAccessExpressionView,
): FlattenedChain | undefined {
  const segments: string[] = [];
  const memberSpans: SourceSpan[] = [];
  let current: ExpressionView = expr;

  while (current instanceof exprViews.MemberAccessExpressionView) {
    const memberName = current.memberName();
    const memberToken = current.memberToken();
    const memberSpan = memberToken ? presentTokenSpan(memberToken) : undefined;
    if (memberName === undefined || memberSpan === undefined) return undefined;

    segments.unshift(memberName);
    memberSpans.unshift(memberSpan);

    const receiver = current.receiver();
    if (receiver === undefined) return undefined;
    current = receiver;
  }

  return { base: current, segments, memberSpans };
}

export function resolveMemberAccessExpression(
  expr: exprViews.MemberAccessExpressionView,
  context: ResolutionWalkContext,
  resolveExpression: (expr: ExpressionView, context: ResolutionWalkContext) => void,
): void {
  const flattened = flattenMemberChain(expr);
  if (flattened === undefined) return;

  const { base, segments, memberSpans } = flattened;

  let baseName: string | undefined;
  let baseSpan: SourceSpan | undefined;
  if (base instanceof exprViews.NameExpressionView) {
    baseName = base.nameText();
    const baseToken = base.nameToken();
    if (baseToken !== undefined) {
      baseSpan = presentTokenSpan(baseToken);
    }
  }

  if (baseName === undefined || baseSpan === undefined) {
    resolveExpression(base, context);
    for (let index = 0; index < segments.length; index++) {
      const memberSpan = memberSpans[index]!;
      context.references.addDeferredMember({
        key: context.referenceKeys.next({
          moduleId: context.moduleId,
          span: memberSpan,
          kind: "memberName",
        }),
        receiverExpressionKey: undefined,
        memberName: segments[index]!,
        memberSpan,
        allowedNamespaces: ["field", "function", "enumCase", "imageDevice"],
      });
    }
    return;
  }

  const fullSegments = [baseName, ...segments];

  if (context.localNames.has(baseName)) {
    return;
  }

  const prefixResult = context.moduleNamespace.resolveQualifiedPrefix(fullSegments);

  if (prefixResult.kind === "resolved") {
    resolveModuleQualifiedChain(prefixResult, segments, memberSpans, baseSpan, baseName, context);
    return;
  }

  if (prefixResult.kind === "prefixConsumesAllSegments") {
    const key = context.referenceKeys.next({
      moduleId: context.moduleId,
      span: baseSpan,
      kind: "moduleQualifiedItem",
    });
    context.diagnostics.push(
      DiagnosticsModule.unresolvedName({
        source: context.source,
        span: baseSpan,
        order: {
          moduleId: context.moduleId,
          span: baseSpan,
          kind: "moduleQualifiedItem",
          ordinal: key.ordinal,
        },
        name: fullSegments.join("."),
      }),
    );
    return;
  }

  let ownerResult = context.scope.lookupValue(baseName);
  if (ownerResult.kind === "unresolved") {
    const typeResult = context.scope.lookupType(baseName);
    if (typeResult.kind === "resolved" || typeResult.kind === "ambiguous") {
      ownerResult = typeResult;
    }
  }

  if (ownerResult.kind === "resolved") {
    const ownerRef = ownerResult.reference;
    const ownerKind = referenceKindFromResolved(ownerRef, context);
    const ownerKey = context.referenceKeys.next({
      moduleId: context.moduleId,
      span: baseSpan,
      kind: ownerKind,
    });
    context.references.add(ownerKey, ownerRef);

    const ownerItemId = getOwnerItemId(ownerRef, context);
    if (ownerItemId !== undefined) {
      resolveMembersOnOwner(ownerItemId, segments, memberSpans, baseName, ownerKey, context);
    } else if (ownerRef.kind === "function") {
      const key = context.referenceKeys.next({
        moduleId: context.moduleId,
        span: baseSpan,
        kind: "functionName",
      });
      context.diagnostics.push(
        DiagnosticsModule.qualifierNotOwner({
          source: context.source,
          span: baseSpan,
          order: {
            moduleId: context.moduleId,
            span: baseSpan,
            kind: "functionName",
            ordinal: key.ordinal,
          },
          qualifier: baseName,
        }),
      );
    } else {
      deferAllMembers(segments, memberSpans, ownerKey, context);
    }
  } else if (ownerResult.kind === "ambiguous") {
    const key = context.referenceKeys.next({
      moduleId: context.moduleId,
      span: baseSpan,
      kind: "functionName",
    });
    context.diagnostics.push(
      DiagnosticsModule.ambiguousName({
        source: context.source,
        span: baseSpan,
        order: {
          moduleId: context.moduleId,
          span: baseSpan,
          kind: "functionName",
          ordinal: key.ordinal,
        },
        name: baseName,
        candidates: ownerResult.candidates.map((candidate) => candidate.display),
      }),
    );
  } else {
    const key = context.referenceKeys.next({
      moduleId: context.moduleId,
      span: baseSpan,
      kind: "functionName",
    });
    context.diagnostics.push(
      DiagnosticsModule.unresolvedName({
        source: context.source,
        span: baseSpan,
        order: {
          moduleId: context.moduleId,
          span: baseSpan,
          kind: "functionName",
          ordinal: key.ordinal,
        },
        name: baseName,
      }),
    );
  }
}

function resolveModuleQualifiedChain(
  prefixResult: {
    moduleId: ModuleId;
    moduleSegments: readonly string[];
    itemSegment: string;
    memberSegments: readonly string[];
  },
  segments: string[],
  memberSpans: SourceSpan[],
  baseSpan: SourceSpan,
  baseName: string,
  context: ResolutionWalkContext,
): void {
  const targetItems = context.index.itemsInModule(prefixResult.moduleId);
  const matchedItems = targetItems.filter((item) => item.name === prefixResult.itemSegment);

  const itemSegIdx = prefixResult.moduleSegments.length;
  const segmentIndex = itemSegIdx - 1;

  let itemSpan: SourceSpan;
  if (segmentIndex >= 0 && segments.length > segmentIndex) {
    itemSpan = memberSpans[segmentIndex]!;
  } else {
    itemSpan = baseSpan;
  }

  if (matchedItems.length === 0) {
    const key = context.referenceKeys.next({
      moduleId: context.moduleId,
      span: itemSpan,
      kind: "moduleQualifiedItem",
    });
    context.diagnostics.push(
      DiagnosticsModule.unresolvedName({
        source: context.source,
        span: itemSpan,
        order: {
          moduleId: context.moduleId,
          span: itemSpan,
          kind: "moduleQualifiedItem",
          ordinal: key.ordinal,
        },
        name: prefixResult.itemSegment,
      }),
    );
    return;
  }

  if (matchedItems.length > 1) {
    const key = context.referenceKeys.next({
      moduleId: context.moduleId,
      span: itemSpan,
      kind: "moduleQualifiedItem",
    });
    context.diagnostics.push(
      DiagnosticsModule.ambiguousName({
        source: context.source,
        span: itemSpan,
        order: {
          moduleId: context.moduleId,
          span: itemSpan,
          kind: "moduleQualifiedItem",
          ordinal: key.ordinal,
        },
        name: prefixResult.itemSegment,
        candidates: matchedItems.map((matchedItem) => ({
          name: matchedItem.name,
          modulePath:
            context.index.module(matchedItem.moduleId)?.pathKey ?? String(matchedItem.moduleId),
          itemKind: matchedItem.kind,
          denseId: Number(matchedItem.id),
        })),
      }),
    );
    return;
  }

  const item = matchedItems[0]!;
  const ref = resolvedReferenceForItem(context.index, item);
  const refKey = context.referenceKeys.next({
    moduleId: context.moduleId,
    span: itemSpan,
    kind: "moduleQualifiedItem",
  });
  context.references.add(refKey, ref);

  if (prefixResult.memberSegments.length > 0) {
    resolveRemainingMembers(item.id, prefixResult.memberSegments, segments, memberSpans, context);
  }
}

function resolveRemainingMembers(
  ownerItemId: ItemId,
  memberSegments: readonly string[],
  allMemberSegments: string[],
  memberSpans: SourceSpan[],
  context: ResolutionWalkContext,
): void {
  const knownOwner = context.index.item(ownerItemId);
  const ownerName = knownOwner?.name ?? "";

  for (let index = 0; index < memberSegments.length; index++) {
    const memberName = memberSegments[index]!;
    const memberSpan = memberSpans[allMemberSegments.length - memberSegments.length + index]!;

    const memberResult = context.memberNamespace.resolveMember({
      ownerItemId,
      name: memberName,
    });

    if (memberResult.kind === "resolved") {
      const ref = memberResult.reference;
      const refKind: NameReferenceKind =
        ref.kind === "field"
          ? "fieldName"
          : ref.kind === "function"
            ? "functionName"
            : "memberName";
      const memberKey = context.referenceKeys.next({
        moduleId: context.moduleId,
        span: memberSpan,
        kind: refKind,
      });
      context.references.add(memberKey, ref);
    } else if (memberResult.kind === "ambiguous") {
      const memberKey = context.referenceKeys.next({
        moduleId: context.moduleId,
        span: memberSpan,
        kind: "memberName",
      });
      context.diagnostics.push(
        DiagnosticsModule.ambiguousMember({
          source: context.source,
          span: memberSpan,
          order: {
            moduleId: context.moduleId,
            span: memberSpan,
            kind: "memberName",
            ordinal: memberKey.ordinal,
          },
          ownerName,
          memberName,
          candidates: memberResult.candidates.map((candidate) => ({
            modulePath: "",
            itemKind: candidate.kind,
            name: memberName,
            denseId:
              "itemId" in candidate
                ? (candidate.itemId as number)
                : "fieldId" in candidate
                  ? (candidate.fieldId as number)
                  : 0,
          })),
        }),
      );
    } else {
      const memberKey = context.referenceKeys.next({
        moduleId: context.moduleId,
        span: memberSpan,
        kind: "memberName",
      });
      context.diagnostics.push(
        DiagnosticsModule.unresolvedMember({
          source: context.source,
          span: memberSpan,
          order: {
            moduleId: context.moduleId,
            span: memberSpan,
            kind: "memberName",
            ordinal: memberKey.ordinal,
          },
          ownerName,
          memberName,
        }),
      );
    }
  }
}

function resolveMembersOnOwner(
  ownerItemId: ItemId,
  segments: string[],
  memberSpans: SourceSpan[],
  ownerName: string,
  ownerKey: { moduleId: ModuleId; span: SourceSpan; kind: NameReferenceKind; ordinal: number },
  context: ResolutionWalkContext,
): void {
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
    const memberName = segments[segmentIndex]!;
    const memberSpan = memberSpans[segmentIndex]!;

    const memberResult = context.memberNamespace.resolveMember({
      ownerItemId,
      name: memberName,
    });

    if (memberResult.kind === "resolved") {
      const ref = memberResult.reference;
      const refKind: NameReferenceKind =
        ref.kind === "field"
          ? "fieldName"
          : ref.kind === "function"
            ? "functionName"
            : ref.kind === "item"
              ? "enumCase"
              : "memberName";
      const memberKey = context.referenceKeys.next({
        moduleId: context.moduleId,
        span: memberSpan,
        kind: refKind,
      });
      context.references.add(memberKey, ref);
    } else if (memberResult.kind === "ambiguous") {
      const memberKey = context.referenceKeys.next({
        moduleId: context.moduleId,
        span: memberSpan,
        kind: "memberName",
      });
      context.diagnostics.push(
        DiagnosticsModule.ambiguousMember({
          source: context.source,
          span: memberSpan,
          order: {
            moduleId: context.moduleId,
            span: memberSpan,
            kind: "memberName",
            ordinal: memberKey.ordinal,
          },
          ownerName,
          memberName,
          candidates: memberResult.candidates.map((candidate) => ({
            modulePath: "",
            itemKind: candidate.kind,
            name: memberName,
            denseId:
              "itemId" in candidate
                ? (candidate.itemId as number)
                : "fieldId" in candidate
                  ? (candidate.fieldId as number)
                  : 0,
          })),
        }),
      );
    } else {
      const memberKey = context.referenceKeys.next({
        moduleId: context.moduleId,
        span: memberSpan,
        kind: "memberName",
      });
      context.diagnostics.push(
        DiagnosticsModule.unresolvedMember({
          source: context.source,
          span: memberSpan,
          order: {
            moduleId: context.moduleId,
            span: memberSpan,
            kind: "memberName",
            ordinal: memberKey.ordinal,
          },
          ownerName,
          memberName,
        }),
      );
    }
  }
}

function deferAllMembers(
  segments: string[],
  memberSpans: SourceSpan[],
  previousKey:
    | { moduleId: ModuleId; span: SourceSpan; kind: NameReferenceKind; ordinal: number }
    | undefined,
  context: ResolutionWalkContext,
): void {
  let currentReceiverKey = previousKey;
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
    const memberName = segments[segmentIndex]!;
    const memberSpan = memberSpans[segmentIndex]!;
    const deferKey = context.referenceKeys.next({
      moduleId: context.moduleId,
      span: memberSpan,
      kind: "memberName",
    });
    context.references.addDeferredMember({
      key: deferKey,
      receiverExpressionKey: currentReceiverKey,
      memberName,
      memberSpan,
      allowedNamespaces: ["field", "function", "enumCase", "imageDevice"],
    });
    currentReceiverKey = deferKey;
  }
}

function getOwnerItemId(
  ref: ResolvedReference,
  context: ResolutionWalkContext,
): ItemId | undefined {
  switch (ref.kind) {
    case "type":
    case "item":
      return ref.itemId;
    case "image": {
      const imageRec = context.index.image(ref.imageId);
      return imageRec?.itemId;
    }
    default:
      return undefined;
  }
}
