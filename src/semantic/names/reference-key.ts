import type { ReferenceKeyInput, SyntaxReferenceKey } from "./reference";

export class ReferenceKeyBuilder {
  private counters: Map<string, number> = new Map();

  next(input: ReferenceKeyInput): SyntaxReferenceKey {
    const key = `${input.moduleId}:${input.span.start}:${input.span.end}:${input.kind}`;
    const count = this.counters.get(key) ?? 0;
    this.counters.set(key, count + 1);
    return {
      moduleId: input.moduleId,
      span: input.span,
      kind: input.kind,
      ordinal: count,
    };
  }
}
