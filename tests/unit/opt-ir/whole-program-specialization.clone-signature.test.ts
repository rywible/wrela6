import { describe, expect, test } from "bun:test";

import { monoInstanceId } from "../../../src/mono/ids";
import { optIrConstantId, optIrFactId, optIrValueId } from "../../../src/opt-ir/ids";
import {
  cloneSignatureKey,
  cloneSignaturesEquivalent,
} from "../../../src/opt-ir/passes/specialization/clone-signature";

describe("whole-program specialization clone signatures", () => {
  test("canonicalizes static operands by source and stable facts instead of insertion order", () => {
    const first = cloneSignatureKey({
      callee: { kind: "source", functionInstanceId: monoInstanceId("parse") },
      staticOperands: [
        {
          parameterIndex: 1,
          valueId: optIrValueId(20),
          binding: {
            kind: "layoutFact",
            layoutFactKey: "packet.header.kind",
            factsCited: [optIrFactId(8), optIrFactId(3)],
          },
        },
        {
          parameterIndex: 0,
          valueId: optIrValueId(10),
          binding: { kind: "constant", constantId: optIrConstantId(4), factsCited: [] },
        },
      ],
    });
    const shuffled = cloneSignatureKey({
      callee: { kind: "source", functionInstanceId: monoInstanceId("parse") },
      staticOperands: [
        {
          parameterIndex: 0,
          valueId: optIrValueId(10),
          binding: { kind: "constant", constantId: optIrConstantId(4), factsCited: [] },
        },
        {
          parameterIndex: 1,
          valueId: optIrValueId(20),
          binding: {
            kind: "layoutFact",
            layoutFactKey: "packet.header.kind",
            factsCited: [optIrFactId(3), optIrFactId(8)],
          },
        },
      ],
    });

    expect(first).toBe(shuffled);
    expect(first).toBe(
      "callee:source:parse|p0=const:4:facts[]|p1=layout:packet.header.kind:facts[3,8]",
    );
  });

  test("includes callee identity and cited facts in clone deduplication", () => {
    const base = {
      callee: { kind: "source" as const, functionInstanceId: monoInstanceId("parse") },
      staticOperands: [
        {
          parameterIndex: 0,
          valueId: optIrValueId(10),
          binding: {
            kind: "calleeIdentity" as const,
            calleeIdentity: monoInstanceId("read_u16"),
            factsCited: [optIrFactId(1)],
          },
        },
      ],
    };

    expect(cloneSignaturesEquivalent(base, base)).toBe(true);
    expect(
      cloneSignaturesEquivalent(base, {
        ...base,
        staticOperands: [
          {
            parameterIndex: 0,
            valueId: optIrValueId(10),
            binding: {
              kind: "calleeIdentity",
              calleeIdentity: monoInstanceId("read_u32"),
              factsCited: [optIrFactId(1)],
            },
          },
        ],
      }),
    ).toBe(false);
    expect(
      cloneSignaturesEquivalent(base, {
        ...base,
        staticOperands: [
          {
            parameterIndex: 0,
            valueId: optIrValueId(10),
            binding: {
              kind: "calleeIdentity",
              calleeIdentity: monoInstanceId("read_u16"),
              factsCited: [optIrFactId(2)],
            },
          },
        ],
      }),
    ).toBe(false);
  });
});
