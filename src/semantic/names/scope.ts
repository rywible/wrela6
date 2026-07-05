import type { ItemIndex } from "../item-index";
import type { FunctionId, ItemId, ParameterId, TypeId } from "../ids";
import type { TypeParameterOwner } from "../item-index/item-records";
import type { ItemRecord } from "../item-index/item-records";
import type { ResolvedReference } from "./reference";
import type { CandidateDisplay } from "./diagnostics";
import type { SourceSpan } from "../../frontend";

export type ScopeNamespace = "type" | "value";

export interface ScopeCandidate {
  readonly namespace: ScopeNamespace;
  readonly name: string;
  readonly reference: ResolvedReference;
  readonly display: CandidateDisplay;
}

export interface ScopeTier {
  readonly name: string;
  readonly candidates: readonly ScopeCandidate[];
}

export type ScopeLookupResult =
  | { readonly kind: "resolved"; readonly reference: ResolvedReference }
  | { readonly kind: "unresolved" }
  | { readonly kind: "ambiguous"; readonly candidates: readonly ScopeCandidate[] };

export interface Scope {
  lookup(namespace: ScopeNamespace, name: string): ScopeLookupResult;
  lookupType(name: string): ScopeLookupResult;
  lookupValue(name: string): ScopeLookupResult;
}

export interface LocalBinding {
  readonly name: string;
  readonly span: SourceSpan;
  readonly ordinal: number;
}

export interface LocalBindingInput {
  readonly name: string;
  readonly span: SourceSpan;
}

export interface LocalScope {
  lookup(name: string): LocalBinding | undefined;
  has(name: string): boolean;
  add(bindings: readonly LocalBindingInput[]): LocalScope;
}

class ImmutableLocalScope implements LocalScope {
  constructor(
    private readonly bindings: readonly LocalBinding[],
    private readonly nextOrdinal: number,
  ) {}

  lookup(name: string): LocalBinding | undefined {
    for (let index = this.bindings.length - 1; index >= 0; index--) {
      const binding = this.bindings[index]!;
      if (binding.name === name) return binding;
    }
    return undefined;
  }

  has(name: string): boolean {
    return this.lookup(name) !== undefined;
  }

  add(bindings: readonly LocalBindingInput[]): LocalScope {
    let nextOrdinal = this.nextOrdinal;
    const nextBindings = [...this.bindings];
    for (const binding of bindings) {
      nextBindings.push({
        name: binding.name,
        span: binding.span,
        ordinal: nextOrdinal,
      });
      nextOrdinal += 1;
    }
    return new ImmutableLocalScope(Object.freeze(nextBindings), nextOrdinal);
  }
}

export class ScopeBuilder {
  private tiers: ScopeTier[] = [];

  addTier(name: string, candidates: readonly ScopeCandidate[]): this {
    this.tiers.push({ name, candidates: [...candidates] });
    return this;
  }

  build(): Scope {
    const tiers = [...this.tiers];
    return {
      lookup(namespace: ScopeNamespace, name: string): ScopeLookupResult {
        for (const tier of tiers) {
          const matches = tier.candidates.filter(
            (candidate) => candidate.namespace === namespace && candidate.name === name,
          );
          if (matches.length === 1) {
            return { kind: "resolved", reference: matches[0]!.reference };
          }
          if (matches.length > 1) {
            return { kind: "ambiguous", candidates: matches };
          }
        }
        return { kind: "unresolved" };
      },
      lookupType(name: string): ScopeLookupResult {
        return this.lookup("type", name);
      },
      lookupValue(name: string): ScopeLookupResult {
        return this.lookup("value", name);
      },
    };
  }
}

export function scopeBuilder(): ScopeBuilder {
  return new ScopeBuilder();
}

export function localScope(bindings: readonly LocalBinding[] = []): LocalScope {
  const nextOrdinal =
    bindings.reduce((maximum, binding) => Math.max(maximum, binding.ordinal), -1) + 1;
  return new ImmutableLocalScope(Object.freeze([...bindings]), nextOrdinal);
}

export function localReference(binding: LocalBinding): ResolvedReference {
  return {
    kind: "local",
    name: binding.name,
    bindingSpan: binding.span,
    ordinal: binding.ordinal,
  };
}

export function resolvedReferenceForItem(index: ItemIndex, item: ItemRecord): ResolvedReference {
  if (item.typeId !== undefined) {
    return { kind: "type", itemId: item.id, typeId: item.typeId };
  }
  if (item.functionId !== undefined) {
    return { kind: "function", itemId: item.id, functionId: item.functionId };
  }
  if (item.imageId !== undefined) {
    return { kind: "image", itemId: item.id, imageId: item.imageId };
  }
  return { kind: "item", itemId: item.id };
}

export function typeCandidate(
  name: string,
  itemId: ItemId,
  typeId: TypeId,
  display?: CandidateDisplay,
): ScopeCandidate {
  return {
    namespace: "type",
    name,
    reference: { kind: "type", itemId, typeId },
    display: display ?? { modulePath: "", itemKind: "", name, denseId: itemId as number },
  };
}

export function functionCandidate(
  name: string,
  itemId: ItemId,
  functionId: FunctionId,
  display?: CandidateDisplay,
): ScopeCandidate {
  return {
    namespace: "value",
    name,
    reference: { kind: "function", itemId, functionId },
    display: display ?? { modulePath: "", itemKind: "", name, denseId: itemId as number },
  };
}

export function itemCandidate(
  namespace: ScopeNamespace,
  name: string,
  itemId: ItemId,
  display?: CandidateDisplay,
): ScopeCandidate {
  return {
    namespace,
    name,
    reference: { kind: "item", itemId },
    display: display ?? { modulePath: "", itemKind: "", name, denseId: itemId as number },
  };
}

export function typeParameterCandidate(
  name: string,
  owner: TypeParameterOwner,
  index: number,
  display?: CandidateDisplay,
): ScopeCandidate {
  return {
    namespace: "type",
    name,
    reference: { kind: "typeParameter", owner, index },
    display: display ?? { modulePath: "", itemKind: "", name, denseId: index },
  };
}

export function parameterCandidate(
  name: string,
  parameterId: ParameterId,
  display?: CandidateDisplay,
): ScopeCandidate {
  return {
    namespace: "value",
    name,
    reference: { kind: "parameter", parameterId },
    display: display ?? { modulePath: "", itemKind: "", name, denseId: parameterId as number },
  };
}
