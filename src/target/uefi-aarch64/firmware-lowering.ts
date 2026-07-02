import type {
  AArch64FirmwareArgumentRule,
  AArch64FirmwarePlatformCallContext,
  AArch64FirmwarePlatformCallLowering,
  AArch64FirmwareResultRule,
  AArch64FirmwareTableFieldLayout,
} from "../aarch64/lower/firmware-platform-call-contract";
import type {
  UefiAArch64PlatformPrimitiveLowering,
  UefiFirmwareArgumentRule,
  UefiFirmwareLoweringRule,
  UefiFirmwareResultRule,
} from "./platform-catalog";
import type { UefiAArch64FirmwareTableSurface, UefiFirmwareTablePath } from "./firmware-tables";
import { lookupUefiFirmwareTableField } from "./firmware-tables";

export function uefiAArch64FirmwarePlatformCallContext(input: {
  readonly firmwareTables: UefiAArch64FirmwareTableSurface;
  readonly platformLowerings: readonly UefiAArch64PlatformPrimitiveLowering[];
}): AArch64FirmwarePlatformCallContext {
  const byPrimitive = new Map<string, AArch64FirmwarePlatformCallLowering>();
  for (const lowering of input.platformLowerings) {
    const adapted = uefiLoweringRuleToAArch64FirmwarePlatformCallLowering({
      primitiveId: String(lowering.primitiveId),
      rule: lowering.lowering,
      firmwareTables: input.firmwareTables,
    });
    if (adapted !== undefined) {
      byPrimitive.set(String(lowering.primitiveId), adapted);
    }
  }
  return Object.freeze({
    loweringFor: (platformPrimitiveId: string) => byPrimitive.get(platformPrimitiveId),
  });
}

export function uefiLoweringRuleToAArch64FirmwarePlatformCallLowering(input: {
  readonly primitiveId: string;
  readonly rule: UefiFirmwareLoweringRule;
  readonly firmwareTables: UefiAArch64FirmwareTableSurface;
}): AArch64FirmwarePlatformCallLowering | undefined {
  switch (input.rule.kind) {
    case "firmware-call": {
      const tableField = firmwareTableFieldLayout(input.firmwareTables, input.rule.tablePath);
      if (tableField === undefined) return undefined;
      return Object.freeze({
        kind: "firmware-call" as const,
        primitiveId: input.primitiveId,
        tablePointerField: tablePointerFieldLayout(input.firmwareTables, input.rule.tablePath),
        tableField,
        argumentRules: Object.freeze([
          ...(input.rule.tablePath.kind === "simple-text-output"
            ? [{ kind: "table-pointer" as const }]
            : []),
          ...input.rule.arguments.map(argumentRuleToAArch64),
        ]),
        resultRule: resultRuleToAArch64(input.rule.result),
      });
    }
    case "compiler-runtime-helper":
      return Object.freeze({
        kind: "compiler-runtime-helper" as const,
        primitiveId: input.primitiveId,
        helperLinkageName: input.rule.helperLinkageName,
        argumentRules: Object.freeze(input.rule.arguments.map(argumentRuleToAArch64)),
        resultRule: resultRuleToAArch64(input.rule.result),
      });
    case "inline":
      return undefined;
  }
}

function firmwareTableFieldLayout(
  firmwareTables: UefiAArch64FirmwareTableSurface,
  path: UefiFirmwareTablePath,
): AArch64FirmwareTableFieldLayout | undefined {
  const record = lookupUefiFirmwareTableField(firmwareTables, path);
  if (record === undefined || record.valueKind !== "functionPointer") return undefined;
  return Object.freeze({
    base: firmwareTableBaseForPath(path),
    fieldKey: record.fieldKey,
    offsetBytes: record.offsetBytes,
    widthBytes: 8 as const,
  });
}

function tablePointerFieldLayout(
  firmwareTables: UefiAArch64FirmwareTableSurface,
  path: UefiFirmwareTablePath,
): AArch64FirmwareTableFieldLayout | undefined {
  if (path.kind === "simple-text-output") {
    const record = lookupUefiFirmwareTableField(firmwareTables, {
      kind: "system-table",
      field: "con-out",
    });
    return record === undefined
      ? undefined
      : Object.freeze({
          base: "uefi-system-table" as const,
          fieldKey: record.fieldKey,
          offsetBytes: record.offsetBytes,
          widthBytes: 8 as const,
        });
  }
  if (path.kind === "boot-services") {
    const record = lookupUefiFirmwareTableField(firmwareTables, {
      kind: "system-table",
      field: "boot-services",
    });
    return record === undefined
      ? undefined
      : Object.freeze({
          base: "uefi-system-table" as const,
          fieldKey: record.fieldKey,
          offsetBytes: record.offsetBytes,
          widthBytes: 8 as const,
        });
  }
  if (path.kind === "runtime-services") {
    const record = lookupUefiFirmwareTableField(firmwareTables, {
      kind: "system-table",
      field: "runtime-services",
    });
    return record === undefined
      ? undefined
      : Object.freeze({
          base: "uefi-system-table" as const,
          fieldKey: record.fieldKey,
          offsetBytes: record.offsetBytes,
          widthBytes: 8 as const,
        });
  }
  return undefined;
}

function firmwareTableBaseForPath(
  path: UefiFirmwareTablePath,
): AArch64FirmwareTableFieldLayout["base"] {
  switch (path.kind) {
    case "system-table":
      return "uefi-system-table";
    case "simple-text-output":
      return "uefi-simple-text-output";
    case "boot-services":
      return "uefi-boot-services";
    case "runtime-services":
      return "uefi-runtime-services";
    case "protocol":
      return "uefi-boot-services";
  }
}

function argumentRuleToAArch64(rule: UefiFirmwareArgumentRule): AArch64FirmwareArgumentRule {
  switch (rule.kind) {
    case "source-argument":
      return Object.freeze({
        kind: "source-argument" as const,
        index: rule.index,
        ...(rule.pointerRequirement === undefined
          ? {}
          : { pointerRequirement: Object.freeze({ ...rule.pointerRequirement }) }),
      });
    case "image-handle":
      return Object.freeze({ kind: "image-handle" as const });
    case "system-table":
      return Object.freeze({ kind: "system-table" as const });
    case "table-pointer":
      return Object.freeze({ kind: "table-pointer" as const });
    case "constant-u64":
      return Object.freeze({ kind: "constant-u64" as const, value: rule.value });
    case "static-char16-pointer":
      return Object.freeze({
        kind: "static-char16-pointer" as const,
        pointer: Object.freeze({ ...rule.pointer }),
      });
  }
}

function resultRuleToAArch64(rule: UefiFirmwareResultRule): AArch64FirmwareResultRule {
  return Object.freeze({ ...rule }) as AArch64FirmwareResultRule;
}
