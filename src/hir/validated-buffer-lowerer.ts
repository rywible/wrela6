import type { ItemRecord } from "../semantic/item-index";
import { ValidatedBufferDeclarationView } from "../frontend/ast/validated-buffer-views";
import {
  DeriveCaseView,
  type DerivedFieldView,
  type LayoutFieldView,
} from "../frontend/ast/field-views";
import type { CheckedFieldRecord } from "../semantic/surface/checked-program";
import type { FieldId, TypeId } from "../semantic/ids";
import { SourceSpan } from "../shared/source-span";
import type { ValidatedBufferFieldModel } from "../semantic/surface/validated-buffer-field-model";
import type { HirLoweringContext } from "./lowering-context";
import type {
  HirDerivedFieldCase,
  HirFieldRecord,
  HirValidatedBuffer,
  HirValidatedBufferDerivedField,
  HirValidatedBufferLayoutField,
} from "./hir";
import { hirDiagnostic } from "./lowering-context";
import { lowerRequirementSurface } from "./requirement-lowerer";
import {
  lowerDerivedCaseCondition,
  lowerLayoutExpression,
  type LayoutFieldKind,
  type ValidatedBufferLayoutFieldContext,
} from "./layout-expression-lowerer";
import type { HirOriginId } from "./ids";
import type { FieldRecord } from "../semantic/item-index";

function validatedBufferFieldModelForType(
  context: HirLoweringContext,
  typeId: TypeId,
): ValidatedBufferFieldModel | undefined {
  return context.program.validatedBufferFields.get(typeId);
}

function layoutFieldViewBySurfaceOrdinal(
  declaration: ValidatedBufferDeclarationView,
  surfaceOrdinal: number,
): LayoutFieldView | undefined {
  return declaration.layoutFields()[surfaceOrdinal];
}

function derivedFieldViewBySurfaceOrdinal(
  declaration: ValidatedBufferDeclarationView,
  surfaceOrdinal: number,
): DerivedFieldView | undefined {
  return declaration.derivedFields()[surfaceOrdinal];
}

function reportLayoutFieldSurfaceMismatch(input: {
  readonly item: ItemRecord;
  readonly context: HirLoweringContext;
  readonly typeId: TypeId;
  readonly fieldRecord: FieldRecord;
  readonly descriptorName: string;
  readonly viewName: string;
}): void {
  input.context.diagnostics.report(
    hirDiagnostic({
      code: "HIR_VALIDATED_BUFFER_FIELD_SURFACE_MISSING",
      message: `Validated buffer layout field '${input.descriptorName}' does not match declaration surface '${input.viewName}'.`,
      moduleId: input.item.moduleId,
      spanStart: input.fieldRecord.span.start,
      spanEnd: input.fieldRecord.span.end,
      ownerKey: `type:${input.typeId}`,
      originKey: `validated-buffer-field:${input.fieldRecord.id}`,
      stableDetail: `${input.descriptorName}:${input.viewName}`,
    }),
  );
}

function reportDerivedFieldSurfaceMismatch(input: {
  readonly item: ItemRecord;
  readonly context: HirLoweringContext;
  readonly typeId: TypeId;
  readonly fieldRecord: FieldRecord;
  readonly descriptorName: string;
  readonly viewName: string;
}): void {
  input.context.diagnostics.report(
    hirDiagnostic({
      code: "HIR_VALIDATED_BUFFER_FIELD_SURFACE_MISSING",
      message: `Validated buffer derived field '${input.descriptorName}' does not match declaration surface '${input.viewName}'.`,
      moduleId: input.item.moduleId,
      spanStart: input.fieldRecord.span.start,
      spanEnd: input.fieldRecord.span.end,
      ownerKey: `type:${input.typeId}`,
      originKey: `validated-buffer-field:${input.fieldRecord.id}`,
      stableDetail: `${input.descriptorName}:${input.viewName}`,
    }),
  );
}

function layoutDescriptorsInOrder(
  fieldModel: ValidatedBufferFieldModel,
  section: ValidatedBufferFieldModel["fields"][number]["section"],
): readonly ValidatedBufferFieldModel["fields"][number][] {
  return fieldModel.fields
    .filter((field) => field.section === section)
    .sort((left, right) => left.bodyOrdinal - right.bodyOrdinal);
}

