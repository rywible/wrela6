import { expect, test } from "bun:test";

import { lowerOrdinaryForStatement as lowerOrdinaryForStatementFromMovedModule } from "../../../src/proof-mir/lower/iterator-lowering/array-for-lowerer";
import { lowerOrdinaryForStatement as lowerOrdinaryForStatementFromStableEntry } from "../../../src/proof-mir/lower/iterator-lowerer";
import { lowerProofMirOrdinaryForForTest } from "../../support/proof-mir/lower-harness/iterator-lowerer-harness";

test("W0-05e keeps ordinary array for lowering exposed through iterator-lowerer", () => {
  expect(lowerOrdinaryForStatementFromStableEntry).toBe(lowerOrdinaryForStatementFromMovedModule);

  const lowered = lowerProofMirOrdinaryForForTest({
    source: ["for byte in packet.bytes():", "    sum = sum + byte", "return sum"],
    iteratorProtocol: "checkedIterator",
    scalarLocals: ["sum", "byte"],
    loopCarriedLocals: ["sum"],
    placeBackedLocals: ["packet"],
  });

  expect(lowered.kind).toBe("ok");
  if (lowered.kind !== "ok") return;
  expect(lowered.header.kind).toBe("loopHeader");
  expect(lowered.nextCall.target.kind).toBe("sourceFunction");
  expect(lowered.itemEdge.effects.map((effect) => effect.kind)).toContain("introducePlace");
  expect(lowered.finishedEdge.facts.map((fact) => fact.kind.kind)).toContain("runtimeEnsured");
});
