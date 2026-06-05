import type {
  FunctionId,
  ItemId,
  FieldId,
  ParameterId,
  PlatformPrimitiveId,
  PlatformContractId,
  TargetId,
  TypeId,
} from "../ids";
import type { CheckedType } from "./type-model";
import type { CheckedResourceKind, TypeParameterKey } from "./resource-kind";
import type { TypeParameterOwner } from "../item-index/item-records";
import type { CheckedProofSurface } from "./proof-surface";
import { checkedProofSurface } from "./proof-surface";
import type { SyntaxReferenceKey, ResolvedReference } from "../names/reference";
import type { SourceSpan } from "../../frontend";
import { compareCodeUnitStrings } from "./deterministic-sort";

// ── Checked type table ──────────────────────────────────────

export interface CheckedTypeRecord {
  readonly typeId: TypeId;
  readonly itemId: ItemId;
  readonly type: CheckedType;
}

export interface CheckedTypeTable {
  get(typeId: TypeId): CheckedTypeRecord | undefined;
  entries(): readonly CheckedTypeRecord[];
}

function checkedTypeTable(records: readonly CheckedTypeRecord[]): CheckedTypeTable {
  const sorted = [...records].sort(
    (left, right) => (left.typeId as number) - (right.typeId as number),
  );
  const byId = new Map(sorted.map((record) => [record.typeId, record]));
  return {
    get: (typeId) => byId.get(typeId),
    entries: () => sorted,
  };
}

// ── Checked function signature ──────────────────────────────

export interface CheckedInterfaceConstraint {
  readonly interfaceType: CheckedType;
  readonly arguments: readonly CheckedType[];
  readonly span: SourceSpan;
}

export interface CheckedGenericParameter {
  readonly key: import("./resource-kind").TypeParameterKey;
  readonly name: string;
  readonly bounds: readonly CheckedInterfaceConstraint[];
  readonly span: SourceSpan;
}

export interface CheckedGenericSignature {
  readonly owner: TypeParameterOwner;
  readonly parameters: readonly CheckedGenericParameter[];
  readonly constraints: readonly CheckedInterfaceConstraint[];
}

export interface CheckedParameter {
  readonly parameterId: ParameterId;
  readonly name: string;
  readonly type: CheckedType;
  readonly mode: "observe" | "consume";
  readonly resourceKind: CheckedResourceKind;
  readonly referenceKey?: SyntaxReferenceKey;
  readonly sourceSpan: SourceSpan;
}

export interface CheckedReceiver {
  readonly parameterId: ParameterId;
  readonly ownerItemId: ItemId;
  readonly mode: "observe" | "consume";
  readonly referenceKey?: SyntaxReferenceKey;
}

export interface CheckedFunctionModifiers {
  readonly isPlatform: boolean;
  readonly isTerminal: boolean;
  readonly isPredicate: boolean;
  readonly isConstructor: boolean;
  readonly isPrivate: boolean;
}

export interface CheckedFunctionSignature {
  readonly functionId: FunctionId;
  readonly itemId: ItemId;
  readonly ownerItemId?: ItemId;
  readonly genericSignature?: CheckedGenericSignature;
  readonly receiver?: CheckedReceiver;
  readonly parameters: readonly CheckedParameter[];
  readonly returnType: CheckedType;
  readonly returnKind: CheckedResourceKind;
  readonly modifiers: CheckedFunctionModifiers;
  readonly sourceSpan: SourceSpan;
}

export interface CheckedFunctionSignatureTable {
  get(functionId: FunctionId): CheckedFunctionSignature | undefined;
  entries(): readonly CheckedFunctionSignature[];
}

function checkedFunctionSignatureTable(
  records: readonly CheckedFunctionSignature[],
): CheckedFunctionSignatureTable {
  const sorted = [...records].sort(
    (left, right) => (left.functionId as number) - (right.functionId as number),
  );
  const byId = new Map(sorted.map((record) => [record.functionId, record]));
  return {
    get: (functionId) => byId.get(functionId),
    entries: () => sorted,
  };
}

// ── Checked field table ─────────────────────────────────────

export interface CheckedFieldRecord {
  readonly fieldId: FieldId;
  readonly itemId: ItemId;
  readonly name: string;
  readonly type: CheckedType;
  readonly resourceKind: CheckedResourceKind;
  readonly sourceSpan: SourceSpan;
}

export interface CheckedFieldTable {
  get(fieldId: FieldId): CheckedFieldRecord | undefined;
  entries(): readonly CheckedFieldRecord[];
}

function checkedFieldTable(records: readonly CheckedFieldRecord[]): CheckedFieldTable {
  const sorted = [...records].sort((left, right) => {
    const aId = left.fieldId as number;
    const bId = right.fieldId as number;
    return aId - bId;
  });
  const byId = new Map(sorted.map((record) => [record.fieldId, record]));
  return {
    get: (fieldId) => byId.get(fieldId),
    entries: () => sorted,
  };
}

// ── Checked generic parameter table ─────────────────────────

export interface CheckedGenericParameterRecord {
  readonly key: TypeParameterKey;
  readonly name: string;
  readonly owner: TypeParameterOwner;
  readonly span: SourceSpan;
}

export interface CheckedGenericParameterTable {
  entries(): readonly CheckedGenericParameterRecord[];
}

function ownerIdString(owner: TypeParameterOwner): string {
  if (owner.kind === "item") return String(owner.itemId);
  return String(owner.functionId);
}

