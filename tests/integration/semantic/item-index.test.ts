import { expect, test } from "bun:test";
import { buildItemIndex } from "../../../src/semantic";
import { parseModuleGraphForTest } from "../../support/frontend/module-graph-test-support";

test("builds deterministic item index from parsed module graph", () => {
  const graph = parseModuleGraphForTest([
    ["app/main.wr", "use Packet from app.packet\nfn main(packet: Packet)\n"],
    [
      "app/packet.wr",
      "validated buffer Packet:\n    params:\n        size: U16\n    layout:\n        data: U8 @ 0 len 4\n",
    ],
  ]);

  const result = buildItemIndex({ graph });

  expect(result.index.modules().map((mod) => mod.pathKey)).toEqual([
    "app/main.wr",
    "app/packet.wr",
  ]);
  expect(result.index.items().map((item) => item.name)).toEqual(["main", "Packet"]);
  expect(result.index.fields().map((field) => field.role)).toEqual([
    "validatedParam",
    "layoutField",
  ]);
});

test("item-index diagnostics can be concatenated with parser diagnostics and sorted", () => {
  const graph = parseModuleGraphForTest([["main.wr", "class Box:\nclass Box:\n"]]);

  const result = buildItemIndex({ graph });

  // Merge with parser diagnostics and sort
  const allDiagnostics = [...graph.diagnostics, ...result.diagnostics].sort((left, right) => {
    const nameCmp = left.source.name.localeCompare(right.source.name);
    if (nameCmp !== 0) return nameCmp;
    const startCmp = left.span.start - right.span.start;
    if (startCmp !== 0) return startCmp;
    const endCmp = left.span.end - right.span.end;
    if (endCmp !== 0) return endCmp;
    return left.code.localeCompare(right.code);
  });

  // Should have at least some diagnostics
  expect(allDiagnostics.length).toBeGreaterThan(0);
  // Should include item-index diagnostics
  expect(result.diagnostics.length).toBeGreaterThan(0);
});
