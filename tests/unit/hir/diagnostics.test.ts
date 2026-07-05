import { describe, expect, test } from "bun:test";
import {
  HIR_DIAGNOSTIC_CODES,
  HIR_DIAGNOSTIC_FIRST_EMITTER,
  HirDiagnosticSink,
  hirDiagnosticCode,
  hirDiagnosticTieBreaker,
  sortHirDiagnostics,
  type HirDiagnostic,
  type HirDiagnosticCode,
} from "../../../src/hir/diagnostics";
import { createHirOriginAllocator } from "../../../src/hir/origin";
import { hirOriginId, type HirOriginId } from "../../../src/hir/ids";
import { moduleId, type ModuleId } from "../../../src/semantic/ids";
import { SourceSpan } from "../../../src/shared/source-span";

function makeDiagnostic(input: {
  readonly code: HirDiagnosticCode;
  readonly message: string;
  readonly moduleId: ModuleId;
  readonly spanStart: number;
  readonly spanEnd: number;
  readonly ownerKey: string;
  readonly originKey: string;
  readonly stableDetail: string;
  readonly originId?: HirOriginId;
}): HirDiagnostic {
  return {
    code: input.code,
    message: input.message,
    stableDetail: input.stableDetail,
    moduleId: input.moduleId,
    order: {
      moduleId: input.moduleId,
      spanStart: input.spanStart,
      spanEnd: input.spanEnd,
      ownerKey: input.ownerKey,
      originKey: input.originKey,
      code: input.code,
      ...(input.originId !== undefined ? { originId: input.originId } : {}),
      tieBreaker: hirDiagnosticTieBreaker({
        ownerKey: input.ownerKey,
        originKey: input.originKey,
        code: input.code,
        stableDetail: input.stableDetail,
      }),
    },
  };
}

const calleeCode = hirDiagnosticCode("HIR_CALL_CALLEE_NOT_FUNCTION");

describe("HIR diagnostic codes", () => {
  test("every registered code constructs via hirDiagnosticCode", () => {
    for (const code of HIR_DIAGNOSTIC_CODES) {
      expect(hirDiagnosticCode(code) as string).toBe(code);
    }
  });

  test("hirDiagnosticCode rejects unknown codes", () => {
    expect(() => hirDiagnosticCode("HIR_UNKNOWN_CODE")).toThrow();
  });

  test("HIR_DIAGNOSTIC_FIRST_EMITTER covers every code with a task or WCR label", () => {
    for (const code of HIR_DIAGNOSTIC_CODES) {
      expect(HIR_DIAGNOSTIC_FIRST_EMITTER[code]).toMatch(/^(Task \d+|WCR-\d+)$/);
    }
  });
});

describe("hirDiagnosticTieBreaker", () => {
  test("formats owner/origin/code/detail", () => {
    const tieBreaker = hirDiagnosticTieBreaker({
      ownerKey: "function:1",
      originKey: "NameExpression:0",
      code: hirDiagnosticCode("HIR_CALL_CALLEE_NOT_FUNCTION"),
      stableDetail: "missing-callee",
    });
    expect(tieBreaker).toBe(
      "owner:function:1/origin:NameExpression:0/code:HIR_CALL_CALLEE_NOT_FUNCTION/detail:missing-callee",
    );
  });
});

