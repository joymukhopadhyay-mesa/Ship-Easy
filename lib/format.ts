// Display formatting only (no business logic).

export function fmtNum(n: number | null | undefined, maxDp = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-GB", { maximumFractionDigits: maxDp });
}

/** "£5,400" or "£5,400.50" */
export function gbp(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const whole = Math.abs(n - Math.round(n)) < 1e-9;
  return "£" + n.toLocaleString("en-GB", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
}

/** "GBP 5,400" (used in the change log, as the spec writes it) */
export function gbpText(n: number | null | undefined): string {
  return gbp(n).replace("£", "GBP ");
}

export function kg(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${fmtNum(n, 2)} kg`;
}

export const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
export const round3 = (x: number) => Math.round((x + Number.EPSILON) * 1000) / 1000;
export const isInt = (x: number) => Number.isFinite(x) && Math.abs(x - Math.round(x)) < 1e-9;
export const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
