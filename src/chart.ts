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
  },
): void {
  const { plan, currency, age, yieldPct, withdrawal } = opts;
  if (plan.target <= 0) {
    container.innerHTML = `<p class="cap">Set a retirement target to see your projected growth.</p>`;
    return;
  }

  const lowRate = monthlyRateFromYearly(yieldPct - YIELD_BAND_PP);
  const highRate = monthlyRateFromYearly(yieldPct + YIELD_BAND_PP);

  const monthsBase = monthsToTarget(plan.savings, plan);
  const reachable = Number.isFinite(monthsBase) && monthsBase > 0;
  const retireMonths = reachable ? monthsBase : Infinity;
  const drawingDown = reachable && withdrawal > 0;

  // Months from retirement until the central plan's balance is exhausted.
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

  // Balance at month m for a given monthly rate: accumulate toward the target,
  // then (once retired) draw the withdrawal down each month, never below zero.
  const balanceOf = (m: number, rate: number): number => {
    if (!drawingDown || m <= retireMonths) {
      return balanceAt(m, { ...plan, monthlyRate: rate });
    }
    const atRetire = balanceAt(retireMonths, { ...plan, monthlyRate: rate });
    const drawn = balanceAt(m - retireMonths, {
      ...plan,
      savings: atRetire,
      monthly: -withdrawal,
      monthlyRate: rate,
    });
    return Math.max(0, drawn);
  };

  const xs = Array.from({ length: SAMPLES + 1 }, (_, i) => (horizon * i) / SAMPLES);
  const baseVals = xs.map((m) => balanceOf(m, plan.monthlyRate));
  const lowVals = xs.map((m) => balanceOf(m, lowRate));
  const highVals = xs.map((m) => balanceOf(m, highRate));

  const yMax = Math.max(plan.target, ...highVals, ...baseVals, ...lowVals) * 1.06;
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
  if (drawingDown && Number.isFinite(depleteMonths) && retireMonths + depleteMonths <= horizon) {
    parts.push(
      `<circle class="chart-dot-depleted" cx="${xOf(retireMonths + depleteMonths).toFixed(1)}" cy="${yBottom.toFixed(1)}" r="4" />`,
    );
  }

  parts.push(
    `<g class="chart-hover" style="display:none">` +
      `<line class="chart-cursor" x1="0" x2="0" y1="${PAD.t}" y2="${yBottom.toFixed(1)}" />` +
      `<circle class="chart-hover-dot chart-hover-edge" r="3" />` +
      `<circle class="chart-hover-dot chart-hover-edge" r="3" />` +
      `<circle class="chart-hover-dot chart-hover-base" r="4" />` +
      `</g>`,
    `<rect class="chart-capture" x="${PAD.l}" y="${PAD.t}" width="${plotW.toFixed(1)}" height="${plotH.toFixed(1)}" />`,
  );

  const svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Projected savings over time: growth toward the target, then retirement drawdown, with a range for higher and lower returns">${parts.join('')}</svg>`;

  const legend = `<div class="chart-legend">
    <span class="chart-key"><span class="chart-sw chart-sw-base"></span>Your plan</span>
    <span class="chart-key"><span class="chart-sw chart-sw-band"></span>Range (±${YIELD_BAND_PP}%/yr)</span>
    <span class="chart-key"><span class="chart-sw chart-sw-target"></span>Target</span>
  </div>`;

  container.innerHTML = `${svg}${legend}<div class="chart-tooltip" hidden></div>`;

  const svgEl = container.querySelector<SVGSVGElement>('.chart');
  const hover = container.querySelector<SVGGElement>('.chart-hover');
  const cursor = container.querySelector<SVGLineElement>('.chart-cursor');
  const tip = container.querySelector<HTMLDivElement>('.chart-tooltip');
  const dots = container.querySelectorAll<SVGCircleElement>('.chart-hover-dot');
  if (!svgEl || !hover || !cursor || !tip || dots.length < 3) return;
  const [dotLow, dotHigh, dotBase] = dots;

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
    hover.style.display = '';

    const when = age != null ? `Age ${Math.round(age + xs[i] / 12)}` : `Year ${Math.round(xs[i] / 12)}`;
    tip.innerHTML =
      `<div class="chart-tt-when">${when}</div>` +
      `<div class="chart-tt-row"><span class="chart-sw chart-sw-base"></span>${compactMoney(baseVals[i], currency)}</div>` +
      `<div class="chart-tt-range">${compactMoney(lowVals[i], currency)} – ${compactMoney(highVals[i], currency)}</div>`;
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
