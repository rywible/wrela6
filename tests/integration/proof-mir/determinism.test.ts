import { expect, test } from "bun:test";
import {
  buildProofMir,
  proofMirDiagnostic,
  proofMirDiagnosticCode,
  sortProofMirDiagnostics,
} from "../../../src/proof-mir";
import { targetId } from "../../../src/semantic/ids";
import {
  closedProofMirFixture,
  proofMirSummary,
  shuffledProofMirInputFixture,
} from "../../support/proof-mir/proof-mir-fixtures";

test("deterministic snapshots survive shuffled function table construction", () => {
  const first = buildProofMir(shuffledProofMirInputFixture({ shuffle: "abc" }));
  const second = buildProofMir(shuffledProofMirInputFixture({ shuffle: "cba" }));

  expect(first.kind).toBe("ok");
  expect(second.kind).toBe("ok");
  if (first.kind !== "ok" || second.kind !== "ok") return;

  expect(proofMirSummary(first.mir)).toBe(proofMirSummary(second.mir));
});

test("identical shuffle keys produce byte-identical Proof MIR summaries", () => {
  const first = buildProofMir(shuffledProofMirInputFixture({ shuffle: "seed-7" }));
  const second = buildProofMir(shuffledProofMirInputFixture({ shuffle: "seed-7" }));

  expect(first.kind).toBe("ok");
  expect(second.kind).toBe("ok");
  if (first.kind !== "ok" || second.kind !== "ok") return;

  expect(proofMirSummary(first.mir)).toBe(proofMirSummary(second.mir));
});

test("closed fixture builds byte-identical summaries across repeated runs", () => {
  const first = buildProofMir(closedProofMirFixture());
  const second = buildProofMir(closedProofMirFixture());

  expect(first.kind).toBe("ok");
  expect(second.kind).toBe("ok");
  if (first.kind !== "ok" || second.kind !== "ok") return;

  expect(proofMirSummary(first.mir)).toBe(proofMirSummary(second.mir));
});

test("diagnostics sort deterministically across shuffled error discovery order", () => {
  const diagnostics = [
    proofMirDiagnostic({
      severity: "error",
      code: proofMirDiagnosticCode("PROOF_MIR_INPUT_LAYOUT_MISMATCH"),
      message: "later diagnostic",
      ownerKey: "owner-b",
      rootCauseKey: "root",
      stableDetail: "detail-b",
    }),
    proofMirDiagnostic({
      severity: "error",
      code: proofMirDiagnosticCode("PROOF_MIR_INPUT_LAYOUT_MISMATCH"),
      message: "earlier diagnostic",
      ownerKey: "owner-a",
      rootCauseKey: "root",
      stableDetail: "detail-a",
    }),
  ];

  const forward = sortProofMirDiagnostics(diagnostics);
  const reverse = sortProofMirDiagnostics([...diagnostics].reverse());

  expect(proofMirSummary({ kind: "error", diagnostics: forward })).toBe(
    proofMirSummary({ kind: "error", diagnostics: reverse }),
  );
  expect(forward.map((diagnostic) => diagnostic.ownerKey)).toEqual(["owner-a", "owner-b"]);
});

test("buildProofMir error diagnostics are stable across shuffled incompatible inputs", () => {
  const incompatibleTarget = targetId("different-target");
  const first = buildProofMir(
    shuffledProofMirInputFixture({ shuffle: "abc", targetId: incompatibleTarget }),
  );
  const second = buildProofMir(
    shuffledProofMirInputFixture({ shuffle: "cba", targetId: incompatibleTarget }),
  );

  expect(first.kind).toBe("error");
  expect(second.kind).toBe("error");
  if (first.kind !== "error" || second.kind !== "error") return;

  expect(proofMirSummary({ kind: "error", diagnostics: first.diagnostics })).toBe(
    proofMirSummary({ kind: "error", diagnostics: second.diagnostics }),
  );
});
