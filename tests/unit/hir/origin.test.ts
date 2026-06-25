import { describe, expect, test } from "bun:test";
import { GreenNode } from "../../../src/frontend/syntax/green-node";
import { GreenToken } from "../../../src/frontend/syntax/green-token";
import { RedNode } from "../../../src/frontend/syntax/red-node";
import { SyntaxKind } from "../../../src/frontend/syntax/syntax-kind";
import { SourceText } from "../../../src/frontend/lexer/source-text";
import { SourceSpan } from "../../../src/shared/source-span";
import { createHirOriginAllocator, type HirOriginAllocatorAndTable } from "../../../src/hir/origin";
import { hirOriginId, type HirOriginId } from "../../../src/hir/ids";
import { functionId, itemId, moduleId } from "../../../src/semantic/ids";

function token(kind: SyntaxKind, lexeme: string): GreenToken {
  return new GreenToken(kind, lexeme, [], [], false);
}

function nameExpression(lexeme: string): GreenNode {
  return new GreenNode({
    kind: SyntaxKind.NameExpression,
    children: [token(SyntaxKind.IdentifierToken, lexeme)],
  });
}

function redNode(green: GreenNode, offset: number): RedNode {
  const source = SourceText.from("test", "x".repeat(offset) + green.reconstruct());
  return new RedNode(green, undefined, offset, source, 0);
}

