import { expect, test } from "bun:test";
import { itemId } from "../../../../src/semantic/ids";
import {
  concreteKind,
  derivedKind,
  errorKind,
  isProofRelevantKind,
  joinConcreteResourceKinds,
  joinResourceKinds,
  parametricKind,
  resourceKindFingerprint,
} from "../../../../src/semantic/surface/resource-kind";

test("isProofRelevantKind identifies proof-relevant kinds", () => {
  expect(isProofRelevantKind("Copy")).toBe(false);
  expect(isProofRelevantKind("Affine")).toBe(false);
  expect(isProofRelevantKind("Linear")).toBe(false);
  expect(isProofRelevantKind("UniqueEdgeRoot")).toBe(true);
  expect(isProofRelevantKind("EdgePath")).toBe(true);
  expect(isProofRelevantKind("Stream")).toBe(true);
  expect(isProofRelevantKind("ValidatedBuffer")).toBe(true);
  expect(isProofRelevantKind("PrivateState")).toBe(true);
  expect(isProofRelevantKind("SealedPlatformToken")).toBe(true);
  expect(isProofRelevantKind("Never")).toBe(false);
});

test("join preserves copy only when both sides are copy", () => {
  expect(joinResourceKinds([concreteKind("Copy"), concreteKind("Copy")])).toEqual(
    concreteKind("Copy"),
  );
});

test("join lifts affine and linear conservatively", () => {
  expect(joinResourceKinds([concreteKind("Copy"), concreteKind("Affine")])).toEqual(
    concreteKind("Affine"),
  );
  expect(joinResourceKinds([concreteKind("Affine"), concreteKind("Linear")])).toEqual(
    concreteKind("Linear"),
  );
});

test("join of parametric kind stays derived", () => {
  const kind = joinResourceKinds([
    concreteKind("Copy"),
    parametricKind({ owner: { kind: "item", itemId: itemId(0) }, index: 0 }),
  ]);

  expect(kind.kind).toBe("derived");
});

test("error kind absorbs joins", () => {
  expect(joinResourceKinds([concreteKind("Copy"), errorKind()])).toEqual(errorKind());
});

test("joinConcreteResourceKinds basic ordering", () => {
  expect(joinConcreteResourceKinds(["Copy", "Copy"])).toBe("Copy");
  expect(joinConcreteResourceKinds(["Copy", "Affine"])).toBe("Affine");
  expect(joinConcreteResourceKinds(["Affine", "Linear"])).toBe("Linear");
});

test("joinConcreteResourceKinds proof-relevant kinds map to linear", () => {
  expect(joinConcreteResourceKinds(["Copy", "Stream"])).toBe("Linear");
  expect(joinConcreteResourceKinds(["Affine", "UniqueEdgeRoot"])).toBe("Linear");
});

test("resourceKindFingerprint is deterministic", () => {
  expect(resourceKindFingerprint(concreteKind("Copy"))).toBe("concrete:Copy");
  expect(resourceKindFingerprint(errorKind())).toBe("error");
  expect(
    resourceKindFingerprint(
      parametricKind({ owner: { kind: "item", itemId: itemId(0) }, index: 0 }),
    ),
  ).toBe("parametric:item:0:0");
  expect(
    resourceKindFingerprint(derivedKind("join", [concreteKind("Copy"), concreteKind("Linear")])),
  ).toBe("derived:join:concrete:Copy,concrete:Linear");
});

test("Never skips in joinConcreteResourceKinds", () => {
  expect(joinConcreteResourceKinds(["Copy", "Never"])).toBe("Copy");
  expect(joinConcreteResourceKinds(["Never", "Affine"])).toBe("Affine");
});