describe("sortHirDiagnostics", () => {
  test("diagnostics sort by order before display message", () => {
    const earlyDiagnostic = makeDiagnostic({
      code: calleeCode,
      message: "late message",
      moduleId: moduleId(1),
      spanStart: 0,
      spanEnd: 0,
      ownerKey: "function:1",
      originKey: "NameExpression:0",
      stableDetail: "missing-callee",
    });
    const lateDiagnostic = makeDiagnostic({
      code: calleeCode,
      message: "early message",
      moduleId: moduleId(1),
      spanStart: 0,
      spanEnd: 0,
      ownerKey: "function:1",
      originKey: "NameExpression:1",
      stableDetail: "missing-callee",
    });
    const sorted = sortHirDiagnostics([lateDiagnostic, earlyDiagnostic]);
    expect(sorted.map((diagnostic) => diagnostic.order.tieBreaker)).toEqual([
      "owner:function:1/origin:NameExpression:0/code:HIR_CALL_CALLEE_NOT_FUNCTION/detail:missing-callee",
      "owner:function:1/origin:NameExpression:1/code:HIR_CALL_CALLEE_NOT_FUNCTION/detail:missing-callee",
    ]);
  });

  test("sorts by moduleId before span", () => {
    const high = makeDiagnostic({
      code: calleeCode,
      message: "m",
      moduleId: moduleId(2),
      spanStart: 0,
      spanEnd: 0,
      ownerKey: "function:1",
      originKey: "o",
      stableDetail: "d",
    });
    const low = makeDiagnostic({
      code: calleeCode,
      message: "m",
      moduleId: moduleId(1),
      spanStart: 9,
      spanEnd: 9,
      ownerKey: "function:1",
      originKey: "o",
      stableDetail: "d",
    });
    const sorted = sortHirDiagnostics([high, low]);
    expect(sorted.map((diagnostic) => diagnostic.moduleId)).toEqual([moduleId(1), moduleId(2)]);
  });

  test("sorts by spanStart before spanEnd", () => {
    const lateStart = makeDiagnostic({
      code: calleeCode,
      message: "m",
      moduleId: moduleId(1),
      spanStart: 5,
      spanEnd: 5,
      ownerKey: "function:1",
      originKey: "o",
      stableDetail: "d",
    });
    const earlyStart = makeDiagnostic({
      code: calleeCode,
      message: "m",
      moduleId: moduleId(1),
      spanStart: 0,
      spanEnd: 9,
      ownerKey: "function:1",
      originKey: "o",
      stableDetail: "d",
    });
    const sorted = sortHirDiagnostics([lateStart, earlyStart]);
    expect(sorted.map((diagnostic) => diagnostic.order.spanStart)).toEqual([0, 5]);
  });

  test("sorts by spanEnd when spans start equal", () => {
    const longer = makeDiagnostic({
      code: calleeCode,
      message: "m",
      moduleId: moduleId(1),
      spanStart: 0,
      spanEnd: 9,
      ownerKey: "function:1",
      originKey: "o",
      stableDetail: "d",
    });
    const shorter = makeDiagnostic({
      code: calleeCode,
      message: "m",
      moduleId: moduleId(1),
      spanStart: 0,
      spanEnd: 3,
      ownerKey: "function:1",
      originKey: "o",
      stableDetail: "d",
    });
    const sorted = sortHirDiagnostics([longer, shorter]);
    expect(sorted.map((diagnostic) => diagnostic.order.spanEnd)).toEqual([3, 9]);
  });

  test("sorts by code when module and span agree", () => {
    const callee = makeDiagnostic({
      code: hirDiagnosticCode("HIR_CALL_CALLEE_NOT_FUNCTION"),
      message: "m",
      moduleId: moduleId(1),
      spanStart: 0,
      spanEnd: 0,
      ownerKey: "function:1",
      originKey: "o",
      stableDetail: "d",
    });
    const argument = makeDiagnostic({
      code: hirDiagnosticCode("HIR_CALL_ARGUMENT_MISMATCH"),
      message: "m",
      moduleId: moduleId(1),
      spanStart: 0,
      spanEnd: 0,
      ownerKey: "function:1",
      originKey: "o",
      stableDetail: "d",
    });
    const sorted = sortHirDiagnostics([callee, argument]);
    expect(sorted.map((diagnostic) => diagnostic.code)).toEqual([
      hirDiagnosticCode("HIR_CALL_ARGUMENT_MISMATCH"),
      hirDiagnosticCode("HIR_CALL_CALLEE_NOT_FUNCTION"),
    ]);
  });

  test("sorts originId with undefined last", () => {
    const withOrigin = makeDiagnostic({
      code: calleeCode,
      message: "m",
      moduleId: moduleId(1),
      spanStart: 0,
      spanEnd: 0,
      ownerKey: "function:1",
      originKey: "o",
      stableDetail: "d",
      originId: hirOriginId(5),
    });
    const withoutOrigin = makeDiagnostic({
      code: calleeCode,
      message: "m",
      moduleId: moduleId(1),
      spanStart: 0,
      spanEnd: 0,
      ownerKey: "function:1",
      originKey: "o",
      stableDetail: "d",
    });
    const sorted = sortHirDiagnostics([withoutOrigin, withOrigin]);
    expect(sorted.map((diagnostic) => diagnostic.order.originId)).toEqual([
      hirOriginId(5),
      undefined,
    ]);
  });

  test("sorts higher originId after lower when both present", () => {
    const higher = makeDiagnostic({
      code: calleeCode,
      message: "m",
      moduleId: moduleId(1),
      spanStart: 0,
      spanEnd: 0,
      ownerKey: "function:1",
      originKey: "o",
      stableDetail: "d",
      originId: hirOriginId(9),
    });
    const lower = makeDiagnostic({
      code: calleeCode,
      message: "m",
      moduleId: moduleId(1),
      spanStart: 0,
      spanEnd: 0,
      ownerKey: "function:1",
      originKey: "o",
      stableDetail: "d",
      originId: hirOriginId(2),
    });
    const sorted = sortHirDiagnostics([higher, lower]);
    expect(sorted.map((diagnostic) => diagnostic.order.originId)).toEqual([
      hirOriginId(2),
      hirOriginId(9),
    ]);
  });

  test("falls back to tieBreaker when earlier keys agree", () => {
    const laterDetail = makeDiagnostic({
      code: calleeCode,
      message: "m",
      moduleId: moduleId(1),
      spanStart: 0,
      spanEnd: 0,
      ownerKey: "function:1",
      originKey: "o",
      stableDetail: "z",
    });
    const earlierDetail = makeDiagnostic({
      code: calleeCode,
      message: "m",
      moduleId: moduleId(1),
      spanStart: 0,
      spanEnd: 0,
      ownerKey: "function:1",
      originKey: "o",
      stableDetail: "a",
    });
    const sorted = sortHirDiagnostics([laterDetail, earlierDetail]);
    expect(sorted.map((diagnostic) => diagnostic.order.tieBreaker)).toEqual([
      hirDiagnosticTieBreaker({
        ownerKey: "function:1",
        originKey: "o",
        code: calleeCode,
        stableDetail: "a",
      }),
      hirDiagnosticTieBreaker({
        ownerKey: "function:1",
        originKey: "o",
        code: calleeCode,
        stableDetail: "z",
      }),
    ]);
  });
});

