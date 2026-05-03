// lib/supabase.ts

import { createClient } from '@supabase/supabase-js'
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// ─── DB Types (match your schema exactly) ─────────────────────────────────────

export type DBFund = {
  id: string
  fund_name: string
  isin: string
  amc: string
  category: 'core' | 'growth' | 'satellite'
  sub_category: string
  sip_amount: number       // int4
  sip_date: number         // int4
  start_date: string       // date
  target_pct: number       // numeric
  is_active: boolean       // bool
  created_at: string       // timestamp
  // UI-only fields (not in DB — computed from transactions + nav_history)
  invested?: number
  current_value?: number
  units?: number
  current_nav?: number
  color?: string
}

export type DBTransaction = {
  id: string
  fund_id: string
  fund_name?: string        // joined from portfolio_funds
  type: 'sip' | 'lumpsum' | 'stp' | 'switch_in' | 'switch_out' | 'buy' | 'sell'
  amount: number            // numeric
  nav_at_purchase: number   // numeric
  units_allotted: number    // numeric
  invest_date: string       // date
  notes: string
  created_at: string
}

export type DBNavHistory = {
  id: string
  isin: string
  nav_date: string          // date
  nav: number               // numeric
}

export type DBProjectionLog = {
  id: string
  snapshot_date: string
  portfolio_value: number
  xirr: number
  proj_3m_bear: number
  proj_3m_base: number
  proj_3m_bull: number
  proj_6m_bear: number
  proj_6m_base: number
  proj_6m_bull: number
  portfolio_score: number
}

// ─── FUNDS ────────────────────────────────────────────────────────────────────

export async function fetchFunds(): Promise<DBFund[]> {
  const { data, error } = await supabase
    .from('portfolio_funds')
    .select('*')
    .order('created_at', { ascending: true })
  if (error) { console.error('fetchFunds:', error); return [] }
  return data || []
}

export async function insertFund(fund: Omit<DBFund, 'id' | 'created_at'>): Promise<DBFund | null> {
  const { data, error } = await supabase
    .from('portfolio_funds')
    .insert(fund)
    .select()
    .single()
  if (error) { console.error('insertFund:', error); return null }
  return data
}

export async function updateFund(id: string, updates: Partial<DBFund>): Promise<boolean> {
  // Remove UI-only computed fields before saving
  const { invested, current_value, units, current_nav, color, ...dbUpdates } = updates as any
  const { error } = await supabase
    .from('portfolio_funds')
    .update(dbUpdates)
    .eq('id', id)
  if (error) { console.error('updateFund:', error); return false }
  return true
}

export async function deleteFund(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('portfolio_funds')
    .delete()
    .eq('id', id)
  if (error) { console.error('deleteFund:', error); return false }
  return true
}

export async function toggleFundSIP(id: string, isActive: boolean): Promise<boolean> {
  const { error } = await supabase
    .from('portfolio_funds')
    .update({ is_active: isActive })
    .eq('id', id)
  if (error) { console.error('toggleFundSIP:', error); return false }
  return true
}

// ─── TRANSACTIONS ─────────────────────────────────────────────────────────────

export async function fetchTransactions(): Promise<DBTransaction[]> {
  const { data, error } = await supabase
    .from('transactions')
    .select(`
      *,
      portfolio_funds ( fund_name )
    `)
    .order('invest_date', { ascending: false })
    .limit(100)
  if (error) { console.error('fetchTransactions:', error); return [] }
  // Flatten joined fund_name
  return (data || []).map((t: any) => ({
    ...t,
    fund_name: t.portfolio_funds?.fund_name || t.fund_name || '—',
  }))
}

export async function insertTransaction(tx: Omit<DBTransaction, 'id' | 'created_at'>): Promise<DBTransaction | null> {
  const { fund_name, ...dbTx } = tx as any
  const { data, error } = await supabase
    .from('transactions')
    .insert(dbTx)
    .select()
    .single()
  if (error) { console.error('insertTransaction:', error); return null }
  return data
}

// ─── NAV HISTORY ──────────────────────────────────────────────────────────────

export async function fetchLatestNAVs(): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from('nav_history')
    .select('isin, nav, nav_date')
    .order('nav_date', { ascending: false })
  if (error) { console.error('fetchLatestNAVs:', error); return {} }

  // Get most recent NAV per ISIN
  const navMap: Record<string, number> = {}
  for (const row of data || []) {
    if (!navMap[row.isin]) navMap[row.isin] = row.nav
  }
  return navMap
}

