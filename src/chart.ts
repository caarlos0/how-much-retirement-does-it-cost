import {
  balanceAt,
  monthlyRateFromYearly,
  monthsToTarget,
  monthsUntilDepleted,
  type Plan,
} from './finance';

const W = 600;
const H = 280;
const PAD = { l: 56, r: 16, t: 16, b: 34 };
const SAMPLES = 120;

/**
 * How far to vary the yearly real return (in percentage points) for the
 * optimistic/pessimistic band. ±2pp mirrors the common "base ± 2 points"
 * convention of simple deterministic retirement calculators (e.g. 4/6/8%).
 */
const YIELD_BAND_PP = 2;

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

interface Timeline {
  reachable: boolean;
  monthsBase: number;
  retireMonths: number;
  drawingDown: boolean;
  depleteMonths: number;
  horizon: number;
}

/**
 * Shared time axis for both charts: when the target is reached, when retirement
 * drawdown starts, and how far out to project — so the two charts always span the
 * same duration.
 */
function timeline(plan: Plan, withdrawal: number): Timeline {
  const monthsBase = monthsToTarget(plan.savings, plan);
  const reachable = Number.isFinite(monthsBase) && monthsBase > 0;
  const retireMonths = reachable ? monthsBase : Infinity;
  const drawingDown = reachable && withdrawal > 0;
  const depleteMonths = drawingDown
    ? monthsUntilDepleted(plan.target, plan.monthlyRate, withdrawal)
    : Infinity;

  let horizon: number;
  if (!reachable) {
    horizon = 480;
  } else if (drawingDown) {
    const window = Number.isFinite(depleteMonths) ? Math.min(depleteMonths + 24, 480) : 360;
    horizon = Math.ceil(retireMonths + window);
  } else {
    horizon = Math.ceil(retireMonths);
  }
  return { reachable, monthsBase, retireMonths, drawingDown, depleteMonths, horizon };
}

/**
 * Balance at month m: accumulate toward the target, then (once past retirement)
 * draw the withdrawal down each month, never below zero.
 */
function phasedBalance(
  m: number,
  plan: Plan,
  withdrawal: number,
  retireMonths: number,
  drawingDown: boolean,
): number {
  if (!drawingDown || m <= retireMonths) return balanceAt(m, plan);
  const atRetire = balanceAt(retireMonths, plan);
  return Math.max(0, balanceAt(m - retireMonths, { ...plan, savings: atRetire, monthly: -withdrawal }));
}

/**
 * Render an inline SVG chart of the plan into `container`: savings grow toward the
 * target (with a shaded band spanning a ±YIELD_BAND_PP yearly-return range), then —
 * once the target is reached — the retirement withdrawal is drawn down against the
 * yield. Hovering reveals the projected values at that point in time.
 */
