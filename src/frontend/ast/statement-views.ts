import { AstView } from "./ast-view";
import { childNode, blockItems } from "./syntax-query";
import { expressionViewFrom, type ExpressionView } from "./expression-views";
import { PatternView } from "./pattern-views";
import { RedNode, SyntaxKind } from "../syntax";

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

  body(): BlockView | undefined {
    const blockNode = childNode(this.node, SyntaxKind.Block);
    return blockNode !== undefined ? BlockView.from(blockNode) : undefined;
  }
}

export class TakeStatementView extends AstView {
  static from(node: RedNode): TakeStatementView | undefined {
    return node.kind === SyntaxKind.TakeStatement ? new TakeStatementView(node) : undefined;
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

  arms(): MatchCaseView[] {
    return this.node
      .children()
      .filter(
        (child): child is RedNode =>
          child instanceof RedNode && child.kind === SyntaxKind.MatchCase,
      )
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

  expression(): ExpressionView | undefined {
    return expressionViewFrom(
      this.node.children().find((child): child is RedNode => child instanceof RedNode),
    );
  }
}
