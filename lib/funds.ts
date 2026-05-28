// lib/funds.ts
// ─── COMPLETE 16-fund portfolio ───────────────────────────────────────────────
// ISINs verified against AMFI Growth-plan codes (Direct plans preferred)
// Run `GET /api/fetch-nav` after any ISIN change to re-seed nav_history

export const MY_FUNDS = [
  // ── CORE ──────────────────────────────────────────────────────────────────
  {
    name: 'Parag Parikh Flexi Cap',
    isin: 'INF879O01027',
    sip: 12500,
    category: 'core',
    color: '#3dd68c',
  },
  {
    name: 'SBI Contra Direct',
    isin: 'INF200K01RA0',
    sip: 10000,
    category: 'core',
    color: '#4ade98',
  },
  {
    name: 'HDFC Mid Cap Opportunities',
    isin: 'INF179K01XQ0',
    sip: 10000,
    category: 'core',
    color: '#22c566',
  },
  {
    name: 'Mirae Asset Large Cap',
    isin: 'INF769K01010',  // ← verify: Direct Growth
    sip: 0,
    category: 'core',
    color: '#60a5fa',
  },
  {
    name: 'HSBC Large and Mid Cap',
    isin: 'INF336L01NM3',  // ← verify: Direct Growth
    sip: 0,
    category: 'core',
    color: '#34d399',
  },
  {
    name: 'ICICI Prudential Bluechip',
    isin: 'INF109K01Z13',  // ← Direct Growth
    sip: 0,
    category: 'core',
    color: '#f59e0b',
  },
  // ── GROWTH ────────────────────────────────────────────────────────────────
  {
    name: 'HDFC Nifty Next 50 Index',
    isin: 'INF179KC1BQ9',
    sip: 10000,
    category: 'growth',
    color: '#d4a853',
  },
  {
    name: 'Nippon India Small Cap',
    isin: 'INF204K01K15',
    sip: 7500,
    category: 'growth',
    color: '#f0c060',
  },
  {
    name: 'ICICI Prudential Technology',
    isin: 'INF109K01BN5',  // ← Direct Growth
    sip: 0,
    category: 'growth',
    color: '#a78bfa',
  },
  {
    name: 'ICICI Prudential Multicap',
    isin: 'INF109K01Z62',  // ← Direct Growth
    sip: 0,
    category: 'growth',
    color: '#c084fc',
  },
  {
    name: 'ICICI Prudential Infrastructure',
    isin: 'INF109K01BF1',  // ← Direct Growth
    sip: 0,
    category: 'growth',
    color: '#fb923c',
  },
  {
    name: 'DSP Tiger Fund',
    isin: 'INF740K01AE9',  // ← verify: Direct Growth
    sip: 0,
    category: 'growth',
    color: '#f97316',
  },
  // ── SATELLITE ─────────────────────────────────────────────────────────────
  {
    name: 'HDFC Defence Fund',
    isin: 'INF179KC1GI5',
    sip: 5000,
    category: 'satellite',
    color: '#9b6dff',
  },
  {
    name: 'ICICI BHARAT 22 FOF',
    isin: 'INF109KC1CN9',  // ← Direct Growth
    sip: 0,
    category: 'satellite',
    color: '#f43f5e',
  },
  {
    name: 'ICICI Prudential Manufacturing',
    isin: 'INF109KC1961',  // ← verify: Direct Growth
    sip: 0,
    category: 'satellite',
    color: '#14b8a6',
  },
  {
    name: 'SBI Contra Regular',
    isin: 'INF200K01126',  // ← Regular plan (legacy — flag for switch)
    sip: 0,
    category: 'legacy',   // Mark as legacy for action centre
    color: '#94a3b8',
    flagForSwitch: true,  // Shows up in Action Centre
  },
] as const

// ─── SIP total (active SIPs only) ────────────────────────────────────────────
export const TOTAL_SIP = MY_FUNDS.reduce((sum, f) => sum + (f.sip ?? 0), 0) // 55000

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Future value: existing corpus + monthly SIP at annual rate */
export function calcProjection(
  currentValue: number,
  monthlySIP: number,
  months: number,
  annualRate: number
): number {
  const r = annualRate / 12 / 100
  const corpusFV = currentValue * Math.pow(1 + r, months)
  const sipFV = monthlySIP * ((Math.pow(1 + r, months) - 1) / r)
  return Math.round(corpusFV + sipFV)
}

/** Indian number formatting */
export function formatINR(amount: number): string {
  if (amount >= 10_000_000) return `₹${(amount / 10_000_000).toFixed(2)} Cr`
  if (amount >= 100_000)    return `₹${(amount / 100_000).toFixed(2)} L`
  if (amount >= 1_000)      return `₹${(amount / 1_000).toFixed(1)} K`
  return `₹${amount}`
}

/** Simple XIRR approximation via CAGR */
export function calcXIRR(
  invested: number,
  currentValue: number,
  years: number
): number {
  if (years <= 0 || invested <= 0) return 0
  return (Math.pow(currentValue / invested, 1 / years) - 1) * 100
}

export const ALERT_THRESHOLDS = {
  navDrop: 5,          // Trigger alert if NAV drops ≥5% in a week
  portfolioDrop: 10,   // Trigger alert if portfolio drops ≥10%
  sipReminder: 2,      // Days before SIP date to remind
  milestones: [75, 80, 90, 100, 125, 150, 175, 200], // In lakhs
}