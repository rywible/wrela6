import { describe, expect, test } from "bun:test";
import {
  LINKER_DIAGNOSTIC_CODES,
  linkerDiagnostic,
  linkerDiagnosticCode,
  linkerError,
  linkerOk,
  linkerVerificationSummary,
  sortLinkerDiagnostics,
  type LinkerDiagnosticCode,
  type LinkerDiagnosticMode,
  type LinkerVerificationSummary,
  type LinkerVerifierRun,
} from "../../../src/linker/diagnostics";

describe("linker diagnostic codes", () => {
  test("registers exactly the linker-owned diagnostic codes", () => {
    expect([...LINKER_DIAGNOSTIC_CODES]).toEqual([
      "LINKER_INPUT_INVALID",
      "LINKER_SYMBOL_RESOLUTION_FAILED",
      "LINKER_SECTION_LAYOUT_FAILED",
      "LINKER_RELOCATION_FAILED",
      "LINKER_ENTRY_RESOLUTION_FAILED",
      "LINKER_IMAGE_LAYOUT_INVALID",
      "LINKER_LAYOUT_FIRST_SECTION_RVA_MISMATCH",
      "LINKER_LAYOUT_SECTION_CONTIGUITY_MISMATCH",
    ]);
  });

  test("validates linker diagnostic codes", () => {
    for (const code of LINKER_DIAGNOSTIC_CODES) {
      expect(linkerDiagnosticCode(code) as string).toBe(code);
    }

    expect(() => linkerDiagnosticCode("LINKER_NOT_REAL")).toThrow("Unknown linker diagnostic code");
  });
});

