import type { ItemId } from "../ids";
import type { ItemIndex } from "../item-index";
import type { DeferredMemberReference } from "../names";
import type {
  MemberNamespace,
  ResolveMemberInput,
  ResolveMemberResult,
} from "../names/member-namespace";
import type { ResolvedReferences } from "../names/resolution-result";
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
  readonly typedOwners: ReadonlyMap<string, ItemId>;
}

export interface CompleteDeferredMembersResult {
  readonly completed: CompletedMemberReferenceTable;
  readonly remainingDeferred: readonly DeferredMemberReference[];
  readonly diagnostics: readonly SemanticSurfaceDiagnostic[];
}

export function ownerItemIdForCheckedType(type: CheckedType): ItemId | undefined {
  if (type.kind === "source") return type.itemId;
  return undefined;
}

export function deriveTypedOwnersFromSignatures(input: {
  readonly signatures: CheckedFunctionSignatureTable;
  readonly references: ResolvedReferences;
}): ReadonlyMap<string, ItemId> {
  const owners = new Map<string, ItemId>();
  for (const signature of input.signatures.entries()) {
    if (signature.receiver?.referenceKey) {
      owners.set(
        syntaxReferenceKeyToString(signature.receiver.referenceKey),
        signature.receiver.ownerItemId,
      );
    }
    for (const parameter of signature.parameters) {
      const ownerItemId = ownerItemIdForCheckedType(parameter.type);
      if (parameter.referenceKey !== undefined && ownerItemId !== undefined) {
        owners.set(syntaxReferenceKeyToString(parameter.referenceKey), ownerItemId);
      }
    }
  }
  return owners;
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
  const diagnostics: SemanticSurfaceDiagnostic[] = [];

  for (const deferredMember of input.references.deferredMembers()) {
    const ownerKey = deferredMember.receiverExpressionKey ?? deferredMember.key;
    const ownerItemId = input.typedOwners.get(syntaxReferenceKeyToString(ownerKey));
    if (ownerItemId === undefined) {
      remaining.push(deferredMember);
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

  const completedTable: CompletedMemberReferenceTable = {
    get: (key) => {
      const keyString = syntaxReferenceKeyToString(key);
      return completed.find((entry) => syntaxReferenceKeyToString(entry.key) === keyString)
        ?.reference;
    },
    entries: () => completed,
  };

  return {
    completed: completedTable,
    remainingDeferred: remaining,
    diagnostics,
  };
}
