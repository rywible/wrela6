import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

export type ReproducibilityCommandEvidence = {
  readonly command: readonly string[];
  readonly exitCode: number;
  readonly stdoutSha256: string;
  readonly stderrSha256: string;
};

export type ReproducibilityOutputDigest = {
  readonly caseKey: string;
  readonly artifactName: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly targetMetadataSha256: string;
};

export type ReproducibilitySourceInputDigest = {
  readonly caseKey: string;
  readonly sourceKey: string;
  readonly moduleName: string;
  readonly sourceRootKey: string;
  readonly sourceRootKind: string;
  readonly byteLength: number;
  readonly sha256: string;
};

export type ReproducibilityValidationReportDigest = {
  readonly caseKey: string;
  readonly reportName: string;
  readonly passLabel: string;
  readonly status: "passed" | "failed";
  readonly byteLength: number;
  readonly sha256: string;
};

export type ReproducibilityManifest = {
  readonly schema: "wrela.reproducibility-manifest";
  readonly schemaVersion: 1;
  readonly source: {
    readonly gitCommit: string;
    readonly dirty: boolean;
    readonly lockSha256: string;
  };
  readonly platform: Readonly<Record<"arch" | "os", string>>;
  readonly tools: Record<string, string>;
  readonly commands: readonly ReproducibilityCommandEvidence[];
  readonly sourceInputs: readonly ReproducibilitySourceInputDigest[];
  readonly outputs: readonly ReproducibilityOutputDigest[];
  readonly validationReports: readonly ReproducibilityValidationReportDigest[];
  readonly validationEvidence: Record<string, unknown>;
};

export function buildReproducibilityManifest(input: {
  readonly gitCommit: string;
  readonly dirty: boolean;
  readonly lockSha256: string;
  readonly platform: {
    readonly architecture: string;
    readonly operatingSystem: string;
  };
  readonly tools: Record<string, string>;
  readonly commands: readonly ReproducibilityCommandEvidence[];
  readonly sourceInputs: readonly ReproducibilitySourceInputDigest[];
  readonly outputs: readonly ReproducibilityOutputDigest[];
  readonly validationReports: readonly ReproducibilityValidationReportDigest[];
  readonly validationEvidence: Record<string, unknown>;
}): string {
  return `${stableJson({
    schema: "wrela.reproducibility-manifest",
    schemaVersion: 1,
    source: {
      gitCommit: input.gitCommit,
      dirty: input.dirty,
      lockSha256: input.lockSha256,
    },
    platform: {
      arch: input.platform.architecture,
      os: input.platform.operatingSystem,
    },
    tools: sortStringRecord(input.tools),
    commands: input.commands.map((command) => ({
      command: [...command.command],
      exitCode: command.exitCode,
      stderrSha256: command.stderrSha256,
      stdoutSha256: command.stdoutSha256,
    })),
    sourceInputs: [...input.sourceInputs]
      .sort((left, right) => compareSourceInputDigest(left, right))
      .map((sourceInput) => ({
        byteLength: sourceInput.byteLength,
        caseKey: sourceInput.caseKey,
        moduleName: sourceInput.moduleName,
        sha256: sourceInput.sha256,
        sourceKey: sourceInput.sourceKey,
        sourceRootKey: sourceInput.sourceRootKey,
        sourceRootKind: sourceInput.sourceRootKind,
      })),
    outputs: [...input.outputs]
      .sort((left, right) => compareOutputDigest(left, right))
      .map((output) => ({
        artifactName: output.artifactName,
        byteLength: output.byteLength,
        caseKey: output.caseKey,
        sha256: output.sha256,
        targetMetadataSha256: output.targetMetadataSha256,
      })),
    validationReports: [...input.validationReports]
      .sort((left, right) => compareValidationReportDigest(left, right))
      .map((report) => ({
        byteLength: report.byteLength,
        caseKey: report.caseKey,
        passLabel: report.passLabel,
        reportName: report.reportName,
        sha256: report.sha256,
        status: report.status,
      })),
    validationEvidence: sortRecord(input.validationEvidence),
  } satisfies ReproducibilityManifest)}\n`;
}

export function sha256Bytes(bytes: ArrayBufferView | string): string {
  return createHash("sha256")
    .update(bytes instanceof Uint8Array ? bytes : String(bytes))
    .digest("hex");
}

export function lockfileSha256(path = "bun.lock"): string {
  if (!existsSync(path)) return "missing";
  return sha256Bytes(readFileSync(path));
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortUnknown(value), null, 2);
}

function sortUnknown(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortUnknown);
  if (value !== null && typeof value === "object") {
    return sortRecord(value as Record<string, unknown>);
  }
  return value;
}

function sortRecord(record: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) result[key] = sortUnknown(record[key]);
  return result;
}

function sortStringRecord(record: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of Object.keys(record).sort()) result[key] = record[key] ?? "";
  return result;
}

function compareOutputDigest(
  left: ReproducibilityOutputDigest,
  right: ReproducibilityOutputDigest,
): number {
  return (
    left.caseKey.localeCompare(right.caseKey) || left.artifactName.localeCompare(right.artifactName)
  );
}

function compareSourceInputDigest(
  left: ReproducibilitySourceInputDigest,
  right: ReproducibilitySourceInputDigest,
): number {
  return (
    left.caseKey.localeCompare(right.caseKey) ||
    left.sourceRootKey.localeCompare(right.sourceRootKey) ||
    left.sourceKey.localeCompare(right.sourceKey) ||
    left.moduleName.localeCompare(right.moduleName)
  );
}

function compareValidationReportDigest(
  left: ReproducibilityValidationReportDigest,
  right: ReproducibilityValidationReportDigest,
): number {
  return (
    left.caseKey.localeCompare(right.caseKey) ||
    left.reportName.localeCompare(right.reportName) ||
    left.passLabel.localeCompare(right.passLabel)
  );
}
