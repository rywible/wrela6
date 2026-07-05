export type WrelaCliEmitStage =
  | "tokens"
  | "ast"
  | "hir"
  | "proof-mir"
  | "opt-ir"
  | "asm"
  | "object"
  | "image";

export type WrelaCliStdlibMode = "toolchain" | "ejected" | "direct-platform" | "none";

export type WrelaCliArguments =
  | {
      readonly kind: "build";
      readonly directory: string;
      readonly target: "uefi-aarch64-rpi5";
      readonly out?: string;
      readonly emit: WrelaCliEmitStage;
      readonly stdlibMode?: WrelaCliStdlibMode;
      readonly json: boolean;
    }
  | {
      readonly kind: "check";
      readonly directory: string;
      readonly stdlibMode?: WrelaCliStdlibMode;
      readonly json: boolean;
    }
  | {
      readonly kind: "validate";
      readonly json: boolean;
    }
  | {
      readonly kind: "run";
      readonly directory: string;
      readonly qemu: true;
      readonly stdlibMode?: WrelaCliStdlibMode;
      readonly json: boolean;
    }
  | {
      readonly kind: "init";
      readonly directory: string;
      readonly target: "uefi-aarch64";
      readonly json: boolean;
    }
  | {
      readonly kind: "usage-error";
      readonly json: boolean;
      readonly stableDetail: string;
    };

const EMIT_STAGES = new Set<WrelaCliEmitStage>([
  "tokens",
  "ast",
  "hir",
  "proof-mir",
  "opt-ir",
  "asm",
  "object",
  "image",
]);

const STDLIB_MODES = new Set<WrelaCliStdlibMode>([
  "toolchain",
  "ejected",
  "direct-platform",
  "none",
]);

export function parseWrelaCliArguments(args: readonly string[]): WrelaCliArguments {
  const command = args[0];
  const json = args.includes("--json");
  if (command === undefined) return usageError(json, "cli:missing-command");
  if (command === "build") return parseBuild(args.slice(1), json);
  if (command === "check") return parseCheck(args.slice(1), json);
  if (command === "validate") return parseValidate(args.slice(1), json);
  if (command === "run") return parseRun(args.slice(1), json);
  if (command === "init") return parseInit(args.slice(1), json);
  return usageError(json, `cli:unknown-command:${command}`);
}

function parseBuild(args: readonly string[], json: boolean): WrelaCliArguments {
  const directory = args[0];
  if (directory === undefined || directory.startsWith("--")) {
    return usageError(json, "cli:build:missing-directory");
  }
  let target = "uefi-aarch64-rpi5" as const;
  let out: string | undefined;
  let emit: WrelaCliEmitStage = "image";
  let stdlibMode: WrelaCliStdlibMode | undefined;

  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") continue;
    if (arg === "--target") {
      const result = requiredOptionValue(args, index, "--target");
      if (result.kind === "error") return usageError(json, result.stableDetail);
      if (result.value !== "uefi-aarch64-rpi5") {
        return usageError(json, `cli:invalid-target:${result.value}`);
      }
      target = result.value;
      index += 1;
      continue;
    }
    if (arg === "--out") {
      const result = requiredOptionValue(args, index, "--out");
      if (result.kind === "error") return usageError(json, result.stableDetail);
      out = result.value;
      index += 1;
      continue;
    }
    if (arg === "--emit") {
      const result = requiredOptionValue(args, index, "--emit");
      if (result.kind === "error") return usageError(json, result.stableDetail);
      if (!EMIT_STAGES.has(result.value as WrelaCliEmitStage)) {
        return usageError(json, `cli:invalid-emit:${result.value}`);
      }
      emit = result.value as WrelaCliEmitStage;
      index += 1;
      continue;
    }
    if (arg === "--stdlib") {
      const result = requiredOptionValue(args, index, "--stdlib");
      if (result.kind === "error") return usageError(json, result.stableDetail);
      if (!STDLIB_MODES.has(result.value as WrelaCliStdlibMode)) {
        return usageError(json, `cli:invalid-stdlib:${result.value}`);
      }
      stdlibMode = result.value as WrelaCliStdlibMode;
      index += 1;
      continue;
    }
    return usageError(json, `cli:unknown-argument:${arg}`);
  }

  return {
    kind: "build",
    directory,
    target,
    ...(out === undefined ? {} : { out }),
    emit,
    ...(stdlibMode === undefined ? {} : { stdlibMode }),
    json,
  };
}

