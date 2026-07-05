import { PatternView } from "../../../frontend/ast/pattern-views";
import { presentTokenText, presentTokenSpan } from "../../../frontend/ast/syntax-query";
import { SourceSpan } from "../../../frontend";
import { resolvedReferenceForItem } from "../scope";
import type { NameReferenceKind } from "../diagnostics";
import * as DiagnosticsModule from "../diagnostics";
import type { ResolutionWalkContext } from "../expression-resolver";
import { getOwnerItemId, referenceKindFromResolved } from "../expression-resolver";

export function resolvePattern(pattern: PatternView, context: ResolutionWalkContext): void {
  const qualifiedName = pattern.qualifiedName();
  if (qualifiedName === undefined) return;

  const segmentsNodes = qualifiedName.segments();
  const segTexts = segmentsNodes
    .map((token) => presentTokenText(token))
    .filter((text): text is string => text !== undefined);

  if (segTexts.length === 0) return;

  if (segTexts.length === 1) {
    const name = segTexts[0]!;
    const scopeResult = context.scope.lookupValue(name);
    if (scopeResult.kind === "resolved") {
      const firstSpan = presentTokenSpan(segmentsNodes[0]);
      if (firstSpan === undefined) return;
      const nameSpan = SourceSpan.from(firstSpan.start, firstSpan.end);
      const kind = referenceKindFromResolved(scopeResult.reference, context);
      const key = context.referenceKeys.next({
        moduleId: context.moduleId,
        span: nameSpan,
        kind,
      });
      context.references.add(key, scopeResult.reference);
    }
    return;
  }

  const firstSpan = presentTokenSpan(segmentsNodes[0]);
  const lastSpan = presentTokenSpan(segmentsNodes[segmentsNodes.length - 1]);
  if (firstSpan === undefined || lastSpan === undefined) return;
  const qnSpan = SourceSpan.from(firstSpan.start, lastSpan.end);
  const modulePrefixResult = context.moduleNamespace.resolveQualifiedPrefix(segTexts);

  if (modulePrefixResult.kind === "noModulePrefix") {
    let ownerResult = context.scope.lookupValue(segTexts[0]!);
    if (ownerResult.kind === "unresolved") {
      const typeResult = context.scope.lookupType(segTexts[0]!);
      if (typeResult.kind === "resolved" || typeResult.kind === "ambiguous") {
        ownerResult = typeResult;
      }
    }
    if (ownerResult.kind === "resolved") {
      const ownerRef = ownerResult.reference;
      const ownerItemId = getOwnerItemId(ownerRef, context);
      if (ownerItemId !== undefined) {
        const ownerKey = context.referenceKeys.next({
          moduleId: context.moduleId,
          span: qnSpan,
          kind: "enumCase",
        });
        context.references.add(ownerKey, ownerRef);

        const memberSegments = segTexts.slice(1);
        for (let memberIndex = 0; memberIndex < memberSegments.length; memberIndex++) {
          const memberName = memberSegments[memberIndex]!;
          const memberSpan = getSegmentSpan(segmentsNodes, memberIndex + 1);
          if (memberSpan === undefined) continue;

          const memberResult = context.memberNamespace.resolveMember({
            ownerItemId,
            name: memberName,
          });
          if (memberResult.kind === "resolved") {
            const refKind: NameReferenceKind =
              memberResult.reference.kind === "field"
                ? "fieldName"
                : memberResult.reference.kind === "function"
                  ? "functionName"
                  : "enumCase";
            const memKey = context.referenceKeys.next({
              moduleId: context.moduleId,
              span: memberSpan,
              kind: refKind,
            });
            context.references.add(memKey, memberResult.reference);
          }
        }
      }
    }
    return;
  }

  if (modulePrefixResult.kind === "prefixConsumesAllSegments") {
    const key = context.referenceKeys.next({
      moduleId: context.moduleId,
      span: qnSpan,
      kind: "enumCase",
    });
    context.diagnostics.push(
      DiagnosticsModule.unresolvedName({
        source: context.source,
        span: qnSpan,
        order: {
          moduleId: context.moduleId,
          span: qnSpan,
          kind: "enumCase",
          ordinal: key.ordinal,
        },
        name: `Qualified name '${segTexts.join(".")}' resolves to a module, not an item.`,
      }),
    );
    return;
  }

  const targetItems = context.index.itemsInModule(modulePrefixResult.moduleId);
  const matchedItems = targetItems.filter((item) => item.name === modulePrefixResult.itemSegment);

  if (matchedItems.length === 0) {
    const itemSegIdx = modulePrefixResult.moduleSegments.length;
    const itemSpan = getSegmentSpan(segmentsNodes, itemSegIdx);
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
        name: modulePrefixResult.itemSegment,
      }),
    );
    return;
  }

  const itemSegIdx = modulePrefixResult.moduleSegments.length;
  const itemSpanResolved = getSegmentSpan(segmentsNodes, itemSegIdx);
  if (itemSpanResolved === undefined) return;

  if (matchedItems.length > 1) {
    const key = context.referenceKeys.next({
      moduleId: context.moduleId,
      span: itemSpanResolved,
      kind: "moduleQualifiedItem",
    });
    context.diagnostics.push(
      DiagnosticsModule.ambiguousName({
        source: context.source,
        span: itemSpanResolved,
        order: {
          moduleId: context.moduleId,
          span: itemSpanResolved,
          kind: "moduleQualifiedItem",
          ordinal: key.ordinal,
        },
        name: modulePrefixResult.itemSegment,
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
    span: itemSpanResolved,
    kind: "moduleQualifiedItem",
  });
  context.references.add(refKey, ref);

  const memberSegmentsToResolve = /* member segments after item */ [];
  const offset = modulePrefixResult.moduleSegments.length + 1;
  for (let segIndex = offset; segIndex < segmentsNodes.length; segIndex++) {
    const memberSpan = getSegmentSpan(segmentsNodes, segIndex);
    if (memberSpan === undefined) continue;
    const memberName = segTexts[segIndex]!;
    memberSegmentsToResolve.push({ name: memberName, span: memberSpan });
  }

  if (item.typeId !== undefined) {
    for (const { name, span } of memberSegmentsToResolve) {
      const memberResult = context.memberNamespace.resolveMember({
        ownerItemId: item.id,
        name,
      });
      if (memberResult.kind === "resolved") {
        const refKind: NameReferenceKind =
          memberResult.reference.kind === "field"
            ? "fieldName"
            : memberResult.reference.kind === "function"
              ? "functionName"
              : "memberName";
        const memKey = context.referenceKeys.next({
          moduleId: context.moduleId,
          span,
          kind: refKind,
        });
        context.references.add(memKey, memberResult.reference);
      }
    }
  }
}

function getSegmentSpan(
  segments: ReturnType<
    typeof import("../../../frontend/ast/name-views").QualifiedNameView.prototype.segments
  >,
  index: number,
): SourceSpan | undefined {
  const seg = segments[index];
  if (seg === undefined) return undefined;
  const span = presentTokenSpan(seg);
  if (span === undefined) return undefined;
  return SourceSpan.from(span.start, span.end);
}
