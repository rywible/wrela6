import type { ModulePath } from "./module-path";
import type { SourceText } from "./source-text";

export type FileReadResult =
  | { kind: "found"; path: ModulePath; source: SourceText }
  | { kind: "missing"; path: ModulePath }
  | { kind: "unreadable"; path: ModulePath; message: string };

export interface FileRepository {
  read(path: ModulePath): Promise<FileReadResult>;
}
