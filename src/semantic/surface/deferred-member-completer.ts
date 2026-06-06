import type { ItemId, ParameterId } from "../ids";
import type { ItemIndex } from "../item-index";
import type { DeferredMemberReference } from "../names";
import type {
  MemberNamespace,
  ResolveMemberInput,
  ResolveMemberResult,
} from "../names/member-namespace";
import type { ResolvedReference, ResolvedReferences } from "../names";
import type {
  CheckedFunctionSignatureTable,
  CompletedMemberReference,
  CompletedMemberReferenceTable,
} from "./checked-program";
import type { CheckedType } from "./type-model";
import type { SemanticSurfaceDiagnostic } from "./diagnostics";
import { unresolvedDeferredMember, ambiguousDeferredMember } from "./diagnostics";
import { syntaxReferenceKeyToString } from "./reference-lookup";

export interface CompleteDeferredMembersInput {
  readonly index: ItemIndex;
  readonly references: ResolvedReferences;
  readonly memberNamespace: MemberNamespace;
  readonly typedOwners: ReadonlyMap<ParameterId, ItemId>;
}

export interface CompleteDeferredMembersResult {
  readonly completed: CompletedMemberReferenceTable;
  readonly remainingDeferred: readonly DeferredMemberReference[];
  readonly failedDeferred: readonly DeferredMemberReference[];
  readonly diagnostics: readonly SemanticSurfaceDiagnostic[];
}

export function deriveTypedOwnersFromSignatures(input: {
  readonly signatures: CheckedFunctionSignatureTable;
  readonly references: ResolvedReferences;
}): ReadonlyMap<ParameterId, ItemId> {
  const owners = new Map<ParameterId, ItemId>();
  for (const signature of input.signatures.entries()) {
    for (const parameter of signature.parameters) {
      const ownerItemId = ownerItemIdForCheckedType(parameter.type);
      if (ownerItemId !== undefined) {
        owners.set(parameter.parameterId, ownerItemId);
      }
    }
  }
  return owners;
}

export function ownerItemIdForCheckedType(type: CheckedType): ItemId | undefined {
  if (type.kind === "source") return type.itemId;
  return undefined;
}

function handleMemberResult(
  result: ResolveMemberResult,
  deferredMember: DeferredMemberReference,
  completed: CompletedMemberReference[],
  diagnostics: SemanticSurfaceDiagnostic[],
): void {
  if (result.kind === "resolved") {
    completed.push({
      key: deferredMember.key,
      reference: result.reference,
    });
  } else if (result.kind === "unresolved") {
    diagnostics.push(
      unresolvedDeferredMember(
        deferredMember.memberName,
        deferredMember.memberSpan,
        undefined as any,
        {
          moduleId: deferredMember.key.moduleId,
          span: deferredMember.memberSpan,
          codeTieBreaker: "deferred",
        },
      ),
    );
  } else if (result.kind === "ambiguous") {
    diagnostics.push(
      ambiguousDeferredMember(
        deferredMember.memberName,
        deferredMember.memberSpan,
        undefined as any,
        {
          moduleId: deferredMember.key.moduleId,
          span: deferredMember.memberSpan,
          codeTieBreaker: "deferred",
        },
      ),
    );
  }
}

export function completeDeferredMembers(
  input: CompleteDeferredMembersInput,
): CompleteDeferredMembersResult {
  const completed: CompletedMemberReference[] = [];
  const remaining: DeferredMemberReference[] = [];
  const failed: DeferredMemberReference[] = [];
  const diagnostics: SemanticSurfaceDiagnostic[] = [];

  const entriesByKey = new Map<string, ResolvedReference>();
  for (const entry of input.references.entries()) {
    entriesByKey.set(syntaxReferenceKeyToString(entry.key), entry.reference);
  }

  for (const deferredMember of input.references.deferredMembers()) {
    const ownerKey = deferredMember.receiverExpressionKey ?? deferredMember.key;
    const receiverRef = entriesByKey.get(syntaxReferenceKeyToString(ownerKey));
    let ownerItemId: ItemId | undefined;

    if (receiverRef?.kind === "parameter") {
      ownerItemId = input.typedOwners.get(receiverRef.parameterId);
    }

    if (ownerItemId === undefined) {
      if (receiverRef?.kind === "parameter") {
        failed.push(deferredMember);
      } else {
        remaining.push(deferredMember);
      }
      continue;
    }

    const resolveInput: ResolveMemberInput = {
      ownerItemId,
      name: deferredMember.memberName,
      allowedNamespaces: deferredMember.allowedNamespaces,
    };

    const result = input.memberNamespace.resolveMember(resolveInput);
    handleMemberResult(result, deferredMember, completed, diagnostics);
  }

  const completedByKey = new Map<string, ResolvedReference>();
  for (const entry of completed) {
    completedByKey.set(syntaxReferenceKeyToString(entry.key), entry.reference);
  }
  const sorted = [...completed].sort((left, right) => {
    const leftKey = syntaxReferenceKeyToString(left.key);
    const rightKey = syntaxReferenceKeyToString(right.key);
    if (leftKey < rightKey) return -1;
    if (leftKey > rightKey) return 1;
    return 0;
  });
  const completedTable: CompletedMemberReferenceTable = {
    get: (key) => completedByKey.get(syntaxReferenceKeyToString(key)),
    entries: () => [...sorted],
  };

  return {
    completed: completedTable,
    remainingDeferred: remaining,
    failedDeferred: failed,
    diagnostics,
  };
}
