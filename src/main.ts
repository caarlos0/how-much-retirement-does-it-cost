import './style.css';
import { CURRENCIES } from './currencies';
import {
  futureValue,
  monthlyRateFromYearly,
  monthsToTarget,
  monthsUntilDepleted,
  requiredMonthly,
  type Plan,
} from './finance';
import { renderChart, renderContributionsChart } from './chart';

const STORAGE_KEY = 'retirement-calc:v2';

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** ISO birth date for someone `years` old today (used for the default). */
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
  baselineSub: byId<HTMLParagraphElement>('baseline-sub'),
  fasterCard: byId<HTMLElement>('faster-card'),
  faster: byId<HTMLDivElement>('faster'),
  impact: byId<HTMLDivElement>('impact'),
  chart: byId<HTMLDivElement>('chart'),
  contribChart: byId<HTMLDivElement>('contrib-chart'),
  ruleCheck: byId<HTMLParagraphElement>('rule-check'),
  share: byId<HTMLButtonElement>('share'),
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

/** Money inputs that get a live compact-magnitude hint below them (1K, 1M, 1B…). */
const MONEY_INPUTS = [els.savings, els.monthly, els.target, els.withdrawal, els.price];
const compactHints = new Map<HTMLInputElement, HTMLElement>();
for (const input of MONEY_INPUTS) {
  const hint = document.createElement('span');
  hint.className = 'compact-hint';
  hint.hidden = true;
  hint.setAttribute('aria-hidden', 'true');
  input.after(hint);
  compactHints.set(input, hint);
}

function compactNumber(value: number): string {
  try {
    return new Intl.NumberFormat(undefined, {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    return String(Math.round(value));
  }
}

/** Show each money field's value in short notation, hidden below 1,000 (nothing to shorten). */
function refreshCompactHints(): void {
  for (const [input, hint] of compactHints) {
    const n = numVal(input);
    if (n == null || Math.abs(n) < 1000) {
      hint.hidden = true;
    } else {
      hint.textContent = compactNumber(n);
      hint.hidden = false;
    }
  }
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

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* ignore malformed storage */
  }
  return { ...DEFAULTS };
}

function save(s: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore storage errors (private mode, quota, etc.) */
  }
}

function stateToHash(s: Settings): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(s)) {
    if (value != null && value !== '') params.set(key, String(value));
  }
  return params.toString();
}

