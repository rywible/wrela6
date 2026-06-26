import { expect, test } from "bun:test";
import { monoDiagnostic, sortMonoDiagnostics } from "../../../src/mono/diagnostics";
import { moduleId } from "../../../src/semantic/ids";

test("mono diagnostics sort deterministically without locale comparison", () => {
  const diagnostics = [
    monoDiagnostic({
      severity: "error",
      code: "MONO_MISSING_SELECTED_IMAGE",
      message: "Missing selected image.",
      moduleId: moduleId(0),
      spanStart: 4,
      spanEnd: 5,
      ownerKey: "pre-image",
      rootCauseKey: "image",
      stableDetail: "b",
    }),
    monoDiagnostic({
      severity: "error",
      code: "MONO_MISSING_SELECTED_IMAGE",
      message: "Missing selected image.",
      moduleId: moduleId(0),
      spanStart: 4,
      spanEnd: 5,
      ownerKey: "pre-image",
      rootCauseKey: "image",
      stableDetail: "a",
    }),
  ];

  expect(
    sortMonoDiagnostics(diagnostics).map((diagnostic) => diagnostic.order.stableDetail),
  ).toEqual(["a", "b"]);
});
