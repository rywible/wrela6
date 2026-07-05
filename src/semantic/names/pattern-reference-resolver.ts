import type { QualifiedNameView } from "../../frontend/ast/name-views";
import type { PatternView } from "../../frontend/ast/pattern-views";
import { BlockView, MatchStatementView } from "../../frontend/ast/statement-views";
import { presentTokenSpan, presentTokenText } from "../../frontend/ast/syntax-query";
import { RedNode, SourceSpan } from "../../frontend";
import { SyntaxKind } from "../../frontend/syntax";
import { resolvedReferenceForItem } from "./scope";
import * as DiagnosticsModule from "./diagnostics";
import type { TypeResolutionContext } from "./type-reference-resolver";

export function walkPatternsInBlock(
  func: { body(): BlockView | undefined },
  context: TypeResolutionContext,
): void {
  const body = func.body();
  if (body === undefined) return;

  walkBlockForPatterns(body, context);
}

function walkBlockForPatterns(block: BlockView, context: TypeResolutionContext): void {
  for (const item of block.items()) {
    if (item.kind === SyntaxKind.MatchStatement) {
      const matchStmt = MatchStatementView.from(item);
      if (matchStmt === undefined) continue;

      for (const arm of matchStmt.arms()) {
        const pattern = arm.pattern();
        if (pattern !== undefined) {
          resolvePattern(pattern, context);
        }

        const armBody = arm.body();
        if (armBody !== undefined) {
          walkBlockForPatterns(armBody, context);
        }
      }
    }

    if (
      item.kind === SyntaxKind.IfStatement ||
      item.kind === SyntaxKind.WhileStatement ||
      item.kind === SyntaxKind.ForStatement
    ) {
      const blockNode = item
        .children()
        .find(
          (child): child is RedNode => child instanceof RedNode && child.kind === SyntaxKind.Block,
        );
      if (blockNode !== undefined) {
        const innerBlock = BlockView.from(blockNode);
        if (innerBlock !== undefined) {
          walkBlockForPatterns(innerBlock, context);
        }
      }
    }

    if (item.kind === SyntaxKind.ExpressionStatement) {
      const blockNode = item
        .children()
        .find(
          (child): child is RedNode => child instanceof RedNode && child.kind === SyntaxKind.Block,
        );
      if (blockNode !== undefined) {
        const innerBlock = BlockView.from(blockNode);
        if (innerBlock !== undefined) {
          walkBlockForPatterns(innerBlock, context);
        }
      }
    }

    if (item.kind === SyntaxKind.Block) {
      const innerBlock = BlockView.from(item);
      if (innerBlock !== undefined) {
        walkBlockForPatterns(innerBlock, context);
      }
    }
  }
}

function resolvePattern(pattern: PatternView, context: TypeResolutionContext): void {
  const qualifiedName = pattern.qualifiedName();
  if (qualifiedName === undefined) return;

  const segments = qualifiedName.segments();
  const segTexts = segments
    .map((token) => presentTokenText(token))
    .filter((token): token is string => token !== undefined);

  if (segTexts.length === 0) return;

  if (segTexts.length === 1) {
    const name = segTexts[0]!;
    const scopeResult = context.scope.lookupValue(name);
    if (scopeResult.kind === "resolved") {
      const firstSpan = presentTokenSpan(segments[0]);
      if (firstSpan === undefined) return;
      const nameSpan = SourceSpan.from(firstSpan.start, firstSpan.end);
      const key = context.referenceKeys.next({
        moduleId: context.moduleId,
        span: nameSpan,
        kind: "typeName",
      });
      context.references.add(key, scopeResult.reference);
    }
    return;
  }

  resolveQualifiedPattern(qualifiedName, segments, segTexts, context);
}

function resolveQualifiedPattern(
  qualifiedName: QualifiedNameView,
  segments: ReturnType<QualifiedNameView["segments"]>,
  segTexts: string[],
  context: TypeResolutionContext,
): void {
  const firstSpan = presentTokenSpan(segments[0]);
  const lastSpan = presentTokenSpan(segments[segments.length - 1]);
  if (firstSpan === undefined || lastSpan === undefined) return;
  const qnSpan = SourceSpan.from(firstSpan.start, lastSpan.end);

  const prefixResult = context.moduleNamespace.resolveQualifiedPrefix(segTexts);

  if (prefixResult.kind === "noModulePrefix") {
    const ownerResult = context.scope.lookupValue(segTexts[0]!);
    if (ownerResult.kind === "resolved") {
      const ownerRef = ownerResult.reference;

      if (ownerRef.kind === "item" || ownerRef.kind === "type") {
        const ownerItemId = ownerRef.itemId;
        const memberKey = context.referenceKeys.next({
          moduleId: context.moduleId,
          span: qnSpan,
          kind: "enumCase",
        });
        context.references.add(memberKey, ownerRef);

        for (let memberIndex = 1; memberIndex < segTexts.length; memberIndex++) {
          const memberName = segTexts[memberIndex]!;
          const memberResult = context.memberNamespace.resolveMember({
            ownerItemId,
            name: memberName,
          });
          if (memberResult.kind === "resolved") {
            const memberSpan = getSegmentSpan(segments, memberIndex);
            if (memberSpan === undefined) continue;
            const memKey = context.referenceKeys.next({
              moduleId: context.moduleId,
              span: memberSpan,
              kind:
                memberResult.reference.kind === "field"
                  ? "fieldName"
                  : memberResult.reference.kind === "function"
                    ? "functionName"
                    : "enumCase",
            });
            context.references.add(memKey, memberResult.reference);
          }
        }
      }
    }
    return;
  }

  if (prefixResult.kind === "prefixConsumesAllSegments") {
    const qnText = segTexts.join(".");
    const key = context.referenceKeys.next({
      moduleId: context.moduleId,
      span: qnSpan,
      kind: "typeName",
    });
    context.diagnostics.push(
      DiagnosticsModule.unresolvedName({
        source: context.source,
        span: qnSpan,
        order: { moduleId: context.moduleId, span: qnSpan, kind: "typeName", ordinal: key.ordinal },
        name: `Qualified name '${qnText}' resolves to a module, not an item.`,
      }),
    );
    return;
  }

  const targetItems = context.index.itemsInModule(prefixResult.moduleId);
  const matchedItems = targetItems.filter((item) => item.name === prefixResult.itemSegment);

  if (matchedItems.length === 0) {
    const itemSegIdx = prefixResult.moduleSegments.length;
    const itemSpan = getSegmentSpan(segments, itemSegIdx);
    if (itemSpan === undefined) return;
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
    const itemSegIdx = prefixResult.moduleSegments.length;
    const itemSpan = getSegmentSpan(segments, itemSegIdx);
    if (itemSpan === undefined) return;
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
  const itemSegIdx = prefixResult.moduleSegments.length;
  const itemSpan = getSegmentSpan(segments, itemSegIdx);
  if (itemSpan === undefined) return;

  const ref = resolvedReferenceForItem(context.index, item);
  const refKey = context.referenceKeys.next({
    moduleId: context.moduleId,
    span: itemSpan,
    kind: "moduleQualifiedItem",
  });
  context.references.add(refKey, ref);
}

function getSegmentSpan(
  segments: ReturnType<QualifiedNameView["segments"]>,
  index: number,
): SourceSpan | undefined {
  const seg = segments[index];
  if (seg === undefined) return undefined;
  const span = presentTokenSpan(seg);
  if (span === undefined) return undefined;
  return SourceSpan.from(span.start, span.end);
}