/** Read shareable settings from the URL fragment, or null when it carries none. */
function settingsFromHash(): Settings | null {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (!Object.keys(DEFAULTS).some((key) => params.has(key))) return null;
  const num = (key: string, fallback: number | null): number | null => {
    const raw = params.get(key);
    if (raw == null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    birthDate: params.get('birthDate') ?? DEFAULTS.birthDate,
    savings: num('savings', DEFAULTS.savings),
    currency: params.get('currency') ?? DEFAULTS.currency,
    monthly: num('monthly', DEFAULTS.monthly),
    yield: num('yield', DEFAULTS.yield),
    target: num('target', DEFAULTS.target),
    withdrawal: num('withdrawal', DEFAULTS.withdrawal),
  };
}

/** Mirror the current settings into the URL fragment so the page itself is shareable. */
function updateHash(s: Settings): void {
  const hash = stateToHash(s);
  history.replaceState(null, '', hash ? `#${hash}` : location.pathname + location.search);
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

/**
 * Cross-check the target against the 4% rule (a nest egg of 25× annual withdrawals):
 * nudge when the target is well below or above what the rule of thumb suggests, and
 * stay silent when they roughly agree.
 *
 * The rule of thumb assumes ~4% real returns, while the sustainability verdict above
 * it trusts the plan's own yield — so the copy is phrased relative to that verdict
 * (`sustainable`, null when there is none) to never contradict it.
 */
function renderRuleCheck(
  target: number,
  withdrawalMonthly: number,
  currency: string,
  yieldPct: number,
  sustainable: boolean | null,
): void {
  const el = els.ruleCheck;
  if (target <= 0 || withdrawalMonthly <= 0) {
    el.hidden = true;
    return;
  }
  const annual = withdrawalMonthly * 12;
  const ruleTarget = annual * 25;
  const ratio = target / ruleTarget;
  el.hidden = false;
  if (ratio < 0.9) {
    if (sustainable) {
      el.className = 'rule-check';
      el.innerHTML = `💡 That only holds if you really get ${yieldPct}%/yr after inflation. The more cautious <strong>4% rule</strong> would want a nest egg near <strong>${money(ruleTarget, currency)}</strong> — 25× your ${money(annual, currency)}/yr — as a safety margin.`;
    } else {
      el.className = 'rule-check warn';
      el.innerHTML = `⚠️ To withdraw ${money(withdrawalMonthly, currency)}/mo, the <strong>4% rule</strong> suggests a nest egg near <strong>${money(ruleTarget, currency)}</strong> — 25× your ${money(annual, currency)}/yr. Your target of ${money(target, currency)} may fall short; consider raising it or trimming withdrawals.`;
    }
  } else if (ratio > 1.1) {
    el.className = 'rule-check';
    if (sustainable === false) {
      el.innerHTML = `💡 Your target clears the <strong>4% rule</strong>'s ${money(ruleTarget, currency)}, but at ${yieldPct}%/yr real yield the withdrawals still draw the balance down — the rule counts on about 4% real returns.`;
    } else {
      el.innerHTML = `💡 Your target of ${money(target, currency)} sits well above the <strong>4% rule</strong>'s ${money(ruleTarget, currency)} for ${money(withdrawalMonthly, currency)}/mo — you could retire on less or spend a little more.`;
    }
  } else {
    el.hidden = true;
  }
}

function render(persist = true): void {
  const s = readSettings();
  if (persist) save(s);
  updateHash(s);
  refreshCompactHints();

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
  const withdrawal = s.withdrawal ?? 0;
  // Whether the retirement withdrawal outlasts the money, under the plan's own yield.
  const deplete =
    reachable && withdrawal > 0 ? monthsUntilDepleted(plan.target, rate, withdrawal) : NaN;
  const sustainable = reachable && withdrawal > 0 ? !Number.isFinite(deplete) : null;

  let baselineSub = '';
  if (!hasTarget) {
    els.baseline.textContent = 'Set a retirement target to see your projection.';
  } else if (monthsBase <= 0) {
    els.baseline.textContent = `You have already reached ${targetMoney}. 🎉`;
  } else if (!Number.isFinite(monthsBase)) {
    els.baseline.textContent = `With these numbers you never reach ${targetMoney}. Try a higher monthly investment or yield.`;
  } else {
    const agePart = retireAge != null ? ` — around age <strong>${retireAge}</strong>` : '';
    els.baseline.innerHTML = `On track to reach ${targetMoney} in <strong>${humanDuration(monthsBase)}</strong>${agePart}.`;
    if (withdrawal > 0) {
      if (sustainable) {
        baselineSub = `Withdrawing ${money(withdrawal, currency)}/mo then is sustainable — the yield keeps up. 🌴`;
      } else {
        const untilAge = age != null ? ` (to age ${Math.round(age + (monthsBase + deplete) / 12)})` : '';
        baselineSub = `Withdrawing ${money(withdrawal, currency)}/mo, it lasts about ${humanDuration(deplete)}${untilAge}.`;
      }
    }
  }
  els.baselineSub.hidden = baselineSub === '';
  els.baselineSub.textContent = baselineSub;

  renderRuleCheck(plan.target, withdrawal, currency, s.yield ?? 0, sustainable);

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
  const delayText = delay > 0 ? humanDuration(delay) : 'less than a day';
  const agePart = retireAge != null ? ` (around age ${retireAge})` : '';
  const notePart =
    plan.monthly > 0
      ? `<p class="note">That's ${(price / plan.monthly).toFixed(1)}× what you invest in a whole month.</p>`
      : '';

  els.impact.innerHTML = `
    <div class="cap">That ${money(price, currency)} could grow to</div>
    <div class="big">${money(fv, currency)}</div>
    <div class="cap">by the time you retire${agePart}.</div>
    <div class="chips">
      <span class="chip">⏳ Delays retirement by <span class="v">${delayText}</span></span>
      <span class="chip">📈 <span class="v">${multiple.toFixed(1)}×</span> your money</span>
    </div>
    ${notePart}`;
}

async function copyShareLink(): Promise<void> {
  try {
    await navigator.clipboard.writeText(location.href);
    els.share.textContent = 'Copied!';
    setTimeout(() => (els.share.textContent = 'Copy link'), 1500);
  } catch {
    /* clipboard unavailable (insecure context or denied) — the link is still in the address bar */
  }
}

const shared = settingsFromHash();
applySettings(shared ?? load());
const rerender = () => render();
for (const el of [els.birthDate, els.savings, els.monthly, els.yield, els.target, els.withdrawal, els.price]) {
  el.addEventListener('input', rerender);
}
els.currency.addEventListener('change', rerender);
// Scrolling the page over a focused number field silently changes its value — drop focus instead.
for (const el of [els.savings, els.monthly, els.yield, els.target, els.withdrawal, els.price]) {
  el.addEventListener('wheel', () => {
    if (document.activeElement === el) el.blur();
  });
}
els.share.addEventListener('click', copyShareLink);
// A shared link is a view of someone else's plan — don't overwrite the visitor's own
// saved settings until they actually change something.
render(shared == null);
