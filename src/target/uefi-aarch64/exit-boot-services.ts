export interface UefiAArch64ExitBootServicesPolicy {
  readonly initialDescriptorSlackBytes: number;
  readonly maxBufferTooSmallRetries: number;
  readonly maxInvalidParameterRetries: number;
}

export interface UefiAArch64ExitBootServicesSuccess {
  readonly bootServicesAuthority: "consumed";
  readonly finalMapKey: bigint;
  readonly descriptorSize: number;
  readonly descriptorVersion: number;
}

export function canonicalUefiAArch64ExitBootServicesPolicy(
  overrides: Partial<UefiAArch64ExitBootServicesPolicy> = {},
): UefiAArch64ExitBootServicesPolicy {
  return Object.freeze({
    initialDescriptorSlackBytes: 2 * 48,
    maxBufferTooSmallRetries: 2,
    maxInvalidParameterRetries: 1,
    ...overrides,
  });
}
