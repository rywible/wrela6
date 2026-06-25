import { AstView } from "./ast-view";
import {
  childNode,
  blockItems,
  childToken,
  presentTokenText,
  presentTokenSpan,
} from "./syntax-query";
import { expressionViewFrom, type ExpressionView } from "./expression-views";
import { PatternView } from "./pattern-views";
import { TypeReferenceView } from "./type-views";
import { RedNode, RedToken, SyntaxKind } from "../syntax";
import type { SourceSpan } from "../lexer";

export class BlockView extends AstView {
  static from(node: RedNode): BlockView | undefined {
    return node.kind === SyntaxKind.Block ? new BlockView(node) : undefined;
  }

  items(): RedNode[] {
    return blockItems(this.node);
  }
}

export class StatementListView extends AstView {
  static from(node: RedNode): StatementListView | undefined {
    return node.kind === SyntaxKind.StatementList ? new StatementListView(node) : undefined;
  }

  items(): RedNode[] {
    return this.node.children().filter((child): child is RedNode => child instanceof RedNode);
  }
}

export class LetStatementView extends AstView {
  static from(node: RedNode): LetStatementView | undefined {
    return node.kind === SyntaxKind.LetStatement ? new LetStatementView(node) : undefined;
  }

  pattern(): PatternView | undefined {
    const patternNode = childNode(this.node, SyntaxKind.Pattern);
    return patternNode !== undefined ? PatternView.from(patternNode) : undefined;
  }

  type(): TypeReferenceView | undefined {
    const typeNode = childNode(this.node, SyntaxKind.TypeReference);
    return typeNode !== undefined ? TypeReferenceView.from(typeNode) : undefined;
  }

  value(): ExpressionView | undefined {
    const children = this.node.children();
    for (const child of children) {
      if (child instanceof RedNode) {
        const view = expressionViewFrom(child);
        if (view !== undefined) return view;
      }
    }
    return undefined;
  }
}

export class IfStatementView extends AstView {
  static from(node: RedNode): IfStatementView | undefined {
    return node.kind === SyntaxKind.IfStatement ? new IfStatementView(node) : undefined;
  }

  condition(): ConditionView | undefined {
    const condNode = childNode(this.node, SyntaxKind.Condition);
    return condNode !== undefined ? ConditionView.from(condNode) : undefined;
  }

  body(): BlockView | undefined {
    const blockNode = childNode(this.node, SyntaxKind.Block);
    return blockNode !== undefined ? BlockView.from(blockNode) : undefined;
  }

  elseClause(): ElseClauseView | undefined {
    const elseNode = childNode(this.node, SyntaxKind.ElseClause);
    return elseNode !== undefined ? ElseClauseView.from(elseNode) : undefined;
  }
}

export class ElseClauseView extends AstView {
  static from(node: RedNode): ElseClauseView | undefined {
    return node.kind === SyntaxKind.ElseClause ? new ElseClauseView(node) : undefined;
  }

  body(): BlockView | undefined {
    const blockNode = childNode(this.node, SyntaxKind.Block);
    return blockNode !== undefined ? BlockView.from(blockNode) : undefined;
  }

  statement(): RedNode | undefined {
    if (childNode(this.node, SyntaxKind.Block) !== undefined) return undefined;
    return this.node.children().find((child): child is RedNode => child instanceof RedNode);
  }
}

export class WhileStatementView extends AstView {
  static from(node: RedNode): WhileStatementView | undefined {
    return node.kind === SyntaxKind.WhileStatement ? new WhileStatementView(node) : undefined;
  }

  condition(): ConditionView | undefined {
    const condNode = childNode(this.node, SyntaxKind.Condition);
    return condNode !== undefined ? ConditionView.from(condNode) : undefined;
  }

  body(): BlockView | undefined {
    const blockNode = childNode(this.node, SyntaxKind.Block);
    return blockNode !== undefined ? BlockView.from(blockNode) : undefined;
  }
}

