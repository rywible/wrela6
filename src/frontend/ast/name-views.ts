import { AstView } from "./ast-view";
import { childNameTokens, presentTokenText } from "./syntax-query";
import { RedNode, RedToken, SyntaxKind } from "../syntax";

export class DottedModuleNameView extends AstView {
  static from(node: RedNode): DottedModuleNameView | undefined {
    return node.kind === SyntaxKind.DottedModuleName ? new DottedModuleNameView(node) : undefined;
  }

  segments(): RedToken[] {
    return childNameTokens(this.node);
  }

  text(): string | undefined {
    const segments = this.segments()
      .map((token) => presentTokenText(token))
      .filter((text): text is string => text !== undefined);
    return segments.length === 0 ? undefined : segments.join(".");
  }
}

export class QualifiedNameView extends AstView {
  static from(node: RedNode): QualifiedNameView | undefined {
    return node.kind === SyntaxKind.QualifiedName ? new QualifiedNameView(node) : undefined;
  }

  segments(): RedToken[] {
    return childNameTokens(this.node);
  }

  text(): string | undefined {
    const segments = this.segments()
      .map((token) => presentTokenText(token))
      .filter((text): text is string => text !== undefined);
    return segments.length === 0 ? undefined : segments.join(".");
  }
}