function derivedFieldIdsBeforeInOrder(input: {
  readonly fieldOrder: readonly FieldId[];
  readonly beforeFieldId: FieldId;
  readonly derivedFieldIds: ReadonlySet<FieldId>;
}): FieldId[] {
  const result: FieldId[] = [];
  for (const fieldId of input.fieldOrder) {
    if (fieldId === input.beforeFieldId) {
      break;
    }
    if (input.derivedFieldIds.has(fieldId)) {
      result.push(fieldId);
    }
  }
  return result;
}

function reportUnmatchedFieldView(input: {
  readonly item: ItemRecord;
  readonly context: HirLoweringContext;
  readonly typeId: TypeId;
  readonly fieldRecord: FieldRecord;
  readonly role: "layout" | "derived";
}): void {
  input.context.diagnostics.report(
    hirDiagnostic({
      code: "HIR_VALIDATED_BUFFER_FIELD_SURFACE_MISSING",
      message: `Validated buffer ${input.role} field '${input.fieldRecord.name}' has no matching declaration surface.`,
      moduleId: input.item.moduleId,
      spanStart: input.fieldRecord.span.start,
      spanEnd: input.fieldRecord.span.end,
      ownerKey: `type:${input.typeId}`,
      originKey: `validated-buffer-field:${input.fieldRecord.id}`,
      stableDetail: input.fieldRecord.name,
    }),
  );
}

function reportMissingFieldSurface(input: {
  readonly item: ItemRecord;
  readonly context: HirLoweringContext;
  readonly sourceOrigin: HirOriginId;
}): void {
  input.context.diagnostics.report(
    hirDiagnostic({
      code: "HIR_VALIDATED_BUFFER_FIELD_SURFACE_MISSING",
      message: "Validated buffer declaration has no parameter or layout field surface.",
      moduleId: input.item.moduleId,
      spanStart: input.item.span.start,
      spanEnd: input.item.span.end,
      originId: input.sourceOrigin,
      ownerKey: `type:${input.item.typeId ?? 0}`,
      originKey: `validated-buffer:${input.item.id}`,
      stableDetail: input.item.name,
    }),
  );
}

function lowerValidatedBufferRequirements(input: {
  readonly item: ItemRecord;
  readonly context: HirLoweringContext;
  readonly typeId: TypeId;
}) {
  const declaration =
    input.item.declaration instanceof ValidatedBufferDeclarationView
      ? input.item.declaration
      : undefined;
  if (declaration === undefined) return [];

  return declaration
    .requireSections()
    .flatMap((section) => section.requirements())
    .flatMap((requirement, ordinal) => {
      const expression = requirement.expression();
      if (expression === undefined) {
        input.context.diagnostics.report(
          hirDiagnostic({
            code: "HIR_VALIDATED_BUFFER_REQUIREMENT_FAILED",
            message: "Validated buffer requirement has no expression.",
            moduleId: input.item.moduleId,
            spanStart: requirement.node.span.start,
            spanEnd: requirement.node.span.end,
            ownerKey: `type:${input.typeId}`,
            originKey: `requirement:${requirement.node.span.start}:${requirement.node.span.end}`,
            stableDetail: input.item.name,
          }),
        );
        return [];
      }
      const span = expression.span;
      const text = expression.source.text.slice(span.start, span.end);
      return [
        lowerRequirementSurface({
          surface: { expression: { kind: "opaque", text }, span },
          owner: { kind: "type", typeId: input.typeId },
          context: input.context,
          ordinal,
        }),
      ];
    });
}

function hirFieldRecordForCheckedField(input: {
  readonly fieldId: FieldId;
  readonly ownerTypeId: TypeId;
  readonly checkedField: CheckedFieldRecord;
  readonly sourceOrigin: HirOriginId;
}): HirFieldRecord {
  return {
    fieldId: input.fieldId,
    ownerTypeId: input.ownerTypeId,
    name: input.checkedField.name,
    type: input.checkedField.type,
    resourceKind: input.checkedField.resourceKind,
    sourceOrigin: input.sourceOrigin,
  };
}

