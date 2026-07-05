import { describe, expect, test } from "bun:test";
import {
  OPT_IR_DIAGNOSTIC_CODES,
  OptIrDiagnosticSink,
  optIrDiagnosticCode,
  optIrDiagnosticOrderKey,
  sortOptIrDiagnostics,
} from "../../../src/opt-ir/diagnostics";
import { optIrFunctionId, optIrOriginId } from "../../../src/opt-ir/ids";
import { optIrDiagnosticForTest } from "../../support/opt-ir/ids-diagnostics-fakes";

describe("OptIR diagnostic codes", () => {
  test("includes the exact contract diagnostic code table", () => {
    expect(OPT_IR_DIAGNOSTIC_CODES).toEqual([
      "OPT_IR_CONSTRUCTION_TRACE",
      "OPT_IR_INPUT_CONTRACT_INVALID",
      "OPT_IR_TARGET_MISMATCH",
      "OPT_IR_LAYOUT_AUTHORITY_MISMATCH",
      "OPT_IR_MISSING_PATH_CERTIFICATE",
      "OPT_IR_MISSING_SEMANTIC_INLINE_POLICY",
      "OPT_IR_FACT_IMPORT_SCHEMA_MISMATCH",
      "OPT_IR_FACT_IMPORT_MISSING_DEPENDENCY",
      "OPT_IR_FACT_IMPORT_MISSING_PATH_DEPENDENCY",
      "OPT_IR_FACT_IMPORT_AUTHORITY_MISMATCH",
      "OPT_IR_UNSUPPORTED_CHECKED_MIR_OPERATION",
      "OPT_IR_CFG_EDGE_MISSING",
      "OPT_IR_BLOCK_ARGUMENT_MISMATCH",
      "OPT_IR_DUPLICATE_VALUE_DEFINITION",
      "OPT_IR_DOMINANCE_VIOLATION",
      "OPT_IR_MISSING_BOUNDS_AUTHORITY",
      "OPT_IR_STALE_RUNTIME_GUARD",
      "OPT_IR_EFFECT_TOKEN_INCOMPLETE",
      "OPT_IR_OPERATION_METADATA_MISMATCH",
      "OPT_IR_FACT_PRESERVATION_INVALID",
      "OPT_IR_REWRITE_LEGALITY_INVALID",
      "OPT_IR_UNLOWERED_AGGREGATE",
      "OPT_IR_UNCERTIFIED_FACT_CONSUMPTION",
    ]);
  });

  test("constructs registered codes and rejects unknown codes", () => {
    for (const code of OPT_IR_DIAGNOSTIC_CODES) {
      expect(optIrDiagnosticCode(code) as string).toBe(code);
    }

    expect(() => optIrDiagnosticCode("OPT_IR_UNKNOWN")).toThrow("Unknown OptIR diagnostic code");
  });
});

