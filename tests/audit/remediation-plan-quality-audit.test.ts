import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface AuditIssue {
  readonly message: string;
}

interface TaskPacket {
  readonly id: string;
  readonly heading: string;
  readonly fields: ReadonlyMap<string, string>;
}

const planPath = join(
  import.meta.dir,
  "../../docs/implementation/2026-07-03-world-class-remediation-plan.md",
);
const assignableHeadingPattern = /^#### W[0-8]-[0-9]{2}[a-z] /;
const taskIdPattern = /^W[0-8]-[0-9]{2}[a-z]$/;
const requiredFields = ["Depends", "Files", "Do", "Test/example", "AC"] as const;

function auditRemediationPlanQuality(source: string): readonly AuditIssue[] {
  const issues: AuditIssue[] = [];
  const catalog = catalogSection(source, issues);
  const packets = parsePackets(catalog, issues);
  const taskIds = new Set(packets.map((packet) => packet.id));

  for (const packet of packets) {
    for (const field of requiredFields) {
      if (!packet.fields.has(field)) {
        issues.push({ message: `${packet.id}: missing ${field}` });
      }
    }

    auditDependencies(packet, taskIds, issues);
    auditConcreteReferences(packet, issues);
  }

  return issues;
}

function catalogSection(source: string, issues: AuditIssue[]): string {
  const startHeading = "## Authoritative subagent task catalog";
  const endHeading = "## Parent workstream context";
  const start = source.indexOf(startHeading);
  const end = source.indexOf(endHeading);

  if (start === -1) {
    issues.push({ message: "missing authoritative catalog boundary" });
    return "";
  }
  if (end === -1 || end <= start) {
    issues.push({ message: "missing parent context boundary" });
    return "";
  }

  return source.slice(start, end);
}

function parsePackets(catalog: string, issues: AuditIssue[]): readonly TaskPacket[] {
  const packets: TaskPacket[] = [];
  let current:
    | {
        readonly id: string;
        readonly heading: string;
        readonly fields: Map<string, string>;
      }
    | undefined;

  for (const line of catalog.split("\n")) {
    if (line.startsWith("#### ")) {
      if (!assignableHeadingPattern.test(line)) {
        issues.push({ message: `invalid assignable heading ${line}` });
      }
      const id = line.match(/^#### (W[0-8]-[0-9]{2}[a-z])\b/)?.[1] ?? line;
      current = { id, heading: line, fields: new Map() };
      packets.push(current);
      continue;
    }

    const field = line.match(/^- \*\*(Depends|Files|Do|Test\/example|AC):\*\* (.*)$/);
    const fieldName = field?.[1];
    const fieldValue = field?.[2];
    if (fieldName && fieldValue && current) {
      current.fields.set(fieldName, fieldValue.trim());
    }
  }

  return packets;
}

function auditDependencies(
  packet: TaskPacket,
  taskIds: ReadonlySet<string>,
  issues: AuditIssue[],
): void {
  const depends = packet.fields.get("Depends");
  if (!depends) {
    return;
  }

  const normalizedDepends = stripTerminalPunctuation(depends.trim());
  if (normalizedDepends === "none") {
    return;
  }

  for (const dependency of normalizedDepends.split(/\s*,\s*/)) {
    const normalizedDependency = stripTerminalPunctuation(dependency.trim());
    if (!taskIdPattern.test(normalizedDependency)) {
      issues.push({
        message: `${packet.id}: non-machine-checkable dependency ${normalizedDependency}`,
      });
      continue;
    }
    if (!taskIds.has(normalizedDependency)) {
      issues.push({ message: `${packet.id}: unknown dependency ${normalizedDependency}` });
    }
  }
}

function auditConcreteReferences(packet: TaskPacket, issues: AuditIssue[]): void {
  const files = packet.fields.get("Files");
  if (files && concreteReferences(files).length === 0) {
    issues.push({ message: `${packet.id}: Files has no concrete path reference` });
  }

  const testExample = packet.fields.get("Test/example");
  if (
    testExample &&
    mentionsTestCommand(testExample) &&
    concreteReferences(testExample).length === 0
  ) {
    issues.push({ message: `${packet.id}: Test/example has no concrete test reference` });
  }

  const acceptanceCriteria = packet.fields.get("AC");
  if (
    acceptanceCriteria &&
    mentionsTestCommand(acceptanceCriteria) &&
    concreteReferences(acceptanceCriteria).length === 0
  ) {
    issues.push({ message: `${packet.id}: AC has no concrete test reference` });
  }
}

function concreteReferences(source: string): readonly string[] {
  const backticked = [...source.matchAll(/`([^`]+)`/g)]
    .map((match) => match[1]?.trim() ?? "")
    .filter((value) => looksConcreteReference(value));
  if (backticked.length > 0) {
    return backticked;
  }

  return source
    .split(/[\s,;()]+/)
    .map((token) => stripTerminalPunctuation(token.trim()))
    .filter((token) => looksConcreteReference(token));
}

function looksConcreteReference(value: string): boolean {
  return (
    /^(src|tests|docs|scripts|stdlib|\.github)\//.test(value) ||
    /^[A-Za-z0-9_.-]+\.(json|ts|md|lock|wr)$/.test(value) ||
    value.includes("**/") ||
    value.includes("/*") ||
    value.includes("*.")
  );
}

function mentionsTestCommand(source: string): boolean {
  return /\bbun test\b|\btest file\b|\bfocused command\b/.test(source);
}

function stripTerminalPunctuation(value: string): string {
  return value.replace(/[.。]+$/u, "");
}

describe("remediation plan quality audit", () => {
  test("reports prose dependencies as non-machine-checkable", () => {
    const source = [
      "## Authoritative subagent task catalog",
      "",
      "#### W0-01a - Example task",
      "",
      "- **Depends:** optimizer/backend complete.",
      "- **Files:** `tests/audit/example.test.ts`.",
      "- **Do:** add the audit.",
      "- **Test/example:** `expect(result).toBe(true);`.",
      "- **AC:** `bun test tests/audit/example.test.ts` passes.",
      "",
      "## Parent workstream context",
    ].join("\n");

    expect(auditRemediationPlanQuality(source).map((issue) => issue.message)).toContain(
      "W0-01a: non-machine-checkable dependency optimizer/backend complete",
    );
  });

  test("reports parent task dependencies as non-machine-checkable", () => {
    const source = [
      "## Authoritative subagent task catalog",
      "",
      "#### W0-01a - Example task",
      "",
      "- **Depends:** none.",
      "- **Files:** `tests/audit/example.test.ts`.",
      "- **Do:** add the first audit.",
      "- **Test/example:** `expect(result).toBe(true);`.",
      "- **AC:** `bun test tests/audit/example.test.ts` passes.",
      "",
      "#### W0-01b - Example follow-up",
      "",
      "- **Depends:** W0-01.",
      "- **Files:** `tests/audit/example-follow-up.test.ts`.",
      "- **Do:** add the follow-up audit.",
      "- **Test/example:** `expect(result).toBe(true);`.",
      "- **AC:** `bun test tests/audit/example-follow-up.test.ts` passes.",
      "",
      "## Parent workstream context",
    ].join("\n");

    expect(auditRemediationPlanQuality(source).map((issue) => issue.message)).toContain(
      "W0-01b: non-machine-checkable dependency W0-01",
    );
  });

  test("the authoritative remediation-plan catalog is machine-checkable", () => {
    const source = readFileSync(planPath, "utf8");
    expect(auditRemediationPlanQuality(source)).toEqual([]);
  });
});
