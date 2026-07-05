import type { HirImage, TypedHirProgram } from "../hir/hir";
import { seedMonoRootWorkResult } from "./monomorphizer";
import { finalizeReachability } from "./reachability-finalization";
import { validateInstantiationGraphForCycles } from "./reachability-graph";
import { createReachabilityState, type ReachabilityResult } from "./reachability-shared";
import { processRootWorkItem } from "./reachability/work-items";

export type { ReachabilityResult } from "./reachability-shared";

export function runReachability(input: {
  readonly program: TypedHirProgram;
  readonly image: HirImage;
}): ReachabilityResult {
  const state = createReachabilityState({ program: input.program, image: input.image });
  const seedResult = seedMonoRootWorkResult({ program: input.program, image: input.image });
  state.diagnostics.push(...seedResult.diagnostics);
  for (const item of seedResult.items) {
    processRootWorkItem({ state, item });
  }
  validateInstantiationGraphForCycles(state);
  return finalizeReachability(state);
}
