import { GreenNode } from "./green-node";
import { RedNode } from "./red-node";
import type { SourceText } from "../lexer/source-text";
import { SourceSpan } from "../lexer/source-span";
import type { DiagnosticSeverity } from "../../shared/diagnostics";
import { compareCodeUnitStrings } from "../../semantic/surface/deterministic-sort";

export class SyntaxTree {
  readonly source: SourceText;
  private readonly greenRoot: GreenNode;
  private redRoot: RedNode | undefined;

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

  get diagnostics(): readonly ParserDiagnostic[] {
    const result: ParserDiagnostic[] = [];
    this.collectDiagnostics(this.greenRoot, 0, result);
    result.sort((left, right) => {
      if (left.span.start !== right.span.start) return left.span.start - right.span.start;
      if (left.span.end !== right.span.end) return left.span.end - right.span.end;
      return compareCodeUnitStrings(left.code, right.code);
    });
    return result;
  }

  private collectDiagnostics(node: GreenNode, offset: number, result: ParserDiagnostic[]): void {
    for (const diagnostic of node.diagnostics) {
      result.push({
        code: diagnostic.code,
        severity: diagnostic.severity,
        message: diagnostic.message,
        source: this.source,
        span: SourceSpan.from(offset + diagnostic.relativeStart, offset + diagnostic.relativeEnd),
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

export interface ParserDiagnostic {
  readonly code: string;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly source: SourceText;
  readonly span: SourceSpan;
}
