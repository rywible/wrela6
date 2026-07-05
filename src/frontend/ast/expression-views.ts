import { AstView } from "./ast-view";
import { childNode, childNameToken, childTokens, presentTokenText } from "./syntax-query";
import { TypeReferenceView } from "./type-views";
import { RedNode, RedToken, SyntaxKind } from "../syntax";

export class LiteralExpressionView extends AstView {
  static from(node: RedNode): LiteralExpressionView | undefined {
    return node.kind === SyntaxKind.LiteralExpression ? new LiteralExpressionView(node) : undefined;
  }

  literalToken(): RedToken | undefined {
    const tokens = childTokens(this.node, SyntaxKind.IntegerLiteralToken)
      .concat(childTokens(this.node, SyntaxKind.StringLiteralToken))
      .concat(childTokens(this.node, SyntaxKind.TrueKeyword))
      .concat(childTokens(this.node, SyntaxKind.FalseKeyword));
    return tokens.find((token) => !token.isMissing);
  }

  literalText(): string | undefined {
    return presentTokenText(this.literalToken());
  }

  cookedStringValue(): string | undefined {
    const token = this.literalToken();
    if (token?.kind !== SyntaxKind.StringLiteralToken || token.isMissing) return undefined;
    return token.green.cookedValue;
  }
}

export class NameExpressionView extends AstView {
  static from(node: RedNode): NameExpressionView | undefined {
    return node.kind === SyntaxKind.NameExpression ? new NameExpressionView(node) : undefined;
  }

  nameToken(): RedToken | undefined {
    return childNameToken(this.node);
  }

  nameText(): string | undefined {
    return presentTokenText(this.nameToken());
  }
}

export class MemberAccessExpressionView extends AstView {
  static from(node: RedNode): MemberAccessExpressionView | undefined {
    return node.kind === SyntaxKind.MemberAccessExpression
      ? new MemberAccessExpressionView(node)
      : undefined;
  }

  receiver(): ExpressionView | undefined {
    const children = this.node.children();
    const firstChild = children[0];
    if (firstChild instanceof RedNode) {
      return expressionViewFrom(firstChild);
    }
    return undefined;
  }

  memberToken(): RedToken | undefined {
    return childNameToken(this.node);
  }

  memberName(): string | undefined {
    return presentTokenText(this.memberToken());
  }
}

export class ParenthesizedExpressionView extends AstView {
  static from(node: RedNode): ParenthesizedExpressionView | undefined {
    return node.kind === SyntaxKind.ParenthesizedExpression
      ? new ParenthesizedExpressionView(node)
      : undefined;
  }

  expression(): ExpressionView | undefined {
    return expressionViewFrom(
      this.node.children().find((child): child is RedNode => child instanceof RedNode),
    );
  }
}

export class IndexExpressionView extends AstView {
  static from(node: RedNode): IndexExpressionView | undefined {
    return node.kind === SyntaxKind.IndexExpression ? new IndexExpressionView(node) : undefined;
  }

  receiver(): ExpressionView | undefined {
    const children = this.node.children();
    const receiver = children[0];
    return receiver instanceof RedNode ? expressionViewFrom(receiver) : undefined;
  }

  index(): ExpressionView | undefined {
    const expressionChildren = this.node
      .children()
      .filter((child): child is RedNode => child instanceof RedNode);
    return expressionViewFrom(expressionChildren[1]);
  }
}

export class CallExpressionView extends AstView {
  static from(node: RedNode): CallExpressionView | undefined {
    return node.kind === SyntaxKind.CallExpression ? new CallExpressionView(node) : undefined;
  }

  callee(): ExpressionView | undefined {
    return expressionViewFrom(
      this.node
        .children()
        .find(
          (child): child is RedNode =>
            child instanceof RedNode && child.kind !== SyntaxKind.CallArgumentList,
        ),
    );
  }

  argumentList(): CallArgumentListView | undefined {
    const listNode = childNode(this.node, SyntaxKind.CallArgumentList);
    return listNode !== undefined ? CallArgumentListView.from(listNode) : undefined;
  }

  arguments(): CallArgumentListView | undefined {
    return this.argumentList();
  }
}

