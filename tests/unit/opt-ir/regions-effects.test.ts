import { describe, expect, test } from "bun:test";
import { hirExpressionId, hirOriginId, hirStatementId } from "../../../src/hir/ids";
import { monoInstanceId } from "../../../src/mono/ids";
import { OPT_IR_CALL_TARGET_KINDS } from "../../../src/opt-ir/calls";
import { OPT_IR_EFFECT_REQUIREMENT_MODES } from "../../../src/opt-ir/effects";
import { optIrAliasClassId, optIrOriginId, optimizationPassId } from "../../../src/opt-ir/ids";
import { OPT_IR_REGION_KINDS } from "../../../src/opt-ir/regions";
import { layoutFactKey } from "../../../src/proof-check/model/fact-packet";
import { proofCheckPacketFactId } from "../../../src/proof-check/ids";
import { proofMirStatementId } from "../../../src/proof-mir/ids";
import {
  optIrCallTargetForTest,
  optIrEffectRequirementForTest,
  optIrLayoutAccessForTest,
  optIrOriginForTest,
  optIrRegionForTest,
} from "../../support/opt-ir/region-effect-fakes";

describe("OptIR regions, effects, calls, layout access, and provenance", () => {
  test("region records preserve ownership, aliasing, layout, volatility, effects, and origin", () => {
    expect(OPT_IR_REGION_KINDS).toEqual([
      "stackLocal",
      "sourceAggregate",
      "packetSource",
      "validatedPayload",
      "imageDevice",
      "firmwareTable",
      "runtimeMemory",
      "constantData",
      "globalData",
      "externalUnknown",
    ]);

    const origin = optIrOriginForTest({ originId: optIrOriginId(9) });
    const regionKinds = [
      "stackLocal",
      "sourceAggregate",
      "packetSource",
      "validatedPayload",
      "imageDevice",
      "firmwareTable",
      "runtimeMemory",
      "constantData",
      "globalData",
      "externalUnknown",
    ] as const;
    const regions = regionKinds.map((kind, index) =>
      optIrRegionForTest({
        kind,
        owner: { kind: "function", functionId: monoInstanceId(`fn:${kind}`) },
        lifetime: index === 0 ? "activation" : "program",
        aliasClass: optIrAliasClassId(index + 1),
        layoutKey: layoutFactKey(`layout:${kind}`),
        volatility: index === 0 ? "volatile" : "nonVolatile",
        effects:
          kind === "packetSource"
            ? { mutability: "readOnly", ordering: "readOnlyRegionVersion" }
            : undefined,
        origin,
      }),
    );

    expect(regions.map((region) => region.kind)).toEqual([
      "stackLocal",
      "sourceAggregate",
      "packetSource",
      "validatedPayload",
      "imageDevice",
      "firmwareTable",
      "runtimeMemory",
      "constantData",
      "globalData",
      "externalUnknown",
    ]);
    expect(regions[0]?.owner).toEqual({
      kind: "function",
      functionId: monoInstanceId("fn:stackLocal"),
    });
    expect(regions[0]?.lifetime).toBe("activation");
    expect(regions[0]?.aliasClass).toBe(optIrAliasClassId(1));
    expect(regions[0]?.layoutKey).toBe(layoutFactKey("layout:stackLocal"));
    expect(regions[0]?.volatility).toBe("volatile");
    expect(regions[2]?.effects.ordering).toBe("readOnlyRegionVersion");
    expect(regions[0]?.origin).toBe(origin);
  });

  test("effect requirements distinguish all token and terminal modes", () => {
    expect(OPT_IR_EFFECT_REQUIREMENT_MODES).toEqual([
      "observe",
      "mutate",
      "advancePrivateState",
      "terminal",
      "readVersionToken",
      "orderedEffectToken",
    ]);

    const requirements = [
      optIrEffectRequirementForTest({ mode: "observe", region: optIrAliasClassId(1) }),
      optIrEffectRequirementForTest({ mode: "mutate", region: optIrAliasClassId(2) }),
      optIrEffectRequirementForTest({ mode: "advancePrivateState", stateKey: "session" }),
      optIrEffectRequirementForTest({ mode: "terminal", terminalKey: "exit" }),
      optIrEffectRequirementForTest({ mode: "readVersionToken", tokenKey: "packet:v1" }),
      optIrEffectRequirementForTest({ mode: "orderedEffectToken", tokenKey: "device:serial" }),
    ];

    expect(requirements.map((requirement) => requirement.mode)).toEqual([
      "observe",
      "mutate",
      "advancePrivateState",
      "terminal",
      "readVersionToken",
      "orderedEffectToken",
    ]);
    expect(requirements[0]).toEqual({ mode: "observe", region: optIrAliasClassId(1) });
    expect(requirements[5]).toEqual({ mode: "orderedEffectToken", tokenKey: "device:serial" });
  });

  test("provenance records preserve source through synthetic contributor origins", () => {
    const origin = optIrOriginForTest({
      originId: optIrOriginId(9),
      source: { file: "packet.wrela", span: { start: 10, end: 19 } },
      hir: {
        originId: hirOriginId(3),
        node: { kind: "expression", expressionId: hirExpressionId(4) },
      },
      mono: {
        functionInstanceId: monoInstanceId("fn:parse"),
        hirStatementId: hirStatementId(5),
      },
      proofMirNode: { kind: "statement", statementId: proofMirStatementId(6) },
      checkedMir: {
        functionInstanceId: monoInstanceId("fn:parse"),
        nodeKey: "checked:stmt:6",
      },
      layoutFact: layoutFactKey("layout:payload"),
      checkedFact: proofCheckPacketFactId(12),
      synthetic: {
        passId: optimizationPassId("bounds-check-elimination"),
        contributors: [optIrOriginId(3), optIrOriginId(4)],
      },
    });

    expect(origin.source?.file).toBe("packet.wrela");
    expect(origin.hir?.node).toEqual({ kind: "expression", expressionId: hirExpressionId(4) });
    expect(origin.mono?.functionInstanceId).toBe(monoInstanceId("fn:parse"));
    expect(origin.proofMirNode).toEqual({ kind: "statement", statementId: proofMirStatementId(6) });
    expect(origin.checkedMir?.nodeKey).toBe("checked:stmt:6");
    expect(origin.layoutFact).toBe(layoutFactKey("layout:payload"));
    expect(origin.checkedFact).toBe(proofCheckPacketFactId(12));
    expect(origin.synthetic?.contributors).toEqual([optIrOriginId(3), optIrOriginId(4)]);
  });

  test("calls and layout access keep target kind and layout fact provenance explicit", () => {
    expect(OPT_IR_CALL_TARGET_KINDS).toEqual([
      "source",
      "runtime",
      "platform",
      "intrinsic",
      "externalUnknown",
    ]);

    const targets = [
      optIrCallTargetForTest({ kind: "source", functionInstanceId: monoInstanceId("fn:parse") }),
      optIrCallTargetForTest({ kind: "runtime", runtimeKey: "copy" }),
      optIrCallTargetForTest({ kind: "platform", platformKey: "serial.write" }),
      optIrCallTargetForTest({ kind: "intrinsic", intrinsicKey: "bswap32" }),
      optIrCallTargetForTest({ kind: "externalUnknown", symbol: "opaque" }),
    ];
    const access = optIrLayoutAccessForTest({
      layoutKey: layoutFactKey("layout:payload.byte0"),
      kind: "fieldOffset",
      origin: optIrOriginForTest({ originId: optIrOriginId(4) }),
    });

    expect(targets.map((target) => target.kind)).toEqual([
      "source",
      "runtime",
      "platform",
      "intrinsic",
      "externalUnknown",
    ]);
    expect(access).toMatchObject({
      kind: "fieldOffset",
      layoutKey: layoutFactKey("layout:payload.byte0"),
    });
  });
});
