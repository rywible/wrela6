import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const workspaceRoot = new URL("../..", import.meta.url).pathname;

type GrandfatheredFile = {
  readonly path: string;
  readonly recordedLines: number;
};

type GrandfatheredGiantFile = GrandfatheredFile & {
  readonly prerequisite: string;
};

type SubsystemAudit = {
  readonly name: string;
  readonly root: string;
  readonly lineCap: number;
  readonly grandfatheredFiles: readonly GrandfatheredFile[];
};

type ScarTissuePattern = {
  readonly name: string;
  readonly token: string;
  readonly appliesToPath?: (path: string) => boolean;
  readonly isAllowedLine?: (line: string) => boolean;
};

type ScarTissueException = {
  readonly path: string;
  readonly pattern: string;
  readonly line: number;
  readonly snippet: string;
};

type ScarTissueFinding = {
  readonly path: string;
  readonly pattern: string;
  readonly line: number;
  readonly snippet: string;
};

type ProofPathStringifyOffender = {
  readonly path: string;
  readonly pattern: "JSON.stringify";
  readonly line: number;
  readonly snippet: string;
};

type GrandfatheredGiantFileGrowth = {
  readonly path: string;
  readonly currentLines: number;
  readonly recordedLines: number;
  readonly prerequisite: string;
  readonly message: string;
};

type GiantFile = {
  readonly path: string;
  readonly currentLines: number;
};

type DeterministicSortPolicyViolation = {
  readonly path: string;
  readonly currentLines: number;
  readonly message: string;
};

type RemainingGiantFileSplitTicket = {
  readonly path: string;
  readonly ownerBoundary: string;
  readonly newFiles: string;
  readonly pureMoveTestCommand: string;
  readonly firstBehaviorTask: string;
};

const w005SplitPrerequisite = "W0-05 split prerequisite";
const giantFileLineThreshold = 900;
const giantFileSplitMapPath = "docs/implementation/giant-file-split-map.md";
const remainingGiantFileSplitTicketsPath = "docs/implementation/remaining-giant-file-splits.md";

const grandfatheredGiantFiles: readonly GrandfatheredGiantFile[] = [
  {
    path: "src/target/aarch64/backend/object/layout-encode-fixed-point.ts",
    recordedLines: 998,
    prerequisite: w005SplitPrerequisite,
  },
  {
    path: "src/opt-ir/lower/lower-checked-mir.ts",
    recordedLines: 997,
    prerequisite: w005SplitPrerequisite,
  },
  {
    path: "src/proof-check/domains/validation.ts",
    recordedLines: 989,
    prerequisite: w005SplitPrerequisite,
  },
  {
    path: "src/proof-check/kernel/registry/transition-helpers.ts",
    recordedLines: 980,
    prerequisite: w005SplitPrerequisite,
  },
  {
    path: "src/mono/mono-hir.ts",
    recordedLines: 977,
    prerequisite: w005SplitPrerequisite,
  },
  {
    path: "src/target/aarch64/backend/object/object-module.ts",
    recordedLines: 973,
    prerequisite: w005SplitPrerequisite,
  },
  {
    path: "src/target/aarch64/backend/verify/encoding-object-verifier.ts",
    recordedLines: 973,
    prerequisite: w005SplitPrerequisite,
  },
  {
    path: "src/target/aarch64/lower/lower-function.ts",
    recordedLines: 965,
    prerequisite: w005SplitPrerequisite,
  },
  {
    path: "src/proof-check/domains/source-calls.ts",
    recordedLines: 952,
    prerequisite: w005SplitPrerequisite,
  },
  {
    path: "src/proof-check/domains/facts.ts",
    recordedLines: 952,
    prerequisite: w005SplitPrerequisite,
  },
  {
    path: "src/proof-mir/draft/draft-graph-builder.ts",
    recordedLines: 946,
    prerequisite: w005SplitPrerequisite,
  },
  {
    path: "src/target/aarch64/backend/api/machine-lowering.ts",
    recordedLines: 945,
    prerequisite: w005SplitPrerequisite,
  },
  {
    path: "src/proof-check/authority/authority-term-canonicalization.ts",
    recordedLines: 944,
    prerequisite: w005SplitPrerequisite,
  },
  {
    path: "src/proof-mir/domains/effects-resources.ts",
    recordedLines: 932,
    prerequisite: w005SplitPrerequisite,
  },
  {
    path: "src/target/uefi-aarch64/runtime-helper-instructions.ts",
    recordedLines: 930,
    prerequisite: w005SplitPrerequisite,
  },
];