export function renderChart(
  container: HTMLElement,
  opts: {
    plan: Plan;
    currency: string;
    age: number | null;
    yieldPct: number;
    withdrawal: number;
    purchase: number;
  },
): void {
  const { plan, currency, age, yieldPct, withdrawal, purchase } = opts;
  if (plan.target <= 0) {
    container.innerHTML = `<p class="cap">Set a retirement target to see your projected growth.</p>`;
    return;
  }

  const lowRate = monthlyRateFromYearly(yieldPct - YIELD_BAND_PP);
  const highRate = monthlyRateFromYearly(yieldPct + YIELD_BAND_PP);

  const { monthsBase, reachable, retireMonths, drawingDown, depleteMonths, horizon } = timeline(
    plan,
    withdrawal,
  );

  const balanceOf = (m: number, rate: number, savings: number = plan.savings): number =>
    phasedBalance(m, { ...plan, savings, monthlyRate: rate }, withdrawal, retireMonths, drawingDown);

  const xs = Array.from({ length: SAMPLES + 1 }, (_, i) => (horizon * i) / SAMPLES);
  const baseVals = xs.map((m) => balanceOf(m, plan.monthlyRate));
  const lowVals = xs.map((m) => balanceOf(m, lowRate));
  const highVals = xs.map((m) => balanceOf(m, highRate));

  // "If you invest it instead": the plan with the purchase money kept invested.
  // It crosses the target sooner but retires on the same date, so the extra money
  // keeps compounding and the gap to your plan grows over time (its true cost).
  const investHitsTarget =
    reachable && purchase > 0 ? monthsToTarget(plan.savings + purchase, plan) : Infinity;
  const showInvest = Number.isFinite(investHitsTarget) && investHitsTarget > 0;
  const investVals = showInvest
    ? xs.map((m) => balanceOf(m, plan.monthlyRate, plan.savings + purchase))
    : [];

  const yMax = Math.max(plan.target, ...highVals, ...baseVals, ...lowVals, ...investVals) * 1.06;
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const xOf = (m: number) => PAD.l + (m / horizon) * plotW;
  const yOf = (v: number) => PAD.t + plotH - (v / yMax) * plotH;

  const yBottom = yOf(0);
  const yTarget = yOf(plan.target);
  const xEnd = xOf(horizon);

  const pt = (m: number, v: number) => `${xOf(m).toFixed(1)},${yOf(v).toFixed(1)}`;
  const line = (vs: number[]) => xs.map((m, i) => pt(m, vs[i])).join(' ');
  const bandPoints = [
    ...xs.map((m, i) => pt(m, highVals[i])),
    ...xs.map((m, i) => pt(m, lowVals[i])).reverse(),
  ].join(' ');

  const xLabel = (m: number) =>
    age != null ? String(Math.round(age + m / 12)) : `${Math.round(m / 12)}y`;

  const retireLine = drawingDown
    ? `<line class="chart-retire" x1="${xOf(retireMonths).toFixed(1)}" y1="${PAD.t}" x2="${xOf(retireMonths).toFixed(1)}" y2="${yBottom.toFixed(1)}" />` +
      `<text class="chart-marker-label" x="${xOf(retireMonths).toFixed(1)}" y="${(PAD.t - 5).toFixed(1)}">retire</text>`
    : '';

  const investLine = showInvest
    ? `<polyline class="chart-line-invest" points="${line(investVals)}" />`
    : '';
  const investDot = showInvest
    ? `<circle class="chart-dot-invest" cx="${xOf(investHitsTarget).toFixed(1)}" cy="${yTarget.toFixed(1)}" r="4" />`
    : '';

  const parts = [
    `<line class="chart-axis" x1="${PAD.l}" y1="${PAD.t}" x2="${PAD.l}" y2="${yBottom.toFixed(1)}" />`,
    `<line class="chart-axis" x1="${PAD.l}" y1="${yBottom.toFixed(1)}" x2="${xEnd.toFixed(1)}" y2="${yBottom.toFixed(1)}" />`,
    `<polygon class="chart-band" points="${bandPoints}" />`,
    retireLine,
    `<line class="chart-target" x1="${PAD.l}" y1="${yTarget.toFixed(1)}" x2="${xEnd.toFixed(1)}" y2="${yTarget.toFixed(1)}" />`,
    `<text class="chart-ylabel" x="${PAD.l - 6}" y="${yTarget.toFixed(1)}">${compactMoney(plan.target, currency)}</text>`,
    `<text class="chart-ylabel" x="${PAD.l - 6}" y="${yBottom.toFixed(1)}">0</text>`,
    `<polyline class="chart-line-edge" points="${line(lowVals)}" />`,
    `<polyline class="chart-line-edge" points="${line(highVals)}" />`,
    `<polyline class="chart-line-base" points="${line(baseVals)}" />`,
    investLine,
  ];

  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    const m = horizon * f;
    parts.push(
      `<text class="chart-xlabel" x="${xOf(m).toFixed(1)}" y="${(yBottom + 18).toFixed(1)}">${xLabel(m)}</text>`,
    );
  }

  if (reachable) {
    parts.push(`<circle class="chart-dot-base" cx="${xOf(monthsBase).toFixed(1)}" cy="${yTarget.toFixed(1)}" r="4" />`);
  }
  if (investDot) {
    parts.push(investDot);
  }
  if (drawingDown && Number.isFinite(depleteMonths) && retireMonths + depleteMonths <= horizon) {
    parts.push(
      `<circle class="chart-dot-depleted" cx="${xOf(retireMonths + depleteMonths).toFixed(1)}" cy="${yBottom.toFixed(1)}" r="4" />`,
    );
  }

  const investHoverDot = showInvest
    ? `<circle class="chart-hover-dot chart-hover-invest" r="4" />`
    : '';
  parts.push(
    `<g class="chart-hover" style="display:none">` +
      `<line class="chart-cursor" x1="0" x2="0" y1="${PAD.t}" y2="${yBottom.toFixed(1)}" />` +
      `<circle class="chart-hover-dot chart-hover-edge chart-hover-low" r="3" />` +
      `<circle class="chart-hover-dot chart-hover-edge chart-hover-high" r="3" />` +
      investHoverDot +
      `<circle class="chart-hover-dot chart-hover-base" r="4" />` +
      `</g>`,
    `<rect class="chart-capture" x="${PAD.l}" y="${PAD.t}" width="${plotW.toFixed(1)}" height="${plotH.toFixed(1)}" />`,
  );

  const svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Projected savings over time: growth toward the target, then retirement drawdown, with a range for higher and lower returns">${parts.join('')}</svg>`;

  const investKey = showInvest
    ? `<span class="chart-key"><span class="chart-sw chart-sw-invest"></span>If you invest it</span>`
    : '';
  const legend = `<div class="chart-legend">
    <span class="chart-key"><span class="chart-sw chart-sw-base"></span>Your plan</span>
    ${investKey}
    <span class="chart-key"><span class="chart-sw chart-sw-band"></span>Range (±${YIELD_BAND_PP}%/yr)</span>
    <span class="chart-key"><span class="chart-sw chart-sw-target"></span>Target</span>
  </div>`;

  container.innerHTML = `${svg}${legend}<div class="chart-tooltip" hidden></div>`;

  const svgEl = container.querySelector<SVGSVGElement>('.chart');
  const hover = container.querySelector<SVGGElement>('.chart-hover');
  const cursor = container.querySelector<SVGLineElement>('.chart-cursor');
  const tip = container.querySelector<HTMLDivElement>('.chart-tooltip');
  const dotLow = container.querySelector<SVGCircleElement>('.chart-hover-low');
  const dotHigh = container.querySelector<SVGCircleElement>('.chart-hover-high');
  const dotBase = container.querySelector<SVGCircleElement>('.chart-hover-base');
  const dotInvest = container.querySelector<SVGCircleElement>('.chart-hover-invest');
  if (!svgEl || !hover || !cursor || !tip || !dotLow || !dotHigh || !dotBase) return;

  const setDot = (el: SVGCircleElement, cx: number, v: number) => {
    el.setAttribute('cx', cx.toFixed(1));
    el.setAttribute('cy', yOf(v).toFixed(1));
  };

  svgEl.addEventListener('pointermove', (ev) => {
    const rect = svgEl.getBoundingClientRect();
    if (rect.width === 0) return;
    const scale = W / rect.width;
    const svgX = Math.max(PAD.l, Math.min(xEnd, (ev.clientX - rect.left) * scale));
    const i = Math.max(0, Math.min(SAMPLES, Math.round(((svgX - PAD.l) / plotW) * SAMPLES)));
    const cx = xOf(xs[i]);

    cursor.setAttribute('x1', cx.toFixed(1));
    cursor.setAttribute('x2', cx.toFixed(1));
    setDot(dotBase, cx, baseVals[i]);
    setDot(dotLow, cx, lowVals[i]);
    setDot(dotHigh, cx, highVals[i]);
    if (dotInvest) setDot(dotInvest, cx, investVals[i]);
    hover.style.display = '';

    const when = age != null ? `Age ${Math.round(age + xs[i] / 12)}` : `Year ${Math.round(xs[i] / 12)}`;
    const investRow = showInvest
      ? `<div class="chart-tt-row"><span class="chart-sw chart-sw-invest"></span>If you invest it<span class="chart-tt-val">${compactMoney(investVals[i], currency)}</span></div>`
      : '';
    tip.innerHTML =
      `<div class="chart-tt-when">${when}</div>` +
      `<div class="chart-tt-row"><span class="chart-sw chart-sw-base"></span>Your plan<span class="chart-tt-val">${compactMoney(baseVals[i], currency)}</span></div>` +
      investRow +
      `<div class="chart-tt-row"><span class="chart-sw chart-sw-band"></span>Range<span class="chart-tt-val">${compactMoney(lowVals[i], currency)} – ${compactMoney(highVals[i], currency)}</span></div>`;
    tip.hidden = false;

    const px = cx / scale;
    const py = yOf(baseVals[i]) / scale;
    const rightHalf = cx > (PAD.l + xEnd) / 2;
    tip.style.left = `${px.toFixed(1)}px`;
    tip.style.top = `${py.toFixed(1)}px`;
    tip.style.transform = `translate(${rightHalf ? 'calc(-100% - 14px)' : '14px'}, -50%)`;
  });

  svgEl.addEventListener('pointerleave', () => {
    hover.style.display = 'none';
    tip.hidden = true;
  });
}

