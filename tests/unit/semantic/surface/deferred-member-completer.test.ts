import { expect, test } from "bun:test";
import { buildMemberNamespace } from "../../../../src/semantic/names/member-namespace";
import {
  completeDeferredMembers,
  deriveTypedOwnersFromSignatures,
} from "../../../../src/semantic/surface/deferred-member-completer";
import { parseAndResolveSurfaceFixture } from "../../../support/semantic/semantic-surface-fakes";

test("deferred member completion runs without error", () => {
  const fixture = parseAndResolveSurfaceFixture([
    [
      "main.wr",
      "class Packet:\n    len: u32\nfn f(packet: Packet):\n    requires:\n        packet.len\n",
    ],
  ]);

  const result = completeDeferredMembers({
    index: fixture.index,
    references: fixture.references,
    memberNamespace: buildMemberNamespace(fixture.index),
    typedOwners: new Map(),
  });

  expect(Array.isArray(result.completed.entries())).toBe(true);
  expect(Array.isArray(result.remainingDeferred)).toBe(true);
});

test("parameter deferred member without typed owner is reported as failed", () => {
  const fixture = parseAndResolveSurfaceFixture([
    ["main.wr", "fn f(packet: Packet):\n    packet.len\nclass Packet:\n    len: u32\n"],
  ]);

  const result = completeDeferredMembers({
    index: fixture.index,
    references: fixture.references,
    memberNamespace: buildMemberNamespace(fixture.index),
    typedOwners: new Map(),
  });

  expect(result.failedDeferred.length).toBeGreaterThan(0);
});

test("deriveTypedOwnersFromSignatures returns empty map for empty signatures", () => {
  const emptySignatures: any = {
    entries: () => [],
    get: () => undefined,
  };

  const owners = deriveTypedOwnersFromSignatures({
    signatures: emptySignatures,
    references: {} as any,
  });

  expect(owners.size).toBe(0);
});