function fieldOrigin(input: {
  readonly context: HirLoweringContext;
  readonly item: ItemRecord;
  readonly fieldId: FieldId;
  readonly span: SourceSpan;
}): HirOriginId {
  return input.context.origins.forSynthetic({
    moduleId: input.item.moduleId,
    span: input.span,
    stableDetail: `field:${input.fieldId}`,
    ownerItemId: input.item.id,
  });
}

function buildAvailableFields(input: {
  readonly context: HirLoweringContext;
  readonly item: ItemRecord;
  readonly parameterFieldIds: readonly FieldId[];
  readonly layoutFieldIds: readonly FieldId[];
  readonly derivedFieldIds: readonly FieldId[];
}): Map<string, { readonly fieldId: FieldId; readonly fieldKind: LayoutFieldKind }> {
  const availableFields = new Map<
    string,
    { readonly fieldId: FieldId; readonly fieldKind: LayoutFieldKind }
  >();
  const addField = (fieldId: FieldId, fieldKind: LayoutFieldKind) => {
    const checkedField = input.context.program.fields.get(fieldId);
    if (checkedField === undefined) return;
    if (availableFields.has(checkedField.name)) {
      return;
    }
    availableFields.set(checkedField.name, { fieldId, fieldKind });
  };
  for (const fieldId of input.parameterFieldIds) {
    addField(fieldId, "parameter");
  }
  for (const fieldId of input.layoutFieldIds) {
    addField(fieldId, "layout");
  }
  for (const fieldId of input.derivedFieldIds) {
    addField(fieldId, "derived");
  }
  return availableFields;
}

function lowerLayoutFields(input: {
  readonly item: ItemRecord;
  readonly context: HirLoweringContext;
  readonly typeId: TypeId;
  readonly declaration: ValidatedBufferDeclarationView;
  readonly fieldModel: ValidatedBufferFieldModel;
  readonly parameterFieldIds: readonly FieldId[];
  readonly derivedFieldIds: readonly FieldId[];
  readonly layoutDerivedFieldOrder: readonly FieldId[];
}): readonly HirValidatedBufferLayoutField[] {
  const ownerKey = `type:${input.typeId}`;
  const loweredLayoutFields: HirValidatedBufferLayoutField[] = [];
  const layoutFieldIdsBefore: FieldId[] = [];
  const derivedFieldIdSet = new Set(input.derivedFieldIds);

  for (const descriptor of layoutDescriptorsInOrder(input.fieldModel, "layout")) {
    const fieldRecord = input.context.index.field(descriptor.fieldId);
    const layoutFieldView = layoutFieldViewBySurfaceOrdinal(
      input.declaration,
      descriptor.surfaceOrdinal,
    );
    const checkedField = input.context.program.fields.get(descriptor.fieldId);
    if (fieldRecord === undefined || checkedField === undefined) {
      continue;
    }
    if (layoutFieldView === undefined) {
      reportUnmatchedFieldView({
        item: input.item,
        context: input.context,
        typeId: input.typeId,
        fieldRecord,
        role: "layout",
      });
      continue;
    }
    const layoutFieldViewName = layoutFieldView.nameText();
    if (layoutFieldViewName !== undefined && layoutFieldViewName !== descriptor.name) {
      reportLayoutFieldSurfaceMismatch({
        item: input.item,
        context: input.context,
        typeId: input.typeId,
        fieldRecord,
        descriptorName: descriptor.name,
        viewName: layoutFieldViewName,
      });
      continue;
    }
    const sourceOrigin = fieldOrigin({
      context: input.context,
      item: input.item,
      fieldId: fieldRecord.id,
      span: fieldRecord.span,
    });
    const fieldContext: ValidatedBufferLayoutFieldContext = {
      ownerItemId: input.item.id,
      typeId: input.typeId,
      availableFields: buildAvailableFields({
        context: input.context,
        item: input.item,
        parameterFieldIds: input.parameterFieldIds,
        layoutFieldIds: layoutFieldIdsBefore,
        derivedFieldIds: derivedFieldIdsBeforeInOrder({
          fieldOrder: input.layoutDerivedFieldOrder,
          beforeFieldId: descriptor.fieldId,
          derivedFieldIds: derivedFieldIdSet,
        }),
      }),
    };
    const offsetResult = lowerLayoutExpression({
      view: layoutFieldView.offsetExpression(),
      context: input.context,
      fieldContext,
      ownerKey,
    });
    const lengthExpression = layoutFieldView.lengthExpression();
    const lengthResult =
      lengthExpression === undefined
        ? undefined
        : lowerLayoutExpression({
            view: lengthExpression,
            context: input.context,
            fieldContext,
            ownerKey,
          });
    if (offsetResult.kind === "error") {
      continue;
    }
    if (lengthResult !== undefined && lengthResult.kind === "error") {
      continue;
    }
    loweredLayoutFields.push({
      field: hirFieldRecordForCheckedField({
        fieldId: descriptor.fieldId,
        ownerTypeId: input.typeId,
        checkedField,
        sourceOrigin,
      }),
      offset: offsetResult.expression,
      ...(lengthResult !== undefined ? { length: lengthResult.expression } : {}),
      ...(checkedField.layoutWireEndian !== undefined
        ? { layoutWireEndian: checkedField.layoutWireEndian }
        : {}),
      ...(checkedField.wireEncoding !== undefined
        ? { wireEncoding: checkedField.wireEncoding }
        : {}),
      sourceOrigin,
    });
    layoutFieldIdsBefore.push(descriptor.fieldId);
  }

  return loweredLayoutFields;
}

