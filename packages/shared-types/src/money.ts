/**
 * Money helpers.
 *
 * Every monetary value in the system is an integer number of minor units
 * (paise for INR). Never use floating point arithmetic for money: all helpers
 * here operate on integers and round explicitly.
 */

export interface CurrencyFormat {
  readonly symbol: string;
  readonly locale: string;
  /** Minor units per major unit - 100 for INR. */
  readonly minorPerMajor: number;
}

export const INR: CurrencyFormat = { symbol: '₹', locale: 'en-IN', minorPerMajor: 100 };

export function toMinorUnits(majorUnits: number, currency: CurrencyFormat = INR): number {
  return Math.round(majorUnits * currency.minorPerMajor);
}

export function toMajorUnits(minorUnits: number, currency: CurrencyFormat = INR): number {
  return minorUnits / currency.minorPerMajor;
}

/**
 * Formats minor units for display: 129900 -> "₹1,299".
 * Sub-rupee precision is only shown when the amount actually has paise, which
 * keeps the common cases clean.
 */
export function formatMoney(
  minorUnits: number,
  currency: CurrencyFormat = INR,
  options: { showDecimals?: boolean } = {},
): string {
  const major = toMajorUnits(minorUnits, currency);
  const showDecimals = options.showDecimals ?? minorUnits % currency.minorPerMajor !== 0;
  const formatted = major.toLocaleString(currency.locale, {
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  });
  return `${currency.symbol}${formatted}`;
}

/** Percentage of an integer minor-unit amount, rounded half-up to whole paise. */
export function percentOf(minorUnits: number, percent: number): number {
  return Math.round((minorUnits * percent) / 100);
}

export function sumMinorUnits(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function clampNonNegative(value: number): number {
  return value < 0 ? 0 : value;
}
