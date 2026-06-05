import { GreenToken } from "./green-token";
import { RedTrivia } from "./red-trivia";
import type { RedNode } from "./red-node";
import { SyntaxKind } from "./syntax-kind";
import type { SourceText } from "../lexer/source-text";
import { SourceSpan } from "../lexer/source-span";

export class RedToken {
  readonly green: GreenToken;
  readonly parent: RedNode | undefined;
  readonly offset: number;
  readonly source: SourceText;
  readonly childIndex: number;

  constructor(
    green: GreenToken,
    parent: RedNode | undefined,
    offset: number,
    source: SourceText,
    childIndex: number,
  ) {
    this.green = green;
    this.parent = parent;
    this.offset = offset;
    this.source = source;
    this.childIndex = childIndex;
  }

  get kind(): SyntaxKind {
    return this.green.kind;
  }

  get span(): SourceSpan {
    return SourceSpan.from(this.offset, this.offset + this.green.width);
  }

  get text(): string {
    return this.source.slice(this.span);
  }

  get isMissing(): boolean {
    return this.green.isMissing;
  }

  leadingTrivia(): RedTrivia[] {
    let triviaOffset = this.offset;
    return this.green.leadingTrivia.map((trivia) => {
      const result = new RedTrivia(trivia, triviaOffset, this.source);
      triviaOffset += trivia.width;
      return result;
    });
  }

  trailingTrivia(): RedTrivia[] {
    const leadingWidth = this.green.leadingTrivia.reduce((sum, trivia) => sum + trivia.width, 0);
    let triviaOffset = this.offset + leadingWidth + this.green.lexeme.length;
    return this.green.trailingTrivia.map((trivia) => {
      const result = new RedTrivia(trivia, triviaOffset, this.source);
      triviaOffset += trivia.width;
      return result;
    });
  }
}