const subsystemAudits: readonly SubsystemAudit[] = [
  {
    name: "semantic",
    root: "src/semantic",
    lineCap: 600,
    grandfatheredFiles: [
      { path: "src/semantic/item-index/source-member-collector.ts", recordedLines: 687 },
      { path: "src/semantic/names/expression-resolver.ts", recordedLines: 1325 },
      { path: "src/semantic/names/type-reference-resolver.ts", recordedLines: 957 },
      { path: "src/semantic/surface/platform-certifier.ts", recordedLines: 761 },
      { path: "src/semantic/surface/semantic-surface-checker.ts", recordedLines: 884 },
    ],
  },
  {
    name: "proof-mir",
    root: "src/proof-mir",
    lineCap: 600,
    grandfatheredFiles: [
      { path: "src/proof-mir/canonicalization/draft-statement-freeze.ts", recordedLines: 752 },
      { path: "src/proof-mir/canonicalization/graph-snapshot-freeze.ts", recordedLines: 930 },
      {
        path: "src/proof-mir/canonicalization/program-freeze-function-draft.ts",
        recordedLines: 853,
      },
      {
        path: "src/proof-mir/canonicalization/program-freeze-program-tables.ts",
        recordedLines: 613,
      },
      { path: "src/proof-mir/domains/effects-resources.ts", recordedLines: 932 },
      { path: "src/proof-mir/domains/fact-recording.ts", recordedLines: 685 },
      { path: "src/proof-mir/draft/draft-graph-builder.ts", recordedLines: 947 },
      { path: "src/proof-mir/lower/attempt-lowerer.ts", recordedLines: 687 },
      { path: "src/proof-mir/lower/expression-lowerer.ts", recordedLines: 889 },
      { path: "src/proof-mir/lower/function-lowerer.ts", recordedLines: 817 },
      { path: "src/proof-mir/lower/if-lowerer.ts", recordedLines: 799 },
      { path: "src/proof-mir/lower/iterator-lowerer.ts", recordedLines: 731 },
      { path: "src/proof-mir/lower/local-classifier.ts", recordedLines: 893 },
      { path: "src/proof-mir/lower/match-lowerer.ts", recordedLines: 604 },
      { path: "src/proof-mir/lower/statement-lowerer.ts", recordedLines: 638 },
      { path: "src/proof-mir/lower/take-lowerer.ts", recordedLines: 636 },
      { path: "src/proof-mir/lower/validation-lowerer.ts", recordedLines: 873 },
      { path: "src/proof-mir/model/graph.ts", recordedLines: 627 },
      { path: "src/proof-mir/validation/graph-validator.ts", recordedLines: 841 },
      { path: "src/proof-mir/validation/input-compatibility-validator.ts", recordedLines: 649 },
    ],
  },
  {
    name: "proof-check",
    root: "src/proof-check",
    lineCap: 600,
    grandfatheredFiles: [
      { path: "src/proof-check/authority/authority-term-canonicalization.ts", recordedLines: 944 },
      { path: "src/proof-check/authority/runtime-authority.ts", recordedLines: 656 },
      { path: "src/proof-check/authority/semantics-companion.ts", recordedLines: 891 },
      { path: "src/proof-check/domains/attempts.ts", recordedLines: 722 },
      { path: "src/proof-check/domains/cross-core-ownership.ts", recordedLines: 803 },
      { path: "src/proof-check/domains/facts.ts", recordedLines: 952 },
      { path: "src/proof-check/domains/layout-entailment.ts", recordedLines: 622 },
      { path: "src/proof-check/domains/loops.ts", recordedLines: 874 },
      { path: "src/proof-check/domains/ownership-transfer.ts", recordedLines: 883 },
      { path: "src/proof-check/domains/platform-contract-effects.ts", recordedLines: 813 },
      { path: "src/proof-check/domains/platform-contract-transfer.ts", recordedLines: 832 },
      { path: "src/proof-check/domains/runtime-contract-transfer.ts", recordedLines: 755 },
      { path: "src/proof-check/domains/source-calls.ts", recordedLines: 952 },
      { path: "src/proof-check/domains/take-session-operations.ts", recordedLines: 696 },
      { path: "src/proof-check/domains/terminal.ts", recordedLines: 775 },
      { path: "src/proof-check/domains/validation.ts", recordedLines: 989 },
      { path: "src/proof-check/kernel/registry/statement-handlers.ts", recordedLines: 614 },
      { path: "src/proof-check/kernel/registry/transition-helpers.ts", recordedLines: 980 },
      { path: "src/proof-check/model/fact-language.ts", recordedLines: 807 },
      { path: "src/proof-check/validation/input-validator.ts", recordedLines: 763 },
    ],
  },
  {
    name: "opt-ir",
    root: "src/opt-ir",
    lineCap: 600,
    grandfatheredFiles: [
      { path: "src/opt-ir/lower/lower-checked-mir.ts", recordedLines: 1032 },
      { path: "src/opt-ir/operations.ts", recordedLines: 1046 },
      { path: "src/opt-ir/passes/cfg-simplification.ts", recordedLines: 729 },
      { path: "src/opt-ir/passes/scalar-simplification.ts", recordedLines: 747 },
      { path: "src/opt-ir/passes/whole-program-specialization.ts", recordedLines: 630 },
    ],
  },
  {
    name: "target/aarch64",
    root: "src/target/aarch64",
    lineCap: 600,
    grandfatheredFiles: [
      { path: "src/target/aarch64/backend/api/backend-target-surface.ts", recordedLines: 757 },
      { path: "src/target/aarch64/backend/api/function-pipeline.ts", recordedLines: 883 },
      { path: "src/target/aarch64/backend/api/machine-lowering.ts", recordedLines: 945 },
      {
        path: "src/target/aarch64/backend/object/layout-encode-fixed-point.ts",
        recordedLines: 998,
      },
      { path: "src/target/aarch64/backend/object/object-module.ts", recordedLines: 974 },
      { path: "src/target/aarch64/backend/verify/encoding-object-verifier.ts", recordedLines: 973 },
      { path: "src/target/aarch64/interpreter/machine-ir-interpreter.ts", recordedLines: 855 },
      { path: "src/target/aarch64/lower/lower-function.ts", recordedLines: 965 },
      { path: "src/target/aarch64/lower/operation-materialization.ts", recordedLines: 836 },
      { path: "src/target/aarch64/lower/operation-materializer-calls.ts", recordedLines: 844 },
      { path: "src/target/aarch64/lower/operation-materializer-memory.ts", recordedLines: 742 },
      { path: "src/target/aarch64/lower/switch-terminator-lowering.ts", recordedLines: 610 },
      { path: "src/target/aarch64/machine-ir/opcode-catalog.ts", recordedLines: 634 },
      { path: "src/target/aarch64/verify/structural-verifier.ts", recordedLines: 626 },
    ],
  },
  {
    name: "layout",
    root: "src/layout",
    lineCap: 600,
    grandfatheredFiles: [
      { path: "src/layout/aggregate-layout.ts", recordedLines: 771 },
      { path: "src/layout/image-entry-abi.ts", recordedLines: 869 },
      { path: "src/layout/source-function-abi.ts", recordedLines: 636 },
      { path: "src/layout/validated-buffer-fields.ts", recordedLines: 796 },
      { path: "src/layout/validated-buffer-terms.ts", recordedLines: 728 },
    ],
  },
  {
    name: "linker",
    root: "src/linker",
    lineCap: 600,
    grandfatheredFiles: [
      { path: "src/linker/image-layout-policy.ts", recordedLines: 858 },
      { path: "src/linker/layout-fixed-point.ts", recordedLines: 739 },
      { path: "src/linker/relocation-application.ts", recordedLines: 697 },
      { path: "src/linker/verifier.ts", recordedLines: 877 },
    ],
  },
  {
    name: "pe-coff",
    root: "src/pe-coff",
    lineCap: 600,
    grandfatheredFiles: [
      { path: "src/pe-coff/aarch64/aarch64-pe-coff-efi-writer.ts", recordedLines: 611 },
      { path: "src/pe-coff/pe-file-layout.ts", recordedLines: 819 },
    ],
  },
  {
    name: "frontend",
    root: "src/frontend",
    lineCap: 600,
    grandfatheredFiles: [{ path: "src/frontend/lexer/lexer.ts", recordedLines: 619 }],
  },
];

