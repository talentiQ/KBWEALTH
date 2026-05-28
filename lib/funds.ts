// Your 6 confirmed SIP funds
//lib/funds.ts
export const MY_FUNDS = [
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
    name: 'HDFC Defence Fund',
    isin: 'INF179KC1GI5',
    sip: 5000,
    category: 'satellite',
    color: '#9b6dff',
  },
]

export const TOTAL_SIP = MY_FUNDS.reduce((sum, f) => sum + f.sip, 0) // 55000

// Projection calculator
export function calcProjection(
  currentValue: number,
  monthlySIP: number,
  months: number,
  annualRate: number
): number {
  const monthlyRate = annualRate / 12 / 100
  // Future value of existing corpus
  const corpusFV = currentValue * Math.pow(1 + monthlyRate, months)
  // Future value of SIP (annuity)
  const sipFV =
    monthlySIP * ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate)
  return Math.round(corpusFV + sipFV)
}

// Format Indian currency
export function formatINR(amount: number): string {
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(2)} Cr`
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(2)} L`
  if (amount >= 1000) return `₹${(amount / 1000).toFixed(1)} K`
  return `₹${amount}`
}

// XIRR approximation
export function calcXIRR(
  invested: number,
  currentValue: number,
  years: number
): number {
  return ((Math.pow(currentValue / invested, 1 / years) - 1) * 100)
}

// Alert thresholds
export const ALERT_THRESHOLDS = {
  navDrop: 5,        // Alert if NAV drops 5% in a week
  portfolioDrop: 10, // Alert if portfolio drops 10%
  sipReminder: 2,    // Days before SIP date
  milestones: [      // Portfolio value milestones in lakhs
    75, 80, 90, 100, 125, 150, 175, 200
  ],
}