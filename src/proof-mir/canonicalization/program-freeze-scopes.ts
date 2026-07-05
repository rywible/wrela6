import { instantiatedHirIdKey, type MonoInstanceId } from "../../mono/ids";
import type { MonoFunctionInstance, MonoLocalId } from "../../mono/mono-hir";
import type { ProofMirDiagnostic } from "../diagnostics";
import type { DraftProofMirLocalRecord, DraftProofMirScopeRecord } from "../draft/draft-program";
import type { ProofMirOriginId, ProofMirScopeId } from "../ids";
import type { ProofMirScope } from "../model/graph";
import type { ProofMirCanonicalKey } from "./canonical-keys";
import { resolveMonoLocalId } from "./program-freeze-shared";

export function freezeScopesFromAssignments(input: {
  readonly scopeRecords: readonly DraftProofMirScopeRecord[];
  readonly localRecords: readonly DraftProofMirLocalRecord[];
  readonly functionInstance: MonoFunctionInstance | undefined;
  readonly functionInstanceId: MonoInstanceId;
  readonly ownerKey: string;
  readonly diagnostics: ProofMirDiagnostic[];
  readonly resolveAssignedScope: (key: ProofMirCanonicalKey) => ProofMirScopeId | undefined;
  readonly resolveParentScope: (
    key: ProofMirCanonicalKey,
    referenceKind: string,
  ) => ProofMirScopeId | undefined;
  readonly resolveOrigin: (
    key: ProofMirCanonicalKey,
    referenceKind: string,
  ) => ProofMirOriginId | undefined;
}): readonly ProofMirScope[] | "error" {
  const ownedLocalIdsByScopeKey = buildOwnedLocalIdsByScopeKey(input);
  const frozenScopes: ProofMirScope[] = [];
  for (const record of input.scopeRecords) {
    const scopeId = input.resolveAssignedScope(record.key);
    const origin = input.resolveOrigin(record.originKey, "originKey");
    if (scopeId === undefined || origin === undefined) {
      return "error";
    }
    const parentScopeId =
      record.parentScopeKey === undefined
        ? undefined
        : input.resolveParentScope(record.parentScopeKey, "parentScopeKey");
    if (record.parentScopeKey !== undefined && parentScopeId === undefined) {
      return "error";
    }
    frozenScopes.push({
      scopeId,
      ...(parentScopeId !== undefined ? { parentScopeId } : {}),
      kind: scopeKindFromRole(record.role),
      ownedLocals: ownedLocalIdsByScopeKey.get(String(record.key)) ?? [],
      openedObligations: [],
      openedSessionMembers: [],
      origin,
    });
  }
  return frozenScopes;
}

function scopeKindFromRole(role: string): ProofMirScope["kind"] {
  if (role === "function") return "function";
  if (role.startsWith("loop:")) return "loop";
  if (role.startsWith("matchArm:")) return "matchArm";
  if (role.startsWith("validationArm:")) return "validationArm";
  if (role.startsWith("attemptArm:")) return "attemptArm";
  if (role.startsWith("take:")) return "take";
  if (role.startsWith("suspendResume:")) return "suspendResume";
  return "block";
}

function buildOwnedLocalIdsByScopeKey(input: {
  readonly localRecords: readonly DraftProofMirLocalRecord[];
  readonly functionInstance: MonoFunctionInstance | undefined;
  readonly functionInstanceId: MonoInstanceId;
  readonly ownerKey: string;
  readonly diagnostics: ProofMirDiagnostic[];
}): ReadonlyMap<string, readonly MonoLocalId[]> {
  const localIdsByScopeKey = new Map<string, MonoLocalId[]>();
  for (const record of input.localRecords) {
    if (record.scopeKey === undefined) continue;
    const monoLocalId = resolveMonoLocalId({
      functionInstance: input.functionInstance,
      localRecord: record,
      functionInstanceId: input.functionInstanceId,
      ownerKey: input.ownerKey,
      diagnostics: input.diagnostics,
    });
    if (monoLocalId === undefined) continue;
    const scopeKey = String(record.scopeKey);
    const current = localIdsByScopeKey.get(scopeKey) ?? [];
    current.push(monoLocalId);
    localIdsByScopeKey.set(scopeKey, current);
  }
  for (const ownedLocals of localIdsByScopeKey.values()) {
    ownedLocals.sort((left, right) =>
      instantiatedHirIdKey(left).localeCompare(instantiatedHirIdKey(right)),
    );
  }
  return localIdsByScopeKey;
}