describe("HirDiagnosticSink", () => {
  test("entries preserves insertion order and sorted returns ordered diagnostics", () => {
    const sink = new HirDiagnosticSink();
    const laterDetail = makeDiagnostic({
      code: calleeCode,
      message: "m",
      moduleId: moduleId(1),
      spanStart: 0,
      spanEnd: 0,
      ownerKey: "function:1",
      originKey: "o",
      stableDetail: "z",
    });
    const earlierDetail = makeDiagnostic({
      code: calleeCode,
      message: "m",
      moduleId: moduleId(1),
      spanStart: 0,
      spanEnd: 0,
      ownerKey: "function:1",
      originKey: "o",
      stableDetail: "a",
    });
    sink.report(laterDetail);
    sink.report(earlierDetail);

    expect(sink.entries().map((diagnostic) => diagnostic.order.tieBreaker)).toEqual([
      laterDetail.order.tieBreaker,
      earlierDetail.order.tieBreaker,
    ]);
    expect(sink.sorted().map((diagnostic) => diagnostic.order.tieBreaker)).toEqual([
      earlierDetail.order.tieBreaker,
      laterDetail.order.tieBreaker,
    ]);
  });

  test("report enriches origin-backed diagnostics with origin source order", () => {
    const origins = createHirOriginAllocator();
    const originId = origins.forSynthetic({
      moduleId: moduleId(7),
      span: SourceSpan.from(11, 17),
      stableDetail: "condition",
    });
    const sink = new HirDiagnosticSink((id) => origins.get(id));

    sink.report(
      makeDiagnostic({
        code: hirDiagnosticCode("HIR_CONDITION_NOT_BOOL"),
        message: "Condition expression must be bool.",
        moduleId: moduleId(0),
        spanStart: 0,
        spanEnd: 0,
        ownerKey: "function:1",
        originKey: `origin:${originId}`,
        stableDetail: "condition",
        originId,
      }),
    );

    const diagnostic = sink.entries()[0]!;
    expect(diagnostic.moduleId).toBe(moduleId(7));
    expect(diagnostic.span).toEqual(SourceSpan.from(11, 17));
    expect(diagnostic.order.moduleId).toBe(moduleId(7));
    expect(diagnostic.order.spanStart).toBe(11);
    expect(diagnostic.order.spanEnd).toBe(17);
  });
});
