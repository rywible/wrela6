import type { ItemRecord } from "../semantic/item-index";
import { ValidatedBufferDeclarationView } from "../frontend/ast/validated-buffer-views";
import type { HirLoweringContext } from "./lowering-context";
import type { HirValidatedBuffer } from "./hir";
import { hirDiagnostic } from "./lowering-context";
import { lowerRequirementSurface } from "./requirement-lowerer";

function reportMissingFieldSurface(input: {
  readonly item: ItemRecord;
  readonly context: HirLoweringContext;
  readonly sourceOrigin: import("./ids").HirOriginId;
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
  readonly typeId: import("../semantic/ids").TypeId;
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

export function lowerValidatedBufferDeclaration(input: {
  readonly item: ItemRecord;
  readonly context: HirLoweringContext;
}): HirValidatedBuffer | undefined {
  if (input.item.kind !== "validatedBuffer" || input.item.typeId === undefined) return undefined;
  const fields = input.context.index.fieldsForItem(input.item.id);
  const parameterFields = fields
    .filter((field) => field.role === "validatedParam")
    .map((field) => field.id);
  const layoutFields = fields
    .filter((field) => field.role === "layoutField")
    .map((field) => field.id);
  const derivedFields = fields.filter((field) => field.role === "field").map((field) => field.id);
  const sourceOrigin = input.context.origins.forSynthetic({
    moduleId: input.item.moduleId,
    span: input.item.span,
    stableDetail: `validated-buffer:${input.item.id}`,
    ownerItemId: input.item.id,
  });
  if (parameterFields.length === 0 && layoutFields.length === 0) {
    reportMissingFieldSurface({ item: input.item, context: input.context, sourceOrigin });
  }

  return {
    typeId: input.item.typeId,
    itemId: input.item.id,
    parameterFields,
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
