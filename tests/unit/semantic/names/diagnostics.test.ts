import { describe, expect, test } from "bun:test";
import { SourceSpan, SourceText } from "../../../../src/frontend";
import { moduleId } from "../../../../src/semantic/ids";
import {
  ambiguousImport,
  ambiguousMember,
  ambiguousName,
  builtinTypeShadowed,
  candidateDisplayText,
  platformFnNotFreestanding,
  privateImport,
  qualifierNotModule,
  qualifierNotOwner,
  sortNameResolutionDiagnostics,
  unknownPlatformPrimitive,
  unresolvedImport,
  unresolvedMember,
  unresolvedModule,
  unresolvedName,
} from "../../../../src/semantic/names/diagnostics";
import type {
  CandidateDisplay,
  NameResolutionDiagnostic,
  NameResolutionDiagnosticOrder,
} from "../../../../src/semantic/names/diagnostics";

const source = SourceText.from("test.wr", "use std.io\nfn run()\n");
const order: NameResolutionDiagnosticOrder = {
  moduleId: moduleId(0),
  span: SourceSpan.from(0, 8),
  kind: "importModule",
  ordinal: 0,
};

describe("diagnostic constructors", () => {
  test("unresolvedModule", () => {
    const diagnostic = unresolvedModule({
      source,
      span: source.span(0, 8),
      order,
      moduleName: "std.io",
    });
    expect(diagnostic.code).toBe("NAME_UNRESOLVED_MODULE");
    expect(diagnostic.severity).toBe("error");
    expect(diagnostic.message).toBe("Unresolved module 'std.io'.");
    expect(diagnostic.source).toBe(source);
    expect(diagnostic.span).toEqual(SourceSpan.from(0, 8));
    expect(diagnostic.order).toBe(order);
  });

  test("unresolvedImport", () => {
    const diagnostic = unresolvedImport({
      source,
      span: source.span(4, 7),
      order,
      moduleName: "std.io",
      importedName: "Writer",
    });
    expect(diagnostic.code).toBe("NAME_UNRESOLVED_IMPORT");
    expect(diagnostic.message).toBe("Unresolved import 'Writer' from module 'std.io'.");
    expect(diagnostic.severity).toBe("error");
  });

  test("ambiguousImport", () => {
    const candidates: readonly CandidateDisplay[] = [
      { modulePath: "std/io.wr", itemKind: "class", name: "Writer", denseId: 0 },
      { modulePath: "app/utils.wr", itemKind: "class", name: "Writer", denseId: 1 },
    ];
    const diagnostic = ambiguousImport({
      source,
      span: source.span(4, 10),
      order,
      moduleName: "std.io",
      importedName: "Writer",
      candidates,
    });
    expect(diagnostic.code).toBe("NAME_AMBIGUOUS_IMPORT");
    expect(diagnostic.message).toBe(
      "Ambiguous import 'Writer' from module 'std.io': app/utils.wr/class/Writer/1, std/io.wr/class/Writer/0.",
    );
    expect(diagnostic.severity).toBe("error");
  });

  test("unresolvedName", () => {
    const diagnostic = unresolvedName({
      source,
      span: source.span(0, 4),
      order,
      name: "x",
    });
    expect(diagnostic.code).toBe("NAME_UNRESOLVED_NAME");
    expect(diagnostic.message).toBe("Unresolved name 'x'.");
    expect(diagnostic.severity).toBe("error");
  });

  test("ambiguousName", () => {
    const candidates: readonly CandidateDisplay[] = [
      { modulePath: "app/utils.wr", itemKind: "function", name: "run", denseId: 0 },
    ];
    const diagnostic = ambiguousName({
      source,
      span: source.span(0, 3),
      order,
      name: "run",
      candidates,
    });
    expect(diagnostic.code).toBe("NAME_AMBIGUOUS_NAME");
    expect(diagnostic.message).toBe("Ambiguous name 'run': app/utils.wr/function/run/0.");
    expect(diagnostic.severity).toBe("error");
  });

  test("qualifierNotModule", () => {
    const diagnostic = qualifierNotModule({
      source,
      span: source.span(0, 5),
      order,
      qualifier: "something",
    });
    expect(diagnostic.code).toBe("NAME_QUALIFIER_NOT_MODULE");
    expect(diagnostic.message).toBe("Qualifier 'something' is not a module.");
    expect(diagnostic.severity).toBe("error");
  });

  test("qualifierNotOwner", () => {
    const diagnostic = qualifierNotOwner({
      source,
      span: source.span(0, 5),
      order,
      qualifier: "something",
    });
    expect(diagnostic.code).toBe("NAME_QUALIFIER_NOT_OWNER");
    expect(diagnostic.message).toBe("Qualifier 'something' does not own members.");
    expect(diagnostic.severity).toBe("error");
  });

  test("unresolvedMember", () => {
    const diagnostic = unresolvedMember({
      source,
      span: source.span(6, 10),
      order,
      ownerName: "Reg32",
      memberName: "value",
    });
    expect(diagnostic.code).toBe("NAME_UNRESOLVED_MEMBER");
    expect(diagnostic.message).toBe("Unresolved member 'value' on 'Reg32'.");
    expect(diagnostic.severity).toBe("error");
  });

  test("ambiguousMember", () => {
    const candidates: readonly CandidateDisplay[] = [
      { modulePath: "arch/cpu.wr", itemKind: "field", name: "ctrl", denseId: 0 },
    ];
    const diagnostic = ambiguousMember({
      source,
      span: source.span(6, 10),
      order,
      ownerName: "Reg32",
      memberName: "ctrl",
      candidates,
    });
    expect(diagnostic.code).toBe("NAME_AMBIGUOUS_MEMBER");
    expect(diagnostic.message).toBe(
      "Ambiguous member 'ctrl' on 'Reg32': arch/cpu.wr/field/ctrl/0.",
    );
    expect(diagnostic.severity).toBe("error");
  });

  test("unknownPlatformPrimitive", () => {
    const diagnostic = unknownPlatformPrimitive({
      source,
      span: source.span(0, 16),
      order: { ...order, kind: "functionName" },
      functionName: "volatile_load_u32",
    });
    expect(diagnostic.code).toBe("NAME_UNKNOWN_PLATFORM_PRIMITIVE");
    expect(diagnostic.message).toBe("Unknown platform primitive 'volatile_load_u32'.");
    expect(diagnostic.severity).toBe("error");
  });

  test("privateImport", () => {
    const diagnostic = privateImport({
      source,
      span: source.span(4, 10),
      order: { ...order, kind: "importedItem" },
      moduleName: "std/io.wr",
      importedName: "internal",
    });
    expect(diagnostic.code).toBe("NAME_PRIVATE_IMPORT");
    expect(diagnostic.message).toBe("Item 'internal' in module 'std/io.wr' is private.");
    expect(diagnostic.severity).toBe("error");
  });

  test("builtinTypeShadowed", () => {
    const diagnostic = builtinTypeShadowed({
      source,
      span: source.span(0, 4),
      order: { ...order, kind: "typeName" },
      name: "u32",
    });
    expect(diagnostic.code).toBe("NAME_BUILTIN_TYPE_SHADOWED");
    expect(diagnostic.message).toBe(
      "Builtin type 'u32' cannot be shadowed by a local declaration.",
    );
    expect(diagnostic.severity).toBe("error");
  });

  test("platformFnNotFreestanding", () => {
    const diagnostic = platformFnNotFreestanding({
      source,
      span: source.span(0, 12),
      order: { ...order, kind: "declaration" },
      functionName: "load",
    });
    expect(diagnostic.code).toBe("NAME_PLATFORM_FN_NOT_FREESTANDING");
    expect(diagnostic.message).toBe("Platform function 'load' must be freestanding.");
    expect(diagnostic.severity).toBe("error");
  });
});