export class ForStatementView extends AstView {
  static from(node: RedNode): ForStatementView | undefined {
    return node.kind === SyntaxKind.ForStatement ? new ForStatementView(node) : undefined;
  }

  pattern(): PatternView | undefined {
    const patternNode = childNode(this.node, SyntaxKind.Pattern);
    return patternNode !== undefined ? PatternView.from(patternNode) : undefined;
  }

  iterable(): ExpressionView | undefined {
    const children = this.node.children();
    for (const child of children) {
      if (child instanceof RedNode && child.kind !== SyntaxKind.Pattern) {
        const view = expressionViewFrom(child);
        if (view !== undefined) return view;
      }
    }
    return undefined;
  }

  body(): BlockView | undefined {
    const blockNode = childNode(this.node, SyntaxKind.Block);
    return blockNode !== undefined ? BlockView.from(blockNode) : undefined;
  }
}

export class TakeStatementView extends AstView {
  static from(node: RedNode): TakeStatementView | undefined {
    return node.kind === SyntaxKind.TakeStatement ? new TakeStatementView(node) : undefined;
  }

  expression(): ExpressionView | undefined {
    const children = this.node.children();
    for (const child of children) {
      if (child instanceof RedNode) {
        const view = expressionViewFrom(child);
        if (view !== undefined) return view;
      }
    }
    return undefined;
  }

  aliasToken(): RedToken | undefined {
    const asKeyword = childToken(this.node, SyntaxKind.AsKeyword);
    if (asKeyword === undefined || asKeyword.isMissing) return undefined;
    const children = this.node.children();
    const asIndex = children.indexOf(asKeyword);
    for (let index = asIndex + 1; index < children.length; index++) {
      const child = children[index];
      if (
        child instanceof RedToken &&
        child.kind === SyntaxKind.IdentifierToken &&
        !child.isMissing
      ) {
        return child;
      }
    }
    return undefined;
  }

  aliasText(): string | undefined {
    return presentTokenText(this.aliasToken());
  }

  aliasSpan(): SourceSpan | undefined {
    return presentTokenSpan(this.aliasToken());
  }

  body(): BlockView | undefined {
    const blockNode = childNode(this.node, SyntaxKind.Block);
    return blockNode !== undefined ? BlockView.from(blockNode) : undefined;
  }
}

export class MatchStatementView extends AstView {
  static from(node: RedNode): MatchStatementView | undefined {
    return node.kind === SyntaxKind.MatchStatement ? new MatchStatementView(node) : undefined;
  }

  condition(): ConditionView | undefined {
    const condNode = childNode(this.node, SyntaxKind.Condition);
    return condNode !== undefined ? ConditionView.from(condNode) : undefined;
  }

  expression(): ExpressionView | undefined {
    for (const child of this.node.children()) {
      if (child instanceof RedNode) {
        const view = expressionViewFrom(child);
        if (view !== undefined) return view;
      }
    }
    return undefined;
  }

  arms(): MatchCaseView[] {
    const block = childNode(this.node, SyntaxKind.Block);
    const candidates =
      block !== undefined
        ? blockItems(block)
        : this.node
            .children()
            .filter(
              (child): child is RedNode =>
                child instanceof RedNode && child.kind === SyntaxKind.MatchCase,
            );
    return candidates
      .filter((child) => child.kind === SyntaxKind.MatchCase)
      .map((node) => MatchCaseView.from(node)!)
      .filter((view): view is MatchCaseView => view !== undefined);
  }
}

export class MatchCaseView extends AstView {
  static from(node: RedNode): MatchCaseView | undefined {
    return node.kind === SyntaxKind.MatchCase ? new MatchCaseView(node) : undefined;
  }

  pattern(): PatternView | undefined {
    const patternNode = childNode(this.node, SyntaxKind.Pattern);
    return patternNode !== undefined ? PatternView.from(patternNode) : undefined;
  }

