import { describe, expect, test } from "bun:test";
import fastCheck from "fast-check";

import {
  buildOptimizedOptIrForTest,
  inputFromProgramForTest,
  optIrResultStableKeyForTest,
  shuffleTablesForTest,
  smallCheckedMirProgramArbitrary,
} from "../../support/opt-ir/property-generators";

describe("optimized OptIR deterministic output", () => {
  test("optimized OptIR is deterministic under table insertion order", () => {
    fastCheck.assert(
      fastCheck.property(smallCheckedMirProgramArbitrary(), (program) => {
        const first = buildOptimizedOptIrForTest(inputFromProgramForTest(program));
        const second = buildOptimizedOptIrForTest(
          inputFromProgramForTest(shuffleTablesForTest(program)),
        );

        expect(optIrResultStableKeyForTest(first)).toBe(optIrResultStableKeyForTest(second));
      }),
      { numRuns: 8 },
    );
  });
});
