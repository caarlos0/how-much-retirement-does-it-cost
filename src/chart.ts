import { balanceAt, monthlyRateFromYearly, monthsToTarget, type Plan } from './finance';

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
 * Render an inline SVG chart of projected savings growth into `container`: the
 * plan's central curve plus a shaded band spanning a ±YIELD_BAND_PP yearly-return
 * range. Hovering reveals the projected values at that point in time.
 */
export function renderChart(
  container: HTMLElement,
  opts: { plan: Plan; currency: string; age: number | null; yieldPct: number },
): void {
  const { plan, currency, age, yieldPct } = opts;
  if (plan.target <= 0) {
    container.innerHTML = `<p class="cap">Set a retirement target to see your projected growth.</p>`;
    return;
  }

  const monthsBase = monthsToTarget(plan.savings, plan);
  const reachable = Number.isFinite(monthsBase) && monthsBase > 0;
  const horizon = reachable ? Math.ceil(monthsBase) : 480;

  const lowPlan: Plan = { ...plan, monthlyRate: monthlyRateFromYearly(yieldPct - YIELD_BAND_PP) };
  const highPlan: Plan = { ...plan, monthlyRate: monthlyRateFromYearly(yieldPct + YIELD_BAND_PP) };

  const xs = Array.from({ length: SAMPLES + 1 }, (_, i) => (horizon * i) / SAMPLES);
  const baseVals = xs.map((m) => balanceAt(m, plan));
  const lowVals = xs.map((m) => balanceAt(m, lowPlan));
  const highVals = xs.map((m) => balanceAt(m, highPlan));

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

  const parts = [
    `<line class="chart-axis" x1="${PAD.l}" y1="${PAD.t}" x2="${PAD.l}" y2="${yBottom.toFixed(1)}" />`,
    `<line class="chart-axis" x1="${PAD.l}" y1="${yBottom.toFixed(1)}" x2="${xEnd.toFixed(1)}" y2="${yBottom.toFixed(1)}" />`,
    `<polygon class="chart-band" points="${bandPoints}" />`,
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

  parts.push(
    `<g class="chart-hover" style="display:none">` +
      `<line class="chart-cursor" x1="0" x2="0" y1="${PAD.t}" y2="${yBottom.toFixed(1)}" />` +
      `<circle class="chart-hover-dot chart-hover-edge" r="3" />` +
      `<circle class="chart-hover-dot chart-hover-edge" r="3" />` +
      `<circle class="chart-hover-dot chart-hover-base" r="4" />` +
      `</g>`,
    `<rect class="chart-capture" x="${PAD.l}" y="${PAD.t}" width="${plotW.toFixed(1)}" height="${plotH.toFixed(1)}" />`,
  );

  const svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Projected savings growth over time, with a range for higher and lower returns">${parts.join('')}</svg>`;

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
