import { GreenNode, type GreenElement } from "./green-node";
import { GreenToken } from "./green-token";
import { RedToken } from "./red-token";
import { SyntaxKind } from "./syntax-kind";
import type { SourceText } from "../lexer/source-text";
import { SourceSpan } from "../lexer/source-span";

export class RedNode {
  readonly green: GreenNode;
  readonly parent: RedNode | undefined;
  readonly offset: number;
  readonly source: SourceText;
  readonly childIndex: number;

  constructor(
    green: GreenNode,
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

  get width(): number {
    return this.green.width;
  }

  child(index: number): RedNode | RedToken | undefined {
    if (index < 0 || index >= this.green.children.length) {
      return undefined;
    }

    const greenChild = this.green.children[index]!;
    let childOffset = this.offset;
    for (let childIndex = 0; childIndex < index; childIndex++) {
      childOffset += this.green.children[childIndex]!.width;
    }

    return wrapGreenElement(greenChild, this, childOffset, this.source, index);
  }

  children(): (RedNode | RedToken)[] {
    const result: (RedNode | RedToken)[] = [];
    let childOffset = this.offset;

    for (let childIndex = 0; childIndex < this.green.children.length; childIndex++) {
      const greenChild = this.green.children[childIndex]!;
      result.push(wrapGreenElement(greenChild, this, childOffset, this.source, childIndex));
      childOffset += greenChild.width;
    }

    return result;
  }
}

function wrapGreenElement(
  green: GreenElement,
  parent: RedNode,
  offset: number,
  source: SourceText,
  childIndex: number,
): RedNode | RedToken {
  if (green instanceof GreenNode) {
    return new RedNode(green, parent, offset, source, childIndex);
  }

  return new RedToken(green as GreenToken, parent, offset, source, childIndex);
}
