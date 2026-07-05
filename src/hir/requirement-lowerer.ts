import type { CheckedRequirementSurface } from "../semantic/surface/proof-surface";
import type { CheckedRequirementReference } from "../semantic/surface/proof-surface";
import {
  BinaryExpressionView,
  CallExpressionView,
  ComparisonExpressionView,
  EqualityExpressionView,
  LiteralExpressionView,
  MemberAccessExpressionView,
  NameExpressionView,
  type ExpressionView,
} from "../frontend/ast/expression-views";
import { RequirementView } from "../frontend/ast/requirement-views";
import { descendants, presentTokenSpan } from "../frontend/ast/syntax-query";
import { SyntaxKind } from "../frontend/syntax";
import type {
  HirProofExpression,
  HirRequirement,
  HirRequirementExpression,
  HirRequirementOwner,
} from "./hir";
import type { HirLoweringContext } from "./lowering-context";
import { currentHirModuleId, hirDiagnostic, hirOwnerKey } from "./lowering-context";
import { hirProofExpressionId, ownedHirRequirementId } from "./ids";
import type { HirOriginId } from "./ids";
import { parseWrIntegerLiteral } from "../shared/integer-literal";

function ownerOrdinal(context: HirLoweringContext): number {
  return context.proofMetadata.count("callSiteRequirement");
}

function referenceKey(reference: CheckedRequirementReference): string {
  const key = reference.key;
  return `${key.moduleId}:${key.span.start}:${key.span.end}:${key.kind}:${key.ordinal}`;
}

function checkedRequirementReferences(
  surface: CheckedRequirementSurface,
): readonly CheckedRequirementReference[] {
  if (surface.expression.kind !== "checked") return [];
  return [...surface.expression.references, ...surface.expression.completedMembers];
}

function moduleIdForRequirement(surface: CheckedRequirementSurface, context: HirLoweringContext) {
  return checkedRequirementReferences(surface)[0]?.key.moduleId ?? currentHirModuleId(context);
}

function proofExpressionFromReference(input: {
  readonly reference: CheckedRequirementReference;
  readonly name: string;
  readonly sourceOrigin: HirOriginId;
  readonly proofExpressionId: ReturnType<typeof hirProofExpressionId>;
}): HirProofExpression {
  const resolved = input.reference.reference;
  return {
    proofExpressionId: input.proofExpressionId,
    kind: "reference",
    name: input.name,
    ...(resolved.kind === "function" ? { functionId: resolved.functionId } : {}),
    ...(resolved.kind === "field" ? { fieldId: resolved.fieldId } : {}),
    sourceOrigin: input.sourceOrigin,
  };
}

function reportRequirementDiagnostic(input: {
  readonly context: HirLoweringContext;
  readonly sourceOrigin: HirOriginId;
  readonly code:
    | "HIR_UNLOWERABLE_REQUIREMENT"
    | "HIR_UNSUPPORTED_REQUIREMENT_FORM"
    | "HIR_REQUIREMENT_REFERENCE_MISMATCH";
  readonly stableDetail: string;
}): void {
  input.context.diagnostics.report(
    hirDiagnostic({
      code: input.code,
      message: "Requirement expression cannot be lowered into a checked HIR proof expression.",
      originId: input.sourceOrigin,
      ownerKey: hirOwnerKey(input.context),
      originKey: `origin:${input.sourceOrigin}`,
      stableDetail: input.stableDetail,
    }),
  );
}

function reportMalformedRequirement(input: {
  readonly context: HirLoweringContext;
  readonly sourceOrigin: HirOriginId;
  readonly code:
    | "HIR_MISSING_LITERAL_TEXT"
    | "HIR_INVALID_INTEGER_LITERAL"
    | "HIR_MISSING_NAME_TEXT";
  readonly stableDetail: string;
  readonly message: string;
}): void {
  input.context.diagnostics.report(
    hirDiagnostic({
      code: input.code,
      message: input.message,
      originId: input.sourceOrigin,
      ownerKey: hirOwnerKey(input.context),
      originKey: `origin:${input.sourceOrigin}`,
      stableDetail: input.stableDetail,
    }),
  );
}

function requirementExpressionView(input: {
  readonly surface: CheckedRequirementSurface;
  readonly context: HirLoweringContext;
}): ExpressionView | undefined {
  const requirementModuleId = moduleIdForRequirement(input.surface, input.context);
  const moduleRecord = input.context.index.module(requirementModuleId);
  const parsedModule =
    moduleRecord !== undefined
      ? input.context.graph.modules.find((module) => module.path.key === moduleRecord.pathKey)
      : undefined;
  const root = parsedModule?.tree.root();
  if (root === undefined) return undefined;

  for (const node of descendants(root, SyntaxKind.Requirement)) {
    const requirement = RequirementView.from(node);
    const expression = requirement?.expression();
    if (expression === undefined) continue;
    if (
      expression.span.start === input.surface.span.start &&
      expression.span.end === input.surface.span.end
    ) {
      return expression;
    }
  }
  return undefined;
}

