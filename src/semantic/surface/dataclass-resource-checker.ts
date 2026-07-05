import type { FieldRecord, ItemIndex } from "../item-index";
import type { CoreTypeCatalog } from "../names/core-types";
import type { SemanticTargetSurface } from "./platform-surface";
import type { SurfaceReferenceLookup } from "./reference-lookup";
import { checkTypeReference } from "./type-reference-checker";
import type { CheckedProgramBuilder } from "./checked-program";
import type { SemanticSurfaceDiagnostic } from "./diagnostics";
import { invalidWireEncoding } from "./diagnostics";
import { dataclassAffineField } from "./dataclass-diagnostics";
import type { ResourceKindContext } from "./resource-kind-checker";
import { resourceKindForType } from "./resource-kind-checker";
import type { CheckedResourceKind } from "./resource-kind";
import { isProofRelevantKind } from "./resource-kind";
import type { CheckedType } from "./type-model";
import { errorCheckedType } from "./type-model";
import type { WireScalarEncoding } from "../../shared/wire-layout";
import { layoutFieldWireSurfaceForCheckedType } from "./layout-field-wire-surface";
import { buildSourceResourceKindFixpoint } from "./resource-kind-worklist";

interface FieldEntry {
  readonly field: FieldRecord;
  readonly item: import("../item-index").ItemRecord;
  readonly type: CheckedType;
}

export function checkDataclassResources(input: {
  readonly index: ItemIndex;
  readonly referenceLookup: SurfaceReferenceLookup;
  readonly coreTypes: CoreTypeCatalog;
  readonly targetSurface: SemanticTargetSurface;
  readonly builder: CheckedProgramBuilder;
  readonly diagnostics: SemanticSurfaceDiagnostic[];
}): ResourceKindContext {
  const fieldEntries: FieldEntry[] = [];
  for (const item of input.index.items()) {
    const fields = input.index.fieldsForItem(item.id);
    for (const fieldRecord of fields) {
      const fieldTypeResult = fieldRecord.type
        ? checkTypeReference({
            moduleId: item.moduleId,
            view: fieldRecord.type,
            index: input.index,
            referenceLookup: input.referenceLookup,
            coreTypes: input.coreTypes,
          })
        : { type: errorCheckedType(), diagnostics: [] as readonly SemanticSurfaceDiagnostic[] };
      input.diagnostics.push(...fieldTypeResult.diagnostics);
      fieldEntries.push({ field: fieldRecord, item, type: fieldTypeResult.type });
    }
  }

  const kindContext = buildSourceResourceKindFixpoint({
    coreTypes: input.coreTypes,
    index: input.index,
    targetSurface: input.targetSurface,
    fields: fieldEntries.map(({ item, type }) => ({ itemTypeId: item.typeId, type })),
  });

  for (const { field, item, type } of fieldEntries) {
    const finalKind = resourceKindForType({ type, context: kindContext });
    if (item.kind === "dataclass" && isAffineOrProofRelevantFieldKind(finalKind)) {
      const source = input.index.module(item.moduleId)?.source;
      input.diagnostics.push(
        dataclassAffineField(field.name, field.nameSpan, source, {
          moduleId: item.moduleId,
          span: field.nameSpan,
          codeTieBreaker: `dataclass-affine-field:${field.name}`,
        }),
      );
    }
    let layoutWireEncoding: WireScalarEncoding | undefined;
    if (field.role === "layoutField" && type.kind !== "error") {
      const wireSurface = layoutFieldWireSurfaceForCheckedType({
        type,
        layoutWireEndian: field.layoutWireEndian,
      });
      if (wireSurface.validationDetails !== undefined) {
        const source = input.index.module(item.moduleId)?.source;
        input.diagnostics.push(
          invalidWireEncoding(field.name, wireSurface.validationDetails, field.span, source, {
            moduleId: item.moduleId,
            span: field.span,
            codeTieBreaker: "wire-encoding",
          }),
        );
      }
      layoutWireEncoding = wireSurface.wireEncoding;
    }
    input.builder.addField({
      fieldId: field.id,
      itemId: item.id,
      name: field.name,
      type,
      resourceKind: finalKind,
      sourceSpan: field.span,
      fieldRole: field.role,
      ...(field.role === "layoutField" && field.layoutWireEndian !== undefined
        ? { layoutWireEndian: field.layoutWireEndian }
        : {}),
      ...(field.role === "layoutField" && layoutWireEncoding !== undefined
        ? { wireEncoding: layoutWireEncoding }
        : {}),
    });
  }
  return kindContext;
}

function isAffineOrProofRelevantFieldKind(kind: CheckedResourceKind): boolean {
  if (kind.kind !== "concrete") return false;
  return kind.value === "Affine" || kind.value === "Linear" || isProofRelevantKind(kind.value);
}