const scarTissuePatterns: readonly ScarTissuePattern[] = [
  { name: "as any", token: "as any" },
  { name: "@ts-ignore", token: "@ts-ignore" },
  { name: "Math.random", token: "Math.random" },
  { name: "Date.now", token: "Date.now" },
  {
    name: "unstable JSON.stringify",
    token: "JSON.stringify",
    appliesToPath: (path) =>
      path.startsWith("src/proof-mir/") ||
      path.startsWith("src/proof-check/") ||
      path.includes("/canonicalization/"),
    isAllowedLine: (line) =>
      line.includes("JSON.stringify(toStableValue(") ||
      line.includes("JSON.stringify(sortJsonValue("),
  },
];

const scarTissueExceptions: readonly ScarTissueException[] = [
  {
    path: "src/proof-check/stable-numeric-seed.ts",
    pattern: "unstable JSON.stringify",
    line: 18,
    snippet:
      "`stableNumericSeed collision for ${JSON.stringify(seed)} and ${JSON.stringify(existingSeed)} at ${String(value)}`,",
  },
  {
    path: "src/proof-mir/domains/effects-resources.ts",
    pattern: "unstable JSON.stringify",
    line: 325,
    snippet: "return JSON.stringify({",
  },
  {
    path: "src/proof-mir/domains/effects-resources.ts",
    pattern: "unstable JSON.stringify",
    line: 335,
    snippet: "return JSON.stringify({",
  },
  {
    path: "src/proof-mir/domains/effects-resources.ts",
    pattern: "unstable JSON.stringify",
    line: 592,
    snippet: "return JSON.stringify({",
  },
  {
    path: "src/proof-mir/domains/effects-resources.ts",
    pattern: "unstable JSON.stringify",
    line: 604,
    snippet: "return JSON.stringify({",
  },
  {
    path: "src/proof-mir/domains/effects-resources.ts",
    pattern: "unstable JSON.stringify",
    line: 877,
    snippet: "normalizePayload: (entry) => JSON.stringify(normalizeDraftEdgeEffect(entry)),",
  },
  {
    path: "src/proof-mir/domains/fact-recording.ts",
    pattern: "unstable JSON.stringify",
    line: 269,
    snippet: "return `layout:${normalized.layout.kind}:${JSON.stringify(normalized.layout)}`;",
  },
  {
    path: "src/proof-mir/domains/fact-recording.ts",
    pattern: "unstable JSON.stringify",
    line: 313,
    snippet: "return JSON.stringify({",
  },
  {
    path: "src/proof-mir/domains/fact-recording.ts",
    pattern: "unstable JSON.stringify",
    line: 322,
    snippet: "return JSON.stringify({",
  },
  {
    path: "src/proof-mir/domains/origin-map.ts",
    pattern: "unstable JSON.stringify",
    line: 189,
    snippet: "return JSON.stringify({",
  },
  {
    path: "src/proof-mir/draft/draft-program.ts",
    pattern: "unstable JSON.stringify",
    line: 358,
    snippet: 'record.type === undefined ? "" : JSON.stringify(record.type),',
  },
  {
    path: "src/proof-mir/draft/draft-program.ts",
    pattern: "unstable JSON.stringify",
    line: 360,
    snippet: 'record.representation === undefined ? "" : JSON.stringify(record.representation),',
  },
  {
    path: "src/proof-mir/draft/draft-program.ts",
    pattern: "unstable JSON.stringify",
    line: 368,
    snippet: 'record.type === undefined ? "" : JSON.stringify(record.type),',
  },
  {
    path: "src/proof-mir/draft/draft-program.ts",
    pattern: "unstable JSON.stringify",
    line: 378,
    snippet: 'record.root === undefined ? "" : JSON.stringify(record.root),',
  },
  {
    path: "src/proof-mir/draft/draft-program.ts",
    pattern: "unstable JSON.stringify",
    line: 379,
    snippet: 'record.projection === undefined ? "" : JSON.stringify(record.projection),',
  },
  {
    path: "src/proof-mir/draft/draft-program.ts",
    pattern: "unstable JSON.stringify",
    line: 380,
    snippet: 'record.type === undefined ? "" : JSON.stringify(record.type),',
  },
  {
    path: "src/proof-mir/draft/draft-program.ts",
    pattern: "unstable JSON.stringify",
    line: 412,
    snippet: "JSON.stringify(record.callId),",
  },
  {
    path: "src/proof-mir/draft/draft-program.ts",
    pattern: "unstable JSON.stringify",
    line: 413,
    snippet: "JSON.stringify(record.target),",
  },
  {
    path: "src/proof-mir/draft/draft-program.ts",
    pattern: "unstable JSON.stringify",
    line: 414,
    snippet: 'record.receiver === undefined ? "" : JSON.stringify(record.receiver),',
  },
  {
    path: "src/proof-mir/draft/draft-program.ts",
    pattern: "unstable JSON.stringify",
    line: 450,
    snippet:
      "return [String(record.callKey), String(record.originKey), JSON.stringify(record.target)].join(",
  },
];

