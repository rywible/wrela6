import * as exprViews from "../../../frontend/ast/expression-views";
import { presentTokenSpan } from "../../../frontend/ast/syntax-query";
import * as DiagnosticsModule from "../diagnostics";
import type { ResolutionWalkContext } from "../expression-resolver";
import { referenceKindFromResolved } from "../expression-resolver";
import { localReference } from "../scope";

export function resolveSimpleNameExpression(
  expr: exprViews.NameExpressionView,
  context: ResolutionWalkContext,
): void {
  const name = expr.nameText();
  if (name === undefined) return;
  if (name === "true" || name === "false") return;
  const nameToken = expr.nameToken();
  if (nameToken === undefined) return;
  const span = presentTokenSpan(nameToken);
  if (span === undefined) return;

  const local = context.localNames.lookup(name);
  if (local !== undefined) {
    const key = context.referenceKeys.next({
      moduleId: context.moduleId,
      span,
      kind: "local",
    });
    context.references.add(key, localReference(local));
    return;
  }

  const scopeResult = context.scope.lookupValue(name);
  if (scopeResult.kind === "resolved") {
    const kind = referenceKindFromResolved(scopeResult.reference, context);
    const key = context.referenceKeys.next({
      moduleId: context.moduleId,
      span,
      kind,
    });
    context.references.add(key, scopeResult.reference);
  } else {
    const key = context.referenceKeys.next({
      moduleId: context.moduleId,
      span,
      kind: "functionName",
    });
    context.diagnostics.push(
      DiagnosticsModule.unresolvedName({
        source: context.source,
        span,
        order: {
          moduleId: context.moduleId,
          span,
          kind: "functionName",
          ordinal: key.ordinal,
        },
        name,
      }),
    );
  }
}