export async function upsertNAV(isin: string, nav: number, date: string): Promise<boolean> {
  const { error } = await supabase
    .from('nav_history')
    .upsert({ isin, nav, nav_date: date }, { onConflict: 'isin,nav_date' })
  if (error) { console.error('upsertNAV:', error); return false }
  return true
}

// ─── PORTFOLIO SUMMARY (computed) ─────────────────────────────────────────────

export async function computePortfolioStats(funds: DBFund[], navMap: Record<string, number>) {
  // For each fund: get sum of (units × latest NAV) = current value
  // Get sum of all invested amounts from transactions
  const { data: txData } = await supabase
    .from('transactions')
    .select('fund_id, amount, units_allotted, type')

  const fundStats: Record<string, { invested: number; units: number }> = {}

  for (const tx of txData || []) {
    if (!fundStats[tx.fund_id]) fundStats[tx.fund_id] = { invested: 0, units: 0 }
    if (['sip', 'lumpsum', 'buy', 'stp', 'switch_in'].includes(tx.type)) {
      fundStats[tx.fund_id].invested += Number(tx.amount)
      fundStats[tx.fund_id].units += Number(tx.units_allotted)
    }
    if (['sell', 'switch_out'].includes(tx.type)) {
      fundStats[tx.fund_id].units -= Number(tx.units_allotted)
    }
  }

  return funds.map(f => {
    const stats = fundStats[f.id] || { invested: 0, units: 0 }
    const nav = navMap[f.isin] || 0
    const currentValue = stats.units * nav
    return {
      ...f,
      invested: stats.invested,
      units: stats.units,
      current_nav: nav,
      current_value: currentValue,
    }
  })
}

// ─── SEED DATA — run once to populate your Supabase ──────────────────────────