describe("linker diagnostics", () => {
  test("normalizes provenance and keeps stable owner fields", () => {
    const diagnostic = linkerDiagnostic({
      code: "LINKER_INPUT_INVALID",
      message: "input is invalid",
      ownerKey: "module:b",
      rootCauseKey: "input:missing-section",
      stableDetail: "section:.text",
      provenance: ["object:z", "object:a", "object:a"],
    });

    expect(diagnostic).toMatchObject({
      code: "LINKER_INPUT_INVALID" as LinkerDiagnosticCode,
      message: "input is invalid",
      ownerKey: "module:b",
      rootCauseKey: "input:missing-section",
      stableDetail: "section:.text",
      provenance: ["object:a", "object:a", "object:z"],
    });
    expect(Object.isFrozen(diagnostic)).toBe(true);
    expect(Object.isFrozen(diagnostic.provenance)).toBe(true);
  });

  test("sorts linker diagnostics by stable fields", () => {
    const diagnostics = sortLinkerDiagnostics([
      linkerDiagnostic({
        code: "LINKER_INPUT_INVALID",
        stableDetail: "b",
        ownerKey: "o",
        rootCauseKey: "r",
      }),
      linkerDiagnostic({
        code: "LINKER_INPUT_INVALID",
        stableDetail: "a",
        ownerKey: "o",
        rootCauseKey: "r",
      }),
    ]);

    expect(diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual(["a", "b"]);
  });

  test("sorts by code, owner, root cause, stable detail, and provenance", () => {
    const sorted = sortLinkerDiagnostics([
      linkerDiagnostic({
        code: "LINKER_RELOCATION_FAILED",
        ownerKey: "owner:a",
        rootCauseKey: "root:a",
        stableDetail: "detail:a",
        provenance: ["source:b"],
      }),
      linkerDiagnostic({
        code: "LINKER_INPUT_INVALID",
        ownerKey: "owner:b",
        rootCauseKey: "root:a",
        stableDetail: "detail:a",
        provenance: ["source:a"],
      }),
      linkerDiagnostic({
        code: "LINKER_INPUT_INVALID",
        ownerKey: "owner:a",
        rootCauseKey: "root:b",
        stableDetail: "detail:a",
        provenance: ["source:a"],
      }),
      linkerDiagnostic({
        code: "LINKER_INPUT_INVALID",
        ownerKey: "owner:a",
        rootCauseKey: "root:a",
        stableDetail: "detail:b",
        provenance: ["source:a"],
      }),
      linkerDiagnostic({
        code: "LINKER_INPUT_INVALID",
        ownerKey: "owner:a",
        rootCauseKey: "root:a",
        stableDetail: "detail:a",
        provenance: ["source:b"],
      }),
      linkerDiagnostic({
        code: "LINKER_INPUT_INVALID",
        ownerKey: "owner:a",
        rootCauseKey: "root:a",
        stableDetail: "detail:a",
        provenance: ["source:a"],
      }),
    ]);

    expect(
      sorted.map((diagnostic) => [
        diagnostic.code,
        diagnostic.ownerKey,
        diagnostic.rootCauseKey,
        diagnostic.stableDetail,
        diagnostic.provenance.join(","),
      ]),
    ).toEqual([
      ["LINKER_INPUT_INVALID", "owner:a", "root:a", "detail:a", "source:a"],
      ["LINKER_INPUT_INVALID", "owner:a", "root:a", "detail:a", "source:b"],
      ["LINKER_INPUT_INVALID", "owner:a", "root:a", "detail:b", "source:a"],
      ["LINKER_INPUT_INVALID", "owner:a", "root:b", "detail:a", "source:a"],
      ["LINKER_INPUT_INVALID", "owner:b", "root:a", "detail:a", "source:a"],
      ["LINKER_RELOCATION_FAILED", "owner:a", "root:a", "detail:a", "source:b"],
    ]);
  });

  test("sorts provenance arrays with embedded separators as distinct keys", () => {
    const sorted = sortLinkerDiagnostics([
      linkerDiagnostic({
        code: "LINKER_INPUT_INVALID",
        ownerKey: "owner:a",
        rootCauseKey: "root:a",
        stableDetail: "detail:a",
        provenance: ["a\u0000b"],
      }),
      linkerDiagnostic({
        code: "LINKER_INPUT_INVALID",
        ownerKey: "owner:a",
        rootCauseKey: "root:a",
        stableDetail: "detail:a",
        provenance: ["a", "b"],
      }),
    ]);

    expect(sorted.map((diagnostic) => diagnostic.provenance)).toEqual([["a", "b"], ["a\u0000b"]]);
    expect(new Set(sorted.map((diagnostic) => diagnostic.order.provenance)).size).toBe(2);
  });
});

describe("linker result helpers", () => {
  type MutableVerifierRun = {
    verifierKey: string;
    runKey: string;
    status: LinkerVerifierRun["status"];
    stableDetail?: string;
  };

  const verification = linkerVerificationSummary({
    runs: [
      {
        verifierKey: "verifier:image",
        runKey: "run:1",
        status: "passed",
        stableDetail: "image-layout",
      },
    ],
  });

  test("linkerOk freezes the ok result and sorts diagnostics", () => {
    const result = linkerOk({
      value: { imageKey: "image:test" },
      diagnostics: [
        linkerDiagnostic({
          code: "LINKER_INPUT_INVALID",
          ownerKey: "owner:b",
          rootCauseKey: "root",
          stableDetail: "b",
        }),
        linkerDiagnostic({
          code: "LINKER_INPUT_INVALID",
          ownerKey: "owner:a",
          rootCauseKey: "root",
          stableDetail: "a",
        }),
      ],
      verification,
    });

    expect(result.kind).toBe("ok");
    expect(result.value).toEqual({ imageKey: "image:test" });
    expect(result.diagnostics.map((diagnostic) => diagnostic.ownerKey)).toEqual([
      "owner:a",
      "owner:b",
    ]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.diagnostics)).toBe(true);
  });

  test("linkerOk copies caller-owned verification", () => {
    const callerOwnedRun = {
      verifierKey: "verifier:image",
      runKey: "run:1",
      status: "passed" as const,
      stableDetail: "before",
    };
    const callerOwnedVerification: { runs: MutableVerifierRun[] } = {
      runs: [callerOwnedRun],
    };
    const result = linkerOk({
      value: { imageKey: "image:test" },
      verification: callerOwnedVerification,
    });

    callerOwnedRun.stableDetail = "after";
    callerOwnedVerification.runs.push({
      verifierKey: "verifier:image",
      runKey: "run:2",
      status: "failed",
      stableDetail: "added",
    });

    expect(result.verification).toEqual({
      runs: [
        {
          verifierKey: "verifier:image",
          runKey: "run:1",
          status: "passed",
          stableDetail: "before",
        },
      ],
    });
    expect(Object.isFrozen(result.verification)).toBe(true);
    expect(Object.isFrozen(result.verification.runs)).toBe(true);
    expect(Object.isFrozen(result.verification.runs[0])).toBe(true);
  });

  test("linkerError freezes the error result and sorts diagnostics", () => {
    const result = linkerError({
      diagnostics: [
        linkerDiagnostic({
          code: "LINKER_RELOCATION_FAILED",
          ownerKey: "owner:z",
          rootCauseKey: "root",
          stableDetail: "z",
        }),
        linkerDiagnostic({
          code: "LINKER_INPUT_INVALID",
          ownerKey: "owner:a",
          rootCauseKey: "root",
          stableDetail: "a",
        }),
      ],
      verification,
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code as string)).toEqual([
      "LINKER_INPUT_INVALID",
      "LINKER_RELOCATION_FAILED",
    ]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.diagnostics)).toBe(true);
  });

  test("linkerError copies caller-owned verification", () => {
    const callerOwnedRun = {
      verifierKey: "verifier:image",
      runKey: "run:1",
      status: "passed" as const,
      stableDetail: "before",
    };
    const callerOwnedVerification: { runs: MutableVerifierRun[] } = {
      runs: [callerOwnedRun],
    };
    const result = linkerError({
      diagnostics: [],
      verification: callerOwnedVerification,
    });

    callerOwnedRun.stableDetail = "after";
    callerOwnedVerification.runs.push({
      verifierKey: "verifier:image",
      runKey: "run:2",
      status: "failed",
      stableDetail: "added",
    });

    expect(result.verification).toEqual({
      runs: [
        {
          verifierKey: "verifier:image",
          runKey: "run:1",
          status: "passed",
          stableDetail: "before",
        },
      ],
    });
    expect(Object.isFrozen(result.verification)).toBe(true);
    expect(Object.isFrozen(result.verification.runs)).toBe(true);
    expect(Object.isFrozen(result.verification.runs[0])).toBe(true);
  });
});

describe("linker verification summary types", () => {
  test("exports the diagnostic mode and verifier run shapes", () => {
    const mode: LinkerDiagnosticMode = "strict";
    const run: LinkerVerifierRun = {
      verifierKey: "verifier:sections",
      runKey: "run:sections",
      status: "skipped",
      stableDetail: "debug-disabled",
    };
    const summary: LinkerVerificationSummary = linkerVerificationSummary({ runs: [run] });

    expect(mode).toBe("strict");
    expect(summary).toEqual({ runs: [run] });
    expect(Object.isFrozen(summary)).toBe(true);
    expect(Object.isFrozen(summary.runs)).toBe(true);
    expect(Object.isFrozen(summary.runs[0])).toBe(true);
  });
});
