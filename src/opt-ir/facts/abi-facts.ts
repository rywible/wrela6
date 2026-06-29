import type { LayoutFactKey } from "../../proof-check/model/fact-packet";
import type { OptIrFactSet } from "./fact-index";
import type { OptIrFactBooleanAnswer } from "./fact-query";
import { layoutRecordForTypedAnswer, layoutSubjectKey } from "./layout-facts";

export interface OptIrAbiFactQuery {
  abiShape(layoutKey: LayoutFactKey): OptIrFactBooleanAnswer;
}

export function createOptIrAbiFactQuery(factSet: OptIrFactSet): OptIrAbiFactQuery {
  return Object.freeze({
    abiShape(layoutKey: LayoutFactKey): OptIrFactBooleanAnswer {
      const record = layoutRecordForTypedAnswer(factSet, layoutKey, "abiShape");
      if (record === undefined) {
        return {
          kind: "unknown",
          factsUsed: [],
          explanation: [`No ABI shape fact is in scope for ${layoutSubjectKey(layoutKey)}.`],
        };
      }
      return {
        kind: "yes",
        factsUsed: [record.factId],
        explanation: [
          `Fact ${Number(record.factId)} proves ABI shape for ${layoutSubjectKey(layoutKey)}.`,
        ],
      };
    },
  });
}