export async function seedDatabase() {
  // Check if already seeded
  const { data: existing } = await supabase
    .from('portfolio_funds')
    .select('id')
    .limit(1)

  if (existing && existing.length > 0) {
    console.log('Database already seeded.')
    return { success: true, message: 'Already seeded' }
  }

  const funds = [
    // Active SIP Funds
    { fund_name: 'Parag Parikh Flexi Cap', isin: 'INF879O01019', amc: 'PPFAS', category: 'core', sub_category: 'Flexi Cap', sip_amount: 12500, sip_date: 1, start_date: '2024-01-01', target_pct: 22.7, is_active: true },
    { fund_name: 'SBI Contra Fund Direct', isin: 'INF200K01VD8', amc: 'SBI MF', category: 'core', sub_category: 'Contra', sip_amount: 10000, sip_date: 1, start_date: '2024-01-01', target_pct: 18.2, is_active: true },
    { fund_name: 'HDFC Mid Cap Opportunities', isin: 'INF179K01VR2', amc: 'HDFC MF', category: 'core', sub_category: 'Mid Cap', sip_amount: 10000, sip_date: 1, start_date: '2024-01-01', target_pct: 18.2, is_active: true },
    { fund_name: 'HDFC Nifty Next 50 Index', isin: 'INF179KC1BQ9', amc: 'HDFC MF', category: 'growth', sub_category: 'Index', sip_amount: 10000, sip_date: 1, start_date: '2025-04-01', target_pct: 18.2, is_active: true },
    { fund_name: 'Nippon India Small Cap', isin: 'INF204K01U36', amc: 'Nippon MF', category: 'growth', sub_category: 'Small Cap', sip_amount: 7500, sip_date: 1, start_date: '2024-01-01', target_pct: 13.6, is_active: true },
    { fund_name: 'HDFC Defence Fund', isin: 'INF179KC1DR4', amc: 'HDFC MF', category: 'satellite', sub_category: 'Sectoral', sip_amount: 5000, sip_date: 1, start_date: '2024-01-01', target_pct: 9.1, is_active: true },
    // Existing Holdings (no active SIP)
    { fund_name: 'SBI Contra (Regular)', isin: 'INF200K01LW3', amc: 'SBI MF', category: 'core', sub_category: 'Contra', sip_amount: 0, sip_date: 0, start_date: '2019-01-01', target_pct: 0, is_active: false },
    { fund_name: 'Mirae Asset Large Cap', isin: 'INF769K01DM9', amc: 'Mirae', category: 'core', sub_category: 'Large Cap', sip_amount: 0, sip_date: 0, start_date: '2021-01-01', target_pct: 0, is_active: false },
    { fund_name: 'ICICI Infrastructure Direct', isin: 'INF109KC1BY5', amc: 'ICICI MF', category: 'growth', sub_category: 'Infra', sip_amount: 0, sip_date: 0, start_date: '2022-01-01', target_pct: 0, is_active: false },
    { fund_name: 'ICICI Technology Direct', isin: 'INF109K01Z48', amc: 'ICICI MF', category: 'growth', sub_category: 'Tech', sip_amount: 0, sip_date: 0, start_date: '2022-06-01', target_pct: 0, is_active: false },
    { fund_name: 'ICICI Manufacturing Direct', isin: 'INF109KC1EL0', amc: 'ICICI MF', category: 'growth', sub_category: 'Mfg', sip_amount: 0, sip_date: 0, start_date: '2022-06-01', target_pct: 0, is_active: false },
    { fund_name: 'ICICI Bluechip (Regular)', isin: 'INF109K01EQ4', amc: 'ICICI MF', category: 'core', sub_category: 'Large Cap', sip_amount: 0, sip_date: 0, start_date: '2019-06-01', target_pct: 0, is_active: false },
    { fund_name: 'ICICI Multicap Direct', isin: 'INF109KC1EV9', amc: 'ICICI MF', category: 'core', sub_category: 'Multi Cap', sip_amount: 0, sip_date: 0, start_date: '2023-01-01', target_pct: 0, is_active: false },
    { fund_name: 'DSP Tiger (Corpus)', isin: 'INF740K01858', amc: 'DSP MF', category: 'growth', sub_category: 'Infra', sip_amount: 0, sip_date: 0, start_date: '2021-01-01', target_pct: 0, is_active: false },
    { fund_name: 'ICICI BHARAT 22 FOF', isin: 'INF109KC1EF2', amc: 'ICICI MF', category: 'satellite', sub_category: 'FOF', sip_amount: 0, sip_date: 0, start_date: '2023-01-01', target_pct: 0, is_active: false },
    { fund_name: 'HSBC L&M Cap (Regular)', isin: 'INF336L01BF3', amc: 'HSBC MF', category: 'core', sub_category: 'L&M Cap', sip_amount: 0, sip_date: 0, start_date: '2021-01-01', target_pct: 0, is_active: false },
  ]

  const { data: insertedFunds, error: fundsError } = await supabase
    .from('portfolio_funds')
    .insert(funds)
    .select()

  if (fundsError) {
    console.error('Seed funds error:', fundsError)
    return { success: false, message: fundsError.message }
  }

  // Map fund name → id for transactions
  const fundIdMap: Record<string, string> = {}
  for (const f of insertedFunds || []) fundIdMap[f.fund_name] = f.id

  // Seed transactions (current holdings as lumpsum purchases)
  const transactions = [
    // Active SIP funds — lumpsum history approximation
    { fund_id: fundIdMap['Parag Parikh Flexi Cap'], type: 'lumpsum', amount: 732000, nav_at_purchase: 280.50, units_allotted: 2609.6, invest_date: '2024-01-01', notes: 'Initial investment' },
    { fund_id: fundIdMap['SBI Contra Fund Direct'], type: 'lumpsum', amount: 146000, nav_at_purchase: 82.10, units_allotted: 1778.3, invest_date: '2024-01-01', notes: 'Initial investment' },
    { fund_id: fundIdMap['HDFC Mid Cap Opportunities'], type: 'lumpsum', amount: 279000, nav_at_purchase: 540.20, units_allotted: 516.5, invest_date: '2024-01-01', notes: 'Initial investment' },
    { fund_id: fundIdMap['HDFC Nifty Next 50 Index'], type: 'sip', amount: 10000, nav_at_purchase: 16.84, units_allotted: 594.0, invest_date: '2025-04-01', notes: 'First SIP' },
    { fund_id: fundIdMap['Nippon India Small Cap'], type: 'lumpsum', amount: 90000, nav_at_purchase: 72.10, units_allotted: 1248.3, invest_date: '2024-01-01', notes: 'Initial investment' },
    { fund_id: fundIdMap['HDFC Defence Fund'], type: 'lumpsum', amount: 120000, nav_at_purchase: 21.35, units_allotted: 5621.8, invest_date: '2024-01-01', notes: 'Initial investment' },
    // Existing holdings
    { fund_id: fundIdMap['SBI Contra (Regular)'], type: 'lumpsum', amount: 488000, nav_at_purchase: 83.52, units_allotted: 5842.0, invest_date: '2019-01-01', notes: 'Old regular plan' },
    { fund_id: fundIdMap['Mirae Asset Large Cap'], type: 'lumpsum', amount: 583000, nav_at_purchase: 76.50, units_allotted: 7621.0, invest_date: '2021-01-01', notes: 'Lumpsum' },
    { fund_id: fundIdMap['ICICI Infrastructure Direct'], type: 'lumpsum', amount: 347000, nav_at_purchase: 42.60, units_allotted: 8145.1, invest_date: '2022-01-01', notes: 'Lumpsum' },
    { fund_id: fundIdMap['ICICI Technology Direct'], type: 'lumpsum', amount: 57000, nav_at_purchase: 67.70, units_allotted: 842.0, invest_date: '2022-06-01', notes: 'Lumpsum' },
    { fund_id: fundIdMap['ICICI Manufacturing Direct'], type: 'lumpsum', amount: 240000, nav_at_purchase: 49.80, units_allotted: 4819.3, invest_date: '2022-06-01', notes: 'Lumpsum' },
    { fund_id: fundIdMap['ICICI Bluechip (Regular)'], type: 'lumpsum', amount: 185000, nav_at_purchase: 25.40, units_allotted: 7283.5, invest_date: '2019-06-01', notes: 'Old regular plan' },
    { fund_id: fundIdMap['ICICI Multicap Direct'], type: 'lumpsum', amount: 73960, nav_at_purchase: 75.32, units_allotted: 981.9, invest_date: '2023-01-01', notes: 'Lumpsum' },
    { fund_id: fundIdMap['DSP Tiger (Corpus)'], type: 'lumpsum', amount: 1053000, nav_at_purchase: 34.82, units_allotted: 30241.0, invest_date: '2021-01-01', notes: 'Corpus — SIP stopped' },
    { fund_id: fundIdMap['ICICI BHARAT 22 FOF'], type: 'lumpsum', amount: 81000, nav_at_purchase: 19.22, units_allotted: 4214.4, invest_date: '2023-01-01', notes: 'Lumpsum — exit pending' },
    { fund_id: fundIdMap['HSBC L&M Cap (Regular)'], type: 'lumpsum', amount: 630000, nav_at_purchase: 29.95, units_allotted: 21035.1, invest_date: '2021-01-01', notes: 'Regular plan — redeeming' },
    // Recent sell transactions
    { fund_id: fundIdMap['ICICI BHARAT 22 FOF'], type: 'sell', amount: 0, nav_at_purchase: 0, units_allotted: 0, invest_date: '2025-04-20', notes: 'Redemption initiated' },
  ].filter(t => t.fund_id) // skip any that didn't get mapped

  const { error: txError } = await supabase
    .from('transactions')
    .insert(transactions)

  if (txError) {
    console.error('Seed transactions error:', txError)
    return { success: false, message: txError.message }
  }

  // Seed NAV history with latest known NAVs
  const navSeeds = [
    { isin: 'INF879O01019', nav: 318.97, nav_date: '2025-04-28' },
    { isin: 'INF200K01VD8', nav: 87.32,  nav_date: '2025-04-28' },
    { isin: 'INF179K01VR2', nav: 579.24, nav_date: '2025-04-28' },
    { isin: 'INF179KC1BQ9', nav: 16.84,  nav_date: '2025-04-28' },
    { isin: 'INF204K01U36', nav: 85.08,  nav_date: '2025-04-28' },
    { isin: 'INF179KC1DR4', nav: 25.52,  nav_date: '2025-04-28' },
    { isin: 'INF200K01LW3', nav: 215.16, nav_date: '2025-04-28' },
    { isin: 'INF769K01DM9', nav: 98.28,  nav_date: '2025-04-28' },
    { isin: 'INF109KC1BY5', nav: 54.14,  nav_date: '2025-04-28' },
    { isin: 'INF109K01Z48', nav: 80.09,  nav_date: '2025-04-28' },
    { isin: 'INF109KC1EL0', nav: 58.09,  nav_date: '2025-04-28' },
    { isin: 'INF109K01EQ4', nav: 47.63,  nav_date: '2025-04-28' },
    { isin: 'INF109KC1EV9', nav: 83.85,  nav_date: '2025-04-28' },
    { isin: 'INF740K01858', nav: 39.02,  nav_date: '2025-04-28' },
    { isin: 'INF109KC1EF2', nav: 20.00,  nav_date: '2025-04-28' },
    { isin: 'INF336L01BF3', nav: 31.47,  nav_date: '2025-04-28' },
  ]

  const { error: navError } = await supabase
    .from('nav_history')
    .upsert(navSeeds, { onConflict: 'isin,nav_date' })

  if (navError) {
    console.error('Seed NAV error:', navError)
    return { success: false, message: navError.message }
  }

  return { success: true, message: `Seeded ${funds.length} funds, ${transactions.length} transactions, ${navSeeds.length} NAVs` }
}