describe("sortNameResolutionDiagnostics", () => {
  test("sorts by order.moduleId, order.span.start, order.span.end, order.kind, order.ordinal, code, message", () => {
    const diagnostics: NameResolutionDiagnostic[] = [
      unresolvedName({
        source,
        span: source.span(8, 14),
        order: {
          moduleId: moduleId(0),
          span: source.span(8, 14),
          kind: "typeName",
          ordinal: 0,
        },
        name: "Writer",
      }),
      unresolvedModule({
        source,
        span: source.span(0, 6),
        order: {
          moduleId: moduleId(0),
          span: source.span(0, 6),
          kind: "importModule",
          ordinal: 0,
        },
        moduleName: "std.io",
      }),
    ];

    const sorted = sortNameResolutionDiagnostics(diagnostics);
    expect(sorted.map((diagnostic) => diagnostic.code)).toEqual([
      "NAME_UNRESOLVED_MODULE",
      "NAME_UNRESOLVED_NAME",
    ]);
  });

  test("sorts by ordinal when all else equal", () => {
    const diagnostics: NameResolutionDiagnostic[] = [
      unresolvedName({
        source,
        span: source.span(0, 4),
        order: { moduleId: moduleId(0), span: source.span(0, 4), kind: "typeName", ordinal: 1 },
        name: "b",
      }),
      unresolvedName({
        source,
        span: source.span(0, 4),
        order: { moduleId: moduleId(0), span: source.span(0, 4), kind: "typeName", ordinal: 0 },
        name: "a",
      }),
    ];
    const sorted = sortNameResolutionDiagnostics(diagnostics);
    expect(sorted[0]!.order.ordinal).toBe(0);
    expect(sorted[1]!.order.ordinal).toBe(1);
  });

  test("sorts by moduleId", () => {
    const diagnostics: NameResolutionDiagnostic[] = [
      unresolvedName({
        source,
        span: source.span(0, 4),
        order: { moduleId: moduleId(1), span: source.span(0, 4), kind: "typeName", ordinal: 0 },
        name: "a",
      }),
      unresolvedName({
        source,
        span: source.span(0, 4),
        order: { moduleId: moduleId(0), span: source.span(0, 4), kind: "typeName", ordinal: 0 },
        name: "b",
      }),
    ];
    const sorted = sortNameResolutionDiagnostics(diagnostics);
    expect(sorted[0]!.order.moduleId).toBe(moduleId(0));
    expect(sorted[1]!.order.moduleId).toBe(moduleId(1));
  });

  test("sorts by span start", () => {
    const diagnostics: NameResolutionDiagnostic[] = [
      unresolvedName({
        source,
        span: source.span(5, 10),
        order: { moduleId: moduleId(0), span: source.span(5, 10), kind: "typeName", ordinal: 0 },
        name: "a",
      }),
      unresolvedName({
        source,
        span: source.span(0, 4),
        order: { moduleId: moduleId(0), span: source.span(0, 4), kind: "typeName", ordinal: 0 },
        name: "b",
      }),
    ];
    const sorted = sortNameResolutionDiagnostics(diagnostics);
    expect(sorted[0]!.order.span.start).toBe(0);
    expect(sorted[1]!.order.span.start).toBe(5);
  });

  test("sorts by span end when start equal", () => {
    const diagnostics: NameResolutionDiagnostic[] = [
      unresolvedName({
        source,
        span: source.span(0, 8),
        order: { moduleId: moduleId(0), span: source.span(0, 8), kind: "typeName", ordinal: 0 },
        name: "a",
      }),
      unresolvedName({
        source,
        span: source.span(0, 4),
        order: { moduleId: moduleId(0), span: source.span(0, 4), kind: "typeName", ordinal: 0 },
        name: "b",
      }),
    ];
    const sorted = sortNameResolutionDiagnostics(diagnostics);
    expect(sorted[0]!.order.span.end).toBe(4);
    expect(sorted[1]!.order.span.end).toBe(8);
  });

  test("sorts by kind", () => {
    const diagnostics: NameResolutionDiagnostic[] = [
      unresolvedName({
        source,
        span: source.span(0, 4),
        order: { moduleId: moduleId(0), span: source.span(0, 4), kind: "importModule", ordinal: 0 },
        name: "a",
      }),
      unresolvedName({
        source,
        span: source.span(0, 4),
        order: {
          moduleId: moduleId(0),
          span: source.span(0, 4),
          kind: "declaration",
          ordinal: 0,
        },
        name: "b",
      }),
    ];
    const sorted = sortNameResolutionDiagnostics(diagnostics);
    expect(sorted.map((diagnostic) => diagnostic.order.kind)).toEqual([
      "declaration",
      "importModule",
    ]);
  });

  test("sorts by code when all other order fields equal", () => {
    const diagnostics: NameResolutionDiagnostic[] = [
      unresolvedName({
        source,
        span: source.span(0, 4),
        order: { moduleId: moduleId(0), span: source.span(0, 4), kind: "typeName", ordinal: 0 },
        name: "a",
      }),
      unresolvedModule({
        source,
        span: source.span(0, 4),
        order: { moduleId: moduleId(0), span: source.span(0, 4), kind: "typeName", ordinal: 0 },
        moduleName: "b",
      }),
    ];
    const sorted = sortNameResolutionDiagnostics(diagnostics);
    expect(sorted.map((diagnostic) => diagnostic.code)).toEqual([
      "NAME_UNRESOLVED_MODULE",
      "NAME_UNRESOLVED_NAME",
    ]);
  });

  test("sorts by message when code also equal", () => {
    const diagnostics: NameResolutionDiagnostic[] = [
      unresolvedName({
        source,
        span: source.span(0, 4),
        order: { moduleId: moduleId(0), span: source.span(0, 4), kind: "typeName", ordinal: 0 },
        name: "zzz",
      }),
      unresolvedName({
        source,
        span: source.span(0, 4),
        order: { moduleId: moduleId(0), span: source.span(0, 4), kind: "typeName", ordinal: 0 },
        name: "aaa",
      }),
    ];
    const sorted = sortNameResolutionDiagnostics(diagnostics);
    expect(sorted.map((diagnostic) => diagnostic.message)).toEqual([
      "Unresolved name 'aaa'.",
      "Unresolved name 'zzz'.",
    ]);
  });

  test("sorts kind by code unit ordering", () => {
    const diagnostics: NameResolutionDiagnostic[] = [
      unresolvedName({
        source,
        span: source.span(0, 4),
        order: {
          moduleId: moduleId(0),
          span: source.span(0, 4),
          kind: "platformBinding",
          ordinal: 0,
        },
        name: "a",
      }),
      unresolvedName({
        source,
        span: source.span(0, 4),
        order: {
          moduleId: moduleId(0),
          span: source.span(0, 4),
          kind: "declaration",
          ordinal: 0,
        },
        name: "b",
      }),
    ];
    const sorted = sortNameResolutionDiagnostics(diagnostics);
    expect(sorted.map((diagnostic) => diagnostic.order.kind)).toEqual([
      "declaration",
      "platformBinding",
    ]);
  });
});

