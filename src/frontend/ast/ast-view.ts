import type { SourceSpan, SourceText } from "../lexer";
import type { RedNode } from "../syntax";
import { SyntaxKind } from "../syntax";

export abstract class AstView {
  readonly node: RedNode;

  protected constructor(node: RedNode) {
    this.node = node;
  }

  get kind(): SyntaxKind {
    return this.node.kind;
  }

  get span(): SourceSpan {
    return this.node.span;
  }

  get source(): SourceText {
    return this.node.source;
  }
}
