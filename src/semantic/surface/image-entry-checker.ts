import type { FunctionId } from "../ids";
import { SourceSpan } from "../../frontend";
import type { ItemIndex } from "../item-index";
import type { CheckedFunctionSignatureTable } from "./checked-program";
import type { CheckedImageRootSelection } from "./image-root-selection";
import { targetSignatureExactlyMatches } from "./signature-checker";
import type { SemanticSurfaceDiagnostic } from "./diagnostics";
import { invalidImageEntryShape, invalidImageEntrySignature } from "./diagnostics";

export interface CheckImageEntryInput {
  readonly selection: CheckedImageRootSelection;
  readonly index: ItemIndex;
  readonly signatures: CheckedFunctionSignatureTable;
}

export interface CheckImageEntryResult {
  readonly entryFunctionId: FunctionId | undefined;
  readonly diagnostics: readonly SemanticSurfaceDiagnostic[];
}

export function checkImageEntry(input: CheckImageEntryInput): CheckImageEntryResult {
  const imageRecord = input.selection.image;
  const profile = input.selection.profile;
  const entryFunctionName = profile.entryFunctionName;

  const entryFunction = input.index.functions().find((func) => {
    return func.parentItemId === imageRecord.itemId && func.name === entryFunctionName;
  });

  if (entryFunction === undefined) {
    const imageItem = input.index.item(imageRecord.itemId);
    const span = imageItem?.span ?? SourceSpan.from(0, 0);
    return {
      entryFunctionId: undefined,
      diagnostics: [
        invalidImageEntryShape(
          `Entry function '${entryFunctionName}' not found in image`,
          span,
          undefined,
          { moduleId: imageRecord.moduleId, span, codeTieBreaker: "entry" },
        ),
      ],
    };
  }

  const checkedSignature = input.signatures.get(entryFunction.id);
  const targetSignature = profile.entrySignature;

  if (checkedSignature === undefined) {
    const funcItem = input.index.item(entryFunction.itemId);
    const span = funcItem?.span ?? SourceSpan.from(0, 0);
    return {
      entryFunctionId: entryFunction.id,
      diagnostics: [
        invalidImageEntrySignature(
          entryFunction.name,
          "No checked signature available",
          span,
          undefined,
          { moduleId: imageRecord.moduleId, span, codeTieBreaker: "entry" },
        ),
      ],
    };
  }

  if (!targetSignatureExactlyMatches(checkedSignature, targetSignature)) {
    const funcItem = input.index.item(entryFunction.itemId);
    const span = funcItem?.span ?? SourceSpan.from(0, 0);
    return {
      entryFunctionId: entryFunction.id,
      diagnostics: [
        invalidImageEntrySignature(
          entryFunction.name,
          "Signature does not match profile entry signature",
          span,
          undefined,
          { moduleId: imageRecord.moduleId, span, codeTieBreaker: "entry" },
        ),
      ],
    };
  }

  return {
    entryFunctionId: entryFunction.id,
    diagnostics: [],
  };
}