function referenceForSpan(input: {
  readonly surface: CheckedRequirementSurface;
  readonly references: readonly CheckedRequirementReference[];
  readonly span: { readonly start: number; readonly end: number };
  readonly consumed: Set<string>;
}): CheckedRequirementReference | undefined {
  return input.references.find((reference) => {
    if (input.consumed.has(referenceKey(reference))) return false;
    return (
      reference.key.span.start === input.span.start && reference.key.span.end === input.span.end
    );
  });
}

function buildProofExpression(input: {
  readonly surface: CheckedRequirementSurface;
  readonly references: readonly CheckedRequirementReference[];
  readonly view: ExpressionView;
  readonly sourceOrigin: HirOriginId;
  readonly context: HirLoweringContext;
  readonly consumed: Set<string>;
  readonly nextExpressionId: () => ReturnType<typeof hirProofExpressionId>;
}): HirProofExpression | undefined {
  if (input.view instanceof LiteralExpressionView) {
    const token = input.view.literalToken();
    if (token?.kind === SyntaxKind.TrueKeyword || token?.kind === SyntaxKind.FalseKeyword) {
      return {
        proofExpressionId: input.nextExpressionId(),
        kind: "literal",
        value: token.kind === SyntaxKind.TrueKeyword,
        sourceOrigin: input.sourceOrigin,
      };
    }
    const text = input.view.literalText();
    if (text === undefined) {
      reportMalformedRequirement({
        context: input.context,
        sourceOrigin: input.sourceOrigin,
        code: "HIR_MISSING_LITERAL_TEXT",
        message: "Requirement literal is missing source text.",
        stableDetail: token?.kind === SyntaxKind.StringLiteralToken ? "string" : "integer",
      });
      return undefined;
    }
    if (token?.kind === SyntaxKind.StringLiteralToken) {
      return {
        proofExpressionId: input.nextExpressionId(),
        kind: "literal",
        value: text,
        sourceOrigin: input.sourceOrigin,
      };
    }
    const value = parseWrIntegerLiteral(text);
    if (value === undefined) {
      reportMalformedRequirement({
        context: input.context,
        sourceOrigin: input.sourceOrigin,
        code: "HIR_INVALID_INTEGER_LITERAL",
        message: "Requirement integer literal text is not valid.",
        stableDetail: text,
      });
      return undefined;
    }
    return {
      proofExpressionId: input.nextExpressionId(),
      kind: "literal",
      value,
      sourceOrigin: input.sourceOrigin,
    };
  }

  if (input.view instanceof NameExpressionView) {
    const name = input.view.nameText();
    if (name === undefined) {
      reportMalformedRequirement({
        context: input.context,
        sourceOrigin: input.sourceOrigin,
        code: "HIR_MISSING_NAME_TEXT",
        message: "Requirement name is missing source text.",
        stableDetail: "name",
      });
      return undefined;
    }
    const span = presentTokenSpan(input.view.nameToken()) ?? input.view.node.span;
    const reference = referenceForSpan({
      surface: input.surface,
      references: input.references,
      span,
      consumed: input.consumed,
    });
    if (
      reference === undefined ||
      (reference.reference.kind !== "function" && reference.reference.kind !== "field")
    ) {
      return undefined;
    }
    input.consumed.add(referenceKey(reference));
    return proofExpressionFromReference({
      reference,
      name,
      sourceOrigin: input.sourceOrigin,
      proofExpressionId: input.nextExpressionId(),
    });
  }

  if (input.view instanceof MemberAccessExpressionView) {
    const span = presentTokenSpan(input.view.memberToken()) ?? input.view.node.span;
    const reference = referenceForSpan({
      surface: input.surface,
      references: input.references,
      span,
      consumed: input.consumed,
    });
    if (reference === undefined || reference.reference.kind !== "field") return undefined;
    input.consumed.add(referenceKey(reference));
    const name = input.view.memberName();
    if (name === undefined) {
      reportMalformedRequirement({
        context: input.context,
        sourceOrigin: input.sourceOrigin,
        code: "HIR_MISSING_NAME_TEXT",
        message: "Requirement member name is missing source text.",
        stableDetail: "member",
      });
      return undefined;
    }
    return proofExpressionFromReference({
      reference,
      name,
      sourceOrigin: input.sourceOrigin,
      proofExpressionId: input.nextExpressionId(),
    });
  }

  if (input.view instanceof CallExpressionView) {
    const callee = input.view.callee();
    const calleeSpan =
      callee instanceof NameExpressionView
        ? (presentTokenSpan(callee.nameToken()) ?? callee.node.span)
        : callee instanceof MemberAccessExpressionView
          ? (presentTokenSpan(callee.memberToken()) ?? callee.node.span)
          : undefined;
    if (calleeSpan === undefined) return undefined;
    const reference = referenceForSpan({
      surface: input.surface,
      references: input.references,
      span: calleeSpan,
      consumed: input.consumed,
    });
    if (reference === undefined || reference.reference.kind !== "function") return undefined;
    input.consumed.add(referenceKey(reference));
    const args: HirProofExpression[] = [];
    for (const argument of input.view.argumentList()?.arguments() ?? []) {
      const argumentExpression =
        "expression" in argument ? argument.expression() : argument.value();
      if (argumentExpression === undefined) return undefined;
      const lowered = buildProofExpression({ ...input, view: argumentExpression });
      if (lowered === undefined) return undefined;
      args.push(lowered);
    }
    return {
      proofExpressionId: input.nextExpressionId(),
      kind: "call",
      calleeFunctionId: reference.reference.functionId,
      arguments: args,
      sourceOrigin: input.sourceOrigin,
    };
  }

  if (
    input.view instanceof BinaryExpressionView ||
    input.view instanceof ComparisonExpressionView ||
    input.view instanceof EqualityExpressionView
  ) {
    const leftView = input.view.left();
    const rightView = input.view.right();
    if (leftView === undefined || rightView === undefined) return undefined;
    const left = buildProofExpression({ ...input, view: leftView });
    const right = buildProofExpression({ ...input, view: rightView });
    if (left === undefined || right === undefined) return undefined;
    const operator = input.view.operatorToken()?.green.lexeme;
    if (operator === undefined) return undefined;
    return {
      proofExpressionId: input.nextExpressionId(),
      kind: "binary",
      operator,
      left,
      right,
      sourceOrigin: input.sourceOrigin,
    };
  }

  return undefined;
}

