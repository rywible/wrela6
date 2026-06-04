import type { ModulePath } from "./module-path";
import type { SourceSpan } from "./source-span";
import type { SourceText } from "./source-text";

export interface ModuleImportRequest {
  readonly importer: ModulePath;
  readonly source: SourceText;
  readonly moduleName: string;
  readonly span: SourceSpan;
}
