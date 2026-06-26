import { SourceSpan } from "../shared/source-span";
import type { FunctionId, ItemId, ModuleId, TypeId } from "../semantic/ids";
import type { TypeParameterKey } from "../semantic/surface/resource-kind";
import { errorCheckedType, type CheckedType } from "../semantic/surface/type-model";
import type {
  CheckedMonoClosureSourceOrigin,
  CheckedConstructorKindRuleTable,
  CheckedInstanceEligibilityOwner,
  CheckedInstanceEligibilityRuleTable,
  CheckedTargetTypeKindTable,
} from "../semantic/surface/mono-closure";
import type { CheckedImageSeed } from "../semantic/surface/semantic-surface-checker";
import type { CertifiedPlatformBindingTable } from "../semantic/surface/checked-program";
import type { TypeConstructorId } from "../semantic/surface/type-model";
import type {
  HirCertifiedPlatformBindingTable,
  HirConstructorKindRuleRecord,
  HirConstructorKindRuleTable,
  HirExternalEntryRootRecord,
  HirInstanceEligibilityRuleRecord,
  HirInstanceEligibilityRuleTable,
  HirMonoClosureSurface,
  HirSourceTypeKindRecord,
  HirSourceTypeKindTable,
  HirTargetTypeKindRecord,
  HirTargetTypeKindTable,
  HirTypeRecord,
} from "./hir";
import { hirTable } from "./hir-table";
import { hirDiagnostic } from "./lowering-context";
import type { HirLoweringContext } from "./lowering-context";
import type { HirOriginId } from "./ids";

export function lowerMonoClosureSurface(input: {
  readonly context: HirLoweringContext;
  readonly typeRecords: readonly HirTypeRecord[];
}): HirMonoClosureSurface {
  const context = input.context;
  const program = context.program;
  const facts = program.monoClosureFacts;

  return {
    sourceTypeKinds: buildSourceTypeKindTable(input.typeRecords),
    targetTypeKinds: buildTargetTypeKindTable({ facts: facts.targetTypeKinds, context }),
    constructorKindRules: buildConstructorKindRuleTable({
      facts: facts.constructorKindRules,
      context,
    }),
    instanceEligibilityRules: buildInstanceEligibilityRuleTable({
      facts: facts.instanceEligibilityRules,
      context,
    }),
    certifiedPlatformBindings: buildCertifiedPlatformBindingTable(
      program.certifiedPlatformBindings,
    ),
    externalEntryRoots: buildExternalEntryRoots({ context, image: context.image }),
  };
}

function buildSourceTypeKindTable(records: readonly HirTypeRecord[]): HirSourceTypeKindTable {
  const entries: readonly HirSourceTypeKindRecord[] = records.map((record) => ({
    typeId: record.typeId,
    kind: record.resourceKind,
    sourceOrigin: record.sourceOrigin,
  }));
  return hirTable({
    entries,
    keyOf: (entry) => String(entry.typeId).padStart(12, "0"),
    lookupKeyOf: (id) => String(id).padStart(12, "0"),
  });
}

function buildTargetTypeKindTable(input: {
  readonly facts: CheckedTargetTypeKindTable;
  readonly context: HirLoweringContext;
}): HirTargetTypeKindTable {
  const entries: readonly HirTargetTypeKindRecord[] = input.facts.entries().map((record) => {
    const sourceOrigin = hirOriginFromSemanticClosureOrigin(record.sourceOrigin, () =>
      input.context.origins.forSynthetic({
        moduleId: 0 as ModuleId,
        span: SourceSpan.from(0, 0),
        stableDetail: `targetTypeKind:${record.targetTypeId}`,
      }),
    );
    return {
      targetTypeId: record.targetTypeId,
      kind: record.kind,
      sourceOrigin,
    };
  });
  return hirTable({
    entries,
    keyOf: (entry) => String(entry.targetTypeId).padStart(12, "0"),
    lookupKeyOf: (id) => String(id).padStart(12, "0"),
  });
}