describe("HirOriginAllocator", () => {
  test("forSyntax is deterministic for the same node", () => {
    const allocator = createHirOriginAllocator();
    const node = redNode(nameExpression("x"), 0);
    const first = allocator.forSyntax({ moduleId: moduleId(0), node });
    const second = allocator.forSyntax({ moduleId: moduleId(0), node });
    expect(first).toBe(second);
  });

  test("forSyntax distinguishes different spans", () => {
    const allocator = createHirOriginAllocator();
    const nodeA = redNode(nameExpression("x"), 0);
    const nodeB = redNode(nameExpression("y"), 5);
    const first = allocator.forSyntax({ moduleId: moduleId(0), node: nodeA });
    const second = allocator.forSyntax({ moduleId: moduleId(0), node: nodeB });
    expect(first).not.toBe(second);
  });

  test("forSyntax distinguishes owner function ids", () => {
    const allocator = createHirOriginAllocator();
    const node = redNode(nameExpression("x"), 0);
    const first = allocator.forSyntax({
      moduleId: moduleId(0),
      node,
      ownerFunctionId: functionId(1),
    });
    const second = allocator.forSyntax({
      moduleId: moduleId(0),
      node,
      ownerFunctionId: functionId(2),
    });
    expect(first).not.toBe(second);
  });

  test("forSyntax distinguishes owner item ids", () => {
    const allocator = createHirOriginAllocator();
    const node = redNode(nameExpression("x"), 0);
    const first = allocator.forSyntax({
      moduleId: moduleId(0),
      node,
      ownerItemId: itemId(1),
    });
    const second = allocator.forSyntax({
      moduleId: moduleId(0),
      node,
      ownerItemId: itemId(2),
    });
    expect(first).not.toBe(second);
  });

  test("forSyntax distinguishes modules", () => {
    const allocator = createHirOriginAllocator();
    const node = redNode(nameExpression("x"), 0);
    const first = allocator.forSyntax({ moduleId: moduleId(0), node });
    const second = allocator.forSyntax({ moduleId: moduleId(1), node });
    expect(first).not.toBe(second);
  });

  test("forSyntax distinguishes same-span nodes with different red source ordinals", () => {
    const allocator = createHirOriginAllocator();
    const green = nameExpression("x");
    const source = SourceText.from("test", green.reconstruct());
    const firstNode = new RedNode(green, undefined, 0, source, 0);
    const secondNode = new RedNode(green, undefined, 0, source, 1);

    const first = allocator.forSyntax({ moduleId: moduleId(0), node: firstNode });
    const second = allocator.forSyntax({ moduleId: moduleId(0), node: secondNode });

    expect(first).not.toBe(second);
  });

  test("forMissingSyntax is deterministic by parent kind and slot", () => {
    const allocator = createHirOriginAllocator();
    const parent = redNode(
      new GreenNode({
        kind: SyntaxKind.CallExpression,
        children: [token(SyntaxKind.IdentifierToken, "x")],
      }),
      0,
    );
    const first = allocator.forMissingSyntax({
      moduleId: moduleId(0),
      parent,
      expectedSlotIndex: 1,
    });
    const second = allocator.forMissingSyntax({
      moduleId: moduleId(0),
      parent,
      expectedSlotIndex: 1,
    });
    expect(first).toBe(second);

    const otherSlot = allocator.forMissingSyntax({
      moduleId: moduleId(0),
      parent,
      expectedSlotIndex: 2,
    });
    expect(otherSlot).not.toBe(first);
  });

  test("forMissingSyntax records a zero-width span at parent start", () => {
    const allocator = createHirOriginAllocator();
    const parent = redNode(
      new GreenNode({
        kind: SyntaxKind.CallExpression,
        children: [token(SyntaxKind.IdentifierToken, "xy")],
      }),
      4,
    );
    const originId = allocator.forMissingSyntax({
      moduleId: moduleId(0),
      parent,
      expectedSlotIndex: 0,
    });
    const origin = allocator.get(originId);
    expect(origin?.span.start).toBe(4);
    expect(origin?.span.end).toBe(4);
    expect(origin?.syntaxKind).toBeUndefined();
  });

  test("forMissingSyntax distinguishes parent kinds", () => {
    const allocator = createHirOriginAllocator();
    const callParent = redNode(
      new GreenNode({
        kind: SyntaxKind.CallExpression,
        children: [token(SyntaxKind.IdentifierToken, "x")],
      }),
      0,
    );
    const memberParent = redNode(
      new GreenNode({
        kind: SyntaxKind.MemberAccessExpression,
        children: [token(SyntaxKind.IdentifierToken, "x")],
      }),
      0,
    );
    const first = allocator.forMissingSyntax({
      moduleId: moduleId(0),
      parent: callParent,
      expectedSlotIndex: 0,
    });
    const second = allocator.forMissingSyntax({
      moduleId: moduleId(0),
      parent: memberParent,
      expectedSlotIndex: 0,
    });
    expect(first).not.toBe(second);
  });

  test("forMissingSyntax distinguishes same-kind parents at different source spans", () => {
    const allocator = createHirOriginAllocator();
    const parentA = redNode(
      new GreenNode({
        kind: SyntaxKind.CallExpression,
        children: [token(SyntaxKind.IdentifierToken, "x")],
      }),
      0,
    );
    const parentB = redNode(
      new GreenNode({
        kind: SyntaxKind.CallExpression,
        children: [token(SyntaxKind.IdentifierToken, "x")],
      }),
      8,
    );

    const first = allocator.forMissingSyntax({
      moduleId: moduleId(0),
      parent: parentA,
      expectedSlotIndex: 0,
    });
    const second = allocator.forMissingSyntax({
      moduleId: moduleId(0),
      parent: parentB,
      expectedSlotIndex: 0,
    });

    expect(first).not.toBe(second);
  });

  test("forSynthetic keys on stableDetail", () => {
    const allocator = createHirOriginAllocator();
    const span = SourceSpan.from(0, 0);
    const first = allocator.forSynthetic({
      moduleId: moduleId(0),
      span,
      stableDetail: "missing-callee",
    });
    const second = allocator.forSynthetic({
      moduleId: moduleId(0),
      span,
      stableDetail: "missing-callee",
    });
    expect(first).toBe(second);

    const other = allocator.forSynthetic({
      moduleId: moduleId(0),
      span,
      stableDetail: "field:3",
    });
    expect(other).not.toBe(first);
  });

  test("forSynthetic distinguishes spans", () => {
    const allocator = createHirOriginAllocator();
    const first = allocator.forSynthetic({
      moduleId: moduleId(0),
      span: SourceSpan.from(0, 0),
      stableDetail: "recovery",
    });
    const second = allocator.forSynthetic({
      moduleId: moduleId(0),
      span: SourceSpan.from(1, 1),
      stableDetail: "recovery",
    });
    expect(first).not.toBe(second);
  });

  test("originRecords collects allocated origins in allocation order", () => {
    const allocator = createHirOriginAllocator();
    const node = redNode(nameExpression("x"), 0);
    const syntaxId = allocator.forSyntax({
      moduleId: moduleId(2),
      node,
      ownerFunctionId: functionId(7),
    });
    const syntheticId = allocator.forSynthetic({
      moduleId: moduleId(2),
      span: SourceSpan.from(1, 1),
      stableDetail: "recovery",
    });

    const records = allocator.originRecords();
    expect(records.map((origin) => origin.originId)).toEqual([syntaxId, syntheticId]);
    expect(records[0]?.moduleId).toBe(moduleId(2));
    expect(records[0]?.syntaxKind).toBe(SyntaxKind.NameExpression);
    expect(records[0]?.ownerFunctionId).toBe(functionId(7));
    expect(records[0]?.span.start).toBe(0);
    expect(records[0]?.span.end).toBe(1);
    expect(records[1]?.syntaxKind).toBeUndefined();
    expect(records[1]?.span.start).toBe(1);
    expect(records[1]?.span.end).toBe(1);
  });

  test("get returns the record for an allocated origin id", () => {
    const allocator: HirOriginAllocatorAndTable = createHirOriginAllocator();
    const node = redNode(nameExpression("x"), 3);
    const originId = allocator.forSyntax({ moduleId: moduleId(4), node });
    const origin = allocator.get(originId);
    expect(origin?.originId).toBe(originId);
    expect(origin?.moduleId).toBe(moduleId(4));
    expect(origin?.syntaxKind).toBe(SyntaxKind.NameExpression);
  });

  test("get returns undefined for an unknown origin id", () => {
    const allocator = createHirOriginAllocator();
    expect(allocator.get(hirOriginId(999))).toBeUndefined();
  });

  test("replaying the same call sequence reproduces the same ids", () => {
    function run(allocator: HirOriginAllocatorAndTable): readonly HirOriginId[] {
      const node = redNode(nameExpression("x"), 0);
      return [
        allocator.forSyntax({ moduleId: moduleId(0), node }),
        allocator.forMissingSyntax({
          moduleId: moduleId(0),
          parent: node,
          expectedSlotIndex: 1,
        }),
        allocator.forSynthetic({
          moduleId: moduleId(0),
          span: SourceSpan.from(0, 0),
          stableDetail: "recovery",
        }),
      ];
    }

    const first = run(createHirOriginAllocator());
    const second = run(createHirOriginAllocator());
    expect(second).toEqual(first);
  });
});
