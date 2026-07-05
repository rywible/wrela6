function digitsForRadix(radix: 2 | 10 | 16): string {
  switch (radix) {
    case 2:
      return "[01]";
    case 10:
      return "[0-9]";
    case 16:
      return "[0-9a-fA-F]";
  }
}

function isCanonicalDigits(text: string, radix: 2 | 10 | 16): boolean {
  const digit = digitsForRadix(radix);
  return new RegExp(`^${digit}(?:_?${digit})*$`).test(text);
}

export function parseWrIntegerLiteral(text: string): bigint | undefined {
  let radix: 2 | 10 | 16 = 10;
  let digits = text;

  if (text.startsWith("0x") || text.startsWith("0X")) {
    radix = 16;
    digits = text.slice(2);
  } else if (text.startsWith("0b") || text.startsWith("0B")) {
    radix = 2;
    digits = text.slice(2);
  }

  if (!isCanonicalDigits(digits, radix)) {
    return undefined;
  }

  const normalized = digits.replaceAll("_", "");
  switch (radix) {
    case 2:
      return BigInt(`0b${normalized}`);
    case 10:
      return BigInt(normalized);
    case 16:
      return BigInt(`0x${normalized}`);
  }
}
