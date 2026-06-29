import type { LayoutFactKey } from "../../proof-check/model/fact-packet";
import type { OptIrLayoutAccessKind } from "../layout-access";
import type { OptIrFactRecord, OptIrFactSet } from "./fact-index";
import type {
  OptIrFactBooleanAnswer,
  OptIrFactQueryTypedAnswer,
  OptIrFactValueAnswer,
} from "./fact-query";

export interface OptIrSelectedLayoutProgram {
  readonly target: {
    readonly endian: "little" | "big";
  };
}

export interface OptIrLayoutAccessQuery {
  readonly kind: OptIrLayoutAccessKind;
  readonly layoutKey: LayoutFactKey;
}

export interface OptIrEndianOfLayoutAccessInput {
  readonly access: OptIrLayoutAccessQuery;
  readonly layoutProgram: OptIrSelectedLayoutProgram;
}

export interface OptIrLayoutFactQuery {
  layoutOf(layoutKey: LayoutFactKey): OptIrFactBooleanAnswer;
  endianOfLayoutAccess(
    input: OptIrEndianOfLayoutAccessInput,
  ): OptIrFactValueAnswer<"little" | "big">;
}

export function createOptIrLayoutFactQuery(factSet: OptIrFactSet): OptIrLayoutFactQuery {
  return Object.freeze({
    layoutOf(layoutKey: LayoutFactKey): OptIrFactBooleanAnswer {
      const record = layoutRecordForKey(factSet, layoutKey);
      if (record === undefined) {
        return unknownLayoutAnswer(layoutKey, "layout ABI");
      }
      return {
        kind: "yes",
        factsUsed: [record.factId],
        explanation: [
          `Fact ${Number(record.factId)} proves layout ABI for ${layoutSubjectKey(layoutKey)}.`,
        ],
      };
    },
    endianOfLayoutAccess(
      input: OptIrEndianOfLayoutAccessInput,
    ): OptIrFactValueAnswer<"little" | "big"> {
      const record = layoutRecordForTypedAnswer(
        factSet,
        input.access.layoutKey,
        "endianOfLayoutAccess",
      );
      if (record === undefined) {
        return {
          kind: "unknown",
          factsUsed: [],
          explanation: [
            `No layout ABI fact is in scope for ${layoutSubjectKey(input.access.layoutKey)}.`,
          ],
        };
      }
      return {
        kind: "yes",
        value: input.layoutProgram.target.endian,
        factsUsed: [record.factId],
        explanation: [
          `Fact ${Number(record.factId)} proves layout ABI for ${layoutSubjectKey(input.access.layoutKey)}.`,
          `Endian ${input.layoutProgram.target.endian} was read from the selected layout program target facts.`,
        ],
      };
    },
  });
}

export function layoutRecordForKey(
  factSet: OptIrFactSet,
  layoutKey: LayoutFactKey,
): OptIrFactRecord | undefined {
  return layoutRecordForTypedAnswer(factSet, layoutKey, "layoutOf");
}

export function layoutRecordForTypedAnswer(
  factSet: OptIrFactSet,
  layoutKey: LayoutFactKey,
  typedAnswer: OptIrFactQueryTypedAnswer,
): OptIrFactRecord | undefined {
  const subjectKey = layoutSubjectKey(layoutKey);
  const layoutFactIds = factSet.indexes.byTypedAnswer[typedAnswer] ?? [];
  for (const factId of layoutFactIds) {
    const record = factSet.indexes.byId[factId];
    if (record?.subjectKey === subjectKey) {
      return record;
    }
  }
  return undefined;
}

export function layoutSubjectKey(layoutKey: LayoutFactKey): string {
  return `layout:${layoutKey}`;
}

function unknownLayoutAnswer(
  layoutKey: LayoutFactKey,
  factDescription: string,
): OptIrFactBooleanAnswer {
  return {
    kind: "unknown",
    factsUsed: [],
    explanation: [`No ${factDescription} fact is in scope for ${layoutSubjectKey(layoutKey)}.`],
  };
}
