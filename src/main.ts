import './style.css';
import { CURRENCIES } from './currencies';
import {
  futureValue,
  monthlyRateFromYearly,
  monthsToTarget,
  monthsUntilDepleted,
  requiredMonthly,
  yearlyPctFromMonthly,
  type Plan,
} from './finance';
import { renderChart, renderContributionsChart } from './chart';

const STORAGE_KEY = 'retirement-calc:v2';
const LEGACY_KEY = 'retirement-calc:v1';

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** ISO birth date for someone `years` old today (used for the default and migration). */
function birthDateForAge(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - Math.round(years));
  return isoDate(d);
}

/** Current age in fractional years from an ISO birth date, or null if unset/invalid. */
function ageFromBirthDate(birthDate: string | null): number | null {
  if (!birthDate) return null;
  const ms = Date.now() - new Date(birthDate).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return ms / (365.2425 * 24 * 60 * 60 * 1000);
}

interface Settings {
  birthDate: string | null;
  savings: number | null;
  currency: string;
  monthly: number | null;
  yield: number | null;
  target: number | null;
  withdrawal: number | null;
}

const DEFAULTS: Settings = {
  birthDate: birthDateForAge(30),
  savings: 10000,
  currency: 'USD',
  monthly: 1000,
  yield: 5,
  target: 1_000_000,
  withdrawal: 4000,
};

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const els = {
  birthDate: byId<HTMLInputElement>('birthdate'),
  savings: byId<HTMLInputElement>('savings'),
  currency: byId<HTMLSelectElement>('currency'),
  monthly: byId<HTMLInputElement>('monthly'),
  yield: byId<HTMLInputElement>('yield'),
  target: byId<HTMLInputElement>('target'),
  withdrawal: byId<HTMLInputElement>('withdrawal'),
  price: byId<HTMLInputElement>('price'),
  baseline: byId<HTMLParagraphElement>('baseline'),
  fasterCard: byId<HTMLElement>('faster-card'),
  faster: byId<HTMLDivElement>('faster'),
  impact: byId<HTMLDivElement>('impact'),
  chart: byId<HTMLDivElement>('chart'),
  contribChart: byId<HTMLDivElement>('contrib-chart'),
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
    birthDate: els.birthDate.value || null,
    savings: numVal(els.savings),
    currency: els.currency.value || 'USD',
    monthly: numVal(els.monthly),
    yield: numVal(els.yield),
    target: numVal(els.target),
    withdrawal: numVal(els.withdrawal),
  };
}

function applySettings(s: Settings): void {
  const str = (v: number | null) => (v == null ? '' : String(v));
  els.birthDate.value = s.birthDate ?? '';
  els.savings.value = str(s.savings);
  els.currency.value = s.currency || 'USD';
  els.monthly.value = str(s.monthly);
  els.yield.value = str(s.yield);
  els.target.value = str(s.target);
  els.withdrawal.value = str(s.withdrawal);
}

/** Merge stored settings over the defaults, deriving a birth date from a legacy age. */
function withBirthDate(stored: Partial<Settings> & { age?: number }): Settings {
  const merged = { ...DEFAULTS, ...stored };
  if (stored.birthDate == null && stored.age != null) {
    merged.birthDate = birthDateForAge(stored.age);
  }
  return merged;
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return withBirthDate(JSON.parse(raw));

    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const old = JSON.parse(legacy) as Partial<Settings> & { age?: number };
      // v1 stored the yield as a monthly %; v2 stores it yearly.
      if (old.yield != null) old.yield = Math.round(yearlyPctFromMonthly(old.yield) * 100) / 100;
      return withBirthDate(old);
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

/** "Years sooner" options to suggest, smallest to largest. */
const FASTER_YEARS = [1, 2, 3, 5, 10];

/**
 * Suggest bumping the monthly contribution to reach the target sooner. Shows the
 * two largest "years sooner" options that still leave at least half a year of
 * runway, or hides the card when there's nothing actionable to suggest.
 */
function renderSuggestions(
  plan: Plan,
  currency: string,
  monthsBase: number,
  age: number | null,
): void {
  const items: string[] = [];

  if (Number.isFinite(monthsBase) && monthsBase > 12) {
    const options = FASTER_YEARS.filter((yr) => monthsBase - yr * 12 >= 6).slice(-2);
    for (const yr of options) {
      const months = monthsBase - yr * 12;
      const monthly = requiredMonthly(plan.savings, months, plan);
      const extra = monthly - plan.monthly;
      if (!(extra > 0)) continue;
      const newAge = age != null ? Math.round(age + months / 12) : null;
      const agePart = newAge != null ? ` (age ${newAge})` : '';
      items.push(
        `<li class="faster-item">
          <span class="faster-lead">Invest <strong>${money(monthly, currency)}/mo</strong> <span class="faster-extra">+${money(extra, currency)}</span></span>
          <span class="faster-sub">retire about ${humanDuration(yr * 12)} sooner${agePart}</span>
        </li>`,
      );
    }
  }

  els.fasterCard.hidden = items.length === 0;
  els.faster.innerHTML = items.length ? `<ul class="faster-list">${items.join('')}</ul>` : '';
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
  const age = ageFromBirthDate(s.birthDate);
  const retireAge = age != null ? Math.round(age + monthsBase / 12) : null;

  if (!hasTarget) {
    els.baseline.textContent = 'Set a retirement target to see your projection.';
  } else if (monthsBase <= 0) {
    els.baseline.textContent = `You have already reached ${targetMoney}. 🎉`;
  } else if (!Number.isFinite(monthsBase)) {
    els.baseline.textContent = `With these numbers you never reach ${targetMoney}. Try a higher monthly investment or yield.`;
  } else {
    const agePart = retireAge != null ? ` — around age ${retireAge}` : '';
    let text = `On track to reach ${targetMoney} in ${humanDuration(monthsBase)}${agePart}.`;
    const withdrawal = s.withdrawal ?? 0;
    if (withdrawal > 0) {
      const deplete = monthsUntilDepleted(plan.target, rate, withdrawal);
      if (!Number.isFinite(deplete)) {
        text += ` Withdrawing ${money(withdrawal, currency)}/mo then is sustainable — the yield keeps up. 🌴`;
      } else {
        const untilAge = age != null ? ` (to age ${Math.round(age + (monthsBase + deplete) / 12)})` : '';
        text += ` Withdrawing ${money(withdrawal, currency)}/mo, it lasts about ${humanDuration(deplete)}${untilAge}.`;
      }
    }
    els.baseline.textContent = text;
  }

  const price = numVal(els.price);
  renderChart(els.chart, {
    plan,
    currency,
    age,
    yieldPct: s.yield ?? 0,
    withdrawal: s.withdrawal ?? 0,
    purchase: price != null && price > 0 ? price : 0,
  });
  renderContributionsChart(els.contribChart, { plan, currency, age, withdrawal: s.withdrawal ?? 0 });
  renderSuggestions(plan, currency, monthsBase, age);

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
for (const el of [els.birthDate, els.savings, els.monthly, els.yield, els.target, els.withdrawal, els.price]) {
  el.addEventListener('input', render);
}
els.currency.addEventListener('change', render);
render();
