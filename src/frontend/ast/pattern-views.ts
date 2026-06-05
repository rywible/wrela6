import { AstView } from "./ast-view";
import { childNode } from "./syntax-query";
import { QualifiedNameView } from "./name-views";
import { RedNode, SyntaxKind } from "../syntax";

export class PatternView extends AstView {
  static from(node: RedNode): PatternView | undefined {
    return node.kind === SyntaxKind.Pattern ? new PatternView(node) : undefined;
  }

  qualifiedName(): QualifiedNameView | undefined {
    const nameNode = childNode(this.node, SyntaxKind.QualifiedName);
    return nameNode !== undefined ? QualifiedNameView.from(nameNode) : undefined;
  }

  patternList(): PatternListView | undefined {
    const listNode = childNode(this.node, SyntaxKind.PatternList);
    return listNode !== undefined ? PatternListView.from(listNode) : undefined;
  }
}

export class PatternListView extends AstView {
  static from(node: RedNode): PatternListView | undefined {
    return node.kind === SyntaxKind.PatternList ? new PatternListView(node) : undefined;
  }

  patterns(): PatternView[] {
    return this.node
      .children()
      .filter(
        (child): child is RedNode => child instanceof RedNode && child.kind === SyntaxKind.Pattern,
      )
      .map((node) => PatternView.from(node)!)
      .filter((view): view is PatternView => view !== undefined);
  }
}