function buildConstructorKindRuleTable(input: {
  readonly facts: CheckedConstructorKindRuleTable;
  readonly context: HirLoweringContext;
}): HirConstructorKindRuleTable {
  const entries: readonly HirConstructorKindRuleRecord[] = input.facts.entries().map((record) => {
    const sourceOrigin = hirOriginFromSemanticClosureOrigin(record.sourceOrigin, () =>
      input.context.origins.forSynthetic({
        moduleId: 0 as ModuleId,
        span: SourceSpan.from(0, 0),
        stableDetail: `constructorRule:${constructorRecordKey(record.constructor)}`,
      }),
    );
    return {
      constructor: record.constructor,
      rule: record.rule,
      ...(record.resultKind !== undefined ? { resultKind: record.resultKind } : {}),
      sourceOrigin,
    };
  });
  return hirTable({
    entries,
    keyOf: (entry) => constructorRecordKey(entry.constructor),
    lookupKeyOf: (id) => constructorRecordKey(id),
  });
}

function buildInstanceEligibilityRuleTable(input: {
  readonly facts: CheckedInstanceEligibilityRuleTable;
  readonly context: HirLoweringContext;
}): HirInstanceEligibilityRuleTable {
  const entries: HirInstanceEligibilityRuleRecord[] = [];
  for (const record of input.facts.entries()) {
    const owner = convertInstanceEligibilityOwner(record.owner, input.context);
    if (owner === undefined) continue;
    entries.push({
      owner,
      parameter: record.parameter,
      allowedConcreteKinds: record.allowedConcreteKinds,
      sourceOrigin: hirOriginFromSemanticClosureOrigin(record.sourceOrigin, () =>
        input.context.origins.forSynthetic({
          moduleId: 0 as ModuleId,
          span: SourceSpan.from(0, 0),
          stableDetail: `instanceEligibilityRule:${instanceEligibilityRuleRecordKey(record.owner, record.parameter)}`,
        }),
      ),
    });
  }
  return hirTable({
    entries,
    keyOf: (entry) => instanceEligibilityRuleRecordKey(entry.owner, entry.parameter),
    lookupKeyOf: (id) => id,
  });
}

function buildCertifiedPlatformBindingTable(
  bindings: CertifiedPlatformBindingTable,
): HirCertifiedPlatformBindingTable {
  return hirTable({
    entries: bindings.entries(),
    keyOf: (entry) => String(entry.functionId).padStart(12, "0"),
    lookupKeyOf: (id) => String(id).padStart(12, "0"),
  });
}

function buildExternalEntryRoots(input: {
  readonly context: HirLoweringContext;
  readonly image: CheckedImageSeed | undefined;
}): readonly HirExternalEntryRootRecord[] {
  const roots: HirExternalEntryRootRecord[] = [];
  const image = input.image;
  if (image !== undefined && image.entryFunctionId !== undefined) {
    const context = input.context;
    const entryFunctionId = image.entryFunctionId;
    const functionRecord = context.index.function(entryFunctionId);
    const module = functionRecord?.moduleId ?? (0 as ModuleId);

    const typeParameters = [...context.index.typeParametersForFunction(entryFunctionId)].sort(
      (left, right) => left.index - right.index,
    );
    const functionTypeArguments: readonly CheckedType[] =
      typeParameters.length > 0 ? typeParameters.map(() => errorCheckedType()) : [];

    const sourceOrigin = context.origins.forSynthetic({
      moduleId: module,
      span: image.sourceSpan,
      stableDetail: `image-entry-root:${entryFunctionId}`,
      ownerFunctionId: entryFunctionId,
    });

    roots.push({
      functionId: entryFunctionId,
      ownerTypeArguments: [],
      functionTypeArguments,
      reason: "imageEntry",
      sourceOrigin,
    });
  }

  for (const root of input.context.program.monoClosureFacts.externalEntryRoots.entries()) {
    const reason = externalEntryRootReason(root.reason);
    if (
      reason === "imageEntry" &&
      roots.some(
        (existing) => existing.reason === "imageEntry" && existing.functionId === root.functionId,
      )
    ) {
      continue;
    }
    const functionRecord = input.context.index.function(root.functionId);
    const module = functionRecord?.moduleId ?? (0 as ModuleId);
    roots.push({
      functionId: root.functionId,
      ownerTypeArguments: root.ownerTypeArguments,
      functionTypeArguments: root.functionTypeArguments,
      reason,
      sourceOrigin: hirOriginFromSemanticClosureOrigin(root.sourceOrigin, () =>
        input.context.origins.forSynthetic({
          moduleId: module,
          span: SourceSpan.from(0, 0),
          stableDetail: `external-entry-root:${root.functionId}:${root.reason}`,
          ownerFunctionId: root.functionId,
        }),
      ),
    });
  }

  return roots.sort((left, right) =>
    externalEntryRootRecordKey(left) < externalEntryRootRecordKey(right)
      ? -1
      : externalEntryRootRecordKey(left) > externalEntryRootRecordKey(right)
        ? 1
        : 0,
  );
}

