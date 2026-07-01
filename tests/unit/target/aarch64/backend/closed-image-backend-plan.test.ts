import { describe, expect, test } from "bun:test";

import {
  privateConventionForTest,
  closedImageBackendPlanForTest,
  finalAddressTakenTableForTest,
  finalSymbolVisibilityTableForTest,
  publicBoundaryTableForTest,
  replacementBoundaryTableForTest,
  singleFunctionMachineProgramForTest,
} from "../../../../../tests/support/target/aarch64/backend/closed-image-plan-fakes";
import {
  aarch64ClosedImageBackendPlanAuthorityFingerprint,
  normalizeAArch64ClosedImageBackendPlan,
  verifyAArch64ClosedImageBackendPlan,
} from "../../../../../src/target/aarch64/backend/api/closed-image-backend-plan";
import { authenticatedBackendTargetSurfaceForTest } from "../../../../../tests/support/target/aarch64/backend/backend-target-surface-fakes";

describe("AArch64 closed-image backend plan", () => {
  test("accepts eligible private convention and returns ok", () => {
    const result = verifyAArch64ClosedImageBackendPlan({
      plan: closedImageBackendPlanForTest(),
      machineProgram: singleFunctionMachineProgramForTest(),
      target: authenticatedBackendTargetSurfaceForTest(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected valid closed-image plan");
    expect(result.diagnostics).toEqual([]);
  });

  test("rejects private convention for address-taken function", () => {
    const result = verifyAArch64ClosedImageBackendPlan({
      plan: closedImageBackendPlanForTest({
        addressTaken: finalAddressTakenTableForTest([
          { symbol: "private.callee", addressTaken: true },
        ]),
      }),
      machineProgram: singleFunctionMachineProgramForTest(),
      target: authenticatedBackendTargetSurfaceForTest(),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error")
      throw new Error("expected private convention address-taken violation");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "closed-image-plan:private-convention-address-taken:private.callee",
    ]);
  });

  test("rejects private convention for exported function", () => {
    const result = verifyAArch64ClosedImageBackendPlan({
      plan: closedImageBackendPlanForTest({
        symbolVisibility: finalSymbolVisibilityTableForTest([
          { symbol: "private.callee", visibility: "public" },
        ]),
      }),
      machineProgram: singleFunctionMachineProgramForTest(),
      target: authenticatedBackendTargetSurfaceForTest(),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected exported private convention violation");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "closed-image-plan:private-convention-public:private.callee",
    ]);
  });

  test("rejects private convention without caller-callee public boundary agreement", () => {
    const result = verifyAArch64ClosedImageBackendPlan({
      plan: closedImageBackendPlanForTest({
        privateConventions: [
          privateConventionForTest({ caller: "other", callee: "private.callee" }),
        ],
        publicAbiBoundaries: publicBoundaryTableForTest(),
      }),
      machineProgram: singleFunctionMachineProgramForTest(),
      target: authenticatedBackendTargetSurfaceForTest(),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected missing boundary violation");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "closed-image-plan:private-convention-missing-boundary:other:private.callee",
    ]);
  });

  test("rejects private convention with replacement boundary", () => {
    const result = verifyAArch64ClosedImageBackendPlan({
      plan: closedImageBackendPlanForTest({
        replacementBoundaries: replacementBoundaryTableForTest([
          { symbol: "private.callee", replacement: "caller" },
        ]),
      }),
      machineProgram: singleFunctionMachineProgramForTest(),
      target: authenticatedBackendTargetSurfaceForTest(),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected replacement boundary violation");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "closed-image-plan:private-convention-replacement:private.callee",
    ]);
  });

  test("rejects stale authority fingerprint", () => {
    const result = verifyAArch64ClosedImageBackendPlan({
      plan: {
        ...closedImageBackendPlanForTest(),
        authorityFingerprint: "stale-authority",
      },
      machineProgram: singleFunctionMachineProgramForTest(),
      target: authenticatedBackendTargetSurfaceForTest(),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected stale authority violation");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "closed-image-plan:stale-authority-fingerprint",
    ]);
  });

  test("forbids private conventions in relocatable-public-only closures", () => {
    const result = verifyAArch64ClosedImageBackendPlan({
      plan: closedImageBackendPlanForTest({
        closureKind: "relocatable-public-only",
      }),
      machineProgram: singleFunctionMachineProgramForTest(),
      target: authenticatedBackendTargetSurfaceForTest(),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error")
      throw new Error("expected relocatable-private convention violation");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "closed-image-plan:private-convention-not-allowed:relocatable-public-only",
    ]);
  });

  test("rejects duplicate plan records even with a recomputed authority fingerprint", () => {
    const base = closedImageBackendPlanForTest();
    const plan = {
      ...base,
      publicAbiBoundaries: publicBoundaryTableForTest([
        { caller: "caller", callee: "private.callee" },
        { caller: "caller", callee: "private.callee" },
      ]),
      privateConventions: [
        privateConventionForTest({ caller: "caller", callee: "private.callee" }),
        privateConventionForTest({
          caller: "caller",
          callee: "private.callee",
          clobberedGprs: ["x0"],
        }),
      ],
    };
    const result = verifyAArch64ClosedImageBackendPlan({
      plan: {
        ...plan,
        authorityFingerprint: aarch64ClosedImageBackendPlanAuthorityFingerprint(plan),
      },
      machineProgram: singleFunctionMachineProgramForTest(),
      target: authenticatedBackendTargetSurfaceForTest(),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected duplicate plan records");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "closed-image-plan:duplicate-private-convention:caller:private.callee",
      "closed-image-plan:duplicate-public-boundary:caller:private.callee",
    ]);
  });

  test("normalizes conflicting duplicate private conventions without throwing", () => {
    const base = closedImageBackendPlanForTest();
    const normalized = normalizeAArch64ClosedImageBackendPlan({
      ...base,
      privateConventions: [
        privateConventionForTest({ caller: "caller", callee: "private.callee" }),
        privateConventionForTest({
          caller: "caller",
          callee: "private.callee",
          clobberedGprs: ["x0"],
        }),
      ],
    });
    const result = verifyAArch64ClosedImageBackendPlan({
      plan: normalized,
      machineProgram: singleFunctionMachineProgramForTest(),
      target: authenticatedBackendTargetSurfaceForTest(),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected duplicate private conventions");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "closed-image-plan:duplicate-private-convention:caller:private.callee",
    );
  });
});
