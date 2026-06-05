import { AstView } from "./ast-view";
import {
  childNode,
  blockItems,
  childTokens,
  presentTokenText,
  presentTokenSpan,
} from "./syntax-query";
import { TypeReferenceView } from "./type-views";
import { expressionViewFrom, type ExpressionView } from "./expression-views";
import { RedNode, RedToken, SyntaxKind } from "../syntax";

export class FieldDeclarationView extends AstView {
  static from(node: RedNode): FieldDeclarationView | undefined {
    return node.kind === SyntaxKind.FieldDeclaration ? new FieldDeclarationView(node) : undefined;
  }

  nameToken(): RedToken | undefined {
    return childTokens(this.node, SyntaxKind.IdentifierToken).find((token) => !token.isMissing);
  }

  nameText(): string | undefined {
    return presentTokenText(this.nameToken());
  }

  nameSpan(): import("../../lexer").SourceSpan | undefined {
    return presentTokenSpan(this.nameToken());
  }

  type(): TypeReferenceView | undefined {
    const typeNode = childNode(this.node, SyntaxKind.TypeReference);
    return typeNode !== undefined ? TypeReferenceView.from(typeNode) : undefined;
  }
}

export class LayoutFieldView extends AstView {
  static from(node: RedNode): LayoutFieldView | undefined {
    return node.kind === SyntaxKind.LayoutField ? new LayoutFieldView(node) : undefined;
  }

  nameToken(): RedToken | undefined {
    return childTokens(this.node, SyntaxKind.IdentifierToken).find((token) => !token.isMissing);
  }

  nameText(): string | undefined {
    return presentTokenText(this.nameToken());
  }

  nameSpan(): import("../../lexer").SourceSpan | undefined {
    return presentTokenSpan(this.nameToken());
  }

  type(): TypeReferenceView | undefined {
    const typeNode = childNode(this.node, SyntaxKind.TypeReference);
    return typeNode !== undefined ? TypeReferenceView.from(typeNode) : undefined;
  }

  offsetExpression(): ExpressionView | undefined {
    const children = this.node
      .children()
      .filter((child): child is RedNode => child instanceof RedNode);
    let foundType = false;
    for (const child of children) {
      if (child.kind === SyntaxKind.TypeReference) {
        foundType = true;
        continue;
      }
      if (foundType && child.kind !== SyntaxKind.IdentifierToken) {
        const expr = expressionViewFrom(child);
        if (expr !== undefined) return expr;
      }
    }
    return undefined;
  }

  lengthExpression(): ExpressionView | undefined {
    const children = this.node
      .children()
      .filter((child): child is RedNode => child instanceof RedNode);
    const expressions = children
      .map((child) => expressionViewFrom(child))
      .filter((expr): expr is ExpressionView => expr !== undefined);
    if (expressions.length >= 2) {
      return expressions[1];
    }
    return undefined;
  }
}

export class DerivedFieldView extends AstView {
  static from(node: RedNode): DerivedFieldView | undefined {
    return node.kind === SyntaxKind.DerivedField ? new DerivedFieldView(node) : undefined;
  }

  nameToken(): RedToken | undefined {
    return childTokens(this.node, SyntaxKind.IdentifierToken).find((token) => !token.isMissing);
  }

  nameText(): string | undefined {
    return presentTokenText(this.nameToken());
  }

  nameSpan(): import("../../lexer").SourceSpan | undefined {
    return presentTokenSpan(this.nameToken());
  }

  type(): TypeReferenceView | undefined {
    const typeNode = childNode(this.node, SyntaxKind.TypeReference);
    return typeNode !== undefined ? TypeReferenceView.from(typeNode) : undefined;
  }

  sourceExpression(): ExpressionView | undefined {
    const children = this.node
      .children()
      .filter((child): child is RedNode => child instanceof RedNode);
    let afterType = false;
    for (const child of children) {
      if (child.kind === SyntaxKind.TypeReference) {
        afterType = true;
        continue;
      }
      if (
        afterType &&
        child.kind !== SyntaxKind.IdentifierToken &&
        child.kind !== SyntaxKind.Block
      ) {
        const expr = expressionViewFrom(child);
        if (expr !== undefined) return expr;
      }
    }
    return undefined;
  }

  cases(): DeriveCaseView[] {
    const block = childNode(this.node, SyntaxKind.Block);
    if (block === undefined) return [];
    return blockItems(block)
      .filter((node) => node.kind === SyntaxKind.DeriveCase)
      .map((node) => DeriveCaseView.from(node)!)
      .filter((view): view is DeriveCaseView => view !== undefined);
  }
}

export class DeriveCaseView extends AstView {
  static from(node: RedNode): DeriveCaseView | undefined {
    return node.kind === SyntaxKind.DeriveCase ? new DeriveCaseView(node) : undefined;
  }

  conditionExpression(): ExpressionView | undefined {
    const children = this.node
      .children()
      .filter((child): child is RedNode => child instanceof RedNode);
    for (const child of children) {
      const expr = expressionViewFrom(child);
      if (expr !== undefined) return expr;
    }
    return undefined;
  }

  resultExpression(): ExpressionView | undefined {
    const children = this.node
      .children()
      .filter((child): child is RedNode => child instanceof RedNode);
    const expressions = children
      .map((child) => expressionViewFrom(child))
      .filter((expr): expr is ExpressionView => expr !== undefined);
    if (expressions.length >= 2) {
      return expressions[1];
    }
    return undefined;
  }
}
