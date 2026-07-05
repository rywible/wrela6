import { GreenNode } from "./green-node";
import { RedNode } from "./red-node";
import type { SourceText } from "../lexer/source-text";
import { SourceSpan } from "../lexer/source-span";
import {
  compareDiagnostics,
  stableDiagnosticDetail,
  type Diagnostic,
} from "../../shared/diagnostics";
import { SyntaxIndex, buildSyntaxIndex } from "./syntax-index";

export class SyntaxTree {
  readonly source: SourceText;
  private readonly greenRoot: GreenNode;
  private redRoot: RedNode | undefined;
  private syntaxIndex: SyntaxIndex | undefined;

  constructor(params: { source: SourceText; greenRoot: GreenNode }) {
    this.source = params.source;
    this.greenRoot = params.greenRoot;
  }

  root(): RedNode {
    if (this.redRoot === undefined) {
      this.redRoot = new RedNode(this.greenRoot, undefined, 0, this.source, 0);
    }
    return this.redRoot;
  }

  reconstruct(): string {
    return this.greenRoot.reconstruct();
  }

  index(): SyntaxIndex {
    if (this.syntaxIndex === undefined) {
      this.syntaxIndex = buildSyntaxIndex(this);
    }
    return this.syntaxIndex;
  }

  get diagnostics(): readonly ParserDiagnostic[] {
    const result: ParserDiagnostic[] = [];
    this.collectDiagnostics(this.greenRoot, 0, result);
    result.sort((left, right) => compareDiagnostics(left, right));
    return result;
  }

  private collectDiagnostics(node: GreenNode, offset: number, result: ParserDiagnostic[]): void {
    for (const diagnostic of node.diagnostics) {
      const span = SourceSpan.from(
        offset + diagnostic.relativeStart,
        offset + diagnostic.relativeEnd,
      );
      result.push({
        code: diagnostic.code,
        severity: diagnostic.severity,
        message: diagnostic.message,
        source: this.source,
        span,
        ownerKey: diagnostic.ownerKey ?? `parser:${diagnostic.code}`,
        stableDetail:
          diagnostic.stableDetail ??
          stableDiagnosticDetail({
            code: diagnostic.code,
            source: this.source,
            span: this.index().anchorForSpan(span)?.span ?? span,
          }),
      });
    }
    let childOffset = offset;
    for (const child of node.children) {
      if (child instanceof GreenNode) {
        this.collectDiagnostics(child, childOffset, result);
      }
      childOffset += child.width;
    }
  }
}

export type ParserDiagnostic = Diagnostic;
