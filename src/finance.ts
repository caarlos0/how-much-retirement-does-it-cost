export interface Plan {
  /** Current amount already saved. */
  savings: number;
  /** Amount contributed every month. */
  monthly: number;
  /** Real monthly yield as a decimal (e.g. 0.004 for 0.4%/month after inflation). */
  monthlyRate: number;
  /** Amount the user wants to have when they retire. */
  target: number;
}

/**
 * Number of months needed to grow from `start` up to `plan.target`, given the
 * plan's monthly contribution and real monthly yield.
 *
 * Returns 0 if the target is already met, or Infinity if it is never reached.
 *
 * The balance after n months is:
 *   FV(n) = (start + M/r) · (1 + r)^n − M/r
 * Solving FV(n) = target for n gives the closed form below. The r === 0 case is
 * handled separately since the formula divides by r.
 */
export function monthsToTarget(start: number, plan: Plan): number {
  const { monthly: M, monthlyRate: r, target: T } = plan;
  if (start >= T) return 0;
  if (r === 0) return M > 0 ? (T - start) / M : Infinity;

  const denom = start + M / r;
  const numer = T + M / r;
  if (denom === 0) return Infinity; // balance is frozen below the target — never reached

  const ratio = numer / denom;
  if (ratio <= 0) return Infinity;

  const n = Math.log(ratio) / Math.log(1 + r);
  return n > 0 && Number.isFinite(n) ? n : Infinity;
}

/** Value of `present` money after `months` of compounding at `monthlyRate`. */
export function futureValue(present: number, monthlyRate: number, months: number): number {
  return present * Math.pow(1 + monthlyRate, months);
}

/** Account balance after `months`, from the plan's savings, contributions and rate. */
export function balanceAt(months: number, plan: Plan): number {
  const { savings: S, monthly: M, monthlyRate: r } = plan;
  if (r === 0) return S + M * months;
  return (S + M / r) * Math.pow(1 + r, months) - M / r;
}

/** Yearly yield % to the equivalent monthly compounding rate (decimal). */
export const monthlyRateFromYearly = (yearlyPct: number) => Math.pow(1 + yearlyPct / 100, 1 / 12) - 1;

/** Monthly yield % to the equivalent yearly yield % (used to migrate old data). */
export const yearlyPctFromMonthly = (monthlyPct: number) => (Math.pow(1 + monthlyPct / 100, 12) - 1) * 100;

/**
 * Monthly contribution needed to grow from `start` up to `plan.target` in exactly
 * `months`, at the plan's rate. This is the inverse of {@link monthsToTarget}:
 * solving FV(months) = target for the contribution M.
 */
export function requiredMonthly(start: number, months: number, plan: Plan): number {
  const { monthlyRate: r, target: T } = plan;
  if (months <= 0) return Infinity;
  if (r === 0) return (T - start) / months;
  const g = Math.pow(1 + r, months);
  return (r * (T - start * g)) / (g - 1);
}