function checkedGenericParameterTable(
  records: readonly CheckedGenericParameterRecord[],
): CheckedGenericParameterTable {
  const sorted = [...records].sort((left, right) => {
    const aKey = `${left.owner.kind}:${ownerIdString(left.owner)}:${left.key.index}`;
    const bKey = `${right.owner.kind}:${ownerIdString(right.owner)}:${right.key.index}`;
    if (aKey < bKey) return -1;
    if (aKey > bKey) return 1;
    return 0;
  });
  return {
    entries: () => sorted,
  };
}

// ── Completed member reference ─────────────────────────────

export interface CompletedMemberReference {
  readonly key: SyntaxReferenceKey;
  readonly reference: ResolvedReference;
}

export interface CompletedMemberReferenceTable {
  get(key: SyntaxReferenceKey): ResolvedReference | undefined;
  entries(): readonly CompletedMemberReference[];
}

function completedMemberReferenceTable(
  entries: readonly CompletedMemberReference[],
): CompletedMemberReferenceTable {
  const sorted = [...entries].sort((left, right) => {
    const leftKey = completedMemberKeyString(left.key);
    const rightKey = completedMemberKeyString(right.key);
    return compareCodeUnitStrings(leftKey, rightKey);
  });
  const byKey = new Map<string, ResolvedReference>();
  for (const entry of sorted) {
    byKey.set(completedMemberKeyString(entry.key), entry.reference);
  }
  return {
    get: (key) => byKey.get(completedMemberKeyString(key)),
    entries: () => sorted,
  };
}

export function completedMemberKeyString(key: SyntaxReferenceKey): string {
  return `${key.moduleId}:${key.span.start}:${key.span.end}:${key.kind}:${key.ordinal}`;
}

// ── Certified platform binding ─────────────────────────────

export interface PlatformPrimitiveBindingCertificate {
  readonly kind: "exactCatalogMatch";
  readonly signatureFingerprint: string;
  readonly proofContractFingerprint: string;
}

export interface CertifiedPlatformBinding {
  readonly itemId: ItemId;
  readonly functionId: FunctionId;
  readonly primitiveId: PlatformPrimitiveId;
  readonly contractId: PlatformContractId;
  readonly targetId: TargetId;
  readonly certificate: PlatformPrimitiveBindingCertificate;
}

export interface CertifiedPlatformBindingTable {
  get(functionId: FunctionId): CertifiedPlatformBinding | undefined;
  entries(): readonly CertifiedPlatformBinding[];
}

function certifiedPlatformBindingTable(
  bindings: readonly CertifiedPlatformBinding[],
): CertifiedPlatformBindingTable {
  const sorted = [...bindings].sort(
    (left, right) => (left.functionId as number) - (right.functionId as number),
  );
  const byId = new Map(sorted.map((binding) => [binding.functionId, binding]));
  return {
    get: (functionId) => byId.get(functionId),
    entries: () => sorted,
  };
}

// ── CheckedSemanticProgram ─────────────────────────────────

export interface CheckedSemanticProgram {
  readonly types: CheckedTypeTable;
  readonly functions: CheckedFunctionSignatureTable;
  readonly fields: CheckedFieldTable;
  readonly genericParameters: CheckedGenericParameterTable;
  readonly completedMembers: CompletedMemberReferenceTable;
  readonly proofSurface: CheckedProofSurface;
  readonly certifiedPlatformBindings: CertifiedPlatformBindingTable;
}

// ── CheckedProgramBuilder ───────────────────────────────────

export class CheckedProgramBuilder {
  private readonly typeRecords: CheckedTypeRecord[] = [];
  private readonly functionRecords: CheckedFunctionSignature[] = [];
  private readonly fieldRecords: CheckedFieldRecord[] = [];
  private readonly genericParamRecords: CheckedGenericParameterRecord[] = [];
  private readonly completedMemberEntries: CompletedMemberReference[] = [];
  private readonly platformBindingRecords: CertifiedPlatformBinding[] = [];
  private proofSurfaceSeeds: {
    requirements?: readonly import("./proof-surface").CheckedRequirementSurface[];
    terminalSurfaces?: readonly import("./proof-surface").CheckedTerminalSurface[];
  } = {};

  addType(record: CheckedTypeRecord): void {
    this.typeRecords.push(record);
  }

  addFunctionSignature(signature: CheckedFunctionSignature): void {
    this.functionRecords.push(signature);
  }

  addField(record: CheckedFieldRecord): void {
    this.fieldRecords.push(record);
  }

  addGenericParameter(record: CheckedGenericParameterRecord): void {
    this.genericParamRecords.push(record);
  }

  addCompletedMember(entry: CompletedMemberReference): void {
    this.completedMemberEntries.push(entry);
  }

  addCertifiedPlatformBinding(binding: CertifiedPlatformBinding): void {
    this.platformBindingRecords.push(binding);
  }

  setProofSurfaceSeeds(seeds: {
    requirements?: readonly import("./proof-surface").CheckedRequirementSurface[];
    terminalSurfaces?: readonly import("./proof-surface").CheckedTerminalSurface[];
  }): void {
    this.proofSurfaceSeeds = seeds;
  }

  build(): CheckedSemanticProgram {
    return {
      types: checkedTypeTable(this.typeRecords),
      functions: checkedFunctionSignatureTable(this.functionRecords),
      fields: checkedFieldTable(this.fieldRecords),
      genericParameters: checkedGenericParameterTable(this.genericParamRecords),
      completedMembers: completedMemberReferenceTable(this.completedMemberEntries),
      proofSurface: checkedProofSurface(this.proofSurfaceSeeds),
      certifiedPlatformBindings: certifiedPlatformBindingTable(this.platformBindingRecords),
    };
  }
}