export class TypeApplicationExpressionView extends AstView {
  static from(node: RedNode): TypeApplicationExpressionView | undefined {
    return node.kind === SyntaxKind.TypeApplicationExpression
      ? new TypeApplicationExpressionView(node)
      : undefined;
  }

  expression(): ExpressionView | undefined {
    return expressionViewFrom(
      this.node
        .children()
        .find(
          (child): child is RedNode =>
            child instanceof RedNode && child.kind !== SyntaxKind.TypeArgumentList,
        ),
    );
  }

  typeArguments(): TypeReferenceView[] {
    const argList = childNode(this.node, SyntaxKind.TypeArgumentList);
    if (argList === undefined) return [];
    return argList
      .children()
      .filter(
        (child): child is RedNode =>
          child instanceof RedNode && child.kind === SyntaxKind.TypeReference,
      )
      .map((node) => TypeReferenceView.from(node))
      .filter((view): view is TypeReferenceView => view !== undefined);
  }
}

export class AttemptExpressionView extends AstView {
  static from(node: RedNode): AttemptExpressionView | undefined {
    return node.kind === SyntaxKind.AttemptExpression ? new AttemptExpressionView(node) : undefined;
  }

  expression(): ExpressionView | undefined {
    return expressionViewFrom(
      this.node.children().find((child): child is RedNode => child instanceof RedNode),
    );
  }

  alternative(): ExpressionView | undefined {
    const children = this.node
      .children()
      .filter((child): child is RedNode => child instanceof RedNode);
    if (children.length >= 2) {
      return expressionViewFrom(children[1]);
    }
    return undefined;
  }
}

export class UnaryExpressionView extends AstView {
  static from(node: RedNode): UnaryExpressionView | undefined {
    return node.kind === SyntaxKind.UnaryExpression ? new UnaryExpressionView(node) : undefined;
  }

  operatorToken(): RedToken | undefined {
    const operators = childTokens(this.node, SyntaxKind.MinusToken)
      .concat(childTokens(this.node, SyntaxKind.NotKeyword))
      .concat(childTokens(this.node, SyntaxKind.TildeToken))
      .concat(childTokens(this.node, SyntaxKind.StarToken));
    return operators.find((token) => !token.isMissing);
  }

  operand(): ExpressionView | undefined {
    const children = this.node.children();
    for (let index = 0; index < children.length; index++) {
      const child = children[index];
      if (child instanceof RedNode) {
        const view = expressionViewFrom(child);
        if (view !== undefined) return view;
      }
    }
    return undefined;
  }
}

export class BinaryExpressionView extends AstView {
  static from(node: RedNode): BinaryExpressionView | undefined {
    return node.kind === SyntaxKind.BinaryExpression ? new BinaryExpressionView(node) : undefined;
  }

  operatorToken(): RedToken | undefined {
    const operators = childTokens(this.node, SyntaxKind.PlusToken)
      .concat(childTokens(this.node, SyntaxKind.MinusToken))
      .concat(childTokens(this.node, SyntaxKind.StarToken))
      .concat(childTokens(this.node, SyntaxKind.SlashToken))
      .concat(childTokens(this.node, SyntaxKind.PercentToken))
      .concat(childTokens(this.node, SyntaxKind.AmpersandToken))
      .concat(childTokens(this.node, SyntaxKind.PipeToken))
      .concat(childTokens(this.node, SyntaxKind.CaretToken))
      .concat(childTokens(this.node, SyntaxKind.LeftShiftToken))
      .concat(childTokens(this.node, SyntaxKind.RightShiftToken))
      .concat(childTokens(this.node, SyntaxKind.AndKeyword))
      .concat(childTokens(this.node, SyntaxKind.OrKeyword));
    return operators.find((token) => !token.isMissing);
  }

  left(): ExpressionView | undefined {
    const children = this.node.children();
    for (const child of children) {
      if (child instanceof RedNode) {
        const view = expressionViewFrom(child);
        if (view !== undefined) return view;
        break;
      }
    }
    return undefined;
  }

  right(): ExpressionView | undefined {
    const children = this.node.children();
    let foundFirst = false;
    for (const child of children) {
      if (child instanceof RedNode) {
        if (foundFirst) {
          const view = expressionViewFrom(child);
          if (view !== undefined) return view;
        } else {
          foundFirst = true;
        }
      }
    }
    return undefined;
  }
}