function externalEntryRootReason(
  reason: import("../semantic/surface/mono-closure").CheckedExternalEntryRootReason,
): HirExternalEntryRootRecord["reason"] {
  if (reason === "imageEntry") return "imageEntry";
  return "targetRequired";
}

function hirOriginFromSemanticClosureOrigin(
  origin: CheckedMonoClosureSourceOrigin | undefined,
  fallback: () => HirOriginId,
): HirOriginId {
  if (typeof origin === "number") return origin as HirOriginId;
  return fallback();
}

function externalEntryRootRecordKey(root: HirExternalEntryRootRecord): string {
  const reasonRank = root.reason === "imageEntry" ? "0" : "1";
  return `${reasonRank}:${String(root.functionId).padStart(12, "0")}:${root.reason}`;
}

function convertInstanceEligibilityOwner(
  owner: CheckedInstanceEligibilityOwner,
  context: HirLoweringContext,
):
  | { readonly kind: "function"; readonly functionId: FunctionId }
  | { readonly kind: "type"; readonly typeId: TypeId }
  | undefined {
  if (owner.kind === "function") {
    return { kind: "function", functionId: owner.functionId };
  }
  const item = context.index.item(owner.itemId);
  if (item?.typeId === undefined) {
    const span = item?.span ?? SourceSpan.from(0, 0);
    const moduleId = item?.moduleId ?? (0 as ModuleId);
    context.diagnostics.report(
      hirDiagnostic({
        code: "HIR_INPUT_SURFACE_DISAGREEMENT",
        message: "Instance eligibility owner does not resolve to a type.",
        moduleId,
        spanStart: span.start,
        spanEnd: span.end,
        ownerKey: `item:${owner.itemId}`,
        originKey: `instance-eligibility-owner:${owner.itemId}`,
        originId: context.origins.forSynthetic({
          moduleId,
          span,
          stableDetail: `instance-eligibility-owner:${owner.itemId}`,
          ownerItemId: owner.itemId,
        }),
        stableDetail: `instance-eligibility-owner:${owner.itemId}`,
      }),
    );
    return undefined;
  }
  return { kind: "type", typeId: item.typeId };
}

function instanceEligibilityRuleRecordKey(
  owner:
    | { readonly kind: "function"; readonly functionId: FunctionId }
    | { readonly kind: "type"; readonly typeId: TypeId }
    | { readonly kind: "item"; readonly itemId: ItemId },
  parameter: TypeParameterKey,
): string {
  const ownerId =
    owner.kind === "function"
      ? owner.functionId
      : owner.kind === "type"
        ? owner.typeId
        : owner.itemId;
  return `${owner.kind}:${ownerId}:${parameter.owner.kind}:${parameter.owner.kind === "item" ? parameter.owner.itemId : parameter.owner.functionId}:${parameter.index}`;
}

function constructorRecordKey(constructor: TypeConstructorId): string {
  switch (constructor.kind) {
    case "source":
      return `source:${String(constructor.typeId).padStart(12, "0")}`;
    case "core":
      return `core:${constructor.coreTypeId}`;
    case "target":
      return `target:${constructor.targetTypeId}`;
  }
}
