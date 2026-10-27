import { randomBytes, randomInt } from 'node:crypto';

const REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Human readable booking reference, e.g. `AG-7K3M9Q`. */
export function generateBookingReference(): string {
  return `AG-${randomCode(6)}`;
}

/** Support ticket reference, e.g. `SUP-482913`. */
export function generateTicketReference(): string {
  return `SUP-${randomDigits(6)}`;
}

/** Invoice number, e.g. `INV-2026-000123` is built from the sequence in `InvoicesService`. */
export function generateInvoiceNumber(year: number, sequence: number): string {
  return `INV-${year}-${String(sequence).padStart(6, '0')}`;
}

export function generateOtpCode(digits = 6): string {
  let code = '';
  for (let index = 0; index < digits; index += 1) code += String(randomInt(0, 10));
  return code;
}

export function randomToken(bytes = 48): string {
  return randomBytes(bytes).toString('base64url');
}

export function randomCode(length: number): string {
  let out = '';
  for (let index = 0; index < length; index += 1) {
    out += REFERENCE_ALPHABET[randomInt(0, REFERENCE_ALPHABET.length)];
  }
  return out;
}

function randomDigits(length: number): string {
  let out = '';
  for (let index = 0; index < length; index += 1) out += String(randomInt(0, 10));
  return out;
}

/** Normalises an Indian mobile number to the `+91XXXXXXXXXX` form used as the user key. */
export function normalisePhone(input: string): string {
  const digits = input.replace(/[^\d]/g, '');
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  return `+91${local}`;
}

/** Masks a bank account for display: keeps the final four digits only. */
export function maskAccountNumber(accountNumber: string): string {
  const digits = accountNumber.replace(/\s+/g, '');
  if (digits.length <= 4) return `••••${digits}`;
  return `••••${digits.slice(-4)}`;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
