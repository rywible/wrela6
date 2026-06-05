import * as fastCheck from "fast-check";

export function arbitraryText(): fastCheck.Arbitrary<string> {
  return fastCheck.string();
}

export function deepNestingSource(): fastCheck.Arbitrary<string> {
  return fastCheck
    .tuple(fastCheck.nat({ max: 50 }), fastCheck.nat({ max: 50 }))
    .map(([nestingDepth, _typeDepth]) => {
      let source = "";
      const indent = "    ";
      source += "fn test():\n";
      for (let index = 0; index < nestingDepth; index++) {
        source += indent.repeat(index + 1) + "loop:\n";
      }
      source += indent.repeat(nestingDepth + 1) + "return\n";
      return source;
    });
}

export function deepExpressionNesting(): fastCheck.Arbitrary<string> {
  return fastCheck.nat({ max: 50 }).map((depth) => {
    let source = "fn test():\n    return ";
    source += "(".repeat(depth) + "1" + ")".repeat(depth);
    source += "\n";
    return source;
  });
}
