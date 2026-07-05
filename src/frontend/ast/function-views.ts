import { AstView } from "./ast-view";
import {
  childNode,
  childNodes,
  childToken,
  childTokens,
  presentTokenText,
  presentTokenSpan,
} from "./syntax-query";
import { TypeParameterView, TypeReferenceView } from "./type-views";
import { BlockView } from "./statement-views";
import { RequiresSectionView } from "./requirement-views";
import { RedNode, RedToken, SyntaxKind } from "../syntax";

export type FunctionModifier = "private" | "platform" | "terminal" | "predicate" | "constructor";

const modifierMap: Partial<Record<SyntaxKind, FunctionModifier>> = {
  [SyntaxKind.PrivateKeyword]: "private",
  [SyntaxKind.PlatformKeyword]: "platform",
  [SyntaxKind.TerminalKeyword]: "terminal",
  [SyntaxKind.PredicateKeyword]: "predicate",
  [SyntaxKind.ConstructorKeyword]: "constructor",
};

export class FunctionDeclarationView extends AstView {
  static from(node: RedNode): FunctionDeclarationView | undefined {
    return node.kind === SyntaxKind.FunctionDeclaration
      ? new FunctionDeclarationView(node)
      : undefined;
  }

  nameToken(): RedToken | undefined {
    return childTokens(this.node, SyntaxKind.IdentifierToken).find((token) => !token.isMissing);
  }

  nameText(): string | undefined {
    return presentTokenText(this.nameToken());
  }

  nameSpan(): import("../lexer").SourceSpan | undefined {
    return presentTokenSpan(this.nameToken());
  }

  modifiers(): FunctionModifier[] {
    const modifierList = childNode(this.node, SyntaxKind.FunctionModifierList);
    if (modifierList === undefined) return [];
    return modifierList
      .children()
      .filter((child): child is RedToken => child instanceof RedToken)
      .filter((token) => !token.isMissing)
      .map((token) => modifierMap[token.kind])
      .filter((modifier): modifier is FunctionModifier => modifier !== undefined);
  }

  parameters(): ParameterView[] {
    const paramList = childNode(this.node, SyntaxKind.ParameterList);
    if (paramList === undefined) return [];
    return paramList
      .children()
      .filter(
        (child): child is RedNode =>
          child instanceof RedNode && child.kind === SyntaxKind.Parameter,
      )
      .map((node) => ParameterView.from(node)!)
      .filter((view): view is ParameterView => view !== undefined);
  }

  typeParameters(): TypeParameterView[] {
    const typeParamList = childNode(this.node, SyntaxKind.TypeParameterList);
    if (typeParamList === undefined) return [];
    return typeParamList
      .children()
      .filter(
        (child): child is RedNode =>
          child instanceof RedNode && child.kind === SyntaxKind.TypeParameter,
      )
      .map((node) => TypeParameterView.from(node)!)
      .filter((view): view is TypeParameterView => view !== undefined);
  }

  returnType(): TypeReferenceView | undefined {
    const returnClause = childNode(this.node, SyntaxKind.ReturnTypeClause);
    if (returnClause === undefined) return undefined;
    const typeNode = childNode(returnClause, SyntaxKind.TypeReference);
    return typeNode !== undefined ? TypeReferenceView.from(typeNode) : undefined;
  }

  body(): BlockView | undefined {
    const blockNode = childNode(this.node, SyntaxKind.Block);
    return blockNode !== undefined ? BlockView.from(blockNode) : undefined;
  }

  requiresSections(): RequiresSectionView[] {
    const directSections = childNodes(this.node, SyntaxKind.RequiresSection);
    const bodySections =
      this.body()
        ?.items()
        .filter((item) => item.kind === SyntaxKind.RequiresSection) ?? [];

    return [...directSections, ...bodySections]
      .map((node) => RequiresSectionView.from(node))
      .filter((view): view is RequiresSectionView => view !== undefined);
  }
}

export class ParameterView extends AstView {
  static from(node: RedNode): ParameterView | undefined {
    return node.kind === SyntaxKind.Parameter ? new ParameterView(node) : undefined;
  }

  nameToken(): RedToken | undefined {
    return childTokens(this.node, SyntaxKind.IdentifierToken).find((token) => !token.isMissing);
  }

  nameText(): string | undefined {
    return presentTokenText(this.nameToken());
  }

  nameSpan(): import("../lexer").SourceSpan | undefined {
    return presentTokenSpan(this.nameToken());
  }

  type(): TypeReferenceView | undefined {
    const typeNode = childNode(this.node, SyntaxKind.TypeReference);
    return typeNode !== undefined ? TypeReferenceView.from(typeNode) : undefined;
  }

  isConsumed(): boolean {
    return (
      childToken(this.node, SyntaxKind.ConsumeKeyword) !== undefined &&
      !childToken(this.node, SyntaxKind.ConsumeKeyword)!.isMissing
    );
  }
}
