import type { HirOriginId } from "../../hir/ids";
import type { InstantiatedHirId } from "../../mono/ids";
import type { MonoInstanceId } from "../../mono/ids";
import { hirLocalId } from "../../hir/ids";
import type {
  MonoExpressionId,
  MonoInstantiatedProofId,
  MonoLocalId,
  MonoStatementId,
} from "../../mono/mono-hir";
import type { ProofMirRuntimeOperationId } from "../../runtime/runtime-catalog-types";
import { instantiatedHirId, instantiatedHirIdKey } from "../../mono/ids";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import { proofMirCanonicalKey } from "../canonicalization/canonical-keys";
import { proofMirLengthDelimitedField } from "../canonicalization/canonical-order";

function draftEntityKey(
  kind: string,
  fields: readonly { readonly kind: string; readonly payload: string }[],
): ProofMirCanonicalKey {
  const segments = fields.map((field) => proofMirLengthDelimitedField(field.kind, field.payload));
  return proofMirCanonicalKey(`${kind}:${segments.join(":")}`);
}

function stringField(
  kind: string,
  payload: string,
): { readonly kind: string; readonly payload: string } {
  return { kind, payload };
}

function monoInstanceField(
  kind: string,
  functionInstanceId: MonoInstanceId,
): { readonly kind: string; readonly payload: string } {
  return {
    kind,
    payload: String(functionInstanceId),
  };
}

function monoInstantiatedHirField(
  kind: string,
  id: InstantiatedHirId<unknown>,
): { readonly kind: string; readonly payload: string } {
  return {
    kind,
    payload: instantiatedHirIdKey(id),
  };
}

function canonicalReferenceField(
  kind: string,
  key: ProofMirCanonicalKey,
): { readonly kind: string; readonly payload: string } {
  return {
    kind,
    payload: String(key),
  };
}

function monoInstantiatedProofField(
  kind: string,
  id: MonoInstantiatedProofId<unknown>,
): { readonly kind: string; readonly payload: string } {
  return {
    kind,
    payload: `${String(id.instanceId)}/proof:${String(id.hirId)}`,
  };
}

export type DraftProofMirOriginOwner =
  | { readonly kind: "function"; readonly functionInstanceId: MonoInstanceId }
  | { readonly kind: "image"; readonly imageInstanceId: MonoInstanceId }
  | {
      readonly kind: "platform";
      readonly edgeId?: MonoInstantiatedProofId<unknown>;
      readonly primitiveId?: string;
    }
  | { readonly kind: "runtimeCatalog"; readonly runtimeId?: ProofMirRuntimeOperationId }
  | { readonly kind: "program" };

function draftOriginOwnerFields(
  owner: DraftProofMirOriginOwner,
): readonly { readonly kind: string; readonly payload: string }[] {
  switch (owner.kind) {
    case "function":
      return [
        { kind: "owner", payload: "function" },
        monoInstanceField("functionInstanceId", owner.functionInstanceId),
      ];
    case "image":
      return [
        { kind: "owner", payload: "image" },
        monoInstanceField("imageInstanceId", owner.imageInstanceId),
      ];
    case "platform": {
      const fields: { kind: string; payload: string }[] = [{ kind: "owner", payload: "platform" }];
      if (owner.edgeId !== undefined) {
        fields.push(monoInstantiatedProofField("edgeId", owner.edgeId));
      }
      if (owner.primitiveId !== undefined) {
        fields.push({ kind: "primitiveId", payload: owner.primitiveId });
      }
      return fields;
    }
    case "runtimeCatalog": {
      const fields: { kind: string; payload: string }[] = [
        { kind: "owner", payload: "runtimeCatalog" },
      ];
      if (owner.runtimeId !== undefined) {
        fields.push({ kind: "runtimeId", payload: String(owner.runtimeId) });
      }
      return fields;
    }
    case "program":
      return [{ kind: "owner", payload: "program" }];
    default: {
      const unreachable: never = owner;
      return unreachable;
    }
  }
}

