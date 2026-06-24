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
import { compareCodeUnitStrings } from "./deterministic-sort";

export interface CompleteDeferredMembersInput {
  readonly index: ItemIndex;
  readonly references: ResolvedReferences;
  readonly memberNamespace: MemberNamespace;
  readonly typedOwners: ReadonlyMap<string, ItemId>;
  readonly parameterOwners: ReadonlyMap<ParameterId, ItemId>;
  readonly declarationKeys?: ReadonlySet<string>;
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
  readonly index?: ItemIndex;
}): {
  byKey: ReadonlyMap<string, ItemId>;
  byParameterId: ReadonlyMap<ParameterId, ItemId>;
} {
  const byKey = new Map<string, ItemId>();
  const byParameterId = new Map<ParameterId, ItemId>();
  for (const signature of input.signatures.entries()) {
    for (const parameter of signature.parameters) {
      const ownerItemId = ownerItemIdForCheckedType(parameter.type, input.index);
      if (ownerItemId !== undefined) {
        if (parameter.referenceKey !== undefined) {
          byKey.set(syntaxReferenceKeyToString(parameter.referenceKey), ownerItemId);
        }
        byParameterId.set(parameter.parameterId, ownerItemId);
      }
    }
  }
  return { byKey, byParameterId };
}

export function ownerItemIdForCheckedType(
  type: CheckedType,
  index?: ItemIndex,
): ItemId | undefined {
  if (type.kind === "source") return type.itemId;
  if (type.kind === "applied" && type.constructor.kind === "source" && index !== undefined) {
    const typeRecord = index.type(type.constructor.typeId);
    return typeRecord?.itemId;
  }
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
      unresolvedDeferredMember(deferredMember.memberName, deferredMember.memberSpan, undefined, {
        moduleId: deferredMember.key.moduleId,
        span: deferredMember.memberSpan,
        codeTieBreaker: "deferred",
      }),
    );
  } else if (result.kind === "ambiguous") {
    diagnostics.push(
      ambiguousDeferredMember(deferredMember.memberName, deferredMember.memberSpan, undefined, {
        moduleId: deferredMember.key.moduleId,
        span: deferredMember.memberSpan,
        codeTieBreaker: "deferred",
      }),
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
    const memberKeyStr = syntaxReferenceKeyToString(deferredMember.key);
    const isDeclarationScoped =
      input.declarationKeys !== undefined && input.declarationKeys.has(memberKeyStr);
    if (input.declarationKeys === undefined || !isDeclarationScoped) {
      remaining.push(deferredMember);
      continue;
    }
    const ownerKey = deferredMember.receiverExpressionKey ?? deferredMember.key;
    const ownerKeyStr = syntaxReferenceKeyToString(ownerKey);
    let ownerItemId: ItemId | undefined = input.typedOwners.get(ownerKeyStr);

    if (ownerItemId === undefined) {
      const receiverRef = entriesByKey.get(ownerKeyStr);
      if (receiverRef?.kind === "parameter") {
        ownerItemId = input.parameterOwners.get(receiverRef.parameterId);
        if (ownerItemId === undefined) {
          failed.push(deferredMember);
          continue;
        }
      } else if (isDeclarationScoped) {
        failed.push(deferredMember);
        continue;
      } else {
        remaining.push(deferredMember);
        continue;
      }
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
    return compareCodeUnitStrings(leftKey, rightKey);
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
