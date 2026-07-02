export const UEFI_STATUS_GOLDEN = Object.freeze({
  success: 0x0000000000000000n,
  loadError: 0x8000000000000001n,
  invalidParameter: 0x8000000000000002n,
  unsupported: 0x8000000000000003n,
  badBufferSize: 0x8000000000000004n,
  bufferTooSmall: 0x8000000000000005n,
  deviceError: 0x8000000000000007n,
  notFound: 0x800000000000000en,
  aborted: 0x8000000000000015n,
  securityViolation: 0x800000000000001an,
});