export function draftOriginKey(input: {
  readonly owner: DraftProofMirOriginOwner;
  readonly sourceOrigin?: string;
  readonly hirOriginId?: HirOriginId;
  readonly note?: string;
  readonly monoExpressionId?: MonoExpressionId;
  readonly monoStatementId?: MonoStatementId;
  readonly layoutReferenceKey?: string;
}): ProofMirCanonicalKey {
  const fields = [...draftOriginOwnerFields(input.owner)];
  if (input.sourceOrigin !== undefined) {
    fields.push(stringField("sourceOrigin", input.sourceOrigin));
  }
  if (input.hirOriginId !== undefined) {
    fields.push(stringField("hirOriginId", String(input.hirOriginId)));
  }
  if (input.note !== undefined) {
    fields.push(stringField("note", input.note));
  }
  if (input.monoExpressionId !== undefined) {
    fields.push(monoInstantiatedHirField("monoExpressionId", input.monoExpressionId));
  }
  if (input.monoStatementId !== undefined) {
    fields.push(monoInstantiatedHirField("monoStatementId", input.monoStatementId));
  }
  if (input.layoutReferenceKey !== undefined) {
    fields.push(stringField("layoutReferenceKey", input.layoutReferenceKey));
  }
  return draftEntityKey("origin", fields);
}

export function draftBlockKey(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly role: string;
  readonly sourceOrigin: string;
}): ProofMirCanonicalKey {
  return draftEntityKey("block", [
    monoInstanceField("functionInstanceId", input.functionInstanceId),
    stringField("role", input.role),
    stringField("sourceOrigin", input.sourceOrigin),
  ]);
}

export function draftStatementKey(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly monoStatementId: MonoStatementId;
}): ProofMirCanonicalKey {
  return draftEntityKey("statement", [
    monoInstanceField("functionInstanceId", input.functionInstanceId),
    monoInstantiatedHirField("monoStatementId", input.monoStatementId),
  ]);
}

export function draftTerminatorKey(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly blockKey: ProofMirCanonicalKey;
}): ProofMirCanonicalKey {
  return draftEntityKey("terminator", [
    monoInstanceField("functionInstanceId", input.functionInstanceId),
    canonicalReferenceField("blockKey", input.blockKey),
  ]);
}

export function draftControlEdgeKey(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly role: string;
  readonly fromBlockKey?: ProofMirCanonicalKey;
  readonly toBlockKey?: ProofMirCanonicalKey;
  readonly originKey?: ProofMirCanonicalKey;
}): ProofMirCanonicalKey {
  const fields: { readonly kind: string; readonly payload: string }[] = [
    monoInstanceField("functionInstanceId", input.functionInstanceId),
    stringField("role", input.role),
  ];
  if (input.fromBlockKey !== undefined) {
    fields.push(canonicalReferenceField("fromBlockKey", input.fromBlockKey));
  }
  if (input.toBlockKey !== undefined) {
    fields.push(canonicalReferenceField("toBlockKey", input.toBlockKey));
  }
  if (input.originKey !== undefined) {
    fields.push(canonicalReferenceField("originKey", input.originKey));
  }
  return draftEntityKey("controlEdge", fields);
}

export function draftSiteDiscriminatedEdgeRole(input: {
  readonly edgeKind: string;
  readonly fromBlock: ProofMirCanonicalKey;
}): string {
  return String(
    draftEntityKey(input.edgeKind, [canonicalReferenceField("fromBlock", input.fromBlock)]),
  );
}

export function draftExitEdgeKey(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly role: string;
}): ProofMirCanonicalKey {
  return draftEntityKey("exitEdge", [
    monoInstanceField("functionInstanceId", input.functionInstanceId),
    stringField("role", input.role),
  ]);
}

export function draftValueKey(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly role: string;
}): ProofMirCanonicalKey {
  return draftEntityKey("value", [
    monoInstanceField("functionInstanceId", input.functionInstanceId),
    stringField("role", input.role),
  ]);
}

export function draftLocalKey(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly monoLocalId: MonoLocalId;
}): ProofMirCanonicalKey {
  return draftEntityKey("local", [
    monoInstanceField("functionInstanceId", input.functionInstanceId),
    monoInstantiatedHirField("monoLocalId", input.monoLocalId),
  ]);
}

