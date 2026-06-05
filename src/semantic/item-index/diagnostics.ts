import type { Diagnostic } from "../../shared";

export type ItemIndexDiagnosticCode =
  | "ITEM_DUPLICATE_MODULE"
  | "ITEM_DUPLICATE_DECLARATION"
  | "ITEM_DUPLICATE_FIELD"
  | "ITEM_DUPLICATE_PARAMETER"
  | "ITEM_DUPLICATE_TYPE_PARAMETER"
  | "ITEM_DUPLICATE_ENUM_CASE";

export type ItemIndexDiagnostic = Diagnostic<ItemIndexDiagnosticCode>;
