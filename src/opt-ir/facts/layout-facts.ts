import type { LayoutFactKey } from "../../proof-check/model/fact-packet";
import type { OptIrFactId } from "../ids";
import type { OptIrLayoutAccessKind } from "../layout-access";
import { createOptIrFactRecordRegistry, optIrExtensionFactRecord } from "./fact-extension-registry";
import type { OptIrFactRecord, OptIrFactSet } from "./fact-index";
import type {
  OptIrFactBooleanAnswer,
  OptIrFactQueryTypedAnswer,
  OptIrFactValueAnswer,
} from "./fact-query";

const LAYOUT_BYTE_RANGE_FACT_REGISTRY = createOptIrFactRecordRegistry({
  extensionKey: "layout-byte-range",
  packetKinds: ["layout-byte-range"],
  preservationRules: ["preserve-through-layout-stable-clone"],
  invalidationRules: ["invalidate-on-abi-or-layout-rewrite"],
  upstreamVerifierKey: "layout-byte-range-facts",
  negativeFixtures: ["missing-size", "negative-offset"],
});

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
  byteRangeForLayout(layoutKey: LayoutFactKey): OptIrFactValueAnswer<OptIrLayoutByteRange>;
}

export interface OptIrLayoutByteRange {
  readonly offsetBytes: bigint;
  readonly sizeBytes: bigint;
}

export interface OptIrLayoutByteRangeFactInput {
  readonly factId: OptIrFactId;
  readonly layoutKey: LayoutFactKey;
  readonly offsetBytes: bigint;
  readonly sizeBytes: bigint;
  readonly authority?: string;
}

export function layoutByteRangeFactRecord(input: OptIrLayoutByteRangeFactInput): OptIrFactRecord {
  if (input.offsetBytes < 0n) {
    throw new RangeError("layout byte-range offset must be non-negative.");
  }
  if (input.sizeBytes <= 0n) {
    throw new RangeError("layout byte-range size must be positive.");
  }
  return optIrExtensionFactRecord({
    registry: LAYOUT_BYTE_RANGE_FACT_REGISTRY,
    factId: input.factId,
    extensionKey: "layout-byte-range",
    packetKind: "layout-byte-range",
    subject: { kind: "layout", layoutKey: input.layoutKey },
    payload: {
      offsetBytes: input.offsetBytes.toString(),
      sizeBytes: input.sizeBytes.toString(),
    },
    authority: requireAuthority(input.authority ?? "proof:layout-byte-range"),
  });
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
    byteRangeForLayout(layoutKey: LayoutFactKey): OptIrFactValueAnswer<OptIrLayoutByteRange> {
      const record = layoutByteRangeRecordForKey(factSet, layoutKey);
      if (record === undefined) {
        return {
          kind: "unknown",
          factsUsed: [],
          explanation: [
            `No layout byte-range fact is in scope for ${layoutSubjectKey(layoutKey)}.`,
          ],
        };
      }
      const payload = extensionPayload(record);
      const offsetBytes = parseNonNegativeBigInt(payload.offsetBytes);
      const sizeBytes = parsePositiveBigInt(payload.sizeBytes);
      if (offsetBytes === undefined || sizeBytes === undefined) {
        return {
          kind: "unknown",
          factsUsed: [record.factId],
          explanation: [
            `Fact ${Number(record.factId)} has malformed layout byte-range payload for ${layoutSubjectKey(layoutKey)}.`,
          ],
        };
      }
      return {
        kind: "yes",
        value: { offsetBytes, sizeBytes },
        factsUsed: [record.factId],
        explanation: [
          `Fact ${Number(record.factId)} proves layout byte range for ${layoutSubjectKey(layoutKey)}.`,
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

export function layoutByteRangeRecordForKey(
  factSet: OptIrFactSet,
  layoutKey: LayoutFactKey,
): OptIrFactRecord | undefined {
  const subjectKey = layoutSubjectKey(layoutKey);
  return factSet.records.find(
    (record) => record.extensionKey === "layout-byte-range" && record.subjectKey === subjectKey,
  );
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

function extensionPayload(record: OptIrFactRecord): Readonly<Record<string, unknown>> {
  if (record.extensionPayload !== undefined && typeof record.extensionPayload === "object") {
    return record.extensionPayload as Readonly<Record<string, unknown>>;
  }
  return {};
}

function parseNonNegativeBigInt(value: unknown): bigint | undefined {
  const parsed = parseBigInt(value);
  return parsed === undefined || parsed < 0n ? undefined : parsed;
}

function parsePositiveBigInt(value: unknown): bigint | undefined {
  const parsed = parseBigInt(value);
  return parsed === undefined || parsed <= 0n ? undefined : parsed;
}

function parseBigInt(value: unknown): bigint | undefined {
  if (typeof value === "bigint") return value;
  if (typeof value !== "string" || !/^-?\d+$/.test(value)) return undefined;
  return BigInt(value);
}

function requireAuthority(authority: string): string {
  if (authority.length === 0) {
    throw new RangeError("layout byte-range facts require non-empty authority.");
  }
  return authority;
}
