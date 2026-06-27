import type { ProofMirScope, ProofMirScopeTable } from "../model/graph";
import type { ProofMirScopeId } from "../ids";

export function proofMirScopeStack(
  scopeId: ProofMirScopeId,
  scopes: ProofMirScopeTable,
): ProofMirScopeId[] | undefined {
  const stack: ProofMirScopeId[] = [];
  const visited = new Set<number>();
  let current: ProofMirScopeId | undefined = scopeId;

  while (current !== undefined) {
    if (visited.has(current)) {
      return undefined;
    }
    visited.add(current);
    stack.push(current);
    const scope = scopes.get(current);
    if (scope === undefined) {
      return undefined;
    }
    current = scope.parentScopeId;
  }

  return stack;
}

export function proofMirCrossedScopes(
  sourceStack: readonly ProofMirScope["scopeId"][],
  targetStack: readonly ProofMirScope["scopeId"][],
): ProofMirScope["scopeId"][] {
  let sourceIndex = sourceStack.length - 1;
  let targetIndex = targetStack.length - 1;

  while (
    sourceIndex >= 0 &&
    targetIndex >= 0 &&
    sourceStack[sourceIndex] === targetStack[targetIndex]
  ) {
    sourceIndex -= 1;
    targetIndex -= 1;
  }

  return sourceStack.slice(0, sourceIndex + 1);
}
