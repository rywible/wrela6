import { AstView } from "./ast-view";
import { childNode, blockItems } from "./syntax-query";
import { expressionViewFrom, type ExpressionView } from "./expression-views";
import { RedNode, SyntaxKind } from "../syntax";

export class RequiresSectionView extends AstView {
  static from(node: RedNode): RequiresSectionView | undefined {
    return node.kind === SyntaxKind.RequiresSection ? new RequiresSectionView(node) : undefined;
  }

  requirements(): RequirementView[] {
    const block = childNode(this.node, SyntaxKind.Block);
    if (block === undefined) return [];
    return blockItems(block)
      .filter((node) => node.kind === SyntaxKind.Requirement)
      .map((node) => RequirementView.from(node)!)
      .filter((view): view is RequirementView => view !== undefined);
  }
}

export class RequireSectionView extends AstView {
  static from(node: RedNode): RequireSectionView | undefined {
    return node.kind === SyntaxKind.RequireSection ? new RequireSectionView(node) : undefined;
  }

  requirements(): RequirementView[] {
    const block = childNode(this.node, SyntaxKind.Block);
    if (block === undefined) return [];
    return blockItems(block)
      .filter((node) => node.kind === SyntaxKind.Requirement)
      .map((node) => RequirementView.from(node)!)
      .filter((view): view is RequirementView => view !== undefined);
  }
}

export class RequirementView extends AstView {
  static from(node: RedNode): RequirementView | undefined {
    return node.kind === SyntaxKind.Requirement ? new RequirementView(node) : undefined;
  }

  expression(): ExpressionView | undefined {
    return expressionViewFrom(
      this.node.children().find((child): child is RedNode => child instanceof RedNode),
    );
  }
}