export class ComparisonExpressionView extends AstView {
  static from(node: RedNode): ComparisonExpressionView | undefined {
    return node.kind === SyntaxKind.ComparisonExpression
      ? new ComparisonExpressionView(node)
      : undefined;
  }

  operatorToken(): RedToken | undefined {
    const operators = childTokens(this.node, SyntaxKind.LessToken)
      .concat(childTokens(this.node, SyntaxKind.GreaterToken))
      .concat(childTokens(this.node, SyntaxKind.LessEqualsToken))
      .concat(childTokens(this.node, SyntaxKind.GreaterEqualsToken));
    return operators.find((token) => !token.isMissing);
  }

  left(): ExpressionView | undefined {
    const children = this.node.children();
    for (const child of children) {
      if (child instanceof RedNode) {
        const view = expressionViewFrom(child);
        if (view !== undefined) return view;
        break;
      }
    }
    return undefined;
  }

  right(): ExpressionView | undefined {
    const children = this.node.children();
    let foundFirst = false;
    for (const child of children) {
      if (child instanceof RedNode) {
        if (foundFirst) {
          const view = expressionViewFrom(child);
          if (view !== undefined) return view;
        } else {
          foundFirst = true;
        }
      }
    }
    return undefined;
  }
}

export class EqualityExpressionView extends AstView {
  static from(node: RedNode): EqualityExpressionView | undefined {
    return node.kind === SyntaxKind.EqualityExpression
      ? new EqualityExpressionView(node)
      : undefined;
  }

  operatorToken(): RedToken | undefined {
    const operators = childTokens(this.node, SyntaxKind.EqualsEqualsToken).concat(
      childTokens(this.node, SyntaxKind.BangEqualsToken),
    );
    return operators.find((token) => !token.isMissing);
  }

  left(): ExpressionView | undefined {
    const children = this.node.children();
    for (const child of children) {
      if (child instanceof RedNode) {
        const view = expressionViewFrom(child);
        if (view !== undefined) return view;
        break;
      }
    }
    return undefined;
  }

  right(): ExpressionView | undefined {
    const children = this.node.children();
    let foundFirst = false;
    for (const child of children) {
      if (child instanceof RedNode) {
        if (foundFirst) {
          const view = expressionViewFrom(child);
          if (view !== undefined) return view;
        } else {
          foundFirst = true;
        }
      }
    }
    return undefined;
  }
}

export class ObjectLiteralExpressionView extends AstView {
  static from(node: RedNode): ObjectLiteralExpressionView | undefined {
    return node.kind === SyntaxKind.ObjectLiteralExpression
      ? new ObjectLiteralExpressionView(node)
      : undefined;
  }

  fields(): ObjectFieldView[] {
    return this.node
      .children()
      .filter(
        (child): child is RedNode =>
          child instanceof RedNode && child.kind === SyntaxKind.ObjectField,
      )
      .map((node) => ObjectFieldView.from(node))
      .filter((view): view is ObjectFieldView => view !== undefined);
  }
}

export class ObjectFieldView extends AstView {
  static from(node: RedNode): ObjectFieldView | undefined {
    return node.kind === SyntaxKind.ObjectField ? new ObjectFieldView(node) : undefined;
  }

  nameToken(): RedToken | undefined {
    return childNameToken(this.node);
  }

  nameText(): string | undefined {
    return presentTokenText(this.nameToken());
  }

  value(): ExpressionView | undefined {
    return expressionViewFrom(
      this.node.children().find((child): child is RedNode => child instanceof RedNode),
    );
  }
}

export class ElseRequirementExpressionView extends AstView {
  static from(node: RedNode): ElseRequirementExpressionView | undefined {
    return node.kind === SyntaxKind.ElseRequirementExpression
      ? new ElseRequirementExpressionView(node)
      : undefined;
  }

  condition(): ExpressionView | undefined {
    const children = this.node.children();
    for (const child of children) {
      if (child instanceof RedNode) {
        const view = expressionViewFrom(child);
        if (view !== undefined) return view;
        break;
      }
    }
    return undefined;
  }