function checkedRequirementExpression(input: {
  readonly surface: CheckedRequirementSurface;
  readonly references: readonly CheckedRequirementReference[];
  readonly sourceOrigin: HirOriginId;
  readonly context: HirLoweringContext;
}): HirRequirementExpression {
  const view = requirementExpressionView({ surface: input.surface, context: input.context });
  if (view === undefined) {
    reportRequirementDiagnostic({
      context: input.context,
      sourceOrigin: input.sourceOrigin,
      code: "HIR_UNLOWERABLE_REQUIREMENT",
      stableDetail: "missing-requirement-ast",
    });
    return { kind: "error", reason: "unlowerable-requirement" };
  }
  const sourceText = view.source.text.slice(view.span.start, view.span.end);
  if (sourceText !== input.surface.expression.text) {
    reportRequirementDiagnostic({
      context: input.context,
      sourceOrigin: input.sourceOrigin,
      code: "HIR_UNLOWERABLE_REQUIREMENT",
      stableDetail: "surface-text-mismatch",
    });
    return { kind: "error", reason: "unlowerable-requirement" };
  }
  let nextOrdinal = 0;
  const consumed = new Set<string>();
  const expression = buildProofExpression({
    surface: input.surface,
    references: input.references,
    view,
    sourceOrigin: input.sourceOrigin,
    context: input.context,
    consumed,
    nextExpressionId: () => hirProofExpressionId(nextOrdinal++),
  });
  if (expression === undefined) {
    reportRequirementDiagnostic({
      context: input.context,
      sourceOrigin: input.sourceOrigin,
      code: "HIR_REQUIREMENT_REFERENCE_MISMATCH",
      stableDetail: "reference",
    });
    return { kind: "error", reason: "requirement-reference-mismatch" };
  }
  if (consumed.size !== input.references.length) {
    reportRequirementDiagnostic({
      context: input.context,
      sourceOrigin: input.sourceOrigin,
      code: "HIR_UNSUPPORTED_REQUIREMENT_FORM",
      stableDetail: `unused-references:${input.references.length - consumed.size}`,
    });
    return { kind: "error", reason: "unsupported-requirement-form" };
  }
  return { kind: "structured", expression };
}

function requirementExpression(input: {
  readonly surface: CheckedRequirementSurface;
  readonly sourceOrigin: HirOriginId;
  readonly context: HirLoweringContext;
}): HirRequirementExpression {
  if (input.surface.expression.kind === "opaque") {
    return { kind: "opaque", text: input.surface.expression.text };
  }
  const references = checkedRequirementReferences(input.surface);
  return checkedRequirementExpression({
    surface: input.surface,
    references,
    sourceOrigin: input.sourceOrigin,
    context: input.context,
  });
}

export function lowerRequirementSurface(input: {
  readonly surface: CheckedRequirementSurface;
  readonly owner: HirRequirementOwner;
  readonly context: HirLoweringContext;
  readonly ordinal?: number;
}): HirRequirement {
  const ordinal = input.ordinal ?? ownerOrdinal(input.context);
  const sourceOrigin = input.context.origins.forSynthetic({
    moduleId: moduleIdForRequirement(input.surface, input.context),
    span: input.surface.span,
    stableDetail: `requirement:${input.surface.span.start}:${input.surface.span.end}`,
    ownerFunctionId: input.owner.kind === "function" ? input.owner.functionId : undefined,
  });
  return {
    requirementId: ownedHirRequirementId(input.owner, ordinal),
    owner: input.owner,
    expression: requirementExpression({
      surface: input.surface,
      sourceOrigin,
      context: input.context,
    }),
    sourceOrigin,
  };
}
