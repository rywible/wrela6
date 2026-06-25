import type { BlockView } from "../frontend/ast/statement-views";
import type { HirBlock } from "./hir";
import type { HirLoweringContext } from "./lowering-context";
import { lowerBlock } from "./statement-lowerer";

export function lowerBlockSkeleton(input: {
  readonly block: BlockView | undefined;
  readonly context: HirLoweringContext;
  readonly sourceOrigin: import("./ids").HirOriginId;
}): HirBlock {
  return lowerBlock(input);
}