const proofPathStringifyRoots = [
  "src/proof-mir/canonicalization",
  "src/proof-check/validation",
] as const;

function sourceText(path: string, root = workspaceRoot): string {
  return readFileSync(join(root, path), "utf8");
}

function lineCount(path: string, root = workspaceRoot): number {
  return sourceText(path, root).split("\n").length;
}

function tsFilesUnder(path: string, root = workspaceRoot): readonly string[] {
  const absolute = join(root, path);
  const result: string[] = [];
  for (const entry of readdirSync(absolute)) {
    const child = join(path, entry);
    const childStat = statSync(join(root, child));
    if (childStat.isDirectory()) {
      result.push(...tsFilesUnder(child, root));
    } else if (entry.endsWith(".ts")) {
      result.push(child);
    }
  }
  return result.sort();
}

function expectLineCountAtMost(input: {
  readonly path: string;
  readonly currentLines: number;
  readonly limit: number;
  readonly limitName: "cap" | "recorded";
}): void {
  expect(
    input.currentLines,
    `${input.path} has ${input.currentLines} lines; ${input.limitName} is ${input.limit}`,
  ).toBeLessThanOrEqual(input.limit);
}

function scarTissueExceptionKey(exception: ScarTissueException): string {
  return [exception.path, exception.pattern, String(exception.line), exception.snippet.trim()].join(
    "\0",
  );
}

