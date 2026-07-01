import './style.css';
import { CURRENCIES } from './currencies';
import { futureValue, monthsToTarget, type Plan } from './finance';
import { progressionChart } from './chart';

const STORAGE_KEY = 'retirement-calc:v2';
const LEGACY_KEY = 'retirement-calc:v1';

/** Yearly yield % to the equivalent monthly compounding rate (decimal). */
const monthlyRateFromYearly = (yearlyPct: number) => Math.pow(1 + yearlyPct / 100, 1 / 12) - 1;

/** Monthly yield % (v1 storage) to the equivalent yearly yield %. */
const yearlyPctFromMonthly = (monthlyPct: number) => (Math.pow(1 + monthlyPct / 100, 12) - 1) * 100;

interface Settings {
  age: number | null;
  savings: number | null;
  currency: string;
  monthly: number | null;
  yield: number | null;
  target: number | null;
}

const DEFAULTS: Settings = {
  age: 30,
  savings: 10000,
  currency: 'USD',
  monthly: 1000,
  yield: 5,
  target: 1_000_000,
};

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const els = {
  age: byId<HTMLInputElement>('age'),
  savings: byId<HTMLInputElement>('savings'),
  currency: byId<HTMLSelectElement>('currency'),
  monthly: byId<HTMLInputElement>('monthly'),
  yield: byId<HTMLInputElement>('yield'),
  target: byId<HTMLInputElement>('target'),
  price: byId<HTMLInputElement>('price'),
  baseline: byId<HTMLParagraphElement>('baseline'),
  impact: byId<HTMLDivElement>('impact'),
  chart: byId<HTMLDivElement>('chart'),
};

for (const { code, name } of CURRENCIES) {
  els.currency.add(new Option(`${code} — ${name}`, code));
}

function numVal(el: HTMLInputElement): number | null {
  const v = el.value.trim();
  if (v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function readSettings(): Settings {
  return {
    age: numVal(els.age),
    savings: numVal(els.savings),
    currency: els.currency.value || 'USD',
    monthly: numVal(els.monthly),
    yield: numVal(els.yield),
    target: numVal(els.target),
  };
}

function applySettings(s: Settings): void {
  const str = (v: number | null) => (v == null ? '' : String(v));
  els.age.value = str(s.age);
  els.savings.value = str(s.savings);
  els.currency.value = s.currency || 'USD';
  els.monthly.value = str(s.monthly);
  els.yield.value = str(s.yield);
  els.target.value = str(s.target);
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };

    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const old = { ...DEFAULTS, ...(JSON.parse(legacy) as Partial<Settings>) };
      // v1 stored the yield as a monthly %; v2 stores it yearly.
      if (old.yield != null) old.yield = Math.round(yearlyPctFromMonthly(old.yield) * 100) / 100;
      return old;
    }
    return { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(s: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore storage errors (private mode, quota, etc.) */
  }
}

function money(value: number, currency: string, digits = 0): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(digits)}`;
  }
}

function humanDuration(months: number): string {
  if (!Number.isFinite(months)) return 'never';
  if (months <= 0) return '—';
  if (months < 1) {
    const days = Math.max(1, Math.round(months * 30.4375));
    return `${days} day${days === 1 ? '' : 's'}`;
  }
  let years = Math.floor(months / 12);
  let rest = Math.round(months - years * 12);
  if (rest === 12) {
    years += 1;
    rest = 0;
  }
  const parts: string[] = [];
  if (years) parts.push(`${years} yr${years === 1 ? '' : 's'}`);
  if (rest) parts.push(`${rest} mo${rest === 1 ? '' : 's'}`);
  return parts.join(' ') || '—';
}

function render(): void {
  const s = readSettings();
  save(s);

  const currency = s.currency || 'USD';
  const rate = monthlyRateFromYearly(s.yield ?? 0);
  const plan: Plan = {
    savings: s.savings ?? 0,
    monthly: s.monthly ?? 0,
    monthlyRate: rate,
    target: s.target ?? 0,
  };
  const targetMoney = money(plan.target, currency);

  const hasTarget = plan.target > 0;
  const monthsBase = hasTarget ? monthsToTarget(plan.savings, plan) : NaN;
  const reachable = Number.isFinite(monthsBase) && monthsBase > 0;
  const retireAge = s.age != null ? Math.round(s.age + monthsBase / 12) : null;

  if (!hasTarget) {
    els.baseline.textContent = 'Set a retirement target to see your projection.';
  } else if (monthsBase <= 0) {
    els.baseline.textContent = `You have already reached ${targetMoney}. 🎉`;
  } else if (!Number.isFinite(monthsBase)) {
    els.baseline.textContent = `With these numbers you never reach ${targetMoney}. Try a higher monthly investment or yield.`;
  } else {
    const agePart = retireAge != null ? ` — around age ${retireAge}` : '';
    els.baseline.textContent = `On track to reach ${targetMoney} in ${humanDuration(monthsBase)}${agePart}.`;
  }

  const price = numVal(els.price);
  els.chart.innerHTML = progressionChart({ plan, currency, age: s.age });

  if (price == null || price <= 0) {
    els.impact.innerHTML = `<p class="cap">Enter a price above to see what it really costs you.</p>`;
    return;
  }

  if (!hasTarget || monthsBase <= 0) {
    els.impact.innerHTML = `
      <div class="big small">Enjoy it — you're already set. 🎉</div>
      <p class="cap">Spending ${money(price, currency)} won't set back a retirement you've already funded.</p>`;
    return;
  }

  if (!reachable) {
    els.impact.innerHTML = `<p class="cap">Adjust your plan above so the target is reachable to see the impact.</p>`;
    return;
  }

  const fv = futureValue(price, rate, monthsBase);
  const multiple = fv / price;
  const monthsIfInvested = monthsToTarget(plan.savings + price, plan);
  const delay = Math.max(
    0,
    monthsBase - (Number.isFinite(monthsIfInvested) ? monthsIfInvested : monthsBase),
  );
  const delayText = humanDuration(delay);
  const agePart = retireAge != null ? ` (around age ${retireAge})` : '';

  els.impact.innerHTML = `
    <div class="cap">That ${money(price, currency)} could grow to</div>
    <div class="big">${money(fv, currency)}</div>
    <div class="cap">by the time you retire${agePart}.</div>
    <div class="chips">
      <span class="chip">⏳ Delays retirement by <span class="v">${delayText}</span></span>
      <span class="chip">📈 <span class="v">${multiple.toFixed(1)}×</span> your money</span>
    </div>
    <p class="note">Buying it today is like working about ${delayText} longer before you can retire.</p>`;
}

applySettings(load());
for (const el of [els.age, els.savings, els.monthly, els.yield, els.target, els.price]) {
  el.addEventListener('input', render);
}
els.currency.addEventListener('change', render);
render();
