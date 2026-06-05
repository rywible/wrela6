import type { ParsedModuleGraph } from "../../frontend/module-graph-parser";
import { checkItemIndexDuplicates } from "./duplicate-checker";
import { ItemIndex } from "./item-index";
import type { ItemIndexRecords } from "./item-records";
import { collectSourceModulesAndTopLevelItems } from "./source-module-collector";
import { collectSourceMembers, createSourceMemberContext } from "./source-member-collector";

export interface BuildItemIndexInput {
  readonly graph: ParsedModuleGraph;
}

export interface BuildItemIndexResult {
  readonly index: ItemIndex;
  readonly diagnostics: readonly import("./diagnostics").ItemIndexDiagnostic[];
}

export function buildItemIndex(input: BuildItemIndexInput): BuildItemIndexResult {
  const source = collectSourceModulesAndTopLevelItems(input.graph.modules);
  const context = createSourceMemberContext(source);
  const records = {
    ...collectSourceMembers(context),
    modules: source.modules,
  } as ItemIndexRecords;
  const diagnostics = checkItemIndexDuplicates(records);

  return { index: new ItemIndex(records), diagnostics };
}
