import {
  SourceSpan,
  presentTokenSpan,
  type ParsedModuleGraph,
  type SourceText,
} from "../../frontend";
import {
  CallExpressionView,
  LiteralExpressionView,
  NameExpressionView,
  expressionViewFrom,
} from "../../frontend/ast/expression-views";
import { RedNode, SyntaxKind } from "../../frontend/syntax";
import type { ItemIndex } from "../item-index";
import type { ModuleId } from "../ids";
import { targetTypeId } from "../ids";
import type { SyntaxReferenceKey } from "../names/reference";
import type { SemanticSurfaceDiagnostic } from "./diagnostics";
import type { SurfaceReferenceLookup } from "./reference-lookup";
import { CheckedProgramBuilder } from "./checked-program";
import { targetCheckedType } from "./type-model";

export function collectCompilerIntrinsicCalls(
  input: {
    readonly graph: ParsedModuleGraph;
    readonly index: ItemIndex;
  },
  referenceLookup: SurfaceReferenceLookup,
  builder: CheckedProgramBuilder,
  diagnostics: SemanticSurfaceDiagnostic[],
): void {
  for (const parsedModule of input.graph.modules) {
    const moduleRecord = input.index
      .modules()
      .find((module) => module.pathKey === parsedModule.path.key);
    if (moduleRecord === undefined) continue;
    walkCompilerIntrinsicCalls(parsedModule.tree.root(), (call) =>
      collectCompilerIntrinsicCall({
        moduleId: moduleRecord.id,
        source: parsedModule.source,
        call,
        referenceLookup,
        builder,
        diagnostics,
      }),
    );
  }
}

function walkCompilerIntrinsicCalls(
  node: RedNode,
  visit: (call: CallExpressionView) => void,
): void {
  const expression = expressionViewFrom(node);
  if (expression instanceof CallExpressionView) {
    visit(expression);
  }
  for (const child of node.children()) {
    if (child instanceof RedNode) {
      walkCompilerIntrinsicCalls(child, visit);
    }
  }
}

function collectCompilerIntrinsicCall(args: {
  readonly moduleId: ModuleId;
  readonly source: SourceText;
  readonly call: CallExpressionView;
  readonly referenceLookup: SurfaceReferenceLookup;
  readonly builder: CheckedProgramBuilder;
  readonly diagnostics: SemanticSurfaceDiagnostic[];
}): void {
  const callee = args.call.callee();
  if (!(callee instanceof NameExpressionView)) return;
  const calleeSpan = presentTokenSpan(callee.nameToken()) ?? callee.node.span;
  const lookup = args.referenceLookup.findOne({
    moduleId: args.moduleId,
    span: calleeSpan,
    kind: "functionName",
  });
  if (lookup.kind !== "found") return;
  if (lookup.entry.reference.kind !== "compilerIntrinsic") return;

  const intrinsic = lookup.entry.reference;
  const argumentViews = args.call.argumentList()?.arguments() ?? [];
  if (argumentViews.length !== 1) {
    args.diagnostics.push(
      invalidCompilerIntrinsicCallDiagnostic({
        sourceName: intrinsic.sourceName,
        message: `Compiler intrinsic '${intrinsic.sourceName}' requires exactly one argument.`,
        source: args.source,
        span: args.call.node.span,
        moduleId: args.moduleId,
      }),
    );
    return;
  }

  const argumentView = argumentViews[0];
  const argumentExpression =
    argumentView !== undefined &&
    "expression" in argumentView &&
    typeof argumentView.expression === "function"
      ? argumentView.expression()
      : argumentView !== undefined &&
          "value" in argumentView &&
          typeof argumentView.value === "function"
        ? argumentView.value()
        : undefined;
  if (!(argumentExpression instanceof LiteralExpressionView)) {
    args.diagnostics.push(
      invalidCompilerIntrinsicCallDiagnostic({
        sourceName: intrinsic.sourceName,
        message: `Compiler intrinsic '${intrinsic.sourceName}' requires argument 1 to be a string literal.`,
        source: args.source,
        span: argumentExpression?.node.span ?? args.call.node.span,
        moduleId: args.moduleId,
      }),
    );
    return;
  }

  const token = argumentExpression.literalToken();
  if (token?.kind !== SyntaxKind.StringLiteralToken) {
    args.diagnostics.push(
      invalidCompilerIntrinsicCallDiagnostic({
        sourceName: intrinsic.sourceName,
        message: `Compiler intrinsic '${intrinsic.sourceName}' requires argument 1 to be a string literal.`,
        source: args.source,
        span: argumentExpression.node.span,
        moduleId: args.moduleId,
      }),
    );
    return;
  }

  args.builder.addCompilerIntrinsicCall({
    key: lookup.entry.key as SyntaxReferenceKey,
    sourceName: intrinsic.sourceName,
    intrinsicKey: intrinsic.intrinsicKey,
    literalValue: decodedStringLiteralValue(argumentExpression.literalText() ?? ""),
    returnTypeKey: intrinsic.returnTargetType,
    returnType: targetCheckedType(targetTypeId(intrinsic.returnTargetType)),
    sourceSpan: args.call.node.span,
  });
}

function decodedStringLiteralValue(text: string): string {
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (typeof parsed === "string") return parsed;
    } catch {
      return text.slice(1, -1);
    }
  }
  return text;
}

function invalidCompilerIntrinsicCallDiagnostic(input: {
  readonly sourceName: string;
  readonly message: string;
  readonly source: SourceText;
  readonly span: SourceSpan;
  readonly moduleId: ModuleId;
}): SemanticSurfaceDiagnostic {
  return {
    code: "SURFACE_INVALID_COMPILER_INTRINSIC_CALL",
    message: input.message,
    severity: "error",
    source: input.source,
    span: input.span,
    order: {
      moduleId: input.moduleId,
      span: input.span,
      codeTieBreaker: `compiler-intrinsic:${input.sourceName}`,
    },
  };
}
