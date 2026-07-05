import { AstView } from "./ast-view";
import { childNameTokens, presentTokenSpan, presentTokenText } from "./syntax-query";
import { SourceSpan } from "../lexer";
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

  textSpan(): SourceSpan | undefined {
    const segmentSpans = this.segments()
      .map((token) => presentTokenSpan(token))
      .filter((span): span is SourceSpan => span !== undefined);
    if (segmentSpans.length === 0) return undefined;
    return SourceSpan.from(segmentSpans[0]!.start, segmentSpans[segmentSpans.length - 1]!.end);
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
