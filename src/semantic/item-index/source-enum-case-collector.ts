import type { HasEnumCases } from "../../frontend/ast/declaration-views";
import { fieldId, itemId } from "../ids";
import type { SourceItemRecord } from "./item-records";
import type { SourceMemberCollectionContext } from "./source-member-collector";

export function collectEnumCases(
  context: SourceMemberCollectionContext,
  item: SourceItemRecord,
  source: HasEnumCases,
): void {
  for (const enumCase of source.enumCases()) {
    const caseName = enumCase.nameText();
    const caseNameSpan = enumCase.nameSpan();
    if (caseName === undefined || caseNameSpan === undefined) continue;

    const caseItemId = itemId(context.items.length);
    context.items.push({
      id: caseItemId,
      kind: "enumCase",
      moduleId: item.moduleId,
      parentItemId: item.id,
      name: caseName,
      modifiers: [],
      nameSpan: caseNameSpan,
      span: enumCase.span,
      declaration: enumCase,
    });

    for (const payloadField of enumCase.payloadFields()) {
      const fieldName = payloadField.nameText();
      const fieldNameSpan = payloadField.nameSpan();
      if (fieldName === undefined || fieldNameSpan === undefined) continue;
      context.fields.push({
        id: fieldId(context.fields.length),
        ownerItemId: caseItemId,
        role: "enumPayload",
        name: fieldName,
        nameSpan: fieldNameSpan,
        span: payloadField.span,
        type: payloadField.type(),
      });
    }
  }
}