function parseCheck(args: readonly string[], json: boolean): WrelaCliArguments {
  const directory = args[0];
  if (directory === undefined || directory.startsWith("--")) {
    return usageError(json, "cli:check:missing-directory");
  }
  let stdlibMode: WrelaCliStdlibMode | undefined;
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") continue;
    if (arg === "--stdlib") {
      const result = requiredOptionValue(args, index, "--stdlib");
      if (result.kind === "error") return usageError(json, result.stableDetail);
      if (!STDLIB_MODES.has(result.value as WrelaCliStdlibMode)) {
        return usageError(json, `cli:invalid-stdlib:${result.value}`);
      }
      stdlibMode = result.value as WrelaCliStdlibMode;
      index += 1;
      continue;
    }
    return usageError(json, `cli:unknown-argument:${arg}`);
  }
  return { kind: "check", directory, ...(stdlibMode === undefined ? {} : { stdlibMode }), json };
}

function parseValidate(args: readonly string[], json: boolean): WrelaCliArguments {
  for (const arg of args) {
    if (arg !== "--json") return usageError(json, `cli:unknown-argument:${arg}`);
  }
  return { kind: "validate", json };
}

function parseRun(args: readonly string[], json: boolean): WrelaCliArguments {
  const directory = args[0];
  if (directory === undefined || directory.startsWith("--")) {
    return usageError(json, "cli:run:missing-directory");
  }
  let qemu = false;
  let stdlibMode: WrelaCliStdlibMode | undefined;
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") continue;
    if (arg === "--qemu") {
      qemu = true;
      continue;
    }
    if (arg === "--stdlib") {
      const result = requiredOptionValue(args, index, "--stdlib");
      if (result.kind === "error") return usageError(json, result.stableDetail);
      if (!STDLIB_MODES.has(result.value as WrelaCliStdlibMode)) {
        return usageError(json, `cli:invalid-stdlib:${result.value}`);
      }
      stdlibMode = result.value as WrelaCliStdlibMode;
      index += 1;
      continue;
    }
    return usageError(json, `cli:unknown-argument:${arg}`);
  }
  if (!qemu) return usageError(json, "cli:run:missing-qemu");
  return {
    kind: "run",
    directory,
    qemu: true,
    ...(stdlibMode === undefined ? {} : { stdlibMode }),
    json,
  };
}

function parseInit(args: readonly string[], json: boolean): WrelaCliArguments {
  let target: "uefi-aarch64" | undefined;
  let directory = ".";
  let directorySeen = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) continue;
    if (arg === "--json") continue;
    if (arg === "--target") {
      const result = requiredOptionValue(args, index, "--target");
      if (result.kind === "error") return usageError(json, result.stableDetail);
      if (result.value !== "uefi-aarch64") {
        return usageError(json, `cli:invalid-init-target:${result.value}`);
      }
      target = result.value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) return usageError(json, `cli:unknown-argument:${arg}`);
    if (directorySeen) return usageError(json, "cli:init:too-many-directories");
    directory = arg;
    directorySeen = true;
  }
  if (target === undefined) return usageError(json, "cli:init:missing-target");
  return { kind: "init", directory, target, json };
}

function requiredOptionValue(
  args: readonly string[],
  index: number,
  option: string,
):
  | { readonly kind: "ok"; readonly value: string }
  | { readonly kind: "error"; readonly stableDetail: string } {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    return { kind: "error", stableDetail: `cli:missing-value:${option}` };
  }
  return { kind: "ok", value };
}

function usageError(json: boolean, stableDetail: string): WrelaCliArguments {
  return { kind: "usage-error", json, stableDetail };
}