  body(): BlockView | undefined {
    const blockNode = childNode(this.node, SyntaxKind.Block);
    return blockNode !== undefined ? BlockView.from(blockNode) : undefined;
  }
}

export class LoopStatementView extends AstView {
  static from(node: RedNode): LoopStatementView | undefined {
    return node.kind === SyntaxKind.LoopStatement ? new LoopStatementView(node) : undefined;
  }

  body(): BlockView | undefined {
    const blockNode = childNode(this.node, SyntaxKind.Block);
    return blockNode !== undefined ? BlockView.from(blockNode) : undefined;
  }
}

export class ReturnStatementView extends AstView {
  static from(node: RedNode): ReturnStatementView | undefined {
    return node.kind === SyntaxKind.ReturnStatement ? new ReturnStatementView(node) : undefined;
  }

  expression(): ExpressionView | undefined {
    return expressionViewFrom(
      this.node.children().find((child): child is RedNode => child instanceof RedNode),
    );
  }
}

export class YieldStatementView extends AstView {
  static from(node: RedNode): YieldStatementView | undefined {
    return node.kind === SyntaxKind.YieldStatement ? new YieldStatementView(node) : undefined;
  }

  expression(): ExpressionView | undefined {
    return expressionViewFrom(
      this.node.children().find((child): child is RedNode => child instanceof RedNode),
    );
  }
}

export class ContinueStatementView extends AstView {
  static from(node: RedNode): ContinueStatementView | undefined {
    return node.kind === SyntaxKind.ContinueStatement ? new ContinueStatementView(node) : undefined;
  }
}

export class BreakStatementView extends AstView {
  static from(node: RedNode): BreakStatementView | undefined {
    return node.kind === SyntaxKind.BreakStatement ? new BreakStatementView(node) : undefined;
  }
}

export class EnsureStatementView extends AstView {
  static from(node: RedNode): EnsureStatementView | undefined {
    return node.kind === SyntaxKind.EnsureStatement ? new EnsureStatementView(node) : undefined;
  }

  expression(): ExpressionView | undefined {
    return expressionViewFrom(
      this.node.children().find((child): child is RedNode => child instanceof RedNode),
    );
  }
}

export class ExpressionStatementView extends AstView {
  static from(node: RedNode): ExpressionStatementView | undefined {
    return node.kind === SyntaxKind.ExpressionStatement
      ? new ExpressionStatementView(node)
      : undefined;
  }

  expression(): ExpressionView | undefined {
    return expressionViewFrom(
      this.node.children().find((child): child is RedNode => child instanceof RedNode),
    );
  }
}

export class AssignmentStatementView extends AstView {
  static from(node: RedNode): AssignmentStatementView | undefined {
    return node.kind === SyntaxKind.AssignmentStatement
      ? new AssignmentStatementView(node)
      : undefined;
  }

  target(): ExpressionView | undefined {
    const children = this.node.children();
    return expressionViewFrom(children.find((child): child is RedNode => child instanceof RedNode));
  }

  value(): ExpressionView | undefined {
    const children = this.node.children();
    const redNodes = children.filter((child): child is RedNode => child instanceof RedNode);
    if (redNodes.length >= 2) {
      return expressionViewFrom(redNodes[1]);
    }
    return undefined;
  }
}

export class ConditionView extends AstView {
  static from(node: RedNode): ConditionView | undefined {
    return node.kind === SyntaxKind.Condition ? new ConditionView(node) : undefined;
  }

  pattern(): PatternView | undefined {
    const patternNode = childNode(this.node, SyntaxKind.Pattern);
    return patternNode !== undefined ? PatternView.from(patternNode) : undefined;
  }

  expression(): ExpressionView | undefined {
    return expressionViewFrom(
      this.node
        .children()
        .find(
          (child): child is RedNode =>
            child instanceof RedNode && child.kind !== SyntaxKind.Pattern,
        ),
    );
  }
}