function parseDraftEntityFields(
  key: ProofMirCanonicalKey,
  entityKind: string,
): Map<string, string> | undefined {
  const keyString = String(key);
  const prefix = `${entityKind}:`;
  if (!keyString.startsWith(prefix)) {
    return undefined;
  }

  let rest = keyString.slice(prefix.length);
  const fields = new Map<string, string>();

  while (rest.length > 0) {
    const kindMatch = /^([^:]+):len\((\d+)\):/.exec(rest);
    if (kindMatch === null) {
      return undefined;
    }
    const kind = kindMatch[1]!;
    const payloadLength = Number(kindMatch[2]!);
    const payloadStart = kindMatch[0].length;
    const payload = rest.slice(payloadStart, payloadStart + payloadLength);
    fields.set(kind, payload);
    rest = rest.slice(payloadStart + payloadLength);
    if (rest.startsWith(":")) {
      rest = rest.slice(1);
    }
  }

  return fields;
}

export function parseDraftLocalKey(
  key: ProofMirCanonicalKey,
): { readonly monoLocalId: MonoLocalId } | undefined {
  const fields = parseDraftEntityFields(key, "local");
  if (fields === undefined) {
    return undefined;
  }
  const monoLocalIdPayload = fields.get("monoLocalId");
  if (monoLocalIdPayload === undefined) {
    return undefined;
  }
  const slashIndex = monoLocalIdPayload.indexOf("/");
  if (slashIndex <= 0 || slashIndex === monoLocalIdPayload.length - 1) {
    return undefined;
  }
  const instanceId = monoLocalIdPayload.slice(0, slashIndex) as MonoInstanceId;
  const hirIdText = monoLocalIdPayload.slice(slashIndex + 1);
  const hirId = Number.parseInt(hirIdText, 10);
  if (!Number.isFinite(hirId)) {
    return undefined;
  }
  return {
    monoLocalId: instantiatedHirId(instanceId, hirLocalId(hirId)),
  };
}

export function draftPlaceKey(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly monoPlaceCanonicalKey: string;
}): ProofMirCanonicalKey {
  return draftEntityKey("place", [
    monoInstanceField("functionInstanceId", input.functionInstanceId),
    stringField("monoPlaceCanonicalKey", input.monoPlaceCanonicalKey),
  ]);
}

export function draftScopeKey(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly role: string;
  readonly parentScopeKey?: ProofMirCanonicalKey;
}): ProofMirCanonicalKey {
  const fields: { kind: string; payload: string }[] = [
    monoInstanceField("functionInstanceId", input.functionInstanceId),
    stringField("role", input.role),
  ];
  if (input.parentScopeKey !== undefined) {
    fields.push(canonicalReferenceField("parentScopeKey", input.parentScopeKey));
  }
  return draftEntityKey("scope", fields);
}

export function draftCallKey(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly monoExpressionId: MonoExpressionId;
}): ProofMirCanonicalKey {
  return draftEntityKey("call", [
    monoInstanceField("functionInstanceId", input.functionInstanceId),
    monoInstantiatedHirField("monoExpressionId", input.monoExpressionId),
  ]);
}

export function draftFactKey(input: {
  readonly role: string;
  readonly kind: string;
  readonly authorityKey: string;
}): ProofMirCanonicalKey {
  return draftEntityKey("fact", [
    stringField("role", input.role),
    stringField("kind", input.kind),
    stringField("authorityKey", input.authorityKey),
  ]);
}

export function draftLayoutTermKey(input: {
  readonly layoutReferenceKey: string;
  readonly termPath: string;
}): ProofMirCanonicalKey {
  return draftEntityKey("layoutTerm", [
    stringField("layoutReferenceKey", input.layoutReferenceKey),
    stringField("termPath", input.termPath),
  ]);
}

export function draftRuntimeCallKey(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly runtimeOperationId: ProofMirRuntimeOperationId;
  readonly callKey: ProofMirCanonicalKey;
}): ProofMirCanonicalKey {
  return draftEntityKey("runtimeCall", [
    monoInstanceField("functionInstanceId", input.functionInstanceId),
    stringField("runtimeOperationId", String(input.runtimeOperationId)),
    canonicalReferenceField("callKey", input.callKey),
  ]);
}

export function draftPrivateStateGenerationKey(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly placeKey: ProofMirCanonicalKey;
  readonly generationOrdinal: number;
}): ProofMirCanonicalKey {
  return draftEntityKey("privateStateGeneration", [
    monoInstanceField("functionInstanceId", input.functionInstanceId),
    canonicalReferenceField("placeKey", input.placeKey),
    stringField("generationOrdinal", String(input.generationOrdinal)),
  ]);
}
