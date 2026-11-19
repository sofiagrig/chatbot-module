// Detects patient identifiers in text before it reaches the database or the AI.
// Pure functions (no server imports) so they can be unit-tested with plain Node.
//
// Blocks:
//   - any run of 9+ digits (ID numbers, phone numbers, MoD referral numbers), even when the
//     digits are split by spaces or dashes ("050 - 3912349", "322-048-364");
//   - an 8-digit run that is a valid Israeli ID once padded with a leading zero
//     (IDs are often written without it).
// Prices, SKUs (5-6 digits), tooth numbers and dates stay well below that.

export type PrivacyReason = "israeli_id" | "phone" | "long_number";

/** Bumped when the privacy notice text changes; every user confirms it again. */
export const PRIVACY_NOTICE_VERSION = 1;

/**
 * Joins digit groups that are written apart but form one number: "050 - 3912349",
 * "322-048-364", "050 391 2349". Groups split by a dash are always joined; groups split by
 * spaces only when one side is short (up to 4 digits), so a list of SKUs such as
 * "29447 29448" stays two numbers.
 */
export function joinDigitGroups(text: string): string {
  const parts = text.split(/(\d+)/); // even indexes: text between numbers, odd: digit runs
  let out = parts[0];
  for (let i = 1; i < parts.length; i += 2) {
    out += parts[i];
    const sep = parts[i + 1];
    const next = parts[i + 2];
    if (sep === undefined || next === undefined || next === "") {
      if (sep !== undefined) out += sep;
      continue;
    }
    const dash = /^[ \t]*[-–—][ \t]*$/.test(sep);
    const spaces = /^[ \t]+$/.test(sep) && (parts[i].length <= 4 || next.length <= 4);
    out += dash || spaces ? "" : sep;
  }
  return out;
}

/** Israeli ID check digit (Luhn variant), for 5-9 digit numbers padded to 9. */
export function isValidIsraeliId(digits: string): boolean {
  if (!/^\d{5,9}$/.test(digits)) return false;
  const padded = digits.padStart(9, "0");
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let n = Number(padded[i]) * ((i % 2) + 1);
    if (n > 9) n -= 9;
    sum += n;
  }
  return sum % 10 === 0;
}

function isPhone(digits: string): boolean {
  // Mobile 05X-XXXXXXX, landline 0X-XXXXXXX, 07X VoIP; optional 972 country code.
  return /^(?:972|0)(?:5\d|7\d|[2-489])\d{7}$/.test(digits);
}

/** Returns why the text looks like it holds a personal identifier (empty = OK). */
export function detectIdentifiers(text: string): PrivacyReason[] {
  const reasons = new Set<PrivacyReason>();
  const runs = joinDigitGroups(text).match(/\d+/g) ?? [];
  for (const run of runs) {
    if (run.length >= 9) {
      if (isPhone(run)) reasons.add("phone");
      else if (run.length === 9 && isValidIsraeliId(run)) reasons.add("israeli_id");
      else reasons.add("long_number");
    } else if (run.length === 8 && isValidIsraeliId(run)) {
      reasons.add("israeli_id");
    }
  }
  return [...reasons];
}