function findScarTissue(input: {
  readonly sourceRoot: string;
  readonly exceptions: readonly ScarTissueException[];
}): readonly ScarTissueFinding[] {
  const exceptions = new Set(input.exceptions.map(scarTissueExceptionKey));
  const findings: ScarTissueFinding[] = [];

  for (const path of tsFilesUnder("src", input.sourceRoot)) {
    const lines = sourceText(path, input.sourceRoot).split("\n");
    for (const [index, line] of lines.entries()) {
      const lineNumber = index + 1;
      for (const pattern of scarTissuePatterns) {
        if (pattern.appliesToPath !== undefined && !pattern.appliesToPath(path)) continue;
        if (!line.includes(pattern.token)) continue;
        if (pattern.isAllowedLine?.(line) === true) continue;

        const finding = {
          path,
          pattern: pattern.name,
          line: lineNumber,
          snippet: line.trim(),
        };
        if (!exceptions.has(scarTissueExceptionKey(finding))) {
          findings.push(finding);
        }
      }
    }
  }

  return findings.sort((left, right) => {
    const leftKey = `${left.path}:${left.line}:${left.pattern}`;
    const rightKey = `${right.path}:${right.line}:${right.pattern}`;
    return leftKey.localeCompare(rightKey);
  });
}

function findProofPathRawStringifyOffenders(
  root = workspaceRoot,
): readonly ProofPathStringifyOffender[] {
  const offenders: ProofPathStringifyOffender[] = [];

  for (const proofPathRoot of proofPathStringifyRoots) {
    if (!existsSync(join(root, proofPathRoot))) continue;
    for (const path of tsFilesUnder(proofPathRoot, root)) {
      const lines = sourceText(path, root).split("\n");
      for (const [index, line] of lines.entries()) {
        if (!line.includes("JSON.stringify")) continue;
        if (line.includes("JSON.stringify(toStableValue(")) continue;
        if (line.includes("JSON.stringify(sortJsonValue(")) continue;

        offenders.push({
          path,
          pattern: "JSON.stringify",
          line: index + 1,
          snippet: line.trim(),
        });
      }
    }
  }

  return offenders.sort((left, right) => {
    const leftKey = `${left.path}:${left.line}:${left.pattern}`;
    const rightKey = `${right.path}:${right.line}:${right.pattern}`;
    return leftKey.localeCompare(rightKey);
  });
}