/**
 * Render a stacked bar chart (one bar per year) into `container`, splitting each
 * year's balance into the money you put in and the investment yield on top —
 * over the same horizon as {@link renderChart}.
 */
export function renderContributionsChart(
  container: HTMLElement,
  opts: { plan: Plan; currency: string; age: number | null; withdrawal: number },
): void {
  const { plan, currency, age, withdrawal } = opts;
  if (plan.target <= 0) {
    container.innerHTML = `<p class="cap">Set a retirement target to see the breakdown.</p>`;
    return;
  }

  const { reachable, retireMonths, drawingDown, horizon } = timeline(plan, withdrawal);
  if (!reachable) {
    container.innerHTML = `<p class="cap">This plan never reaches the target — adjust it to see the breakdown.</p>`;
    return;
  }

  const years = Math.max(1, Math.round(horizon / 12));
  const bars = Array.from({ length: years + 1 }, (_, y) => {
    const m = Math.min(y * 12, horizon);
    const balance = phasedBalance(m, plan, withdrawal, retireMonths, drawingDown);
    const contributed = plan.savings + plan.monthly * Math.min(m, retireMonths);
    return {
      m,
      balance,
      putIn: Math.min(contributed, balance),
      yieldPart: Math.max(0, balance - contributed),
    };
  });

  const yMax = Math.max(plan.target, ...bars.map((b) => b.balance)) * 1.06;
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const yBottom = PAD.t + plotH;
  const yOf = (v: number) => PAD.t + plotH - (v / yMax) * plotH;
  const slot = plotW / bars.length;
  const barW = Math.max(1.5, slot * 0.68);
  const xOf = (i: number) => PAD.l + slot * (i + 0.5);
  const xLabel = (m: number) =>
    age != null ? String(Math.round(age + m / 12)) : `${Math.round(m / 12)}y`;

  const parts: string[] = [
    `<line class="chart-axis" x1="${PAD.l}" y1="${PAD.t}" x2="${PAD.l}" y2="${yBottom.toFixed(1)}" />`,
    `<line class="chart-axis" x1="${PAD.l}" y1="${yBottom.toFixed(1)}" x2="${(PAD.l + plotW).toFixed(1)}" y2="${yBottom.toFixed(1)}" />`,
    `<line class="chart-target" x1="${PAD.l}" y1="${yOf(plan.target).toFixed(1)}" x2="${(PAD.l + plotW).toFixed(1)}" y2="${yOf(plan.target).toFixed(1)}" />`,
    `<text class="chart-ylabel" x="${(PAD.l - 6).toFixed(1)}" y="${yOf(plan.target).toFixed(1)}">${compactMoney(plan.target, currency)}</text>`,
    `<text class="chart-ylabel" x="${(PAD.l - 6).toFixed(1)}" y="${yBottom.toFixed(1)}">0</text>`,
  ];

  bars.forEach((b, i) => {
    const x = (xOf(i) - barW / 2).toFixed(1);
    const yPut = yOf(b.putIn);
    const yTop = yOf(b.putIn + b.yieldPart);
    parts.push(
      `<rect class="bar-putin" x="${x}" y="${yPut.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, yBottom - yPut).toFixed(1)}" />`,
    );
    if (b.yieldPart > 0) {
      parts.push(
        `<rect class="bar-yield" x="${x}" y="${yTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, yPut - yTop).toFixed(1)}" />`,
      );
    }
  });

  const nLabels = Math.min(bars.length, 5);
  for (let k = 0; k < nLabels; k++) {
    const i = Math.round((k / (nLabels - 1)) * (bars.length - 1));
    parts.push(
      `<text class="chart-xlabel" x="${xOf(i).toFixed(1)}" y="${(yBottom + 18).toFixed(1)}">${xLabel(bars[i].m)}</text>`,
    );
  }

  parts.push(
    `<rect class="bar-hover" x="0" y="${PAD.t}" width="${slot.toFixed(1)}" height="${plotH.toFixed(1)}" style="display:none" />`,
    `<rect class="chart-capture" x="${PAD.l}" y="${PAD.t}" width="${plotW.toFixed(1)}" height="${plotH.toFixed(1)}" />`,
  );

  const svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Money you put in versus investment yield each year">${parts.join('')}</svg>`;
  const legend = `<div class="chart-legend">
    <span class="chart-key"><span class="chart-sw chart-sw-putin"></span>Money you put in</span>
    <span class="chart-key"><span class="chart-sw chart-sw-yield"></span>Yield</span>
    <span class="chart-key"><span class="chart-sw chart-sw-target"></span>Target</span>
  </div>`;

  container.innerHTML = `${svg}${legend}<div class="chart-tooltip" hidden></div>`;

  const svgEl = container.querySelector<SVGSVGElement>('.chart');
  const highlight = container.querySelector<SVGRectElement>('.bar-hover');
  const tip = container.querySelector<HTMLDivElement>('.chart-tooltip');
  if (!svgEl || !highlight || !tip) return;

  svgEl.addEventListener('pointermove', (ev) => {
    const rect = svgEl.getBoundingClientRect();
    if (rect.width === 0) return;
    const scale = W / rect.width;
    const svgX = (ev.clientX - rect.left) * scale;
    const i = Math.max(0, Math.min(bars.length - 1, Math.floor((svgX - PAD.l) / slot)));
    const b = bars[i];

    highlight.setAttribute('x', (PAD.l + slot * i).toFixed(1));
    highlight.style.display = '';

    const when = age != null ? `Age ${Math.round(age + b.m / 12)}` : `Year ${Math.round(b.m / 12)}`;
    tip.innerHTML =
      `<div class="chart-tt-when">${when}</div>` +
      `<div class="chart-tt-row"><span class="chart-sw chart-sw-putin"></span>Put in<span class="chart-tt-val">${compactMoney(b.putIn, currency)}</span></div>` +
      `<div class="chart-tt-row"><span class="chart-sw chart-sw-yield"></span>Yield<span class="chart-tt-val">${compactMoney(b.yieldPart, currency)}</span></div>` +
      `<div class="chart-tt-row"><span class="chart-sw" style="visibility:hidden"></span>Total<span class="chart-tt-val">${compactMoney(b.balance, currency)}</span></div>`;
    tip.hidden = false;

    const cx = xOf(i) / scale;
    const py = yOf(b.balance) / scale;
    const rightHalf = xOf(i) > PAD.l + plotW / 2;
    tip.style.left = `${cx.toFixed(1)}px`;
    tip.style.top = `${py.toFixed(1)}px`;
    tip.style.transform = `translate(${rightHalf ? 'calc(-100% - 12px)' : '12px'}, -50%)`;
  });

  svgEl.addEventListener('pointerleave', () => {
    highlight.style.display = 'none';
    tip.hidden = true;
  });
}
