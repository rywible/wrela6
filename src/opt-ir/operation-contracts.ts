export const OPT_IR_CONTRACT_STABLE_KEY: unique symbol = Symbol("optIrContractStableKey");

export type OptIrContractValue =
  | string
  | number
  | boolean
  | bigint
  | null
  | readonly OptIrContractValue[]
  | { readonly [key: string]: OptIrContractValue };

export type OptIrContractPayload = Readonly<Record<string, OptIrContractValue>>;

export type OptIrCanonicalContract = OptIrContractPayload & {
  readonly [OPT_IR_CONTRACT_STABLE_KEY]: string;
};

export type OptIrSemanticContract = OptIrCanonicalContract;
export type OptIrNumericContract = OptIrCanonicalContract;

export function optIrCanonicalContract(
  input: Readonly<Record<string, unknown>>,
  label: string,
): OptIrCanonicalContract {
  const canonical = canonicalizeContractValue(input, label, "$", new Set<object>());
  if (!isRecord(canonical.value)) {
    throw new RangeError(`${label} contract must be an object.`);
  }
  const payload = { ...canonical.value };
  Object.defineProperty(payload, OPT_IR_CONTRACT_STABLE_KEY, {
    enumerable: false,
    configurable: false,
    writable: false,
    value: canonical.key,
  });
  return Object.freeze(payload) as OptIrCanonicalContract;
}

export function optIrContractStableKey(contract: Readonly<Record<string, unknown>>): string {
  const candidate = contract as Partial<Record<typeof OPT_IR_CONTRACT_STABLE_KEY, string>>;
  if (typeof candidate[OPT_IR_CONTRACT_STABLE_KEY] === "string") {
    return candidate[OPT_IR_CONTRACT_STABLE_KEY];
  }
  return canonicalizeContractValue(contract, "OptIR", "$", new Set<object>()).key;
}

function canonicalizeContractValue(
  value: unknown,
  label: string,
  path: string,
  seen: Set<object>,
): { readonly value: unknown; readonly key: string } {
  switch (typeof value) {
    case "string":
      return { value, key: `string:${JSON.stringify(value)}` };
    case "number":
      if (!Number.isFinite(value)) {
        throw new RangeError(`${label} contract contains non-finite number at ${path}.`);
      }
      return { value, key: Object.is(value, -0) ? "number:-0" : `number:${value}` };
    case "boolean":
      return { value, key: `boolean:${value}` };
    case "bigint":
      return { value, key: `bigint:${value}` };
    case "undefined":
      throw new RangeError(`${label} contract contains unsupported undefined at ${path}.`);
    case "function":
    case "symbol":
      throw new RangeError(`${label} contract contains unsupported ${typeof value} at ${path}.`);
    case "object":
      if (value === null) {
        return { value: null, key: "null" };
      }
      return Array.isArray(value)
        ? canonicalizeContractArray(value, label, path, seen)
        : canonicalizeContractRecord(value, label, path, seen);
  }
}

function canonicalizeContractArray(
  value: readonly unknown[],
  label: string,
  path: string,
  seen: Set<object>,
): { readonly value: readonly unknown[]; readonly key: string } {
  if (seen.has(value)) {
    throw new RangeError(`${label} contract contains a cycle at ${path}.`);
  }
  seen.add(value);
  const entries = value.map((entry, index) =>
    canonicalizeContractValue(entry, label, `${path}[${index}]`, seen),
  );
  seen.delete(value);
  return {
    value: Object.freeze(entries.map((entry) => entry.value)),
    key: `array:[${entries.map((entry) => entry.key).join(",")}]`,
  };
}

function canonicalizeContractRecord(
  value: object,
  label: string,
  path: string,
  seen: Set<object>,
): { readonly value: Readonly<Record<string, unknown>>; readonly key: string } {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new RangeError(`${label} contract contains non-plain object at ${path}.`);
  }
  if (seen.has(value)) {
    throw new RangeError(`${label} contract contains a cycle at ${path}.`);
  }
  seen.add(value);
  const output: Record<string, unknown> = {};
  const keyParts: string[] = [];
  for (const key of Object.keys(value).sort()) {
    const entry = canonicalizeContractValue(
      (value as Readonly<Record<string, unknown>>)[key],
      label,
      `${path}.${key}`,
      seen,
    );
    output[key] = entry.value;
    keyParts.push(`${JSON.stringify(key)}:${entry.key}`);
  }
  seen.delete(value);
  return {
    value: Object.freeze(output),
    key: `object:{${keyParts.join(",")}}`,
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