function findGrandfatheredGiantFileGrowth(
  root = workspaceRoot,
): readonly GrandfatheredGiantFileGrowth[] {
  return grandfatheredGiantFiles
    .filter((file) => existsSync(join(root, file.path)))
    .map((file) => {
      const currentLines = lineCount(file.path, root);
      return {
        path: file.path,
        currentLines,
        recordedLines: file.recordedLines,
        prerequisite: file.prerequisite,
        message: `${file.path} grandfathered giant file grew from ${file.recordedLines} to ${currentLines} lines; ${file.prerequisite}`,
      };
    })
    .filter((file) => file.currentLines > file.recordedLines);
}

function findUnrecordedGiantFiles(root = workspaceRoot): readonly GiantFile[] {
  const recordedPaths = new Set(grandfatheredGiantFiles.map((file) => file.path));
  return tsFilesUnder("src", root)
    .map((path) => ({ path, currentLines: lineCount(path, root) }))
    .filter((file) => file.currentLines > giantFileLineThreshold && !recordedPaths.has(file.path));
}

function findStaleGrandfatheredGiantFileRecords(root = workspaceRoot): readonly GiantFile[] {
  return grandfatheredGiantFiles
    .filter((file) => existsSync(join(root, file.path)))
    .map((file) => ({ path: file.path, currentLines: lineCount(file.path, root) }))
    .filter((file) => file.currentLines <= giantFileLineThreshold);
}

function sortedGrandfatheredGiantFilePaths(): string[] {
  return grandfatheredGiantFiles.map((file) => file.path).toSorted();
}

