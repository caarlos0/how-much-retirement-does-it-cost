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
  if (denom === 0) return -M / r >= T ? 0 : Infinity;

  const ratio = numer / denom;
  if (ratio <= 0) return Infinity;

  const n = Math.log(ratio) / Math.log(1 + r);
  return n > 0 && Number.isFinite(n) ? n : Infinity;
}

/** Value of `present` money after `months` of compounding at `monthlyRate`. */
export function futureValue(present: number, monthlyRate: number, months: number): number {
  return present * Math.pow(1 + monthlyRate, months);
}
