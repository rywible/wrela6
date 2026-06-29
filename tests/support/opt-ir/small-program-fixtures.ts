import type { OptIrProgram } from "../../../src/opt-ir/program";
import { optIrProgramForTest } from "./cfg-fakes";

export function smallOptIrProgramForTest(input: Partial<OptIrProgram> = {}): OptIrProgram {
  return optIrProgramForTest(input);
}