function markdownTableSourcePaths(path: string, root = workspaceRoot): readonly string[] {
  return sourceText(path, root)
    .split("\n")
    .filter((line) => line.startsWith("| `src/"))
    .map((line) => {
      const [pathCell] = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      const match = /^`([^`]+)`$/.exec(pathCell ?? "");
      return match?.[1] ?? "";
    })
    .sort();
}

function parseRemainingGiantFileSplitTickets(
  root = workspaceRoot,
): readonly RemainingGiantFileSplitTicket[] {
  return sourceText(remainingGiantFileSplitTicketsPath, root)
    .split("\n")
    .filter((line) => line.startsWith("| `src/"))
    .map((line) => {
      const [pathCell, ownerBoundary, newFiles, pureMoveTestCommand, firstBehaviorTask] = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      const path = /^`([^`]+)`$/.exec(pathCell ?? "")?.[1] ?? "";

      return {
        path,
        ownerBoundary: ownerBoundary ?? "",
        newFiles: newFiles ?? "",
        pureMoveTestCommand: pureMoveTestCommand ?? "",
        firstBehaviorTask: firstBehaviorTask ?? "",
      };
    });
}

function findDeterministicSortPolicyViolations(
  root = workspaceRoot,
): readonly DeterministicSortPolicyViolation[] {
  return tsFilesUnder("src", root)
    .filter((path) => path.endsWith("/deterministic-sort.ts"))
    .filter((path) => path !== "src/shared/deterministic-sort.ts")
    .map((path) => {
      const text = sourceText(path, root);
      return {
        path,
        currentLines: text.split("\n").length,
        hasBespokeHeader: text.includes("BESPOKE:"),
      };
    })
    .filter((file) => file.currentLines > 3 && !file.hasBespokeHeader)
    .map((file) => ({
      path: file.path,
      currentLines: file.currentLines,
      message: `${file.path} must be a <=3-line re-export or include a BESPOKE: header`,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function withTempSourceFile(path: string, source: string, callback: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "wrela-audit-"));
  const absolutePath = join(root, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, source, "utf8");
  try {
    callback(root);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

describe("subsystem maintainability audit", () => {
  test("giant-file audit reports grandfathered giant file growth with W0-05 prerequisite", () => {
    const source = `${sourceText(
      "src/target/aarch64/backend/object/layout-encode-fixed-point.ts",
    )}${"\n".repeat(10)}`;

    withTempSourceFile(
      "src/target/aarch64/backend/object/layout-encode-fixed-point.ts",
      source,
      (root) => {
        expect(findGrandfatheredGiantFileGrowth(root)).toEqual([
          {
            path: "src/target/aarch64/backend/object/layout-encode-fixed-point.ts",
            currentLines: 1008,
            recordedLines: 998,
            prerequisite: w005SplitPrerequisite,
            message:
              "src/target/aarch64/backend/object/layout-encode-fixed-point.ts grandfathered giant file grew from 998 to 1008 lines; W0-05 split prerequisite",
          },
        ]);
      },
    );
  });

  test("scar-tissue scan reports new banned production patterns with file path and pattern", () => {
    withTempSourceFile("src/proof-mir/new-ban.ts", "export const value = {} as any;\n", (root) => {
      expect(findScarTissue({ sourceRoot: root, exceptions: [] })).toEqual([
        {
          path: "src/proof-mir/new-ban.ts",
          pattern: "as any",
          line: 1,
          snippet: "export const value = {} as any;",
        },
      ]);
    });
  });

  test("proof path stringify audit reports raw stringify with path and pattern", () => {
    withTempSourceFile(
      "src/proof-mir/canonicalization/new-raw-stringify.ts",
      "export const value = JSON.stringify({ b: 1, a: 2 });\n",
      (root) => {
        expect(findProofPathRawStringifyOffenders(root)).toEqual([
          {
            path: "src/proof-mir/canonicalization/new-raw-stringify.ts",
            pattern: "JSON.stringify",
            line: 1,
            snippet: "export const value = JSON.stringify({ b: 1, a: 2 });",
          },
        ]);
      },
    );
  });

  test("deterministic-sort audit reports non-bespoke copies", () => {
    withTempSourceFile(
      "src/layout/deterministic-sort.ts",
      [
        "export function compareCodeUnitStrings(left: string, right: string): number {",
        "  if (left < right) return -1;",
        "  if (left > right) return 1;",
        "  return 0;",
        "}",
        "",
      ].join("\n"),
      (root) => {
        expect(findDeterministicSortPolicyViolations(root)).toEqual([
          {
            path: "src/layout/deterministic-sort.ts",
            currentLines: 6,
            message:
              "src/layout/deterministic-sort.ts must be a <=3-line re-export or include a BESPOKE: header",
          },
        ]);
      },
    );
  });

  test("proof MIR canonicalization and proof-check validation do not use raw stringify", () => {
    const offenders = findProofPathRawStringifyOffenders();

    expect(
      offenders,
      offenders
        .map((offender) => `${offender.path}:${offender.line} contains ${offender.pattern}`)
        .join("\n"),
    ).toEqual([]);
  });

  test("runtime source does not add scar-tissue patterns", () => {
    const findings = findScarTissue({
      sourceRoot: workspaceRoot,
      exceptions: scarTissueExceptions,
    });

    expect(
      findings,
      findings
        .map((finding) => `${finding.path}:${finding.line} contains ${finding.pattern}`)
        .join("\n"),
    ).toEqual([]);
  });

  test("grandfathered giant files do not grow before W0-05 splits", () => {
    const growth = findGrandfatheredGiantFileGrowth();

    expect(growth, growth.map((file) => file.message).join("\n")).toEqual([]);
  });

  test("giant-file audit records every current src TypeScript giant file", () => {
    const unrecordedFiles = findUnrecordedGiantFiles();

    expect(
      unrecordedFiles,
      unrecordedFiles
        .map(
          (file) =>
            `${file.path} has ${file.currentLines} lines and needs ${w005SplitPrerequisite}`,
        )
        .join("\n"),
    ).toEqual([]);
  });

  test("giant-file audit removes stale records after files shrink below threshold", () => {
    const staleFiles = findStaleGrandfatheredGiantFileRecords();

    expect(
      staleFiles,
      staleFiles
        .map((file) => `${file.path} has ${file.currentLines} lines and is no longer giant`)
        .join("\n"),
    ).toEqual([]);
  });

  test("giant-file split map documents the audited current giant-file set", () => {
    expect(markdownTableSourcePaths(giantFileSplitMapPath)).toEqual(
      sortedGrandfatheredGiantFilePaths(),
    );
  });

  test("remaining giant-file split tickets cover every audited giant file", () => {
    const tickets = parseRemainingGiantFileSplitTickets();

    expect(tickets.map((ticket) => ticket.path).toSorted()).toEqual(
      sortedGrandfatheredGiantFilePaths(),
    );

    for (const ticket of tickets) {
      expect(ticket.ownerBoundary, `${ticket.path} missing owner boundary`).not.toBe("");
      expect(ticket.newFiles, `${ticket.path} missing concrete new file path`).toContain("`src/");
      expect(
        ticket.pureMoveTestCommand.startsWith("`bun test "),
        `${ticket.path} missing pure-move test command`,
      ).toBe(true);
      expect(ticket.firstBehaviorTask, `${ticket.path} missing behavior task`).not.toBe("");
    }
  });

  test("deterministic-sort copies are tiny re-exports or documented bespoke copies", () => {
    const violations = findDeterministicSortPolicyViolations();

    expect(violations, violations.map((violation) => violation.message).join("\n")).toEqual([]);
  });

  for (const audit of subsystemAudits) {
    test(`${audit.name} runtime modules do not grow beyond line-count limits`, () => {
      const grandfatheredByPath = new Map(
        audit.grandfatheredFiles.map((file) => [file.path, file.recordedLines]),
      );

      for (const path of tsFilesUnder(audit.root)) {
        const currentLines = lineCount(path);
        const recordedLines = grandfatheredByPath.get(path);
        if (recordedLines === undefined) {
          expectLineCountAtMost({
            path,
            currentLines,
            limit: audit.lineCap,
            limitName: "cap",
          });
        } else {
          expectLineCountAtMost({
            path,
            currentLines,
            limit: recordedLines,
            limitName: "recorded",
          });
        }
      }
    });
  }
});