describe("candidateDisplayText", () => {
  test("sorts by modulePath, itemKind, name, denseId", () => {
    const candidates: readonly CandidateDisplay[] = [
      { modulePath: "std/io.wr", itemKind: "class", name: "Writer", denseId: 0 },
      { modulePath: "app/utils.wr", itemKind: "class", name: "Writer", denseId: 1 },
      { modulePath: "std/io.wr", itemKind: "class", name: "Reader", denseId: 0 },
      { modulePath: "std/io.wr", itemKind: "function", name: "open", denseId: 5 },
      { modulePath: "std/io.wr", itemKind: "class", name: "Writer", denseId: 2 },
    ];

    const result = candidateDisplayText(candidates);
    expect(result).toBe(
      "app/utils.wr/class/Writer/1, std/io.wr/class/Reader/0, std/io.wr/class/Writer/0, std/io.wr/class/Writer/2, std/io.wr/function/open/5",
    );
  });

  test("returns empty string for empty candidates", () => {
    expect(candidateDisplayText([])).toBe("");
  });

  test("sorts modulePath by code unit ordering", () => {
    const candidates: readonly CandidateDisplay[] = [
      { modulePath: "zeta.wr", itemKind: "class", name: "A", denseId: 0 },
      { modulePath: "Alpha.wr", itemKind: "class", name: "A", denseId: 0 },
    ];

    expect(candidateDisplayText(candidates)).toBe("Alpha.wr/class/A/0, zeta.wr/class/A/0");
  });
});

describe("constructors use narrow spans from callers", () => {
  test("preserves caller-supplied span", () => {
    const narrow = source.span(4, 7);
    const diagnostic = unresolvedName({
      source,
      span: narrow,
      order: { ...order, span: narrow },
      name: "foo",
    });
    expect(diagnostic.span).toBe(narrow);
    expect(diagnostic.span.start).toBe(4);
    expect(diagnostic.span.end).toBe(7);
    expect(diagnostic.order.span).toBe(narrow);
  });
});
