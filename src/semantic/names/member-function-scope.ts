import { FunctionDeclarationView } from "../../frontend/ast/function-views";
import type { ItemIndex } from "../item-index";
import type { ItemRecord } from "../item-index/item-records";
import type { Scope, ScopeCandidate } from "./scope";
import { functionCandidate, scopeBuilder } from "./scope";

export function findMemberFunctionItem(input: {
  readonly index: ItemIndex;
  readonly ownerItem: ItemRecord;
  readonly functionView: FunctionDeclarationView;
}): ItemRecord | undefined {
  const functionName = input.functionView.nameText();
  if (functionName === undefined) return undefined;

  const candidateItems = input.index
    .itemsInModule(input.ownerItem.moduleId)
    .filter(
      (item) =>
        item.parentItemId === input.ownerItem.id &&
        item.functionId !== undefined &&
        item.name === functionName,
    );

  return (
    candidateItems.find(
      (item) =>
        item.declaration instanceof FunctionDeclarationView &&
        item.declaration.node === input.functionView.node,
    ) ??
    candidateItems.find(
      (item) =>
        item.declaration instanceof FunctionDeclarationView &&
        spansMatch(item.declaration.span, input.functionView.span),
    ) ??
    candidateItems[0]
  );
}

export function buildMemberFunctionScope(input: {
  readonly index: ItemIndex;
  readonly ownerItem: ItemRecord;
}): Scope | undefined {
  const candidates = memberFunctionScopeCandidates(input);
  if (candidates.length === 0) return undefined;
  return scopeBuilder().addTier("memberFunctions", candidates).build();
}

function memberFunctionScopeCandidates(input: {
  readonly index: ItemIndex;
  readonly ownerItem: ItemRecord;
}): readonly ScopeCandidate[] {
  return input.index
    .itemsInModule(input.ownerItem.moduleId)
    .filter((item) => item.parentItemId === input.ownerItem.id && item.functionId !== undefined)
    .map((item) => functionCandidate(item.name, item.id, item.functionId!));
}

function spansMatch(
  left: { readonly start: number; readonly end: number },
  right: { readonly start: number; readonly end: number },
): boolean {
  return left.start === right.start && left.end === right.end;
}
