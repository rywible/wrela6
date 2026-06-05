import { AstView } from "./ast-view";
import { childNode, childTokens, presentTokenText, presentTokenSpan } from "./syntax-query";
import { QualifiedNameView } from "./name-views";
import { RedNode, RedToken, SyntaxKind } from "../syntax";

export class TypeReferenceView extends AstView {
  static from(node: RedNode): TypeReferenceView | undefined {
    return node.kind === SyntaxKind.TypeReference ? new TypeReferenceView(node) : undefined;
  }

  qualifiedName(): QualifiedNameView | undefined {
    const nameNode = childNode(this.node, SyntaxKind.QualifiedName);
    return nameNode !== undefined ? QualifiedNameView.from(nameNode) : undefined;
  }

  qualifiedNameText(): string | undefined {
    return this.qualifiedName()?.text();
  }

  typeArguments(): TypeReferenceView[] {
    const argumentList = childNode(this.node, SyntaxKind.TypeArgumentList);
    if (argumentList === undefined) return [];
    return argumentList
      .children()
      .filter(
        (child): child is RedNode =>
          child instanceof RedNode && child.kind === SyntaxKind.TypeReference,
      )
      .map((node) => TypeReferenceView.from(node)!)
      .filter((view): view is TypeReferenceView => view !== undefined);
  }
}

export class TypeParameterView extends AstView {
  static from(node: RedNode): TypeParameterView | undefined {
    return node.kind === SyntaxKind.TypeParameter ? new TypeParameterView(node) : undefined;
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

  bound(): TypeReferenceView | undefined {
    const boundNode = childNode(this.node, SyntaxKind.TypeReference);
    return boundNode !== undefined ? TypeReferenceView.from(boundNode) : undefined;
  }
}

export class TypeParameterListView extends AstView {
  static from(node: RedNode): TypeParameterListView | undefined {
    return node.kind === SyntaxKind.TypeParameterList ? new TypeParameterListView(node) : undefined;
  }

  parameters(): TypeParameterView[] {
    return this.node
      .children()
      .filter(
        (child): child is RedNode =>
          child instanceof RedNode && child.kind === SyntaxKind.TypeParameter,
      )
      .map((node) => TypeParameterView.from(node)!)
      .filter((view): view is TypeParameterView => view !== undefined);
  }
}

export class ReturnTypeClauseView extends AstView {
  static from(node: RedNode): ReturnTypeClauseView | undefined {
    return node.kind === SyntaxKind.ReturnTypeClause ? new ReturnTypeClauseView(node) : undefined;
  }

  type(): TypeReferenceView | undefined {
    const typeNode = childNode(this.node, SyntaxKind.TypeReference);
    return typeNode !== undefined ? TypeReferenceView.from(typeNode) : undefined;
  }
}