function lowerDerivedFieldCases(input: {
  readonly deriveCaseViews: readonly DeriveCaseView[];
  readonly context: HirLoweringContext;
  readonly fieldContext: ValidatedBufferLayoutFieldContext;
  readonly ownerKey: string;
  readonly moduleId: import("../semantic/ids").ModuleId;
}): readonly HirDerivedFieldCase[] {
  const cases: HirDerivedFieldCase[] = [];
  for (const deriveCaseView of input.deriveCaseViews) {
    const sourceOrigin = input.context.origins.forSyntax({
      moduleId: input.moduleId,
      node: deriveCaseView.node,
      ownerItemId: input.fieldContext.ownerItemId,
    });
    const condition = lowerDerivedCaseCondition({
      view: deriveCaseView.conditionExpression(),
      context: input.context,
      fieldContext: input.fieldContext,
      ownerKey: input.ownerKey,
    });
    const result = lowerLayoutExpression({
      view: deriveCaseView.resultExpression(),
      context: input.context,
      fieldContext: input.fieldContext,
      ownerKey: input.ownerKey,
    });
    if (condition === undefined || result.kind === "error") {
      continue;
    }
    cases.push({
      condition,
      result: result.expression,
      sourceOrigin,
    });
  }
  return cases;
}

function lowerDerivedFields(input: {
  readonly item: ItemRecord;
  readonly context: HirLoweringContext;
  readonly typeId: TypeId;
  readonly declaration: ValidatedBufferDeclarationView;
  readonly fieldModel: ValidatedBufferFieldModel;
  readonly parameterFieldIds: readonly FieldId[];
  readonly layoutFieldIds: readonly FieldId[];
  readonly layoutDerivedFieldOrder: readonly FieldId[];
}): readonly HirValidatedBufferDerivedField[] {
  const ownerKey = `type:${input.typeId}`;
  const loweredDerivedFields: HirValidatedBufferDerivedField[] = [];
  const derivedFieldIdSet = new Set(input.fieldModel.derivedFieldIds);

  for (const descriptor of layoutDescriptorsInOrder(input.fieldModel, "derive")) {
    const fieldRecord = input.context.index.field(descriptor.fieldId);
    const derivedFieldView = derivedFieldViewBySurfaceOrdinal(
      input.declaration,
      descriptor.surfaceOrdinal,
    );
    const checkedField = input.context.program.fields.get(descriptor.fieldId);
    if (fieldRecord === undefined || checkedField === undefined) {
      continue;
    }
    if (derivedFieldView === undefined) {
      reportUnmatchedFieldView({
        item: input.item,
        context: input.context,
        typeId: input.typeId,
        fieldRecord,
        role: "derived",
      });
      continue;
    }
    const derivedFieldViewName = derivedFieldView.nameText();
    if (derivedFieldViewName !== undefined && derivedFieldViewName !== descriptor.name) {
      reportDerivedFieldSurfaceMismatch({
        item: input.item,
        context: input.context,
        typeId: input.typeId,
        fieldRecord,
        descriptorName: descriptor.name,
        viewName: derivedFieldViewName,
      });
      continue;
    }
    const sourceOrigin = fieldOrigin({
      context: input.context,
      item: input.item,
      fieldId: fieldRecord.id,
      span: fieldRecord.span,
    });
    const fieldContext: ValidatedBufferLayoutFieldContext = {
      ownerItemId: input.item.id,
      typeId: input.typeId,
      availableFields: buildAvailableFields({
        context: input.context,
        item: input.item,
        parameterFieldIds: input.parameterFieldIds,
        layoutFieldIds: input.layoutFieldIds,
        derivedFieldIds: derivedFieldIdsBeforeInOrder({
          fieldOrder: input.layoutDerivedFieldOrder,
          beforeFieldId: descriptor.fieldId,
          derivedFieldIds: derivedFieldIdSet,
        }),
      }),
    };
    const sourceResult = lowerLayoutExpression({
      view: derivedFieldView.sourceExpression(),
      context: input.context,
      fieldContext,
      ownerKey,
    });
    if (sourceResult.kind === "error") {
      continue;
    }
    const cases = lowerDerivedFieldCases({
      deriveCaseViews: derivedFieldView.cases(),
      context: input.context,
      fieldContext,
      ownerKey,
      moduleId: input.item.moduleId,
    });
    loweredDerivedFields.push({
      field: hirFieldRecordForCheckedField({
        fieldId: descriptor.fieldId,
        ownerTypeId: input.typeId,
        checkedField,
        sourceOrigin,
      }),
      source: sourceResult.expression,
      cases,
      sourceOrigin,
    });
  }

  return loweredDerivedFields;
}

