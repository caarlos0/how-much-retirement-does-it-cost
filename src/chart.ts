import { balanceAt, monthsToTarget, type Plan } from './finance';

const W = 600;
const H = 280;
const PAD = { l: 56, r: 16, t: 16, b: 34 };
const SAMPLES = 120;

function compactMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    return String(Math.round(value));
  }
}

/** Inline SVG line chart of projected savings growth over time toward the target. */
export function progressionChart(opts: {
  plan: Plan;
  currency: string;
  age: number | null;
}): string {
  const { plan, currency, age } = opts;
  if (plan.target <= 0) {
    return `<p class="cap">Set a retirement target to see your projected growth.</p>`;
  }

  const monthsBase = monthsToTarget(plan.savings, plan);
  const reachable = Number.isFinite(monthsBase) && monthsBase > 0;
  const horizon = reachable ? Math.ceil(monthsBase) : 480;

  const xs = Array.from({ length: SAMPLES + 1 }, (_, i) => (horizon * i) / SAMPLES);
  const vals = xs.map((m) => balanceAt(m, plan));

  const yMax = Math.max(plan.target, ...vals) * 1.06;
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const xOf = (m: number) => PAD.l + (m / horizon) * plotW;
  const yOf = (v: number) => PAD.t + plotH - (v / yMax) * plotH;

  const yBottom = yOf(0);
  const yTarget = yOf(plan.target);
  const xEnd = xOf(horizon);

  const points = xs.map((m, i) => `${xOf(m).toFixed(1)},${yOf(vals[i]).toFixed(1)}`).join(' ');

  const xLabel = (m: number) =>
    age != null ? String(Math.round(age + m / 12)) : `${Math.round(m / 12)}y`;

  const parts = [
    `<line class="chart-axis" x1="${PAD.l}" y1="${PAD.t}" x2="${PAD.l}" y2="${yBottom.toFixed(1)}" />`,
    `<line class="chart-axis" x1="${PAD.l}" y1="${yBottom.toFixed(1)}" x2="${xEnd.toFixed(1)}" y2="${yBottom.toFixed(1)}" />`,
    `<line class="chart-target" x1="${PAD.l}" y1="${yTarget.toFixed(1)}" x2="${xEnd.toFixed(1)}" y2="${yTarget.toFixed(1)}" />`,
    `<text class="chart-ylabel" x="${PAD.l - 6}" y="${yTarget.toFixed(1)}">${compactMoney(plan.target, currency)}</text>`,
    `<text class="chart-ylabel" x="${PAD.l - 6}" y="${yBottom.toFixed(1)}">0</text>`,
  ];

  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    const m = horizon * f;
    parts.push(
      `<text class="chart-xlabel" x="${xOf(m).toFixed(1)}" y="${(yBottom + 18).toFixed(1)}">${xLabel(m)}</text>`,
    );
  }

  parts.push(`<polyline class="chart-line-base" points="${points}" />`);
  if (reachable) {
    parts.push(`<circle class="chart-dot-base" cx="${xOf(monthsBase).toFixed(1)}" cy="${yTarget.toFixed(1)}" r="4" />`);
  }

  const svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Projected savings growth over time">${parts.join('')}</svg>`;

  const legend = `<div class="chart-legend">
    <span class="chart-key"><span class="chart-sw chart-sw-base"></span>Your plan</span>
    <span class="chart-key"><span class="chart-sw chart-sw-target"></span>Target</span>
  </div>`;

  return svg + legend;
}