  alternative(): ExpressionView | undefined {
    const children = this.node.children();
    let foundFirst = false;
    for (const child of children) {
      if (child instanceof RedNode) {
        if (foundFirst) {
          const view = expressionViewFrom(child);
          if (view !== undefined) return view;
        } else {
          foundFirst = true;
        }
      }
    }
    return undefined;
  }
}

export class ArgumentView extends AstView {
  static from(node: RedNode): ArgumentView | undefined {
    return node.kind === SyntaxKind.Argument ? new ArgumentView(node) : undefined;
  }

  expression(): ExpressionView | undefined {
    return expressionViewFrom(
      this.node.children().find((child): child is RedNode => child instanceof RedNode),
    );
  }
}

export class NamedArgumentView extends AstView {
  static from(node: RedNode): NamedArgumentView | undefined {
    return node.kind === SyntaxKind.NamedArgument ? new NamedArgumentView(node) : undefined;
  }

  nameToken(): RedToken | undefined {
    return childNameToken(this.node);
  }

  nameText(): string | undefined {
    return presentTokenText(this.nameToken());
  }

  value(): ExpressionView | undefined {
    const children = this.node.children();
    for (const child of children) {
      if (child instanceof RedNode && child.kind !== SyntaxKind.IdentifierToken) {
        const view = expressionViewFrom(child);
        if (view !== undefined) return view;
      }
    }
    return undefined;
  }
}

export class CallArgumentListView extends AstView {
  static from(node: RedNode): CallArgumentListView | undefined {
    return node.kind === SyntaxKind.CallArgumentList ? new CallArgumentListView(node) : undefined;
  }

  arguments(): (ArgumentView | NamedArgumentView)[] {
    return this.node
      .children()
      .filter(
        (child): child is RedNode =>
          child instanceof RedNode &&
          (child.kind === SyntaxKind.Argument || child.kind === SyntaxKind.NamedArgument),
      )
      .map((node) => {
        if (node.kind === SyntaxKind.Argument) return ArgumentView.from(node);
        return NamedArgumentView.from(node);
      })
      .filter((view): view is ArgumentView | NamedArgumentView => view !== undefined);
  }
}

export type ExpressionView =
  | LiteralExpressionView
  | NameExpressionView
  | ParenthesizedExpressionView
  | MemberAccessExpressionView
  | IndexExpressionView
  | CallExpressionView
  | TypeApplicationExpressionView
  | AttemptExpressionView
  | UnaryExpressionView
  | BinaryExpressionView
  | ComparisonExpressionView
  | EqualityExpressionView
  | ObjectLiteralExpressionView
  | ElseRequirementExpressionView;

export function expressionViewFrom(node: RedNode | undefined): ExpressionView | undefined {
  if (node === undefined) return undefined;
  switch (node.kind) {
    case SyntaxKind.LiteralExpression:
      return LiteralExpressionView.from(node);
    case SyntaxKind.NameExpression:
      return NameExpressionView.from(node);
    case SyntaxKind.ParenthesizedExpression:
      return ParenthesizedExpressionView.from(node);
    case SyntaxKind.MemberAccessExpression:
      return MemberAccessExpressionView.from(node);
    case SyntaxKind.IndexExpression:
      return IndexExpressionView.from(node);
    case SyntaxKind.CallExpression:
      return CallExpressionView.from(node);
    case SyntaxKind.TypeApplicationExpression:
      return TypeApplicationExpressionView.from(node);
    case SyntaxKind.AttemptExpression:
      return AttemptExpressionView.from(node);
    case SyntaxKind.UnaryExpression:
      return UnaryExpressionView.from(node);
    case SyntaxKind.BinaryExpression:
      return BinaryExpressionView.from(node);
    case SyntaxKind.ComparisonExpression:
      return ComparisonExpressionView.from(node);
    case SyntaxKind.EqualityExpression:
      return EqualityExpressionView.from(node);
    case SyntaxKind.ObjectLiteralExpression:
      return ObjectLiteralExpressionView.from(node);
    case SyntaxKind.ElseRequirementExpression:
      return ElseRequirementExpressionView.from(node);
    default:
      return undefined;
  }
}