export function lowerValidatedBufferDeclaration(input: {
  readonly item: ItemRecord;
  readonly context: HirLoweringContext;
}): HirValidatedBuffer | undefined {
  if (input.item.kind !== "validatedBuffer" || input.item.typeId === undefined) return undefined;
  const fieldModel = validatedBufferFieldModelForType(input.context, input.item.typeId);
  const parameterFields = fieldModel?.parameterFieldIds ?? [];
  const layoutFieldIds = fieldModel?.layoutFieldIds ?? [];
  const derivedFieldIds = fieldModel?.derivedFieldIds ?? [];
  const layoutDerivedFieldOrder = fieldModel?.layoutDerivedFieldOrder ?? [];
  const sourceOrigin = input.context.origins.forSynthetic({
    moduleId: input.item.moduleId,
    span: input.item.span,
    stableDetail: `validated-buffer:${input.item.id}`,
    ownerItemId: input.item.id,
  });
  if (parameterFields.length === 0 && layoutFieldIds.length === 0) {
    reportMissingFieldSurface({ item: input.item, context: input.context, sourceOrigin });
  }

  const declaration =
    input.item.declaration instanceof ValidatedBufferDeclarationView
      ? input.item.declaration
      : undefined;
  const layoutFields =
    declaration === undefined || fieldModel === undefined
      ? []
      : lowerLayoutFields({
          item: input.item,
          context: input.context,
          typeId: input.item.typeId,
          declaration,
          fieldModel,
          parameterFieldIds: parameterFields,
          derivedFieldIds,
          layoutDerivedFieldOrder,
        });
  const derivedFields =
    declaration === undefined || fieldModel === undefined
      ? []
      : lowerDerivedFields({
          item: input.item,
          context: input.context,
          typeId: input.item.typeId,
          declaration,
          fieldModel,
          parameterFieldIds: parameterFields,
          layoutFieldIds,
          layoutDerivedFieldOrder,
        });

  return {
    typeId: input.item.typeId,
    itemId: input.item.id,
    parameterFields,
    layoutDerivedFieldOrder,
    layoutFields,
    derivedFields,
    requirements: lowerValidatedBufferRequirements({
      item: input.item,
      context: input.context,
      typeId: input.item.typeId,
    }),
    sourceOrigin,
  };
}

export function lowerValidatedBuffers(input: {
  readonly context: HirLoweringContext;
}): readonly HirValidatedBuffer[] {
  return input.context.index
    .items()
    .map((item) => lowerValidatedBufferDeclaration({ item, context: input.context }))
    .filter((buffer): buffer is HirValidatedBuffer => buffer !== undefined);
}
