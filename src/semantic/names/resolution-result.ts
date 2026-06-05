import type {
  SyntaxReferenceKey,
  ResolvedReference,
  ResolvedReferenceEntry,
  DeferredMemberReference,
  PlatformPrimitiveBinding,
} from "./reference";
import type { FunctionId } from "../ids";

export interface ResolvedReferences {
  get(key: SyntaxReferenceKey): ResolvedReference | undefined;
  entries(): readonly ResolvedReferenceEntry[];
  deferredMembers(): readonly DeferredMemberReference[];
}

export class ResolvedReferencesBuilder {
  private entries: ResolvedReferenceEntry[] = [];
  private deferred: DeferredMemberReference[] = [];

  add(key: SyntaxReferenceKey, reference: ResolvedReference): void {
    this.entries.push({ key, reference });
  }

  addDeferredMember(reference: DeferredMemberReference): void {
    this.deferred.push(reference);
  }

  merge(references: ResolvedReferences): void {
    for (const entry of references.entries()) {
      this.entries.push(entry);
    }
    for (const deferredMember of references.deferredMembers()) {
      this.deferred.push(deferredMember);
    }
  }

  build(): ResolvedReferences {
    const sortedEntries = [...this.entries].sort((left, right) => compareKeys(left.key, right.key));
    const sortedDeferred = [...this.deferred].sort((left, right) =>
      compareKeys(left.key, right.key),
    );
    const table = new Map<string, ResolvedReference>();
    for (const entry of sortedEntries) {
      const keyStr = keyToString(entry.key);
      table.set(keyStr, entry.reference);
    }

    return {
      get(key: SyntaxReferenceKey): ResolvedReference | undefined {
        return table.get(keyToString(key));
      },
      entries(): readonly ResolvedReferenceEntry[] {
        return sortedEntries;
      },
      deferredMembers(): readonly DeferredMemberReference[] {
        return sortedDeferred;
      },
    };
  }
}

function keyToString(key: SyntaxReferenceKey): string {
  return `${key.moduleId}:${key.span.start}:${key.span.end}:${key.kind}:${key.ordinal}`;
}

function compareKeys(left: SyntaxReferenceKey, right: SyntaxReferenceKey): number {
  if (left.moduleId !== right.moduleId)
    return (left.moduleId as number) - (right.moduleId as number);
  if (left.span.start !== right.span.start) return left.span.start - right.span.start;
  if (left.span.end !== right.span.end) return left.span.end - right.span.end;
  if (left.kind !== right.kind) return left.kind.localeCompare(right.kind);
  return left.ordinal - right.ordinal;
}

export interface ResolvedPlatformBindings {
  get(functionId: FunctionId): PlatformPrimitiveBinding | undefined;
  entries(): readonly PlatformPrimitiveBinding[];
}

export class ResolvedPlatformBindingsBuilder {
  private bindings: PlatformPrimitiveBinding[] = [];

  add(binding: PlatformPrimitiveBinding): void {
    this.bindings.push(binding);
  }

  merge(bindings: ResolvedPlatformBindings): void {
    for (const binding of bindings.entries()) {
      this.bindings.push(binding);
    }
  }

  build(): ResolvedPlatformBindings {
    const sorted = [...this.bindings].sort((left, right) => {
      if (left.functionId !== right.functionId)
        return (left.functionId as number) - (right.functionId as number);
      if (left.itemId !== right.itemId) return (left.itemId as number) - (right.itemId as number);
      return left.primitiveId.localeCompare(right.primitiveId);
    });
    const map = new Map<FunctionId, PlatformPrimitiveBinding>();
    for (const binding of sorted) {
      map.set(binding.functionId, binding);
    }
    return {
      get(functionId: FunctionId): PlatformPrimitiveBinding | undefined {
        return map.get(functionId);
      },
      entries(): readonly PlatformPrimitiveBinding[] {
        return sorted;
      },
    };
  }
}