describe("OptIR diagnostics", () => {
  test("include stable structured metadata and deterministic order key", () => {
    const diagnostic = optIrDiagnosticForTest({
      severity: "error",
      code: optIrDiagnosticCode("OPT_IR_INPUT_CONTRACT_INVALID"),
      messageTemplate: "Input contract {contract} is invalid.",
      arguments: { contract: "checked-mir" },
      ownerKey: "program:0",
      rootCauseKey: "handoff:fingerprint",
      stableDetail: "missing-terminal-graph",
      originId: optIrOriginId(8),
      functionId: optIrFunctionId(2),
    });

    expect(diagnostic).toEqual({
      severity: "error",
      code: optIrDiagnosticCode("OPT_IR_INPUT_CONTRACT_INVALID"),
      messageTemplate: "Input contract {contract} is invalid.",
      arguments: { contract: "checked-mir" },
      ownerKey: "program:0",
      rootCauseKey: "handoff:fingerprint",
      stableDetail: "missing-terminal-graph",
      originId: optIrOriginId(8),
      functionId: optIrFunctionId(2),
      orderKey: optIrDiagnosticOrderKey({
        originKey: "8",
        functionKey: "2",
        code: optIrDiagnosticCode("OPT_IR_INPUT_CONTRACT_INVALID"),
        ownerKey: "program:0",
        rootCauseKey: "handoff:fingerprint",
        stableDetail: "missing-terminal-graph",
      }),
    });
  });

  test("sorts deterministically by origin, function, code, owner, root cause, and detail", () => {
    const diagnostics = [
      optIrDiagnosticForTest({ originId: optIrOriginId(2), stableDetail: "a" }),
      optIrDiagnosticForTest({ originId: optIrOriginId(1), functionId: optIrFunctionId(2) }),
      optIrDiagnosticForTest({
        originId: optIrOriginId(1),
        functionId: optIrFunctionId(1),
        stableDetail: "b",
      }),
      optIrDiagnosticForTest({
        originId: optIrOriginId(1),
        functionId: optIrFunctionId(1),
        stableDetail: "a",
      }),
      optIrDiagnosticForTest({
        originId: optIrOriginId(1),
        functionId: optIrFunctionId(1),
        code: optIrDiagnosticCode("OPT_IR_BLOCK_ARGUMENT_MISMATCH"),
        ownerKey: "owner:b",
      }),
      optIrDiagnosticForTest({
        originId: optIrOriginId(1),
        functionId: optIrFunctionId(1),
        code: optIrDiagnosticCode("OPT_IR_BLOCK_ARGUMENT_MISMATCH"),
        ownerKey: "owner:a",
        rootCauseKey: "root:b",
      }),
      optIrDiagnosticForTest({
        originId: optIrOriginId(1),
        functionId: optIrFunctionId(1),
        code: optIrDiagnosticCode("OPT_IR_BLOCK_ARGUMENT_MISMATCH"),
        ownerKey: "owner:a",
        rootCauseKey: "root:a",
      }),
    ];

    expect(sortOptIrDiagnostics(diagnostics).map((diagnostic) => diagnostic.orderKey)).toEqual([
      "origin:1/function:1/code:OPT_IR_BLOCK_ARGUMENT_MISMATCH/owner:owner:a/root:root:a/detail:detail",
      "origin:1/function:1/code:OPT_IR_BLOCK_ARGUMENT_MISMATCH/owner:owner:a/root:root:b/detail:detail",
      "origin:1/function:1/code:OPT_IR_BLOCK_ARGUMENT_MISMATCH/owner:owner:b/root:root/detail:detail",
      "origin:1/function:1/code:OPT_IR_INPUT_CONTRACT_INVALID/owner:owner/root:root/detail:a",
      "origin:1/function:1/code:OPT_IR_INPUT_CONTRACT_INVALID/owner:owner/root:root/detail:b",
      "origin:1/function:2/code:OPT_IR_INPUT_CONTRACT_INVALID/owner:owner/root:root/detail:detail",
      "origin:2/function:/code:OPT_IR_INPUT_CONTRACT_INVALID/owner:owner/root:root/detail:a",
    ]);
  });

  test("sink stores entries and returns sorted snapshots", () => {
    const sink = new OptIrDiagnosticSink();
    sink.report(optIrDiagnosticForTest({ originId: optIrOriginId(2) }));
    sink.report(optIrDiagnosticForTest({ originId: optIrOriginId(1) }));

    expect(sink.entries().map((diagnostic) => diagnostic.orderKey)).toEqual([
      "origin:2/function:/code:OPT_IR_INPUT_CONTRACT_INVALID/owner:owner/root:root/detail:detail",
      "origin:1/function:/code:OPT_IR_INPUT_CONTRACT_INVALID/owner:owner/root:root/detail:detail",
    ]);
    expect(sink.sorted().map((diagnostic) => diagnostic.orderKey)).toEqual([
      "origin:1/function:/code:OPT_IR_INPUT_CONTRACT_INVALID/owner:owner/root:root/detail:detail",
      "origin:2/function:/code:OPT_IR_INPUT_CONTRACT_INVALID/owner:owner/root:root/detail:detail",
    ]);
  });
});
