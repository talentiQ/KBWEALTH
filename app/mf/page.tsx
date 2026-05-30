'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { calcProjection, MY_FUNDS } from '@/lib/funds'

// ─── Color map from canonical fund list ──────────────────────────────────────
const FUND_COLORS: Record<string, string> = Object.fromEntries(
  MY_FUNDS.map(f => [f.isin, f.color])
)

type Tab        = 'dashboard' | 'sip' | 'lumpsum' | 'projections' | 'agent' | 'transactions'
type ProjPeriod = '3m' | '6m' | '1y' | '5y'
type AgentType  = 'weekly' | 'projection' | 'alert' | 'advice'
type ModalType  = 'add-sip' | 'add-lumpsum' | 'edit-fund' | 'buy' | 'sell' | 'delete' | null

interface Fund {
  id: string; fund_name: string; isin: string; amc: string
  category: 'core' | 'growth' | 'satellite'; sub_category: string
  sip_amount: number; sip_date: number; start_date: string
  invested: number; current_value: number; units: number
  current_nav: number; is_active: boolean; color: string
}
interface Transaction {
  id: string; fund_id?: string; fund_name: string; type: string
  amount: number; nav: number; units: number; date: string
  status: string; notes?: string
}
interface Alert {
  id: string; alert_type: string; fund_name?: string
  message: string; triggered_at: string; is_read: boolean
}

// ─── NW Portfolio design tokens (matches page.jsx exactly) ───────────────────
const C = {
  sidebar:       '#0B1E4F',
  sidebarActive: '#1E3A8A',
  mf:            { main: '#7C3AED', bg: '#F5F3FF', light: '#EDE9FE' },
  green:         '#059669',
  red:           '#E8195A',
  blue:          '#2563EB',
  orange:        '#D97706',
  text:          '#0B1E4F',
  text2:         '#374151',
  text3:         '#6B7280',
  text4:         '#9CA3AF',
  border:        '#E8ECF4',
  bg:            '#F1F5FB',
  white:         '#ffffff',
}

const CAT_COLOR: Record<string, string> = {
  core:      '#059669',
  growth:    '#D97706',
  satellite: '#7C3AED',
}
const CAT_BG: Record<string, string> = {
  core:      '#ECFDF5',
  growth:    '#FFFBEB',
  satellite: '#F5F3FF',
}

const fmtINR = (n: number) => {
  const a = Math.abs(n)
  if (a >= 10000000) return `₹${(a / 10000000).toFixed(2)} Cr`
  if (a >= 100000)   return `₹${(a / 100000).toFixed(2)} L`
  if (a >= 1000)     return `₹${(a / 1000).toFixed(1)} K`
  return `₹${a.toLocaleString('en-IN')}`
}
const fmtFull = (n: number) => `₹${Math.abs(n).toLocaleString('en-IN')}`
const fmtPct  = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`

function calculateXIRR(cashflows: { amount: number; date: string }[], currentValue: number): number {
  try {
    if (!cashflows.length || currentValue <= 0) return 0
    const flows = [
      ...cashflows.map(cf => ({ amount: -Math.abs(cf.amount), date: new Date(cf.date) })),
      { amount: currentValue, date: new Date() },
    ]
    const firstDate = flows[0].date
    const years = (d: Date) => (d.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24 * 365)
    let rate = 0.12
    for (let i = 0; i < 100; i++) {
      let npv = 0, derivative = 0
      for (const f of flows) {
        const t = years(f.date)
        npv        += f.amount / Math.pow(1 + rate, t)
        derivative += (-t * f.amount) / Math.pow(1 + rate, t + 1)
      }
      const newRate = rate - npv / derivative
      if (Math.abs(newRate - rate) < 0.00001) { rate = newRate; break }
      rate = newRate
    }
    return rate * 100
  } catch { return 0 }
}

function monthsToTarget(current: number, sip: number, target: number, rate = 13): number | null {
  for (let m = 1; m <= 360; m++) {
    if (calcProjection(current, sip, m, rate) >= target) return m
  }
  return null
}
function targetDate(months: number | null): string {
  if (!months) return '>30Y'
  const d = new Date(); d.setMonth(d.getMonth() + months)
  return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
}

const TABS = [
  { id: 'dashboard',    label: 'Dashboard',    icon: '⊞' },
  { id: 'sip',         label: 'SIP Funds',    icon: '🔄' },
  { id: 'lumpsum',     label: 'Lumpsum',      icon: '💰' },
  { id: 'transactions',label: 'Transactions', icon: '📋' },
  { id: 'projections', label: 'Projections',  icon: '📈' },
  { id: 'agent',       label: 'AI Advisor',   icon: '🤖' },
]

// ─── Shared label/input style (matches page.jsx) ─────────────────────────────
const LBL: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 600, color: C.text3,
  textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6,
}
const INP: React.CSSProperties = {
  width: '100%', padding: '10px 12px', border: `1.5px solid ${C.border}`,
  borderRadius: 9, fontSize: 13, outline: 'none', color: '#111', boxSizing: 'border-box',
  fontFamily: "'DM Sans', sans-serif",
}

// ════════════════════════════════════════════════════════════════════════════
export default function MFPage() {
  const [tab, setTab]             = useState<Tab>('dashboard')
  const [userId, setUserId]       = useState<string | null>(null)
  const [funds, setFunds]         = useState<Fund[]>([])
  const [transactions, setTx]     = useState<Transaction[]>([])
  const [alerts, setAlerts]       = useState<Alert[]>([])
  const [loading, setLoading]     = useState(true)
  const [modal, setModal]         = useState<ModalType>(null)
  const [selFund, setSelFund]     = useState<Fund | null>(null)
  const [projPeriod, setProjP]    = useState<ProjPeriod>('3m')
  const [agentOut, setAgentOut]   = useState('')
  const [agentBusy, setAgentBusy] = useState(false)
  const [toast, setToast]         = useState({ msg: '', show: false, ok: true })
  const [txFilter, setTxFilter]   = useState('all')
  const [search, setSearch]       = useState('')

  const [sipForm, setSipForm] = useState({
    fund_name: '', isin: '', amc: '', category: 'core', sub_category: '',
    sip_amount: '', sip_date: '1', start_date: '',
  })
  const [lumpsumForm, setLumpsumForm] = useState({ fund_name: '', amount: '', nav: '', date: '', notes: '' })
  const [buyForm,  setBuyForm]  = useState({ amount: '', nav: '', date: new Date().toISOString().split('T')[0], notes: '' })
  const [sellForm, setSellForm] = useState({ units:  '', nav: '', date: new Date().toISOString().split('T')[0], notes: '' })
  const [editForm, setEditForm] = useState<Partial<Fund>>({})

  const showToast = useCallback((msg: string, ok = true) => {
    setToast({ msg, show: true, ok })
    setTimeout(() => setToast(t => ({ ...t, show: false })), 2800)
  }, [])

  // ── Auth: get current user ────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id ?? null)
    })
  }, [])

  useEffect(() => { if (userId) loadAll() }, [userId])

  // ── Load all MF data, scoped to current user ──────────────────────────────
  async function loadAll() {
    if (!userId) return
    setLoading(true)
    try {
      // ── Step 1: Check if user_id column exists in portfolio_funds ──────────
      // We do a cheap probe query. If it returns a schema-cache error (42703),
      // the column doesn't exist yet → fall back to unfiltered query so
      // existing data still shows while the migration is pending.
      const probe = await supabase
        .from('portfolio_funds')
        .select('user_id')
        .limit(1)

      // PGRST204 = column not found in schema cache  |  42703 = undefined column
      const userIdColMissing =
        !!probe.error &&
        (probe.error.code === 'PGRST204' ||
          probe.error.message?.toLowerCase().includes('user_id') ||
          probe.error.message?.toLowerCase().includes('column'))

      // ── Step 2: Load portfolio_funds ───────────────────────────────────────
      let pfQuery = supabase.from('portfolio_funds').select('*').order('category')
      if (!userIdColMissing) pfQuery = pfQuery.eq('user_id', userId) as any

      const { data: pfData, error: pfErr } = await pfQuery
      if (pfErr) console.error('portfolio_funds:', pfErr)

      // ── Step 3: Load transactions ──────────────────────────────────────────
      let txQuery = supabase
        .from('transactions')
        .select('*, portfolio_funds(fund_name)')
        .order('invest_date', { ascending: false })
      if (!userIdColMissing) txQuery = txQuery.eq('user_id', userId) as any

      const { data: txData, error: txErr } = await txQuery
      if (txErr) console.error('transactions:', txErr)

      // ── Step 4: nav_history scoped to this user's fund ISINs ──────────────
      const isins = (pfData || []).map((f: any) => f.isin).filter(Boolean)
      let navData: any[] = []
      if (isins.length) {
        const { data: nd, error: navErr } = await supabase
          .from('nav_history')
          .select('isin, nav, nav_date')
          .in('isin', isins)
          .order('nav_date', { ascending: false })
        if (navErr) console.error('nav_history:', navErr)
        navData = nd || []
      }

      // ── Step 5: alerts ─────────────────────────────────────────────────────
      let alertQuery = supabase
        .from('alerts_log')
        .select('*')
        .order('triggered_at', { ascending: false })
        .limit(30)
      if (!userIdColMissing) alertQuery = alertQuery.eq('user_id', userId) as any

      const { data: alertData } = await alertQuery

      // ── Guard: nothing to render ───────────────────────────────────────────
      if (!pfData?.length) {
        setFunds([]); setTx([]); setAlerts(alertData || [])
        setLoading(false); return
      }

      // Most recent NAV per ISIN
      const navMap: Record<string, number> = {}
      for (const n of navData) {
        if (!navMap[n.isin]) navMap[n.isin] = n.nav
      }

      const enriched: Fund[] = (pfData || []).map(f => {
        const myTxs = (txData || []).filter(t => t.fund_id === f.id)
        let invested = 0, units = 0
        for (const t of myTxs) {
          const amt = Number(t.amount), u = Number(t.units_allotted) || 0
          if (['sip','lumpsum','buy','stp','switch_in'].includes(t.type))  { invested += amt; units += u }
          if (['sell','switch_out'].includes(t.type))                       { units -= u }
        }
        const nav = navMap[f.isin] || 0
        const cv  = nav > 0 ? units * nav : (f.current_value || invested)
        return {
          ...f, invested, units,
          current_nav:   nav,
          current_value: cv,
          is_active:     f.is_active ?? true,
          color:         FUND_COLORS[f.isin] || CAT_COLOR[f.category] || C.mf.main,
        }
      })

      setFunds(enriched)
      setTx((txData || []).map(t => ({
        id: t.id, fund_id: t.fund_id,
        fund_name: t.portfolio_funds?.fund_name || '—',
        type: t.type, amount: Number(t.amount),
        nav: Number(t.nav_at_purchase) || 0,
        units: Number(t.units_allotted) || 0,
        date: t.invest_date, status: 'completed', notes: t.notes || '',
      })))
      setAlerts(alertData || [])
    } catch (e) { console.error('loadAll:', e) }
    setLoading(false)
  }

  // ── Portfolio metrics ─────────────────────────────────────────────────────
  const totalInvested = funds.reduce((s, f) => s + f.invested, 0)
  const totalCurrent  = funds.reduce((s, f) => s + f.current_value, 0)
  const totalGain     = totalCurrent - totalInvested
  const gainPct       = totalInvested > 0 ? (totalGain / totalInvested) * 100 : 0
  const xirr          = calculateXIRR(
    transactions.filter(t => ['sip','buy','lumpsum'].includes(t.type))
      .map(t => ({ amount: t.amount, date: t.date })),
    totalCurrent
  )
  const totalSIP    = funds.filter(f => f.is_active && f.sip_amount > 0).reduce((s, f) => s + f.sip_amount, 0)
  const activeFunds = funds.filter(f => f.is_active && f.sip_amount > 0)
  const bestReturn  = funds.reduce((b, f) => {
    const r = f.invested > 0 ? ((f.current_value - f.invested) / f.invested) * 100 : 0
    return r > b ? r : b
  }, 0)

  // ── Projections ───────────────────────────────────────────────────────────
  const projData = useMemo(() => {
    const cv = totalCurrent, sip = totalSIP
    return {
      '3m': { bear: fmtINR(calcProjection(cv, sip, 3,  10)), base: fmtINR(calcProjection(cv, sip, 3,  13)), bull: fmtINR(calcProjection(cv, sip, 3,  16)) },
      '6m': { bear: fmtINR(calcProjection(cv, sip, 6,  10)), base: fmtINR(calcProjection(cv, sip, 6,  13)), bull: fmtINR(calcProjection(cv, sip, 6,  16)) },
      '1y': { bear: fmtINR(calcProjection(cv, sip, 12, 10)), base: fmtINR(calcProjection(cv, sip, 12, 13)), bull: fmtINR(calcProjection(cv, sip, 12, 16)) },
      '5y': { bear: fmtINR(calcProjection(cv, sip, 60, 10)), base: fmtINR(calcProjection(cv, sip, 60, 13)), bull: fmtINR(calcProjection(cv, sip, 60, 16)) },
    }
  }, [totalCurrent, totalSIP])

  const breakdown = useMemo(() => {
    const m = ({ '3m': 3, '6m': 6, '1y': 12, '5y': 60 } as Record<string,number>)[projPeriod]
    const r = 13 / 12 / 100
    const corpusFV = totalCurrent * Math.pow(1 + r, m)
    const sipRaw   = totalSIP * m
    const sipFV    = r > 0 ? totalSIP * ((Math.pow(1 + r, m) - 1) / r) : sipRaw
    const total    = corpusFV + sipFV
    return {
      corpus:  { val: fmtINR(corpusFV), pct: total > 0 ? (corpusFV / total) * 100 : 0 },
      sipContr:{ val: `+${fmtINR(sipRaw)}`, pct: total > 0 ? (sipRaw / total) * 100 : 0 },
      sipGrow: { val: `+${fmtINR(Math.max(0, sipFV - sipRaw))}`, pct: total > 0 ? (Math.max(0, sipFV - sipRaw) / total) * 100 : 0 },
    }
  }, [totalCurrent, totalSIP, projPeriod])

  const milestones = useMemo(() => [
    { icon: '🎯', label: '₹75L',      target: 7500000  },
    { icon: '🚀', label: '₹80L',      target: 8000000  },
    { icon: '💎', label: '₹1 Crore',  target: 10000000 },
    { icon: '🏆', label: '₹1.71 Cr',  target: 17100000 },
    { icon: '👑', label: '₹3.74 Cr',  target: 37400000 },
  ].map(t => {
    const mBase = monthsToTarget(totalCurrent, totalSIP, t.target, 13)
    const already = totalCurrent >= t.target
    return {
      ...t,
      date:  already ? '✓ Reached' : targetDate(mBase),
      range: already
        ? fmtINR(totalCurrent)
        : `${fmtINR(calcProjection(totalCurrent, totalSIP, mBase ?? 0, 10))}–${fmtINR(calcProjection(totalCurrent, totalSIP, mBase ?? 0, 16))}`,
    }
  }), [totalCurrent, totalSIP])

  // ── AI context ────────────────────────────────────────────────────────────
  const portfolioCtx = `Portfolio — ${new Date().toDateString()}
Total Value: ${fmtINR(totalCurrent)} | Invested: ${fmtINR(totalInvested)} | Returns: ${fmtINR(totalGain)} (${fmtPct(gainPct)}) | XIRR: ${fmtPct(xirr)}
Monthly SIP: ₹${totalSIP.toLocaleString('en-IN')}/month across ${activeFunds.length} active funds
Active SIP Funds:
${activeFunds.map(f => `• ${f.fund_name} | ₹${f.sip_amount.toLocaleString('en-IN')}/mo | NAV ₹${f.current_nav} | Invested ${fmtINR(f.invested)} | Current ${fmtINR(f.current_value)}`).join('\n')}
3M Base @13%: ${projData['3m']?.base || '—'}`

  // ── CRUD ──────────────────────────────────────────────────────────────────
  const addSIP = async () => {
    if (!sipForm.fund_name || !sipForm.sip_amount) { showToast('Fund name and SIP amount required', false); return }
    const sipPayload: Record<string,any> = {
      fund_name:    sipForm.fund_name,
      isin:         sipForm.isin,
      amc:          sipForm.amc,
      category:     sipForm.category,
      sub_category: sipForm.sub_category,
      sip_amount:   Number(sipForm.sip_amount),
      sip_date:     Number(sipForm.sip_date),
      start_date:   sipForm.start_date || null,
      target_pct:   0,
      is_active:    true,
    }
    if (userId) sipPayload.user_id = userId
    const { error } = await supabase.from('portfolio_funds').insert(sipPayload)
    if (error) { showToast('Error: ' + error.message, false); return }
    showToast('SIP fund added')
    setSipForm({ fund_name:'', isin:'', amc:'', category:'core', sub_category:'', sip_amount:'', sip_date:'1', start_date:'' })
    setModal(null); loadAll()
  }

  const addLumpsum = async () => {
    if (!lumpsumForm.fund_name || !lumpsumForm.amount) { showToast('Fund and amount required', false); return }
    const fund = funds.find(f => f.fund_name === lumpsumForm.fund_name)
    if (!fund) { showToast('Select a fund from the list', false); return }
    const amount = Number(lumpsumForm.amount)
    const nav    = Number(lumpsumForm.nav) || 0
    const lumpPayload: Record<string,any> = {
      fund_id:         fund.id,
      type:            'lumpsum',
      amount,
      nav_at_purchase: nav || null,
      units_allotted:  nav > 0 ? amount / nav : null,
      invest_date:     lumpsumForm.date || new Date().toISOString().split('T')[0],
      notes:           lumpsumForm.notes || null,
    }
    if (userId) lumpPayload.user_id = userId
    const { error } = await supabase.from('transactions').insert(lumpPayload)
    if (error) { showToast('Error: ' + error.message, false); return }
    showToast(`Lumpsum ${fmtINR(amount)} saved`)
    setLumpsumForm({ fund_name:'', amount:'', nav:'', date:'', notes:'' })
    setModal(null); loadAll()
  }

  const buyFund = async () => {
    if (!selFund || !buyForm.amount) { showToast('Enter amount', false); return }
    const amount = Number(buyForm.amount), nav = Number(buyForm.nav) || selFund.current_nav
    const buyPayload: Record<string,any> = {
      fund_id: selFund.id, type: 'buy', amount,
      nav_at_purchase: nav, units_allotted: nav > 0 ? amount / nav : 0,
      invest_date: buyForm.date, notes: buyForm.notes || null,
    }
    if (userId) buyPayload.user_id = userId
    const { error } = await supabase.from('transactions').insert(buyPayload)
    if (error) { showToast('Error: ' + error.message, false); return }
    showToast(`Bought ${fmtINR(amount)} of ${selFund.fund_name}`)
    setModal(null); loadAll()
  }

  const sellFund = async () => {
    if (!selFund || !sellForm.units) { showToast('Enter units', false); return }
    const units = Number(sellForm.units), nav = Number(sellForm.nav) || selFund.current_nav
    if (units > selFund.units) { showToast('Insufficient units', false); return }
    const sellPayload: Record<string,any> = {
      fund_id: selFund.id, type: 'sell',
      amount: units * nav, nav_at_purchase: nav, units_allotted: units,
      invest_date: sellForm.date, notes: sellForm.notes || null,
    }
    if (userId) sellPayload.user_id = userId
    const { error } = await supabase.from('transactions').insert(sellPayload)
    if (error) { showToast('Error: ' + error.message, false); return }
    showToast(`Sell placed — ${fmtINR(units * nav)}`)
    setModal(null); loadAll()
  }

  const deleteTx = async (id: string) => {
    const { error } = await supabase.from('transactions').delete().eq('id', id)
    if (error) { showToast('Error: ' + error.message, false); return }
    showToast('Transaction deleted'); loadAll()
  }

  const updateFund = async () => {
    if (!selFund) return
    const { invested: _i, current_value: _cv, units: _u, current_nav: _nav, color: _c, ...safeEdits } = editForm as any
    const { error } = await supabase.from('portfolio_funds').update(safeEdits).eq('id', selFund.id)
    if (error) { showToast('Error: ' + error.message, false); return }
    showToast('Fund updated'); setModal(null); loadAll()
  }

  const deleteFund = async () => {
    if (!selFund) return
    await supabase.from('transactions').delete().eq('fund_id', selFund.id)
    const { error } = await supabase.from('portfolio_funds').delete().eq('id', selFund.id)
    if (error) { showToast('Error: ' + error.message, false); return }
    showToast(`${selFund.fund_name} removed`); setModal(null); loadAll()
  }

  const toggleSIP = async (fund: Fund) => {
    const { error } = await supabase.from('portfolio_funds')
      .update({ is_active: !fund.is_active }).eq('id', fund.id)
    if (error) { showToast('Error: ' + error.message, false); return }
    showToast(!fund.is_active ? 'SIP resumed' : 'SIP paused'); loadAll()
  }

  const markRead = async (id: string) => {
    await supabase.from('alerts_log').update({ is_read: true }).eq('id', id)
    setAlerts(a => a.map(x => x.id === id ? { ...x, is_read: true } : x))
  }

  // ── AI Agent ──────────────────────────────────────────────────────────────
  const PROMPTS: Record<AgentType, string> = {
    weekly:     `Generate a WhatsApp-style weekly brief. Emojis, 10-12 bullet lines. Portfolio score, XIRR, each fund status, one specific action this week.\n\n${portfolioCtx}`,
    projection: `Based on Indian market conditions ${new Date().toDateString()}, give realistic 3M and 6M projection. Which scenario is most likely? Be specific.\n\n${portfolioCtx}`,
    alert:      `Check for alerts: 🔴 Critical | 🟡 Warning | 🟢 Opportunity. Pending exits, expense drags, sector risks. Max 2 lines each.\n\n${portfolioCtx}`,
    advice:     `Give 3 highly specific actionable moves for this month. Exact fund names and ₹ amounts. Include tax tip, rebalancing action, deployment decision.\n\n${portfolioCtx}`,
  }

  const runAgent = useCallback(async (type: AgentType) => {
    setAgentBusy(true)
    setAgentOut('Analysing your portfolio…')
    try {
      const res  = await fetch('/api/agent', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customPrompt: PROMPTS[type] }),
      })
      const data = await res.json()
      setAgentOut(data.result || 'No response.')
      // Safe insert: only include user_id when migration has been run
      const alertPayload: Record<string,any> = {
        alert_type:   type === 'weekly' ? 'weekly_brief' : type,
        fund_name:    'AI_AGENT',
        message:      (data.result || '').slice(0, 500),
        triggered_at: new Date().toISOString(),
        is_read:      false,
      }
      if (userId) alertPayload.user_id = userId
      await supabase.from('alerts_log').insert(alertPayload).then(({ error }) => {
        if (error) console.warn('alert insert (user_id may not exist yet):', error.message)
      })
      loadAll()
    } catch { setAgentOut('⚠️ Could not connect to AI agent.') }
    setAgentBusy(false)
  }, [portfolioCtx, userId])

  // ── Filtered txns ─────────────────────────────────────────────────────────
  const filteredTx = transactions.filter(t => {
    if (txFilter !== 'all' && t.type !== txFilter) return false
    if (search && !t.fund_name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const actionAlerts = alerts
    .filter(a => ['weekly_brief','weekly','projection','alert','advice','custom'].includes(a.alert_type) && !a.is_read)
    .slice(0, 4)
  const unreadCount = alerts.filter(a => !a.is_read).length

  const alertTitle = (a: Alert) => ({
    weekly_brief: '📊 Weekly Brief', weekly: '📊 Weekly Brief',
    projection: '📅 Projection', alert: '⚡ Alert', advice: '💡 Advice', custom: '🤖 AI Insight',
  }[a.alert_type] || `🔔 ${a.alert_type}`)

  // ── Skeleton ──────────────────────────────────────────────────────────────
  const Sk = ({ h = 14, w = '100%' }: { h?: number; w?: string | number }) => (
    <div style={{
      height: h, width: w,
      background: 'linear-gradient(90deg,#E8ECF2 25%,#F5F7FA 50%,#E8ECF2 75%)',
      backgroundSize: '200% 100%', animation: 'skshimmer 1.5s infinite', borderRadius: 6,
    }} />
  )

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER  (no topnav / bnav — consumed inside NW Portfolio's layout)
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "'DM Sans',-apple-system,sans-serif", color: C.text }}>
      <style>{`
        @keyframes skshimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
        @keyframes mfFadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        .mf-fade{animation:mfFadeUp .22s ease both}
        .mf-hover:hover{background:#F8FAFC!important}
        .mf-tab-btn:hover{background:#F5F3FF!important}
      `}</style>

      {/* ── Page header identical to other NW modules ── */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontFamily:"'Syne',sans-serif", fontSize: 22, fontWeight: 700, color: C.text, marginBottom: 4 }}>
            📈 Mutual Funds Portfolio
          </h2>
          <div style={{ fontSize: 13, color: C.text4 }}>
            {loading ? '…' : `${funds.length} funds · ${activeFunds.length} active SIPs · XIRR ${fmtPct(xirr)}`}
          </div>
        </div>
        <div style={{ display:'flex', gap: 10, alignItems:'center' }}>
          {unreadCount > 0 && (
            <div style={{ background: C.red, color:'white', borderRadius:'50%', width:22, height:22,
              fontSize:11, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center' }}>
              {unreadCount}
            </div>
          )}
          <button onClick={loadAll} style={{ padding:'9px 16px', background: C.mf.light, color: C.mf.main,
            border:`1px solid #DDD6FE`, borderRadius:9, fontSize:13, cursor:'pointer', fontWeight:500 }}>
            ↻ Refresh NAV
          </button>
        </div>
      </div>

      {/* ── MF Hero banner (purple, matches NW module banners) ── */}
      <div style={{ background:'linear-gradient(135deg,#5B21B6,#7C3AED)', borderRadius:16, padding:'20px 28px',
        marginBottom:20, color:'white', display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:20 }}>
        {[
          { l:'Portfolio Value', v: fmtINR(totalCurrent),    s: fmtFull(totalCurrent) },
          { l:'Total Invested',  v: fmtINR(totalInvested),   s: fmtFull(totalInvested) },
          { l:'Total Gains',     v: (totalGain>=0?'+':'')+fmtINR(totalGain), s: `${totalInvested>0?((totalGain/totalInvested)*100).toFixed(2):'0.00'}% return` },
          { l:'Monthly SIP',     v: `₹${totalSIP.toLocaleString('en-IN')}`, s: `${activeFunds.length} active SIPs` },
        ].map(s => (
          <div key={s.l}>
            <div style={{ fontSize:10, opacity:.65, textTransform:'uppercase', letterSpacing:'1px', marginBottom:6 }}>{s.l}</div>
            <div style={{ fontFamily:"'Syne',sans-serif", fontSize:22, fontWeight:700 }}>{loading ? '…' : s.v}</div>
            <div style={{ fontSize:11, opacity:.6, marginTop:3 }}>{s.s}</div>
          </div>
        ))}
      </div>

      {/* ── Sub-tab nav (styled like NW sidebar buttons but horizontal) ── */}
      <div style={{ display:'flex', gap:6, marginBottom:20, flexWrap:'wrap', background:'white',
        borderRadius:12, padding:6, border:`1px solid ${C.border}` }}>
        {TABS.map(t => (
          <button key={t.id} className="mf-tab-btn"
            onClick={() => setTab(t.id as Tab)}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 16px', borderRadius:9,
              border:'none', cursor:'pointer', fontSize:12, fontWeight: tab===t.id ? 600 : 400,
              background: tab===t.id ? C.mf.main : 'transparent',
              color: tab===t.id ? 'white' : C.text3, transition:'.15s' }}>
            <span>{t.icon}</span><span>{t.label}</span>
            {tab===t.id && <div style={{ width:4, height:4, borderRadius:'50%', background:'rgba(255,255,255,.6)' }} />}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* DASHBOARD TAB                                                      */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {tab === 'dashboard' && (
        <div className="mf-fade">
          {/* Quick stats — matches NW Overview card style */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:16 }}>
            {[
              { l:'Total Invested',   v: fmtINR(totalInvested), c: C.text,     bg:'#F8FAFC' },
              { l:'Total Returns',    v: fmtINR(totalGain),     c: C.green,    bg:'#ECFDF5' },
              { l:'3M Target (Base)', v: projData['3m']?.base || '—', c: C.orange, bg:'#FFFBEB' },
              { l:'XIRR',             v: fmtPct(xirr),          c: C.mf.main,  bg: C.mf.light },
            ].map(s => (
              <div key={s.l} style={{ background:'white', borderRadius:14, padding:'16px 18px',
                border:`1px solid ${C.border}` }}>
                <div style={{ fontSize:11, color: C.text4, marginBottom:6 }}>{s.l}</div>
                <div style={{ fontFamily:"'Syne',sans-serif", fontSize:20, fontWeight:700, color:s.c }}>
                  {loading ? '…' : s.v}
                </div>
              </div>
            ))}
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
            {/* Live Allocation */}
            <div style={{ background:'white', borderRadius:16, padding:20, border:`1px solid ${C.border}` }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
                <div style={{ fontSize:14, fontWeight:600, color: C.text }}>Live Allocation</div>
                <div style={{ fontSize:12, color: C.text4 }}>{funds.length} funds</div>
              </div>
              {loading
                ? [1,2,3,4].map(i => <div key={i} style={{ marginBottom:10 }}><Sk h={8} /></div>)
                : funds.map(f => {
                    const pct = totalCurrent > 0 ? (f.current_value / totalCurrent) * 100 : 0
                    return (
                      <div key={f.id} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
                        <div style={{ width:8, height:8, borderRadius:'50%', background:f.color, flexShrink:0 }} />
                        <div style={{ fontSize:11, color:C.text2, width:140, flexShrink:0, overflow:'hidden',
                          textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          {f.fund_name.replace(' Direct','').replace(' Fund','').split(' ').slice(0,3).join(' ')}
                        </div>
                        <div style={{ flex:1, height:6, background:'#F3F4F6', borderRadius:3, overflow:'hidden' }}>
                          <div style={{ width:`${pct}%`, height:'100%', background:f.color, borderRadius:3, transition:'width .8s' }} />
                        </div>
                        <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:C.text4, width:36, textAlign:'right' }}>{pct.toFixed(1)}%</div>
                        <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:C.text2, width:60, textAlign:'right' }}>{fmtINR(f.current_value)}</div>
                      </div>
                    )
                  })
              }
            </div>

            {/* Action Centre */}
            <div style={{ background:'white', borderRadius:16, padding:20, border:`1px solid ${C.border}` }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
                <div style={{ fontSize:14, fontWeight:600, color:C.text }}>Action Centre</div>
                <button onClick={loadAll} style={{ fontSize:11, padding:'5px 12px', background:'#F5F3FF',
                  color:C.mf.main, border:`1px solid #DDD6FE`, borderRadius:7, cursor:'pointer', fontWeight:500 }}>
                  ↻ Refresh
                </button>
              </div>
              {loading ? (
                [1,2,3].map(i => <div key={i} style={{ marginBottom:10 }}><Sk h={56} /></div>)
              ) : actionAlerts.length === 0 ? (
                <div style={{ padding:'20px 0', textAlign:'center', color:C.text4, fontSize:13 }}>
                  <div style={{ fontSize:28, marginBottom:8 }}>🤖</div>
                  No AI recommendations yet.<br />
                  Run <strong>AI Advisor → Check Alerts</strong>
                </div>
              ) : actionAlerts.map(a => (
                <div key={a.id} onClick={() => markRead(a.id)}
                  style={{ padding:'12px 14px', borderRadius:10, display:'flex', gap:10, alignItems:'flex-start',
                    marginBottom:8, border:`1px solid ${C.border}`, background:'#F8FAFC', cursor:'pointer' }}>
                  <div style={{ fontSize:15, flexShrink:0 }}>
                    {{ critical:'⚡', alert:'⚡', advice:'💡', info:'📊' }[a.alert_type] || '🔔'}
                  </div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:12, fontWeight:600, color:C.text, marginBottom:2 }}>{alertTitle(a)}</div>
                    <div style={{ fontSize:11, color:C.text3, lineHeight:1.6 }}>{a.message.slice(0,120)}…</div>
                    <div style={{ fontSize:10, color:C.text4, marginTop:3 }}>
                      {new Date(a.triggered_at).toLocaleDateString('en-IN', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* SIP FUNDS TAB                                                      */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {tab === 'sip' && (
        <div className="mf-fade">
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
            <div>
              <div style={{ fontSize:16, fontWeight:600, color:C.text }}>SIP Portfolio</div>
              <div style={{ fontSize:12, color:C.text4, marginTop:2 }}>{activeFunds.length} active · ₹{totalSIP.toLocaleString('en-IN')}/month</div>
            </div>
            <button onClick={() => setModal('add-sip')} style={{ background:C.mf.main, color:'white',
              border:'none', borderRadius:10, padding:'10px 20px', fontSize:13, fontWeight:600, cursor:'pointer' }}>
              + Add SIP
            </button>
          </div>

          {loading
            ? [1,2,3].map(i => <div key={i} style={{ marginBottom:10 }}><Sk h={100} /></div>)
            : (['core','growth','satellite'] as const).map(cat => {
                const cf = funds.filter(f => f.category === cat)
                if (!cf.length) return null
                const ci = cf.reduce((s,f) => s+f.invested, 0)
                const cc = cf.reduce((s,f) => s+f.current_value, 0)
                const cg = ci > 0 ? ((cc-ci)/ci)*100 : 0
                return (
                  <div key={cat}>
                    {/* Category header */}
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                      margin:'16px 0 10px', padding:'8px 14px', background:'white',
                      borderRadius:10, border:`1px solid ${C.border}` }}>
                      <span style={{ fontSize:11, fontWeight:700, padding:'3px 10px', borderRadius:4,
                        letterSpacing:'1.5px', background:CAT_BG[cat], color:CAT_COLOR[cat] }}>
                        {cat.toUpperCase()}
                      </span>
                      <div style={{ display:'flex', gap:16, fontSize:13, fontWeight:500 }}>
                        <span style={{ color:C.text2 }}>{fmtINR(cc)}</span>
                        <span style={{ color: cg>=0?C.green:C.red, fontFamily:"'JetBrains Mono',monospace" }}>
                          {fmtPct(cg)}
                        </span>
                      </div>
                    </div>

                    {cf.map(f => {
                      const ret = f.invested > 0 ? ((f.current_value-f.invested)/f.invested)*100 : 0
                      return (
                        <div key={f.id} className="mf-hover"
                          style={{ background:'white', borderRadius:14, padding:'16px 18px',
                            marginBottom:10, border:`1px solid ${C.border}` }}>
                          {/* Top row */}
                          <div style={{ display:'flex', alignItems:'flex-start', gap:12, marginBottom:14 }}>
                            <div style={{ width:4, height:44, borderRadius:2, background:f.color, flexShrink:0, marginTop:2 }} />
                            <div style={{ flex:1 }}>
                              <div style={{ fontSize:14, fontWeight:600, color:C.text, marginBottom:5 }}>{f.fund_name}</div>
                              <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                                <span style={{ fontSize:11, color:C.text4 }}>{f.amc || f.category}</span>
                                {f.sub_category && (
                                  <span style={{ fontSize:10, background:'#EFF6FF', color:C.blue,
                                    padding:'2px 7px', borderRadius:4, fontWeight:500 }}>{f.sub_category}</span>
                                )}
                                <span style={{ fontSize:10, padding:'2px 7px', borderRadius:4, fontWeight:500,
                                  background: f.is_active&&f.sip_amount>0?'#ECFDF5':'#FFFBEB',
                                  color: f.is_active&&f.sip_amount>0?C.green:C.orange }}>
                                  {f.sip_amount>0 ? (f.is_active?'SIP Active':'SIP Paused') : 'No SIP'}
                                </span>
                              </div>
                            </div>
                            <div style={{ textAlign:'right' }}>
                              <div style={{ fontSize:16, fontWeight:700, fontFamily:"'JetBrains Mono',monospace",
                                color: ret>=0?C.green:C.red }}>{fmtPct(ret)}</div>
                              <div style={{ fontSize:11, color:C.text4, fontFamily:"'JetBrains Mono',monospace", marginTop:2 }}>
                                {fmtINR(Math.abs(f.current_value - f.invested))}
                              </div>
                            </div>
                          </div>
                          {/* Stats row */}
                          <div style={{ display:'flex', gap:0, padding:'10px 0', borderTop:`1px solid ${C.border}`,
                            borderBottom:`1px solid ${C.border}`, marginBottom:12, overflowX:'auto' }}>
                            {[
                              f.sip_amount>0 && { l:'SIP/Month', v:`₹${f.sip_amount.toLocaleString('en-IN')}` },
                              { l:'Invested',  v: fmtINR(f.invested) },
                              { l:'Current',   v: fmtINR(f.current_value) },
                              { l:'Units',     v: f.units.toFixed(3) },
                              { l:'NAV',       v: `₹${f.current_nav}` },
                            ].filter(Boolean).map((s: any) => (
                              <div key={s.l} style={{ flex:1, textAlign:'center', borderRight:`1px solid ${C.border}`,
                                minWidth:70, padding:'0 6px' }}>
                                <div style={{ fontSize:9, color:C.text4, textTransform:'uppercase',
                                  letterSpacing:'.8px', marginBottom:4, fontFamily:"'JetBrains Mono',monospace" }}>{s.l}</div>
                                <div style={{ fontSize:12, fontWeight:500, fontFamily:"'JetBrains Mono',monospace",
                                  color:C.text2 }}>{s.v}</div>
                              </div>
                            ))}
                          </div>
                          {/* Actions */}
                          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                            {[
                              { l:'+ Buy',   cl:{ background:'#ECFDF5', color:C.green },   onClick:()=>{ setSelFund(f); setBuyForm({ amount:'', nav:String(f.current_nav), date:new Date().toISOString().split('T')[0], notes:'' }); setModal('buy') } },
                              { l:'− Sell',  cl:{ background:'#FFF0F5', color:C.red },     onClick:()=>{ setSelFund(f); setSellForm({ units:'', nav:String(f.current_nav), date:new Date().toISOString().split('T')[0], notes:'' }); setModal('sell') } },
                              { l:'✏️ Edit', cl:{ background:'#EFF6FF', color:C.blue },    onClick:()=>{ setSelFund(f); setEditForm({ sip_amount:f.sip_amount, sip_date:f.sip_date, current_nav:f.current_nav, is_active:f.is_active, category:f.category, sub_category:f.sub_category }); setModal('edit-fund') } },
                              f.sip_amount>0 && { l: f.is_active?'⏸ Pause':'▶ Resume', cl:{ background:'#F9FAFB', color:C.text2 }, onClick:()=>toggleSIP(f) },
                              { l:'🗑',       cl:{ background:'#F9FAFB', color:C.text4 },  onClick:()=>{ setSelFund(f); setModal('delete') } },
                            ].filter(Boolean).map((a:any, i) => (
                              <button key={i} onClick={a.onClick}
                                style={{ ...a.cl, fontSize:12, fontWeight:500, padding:'5px 14px',
                                  borderRadius:7, cursor:'pointer', border:`1px solid ${C.border}` }}>
                                {a.l}
                              </button>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })
          }
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* LUMPSUM TAB                                                        */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {tab === 'lumpsum' && (
        <div className="mf-fade">
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
            <div>
              <div style={{ fontSize:16, fontWeight:600, color:C.text }}>Lumpsum Holdings</div>
              <div style={{ fontSize:12, color:C.text4, marginTop:2 }}>{funds.length} positions</div>
            </div>
            <button onClick={() => setModal('add-lumpsum')} style={{ background:C.mf.main, color:'white',
              border:'none', borderRadius:10, padding:'10px 20px', fontSize:13, fontWeight:600, cursor:'pointer' }}>
              + Add Lumpsum
            </button>
          </div>
          {/* Summary cards */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:16 }}>
            {[
              { l:'Total Invested', v: fmtINR(totalInvested),                     c: C.text },
              { l:'Current Value',  v: fmtINR(totalCurrent),                      c: C.mf.main },
              { l:'Total Gain',     v: (totalGain>=0?'+':'')+fmtINR(totalGain),   c: totalGain>=0?C.green:C.red },
              { l:'Best Return',    v: fmtPct(bestReturn),                         c: C.orange },
            ].map(s => (
              <div key={s.l} style={{ background:'white', borderRadius:12, padding:'14px 16px', border:`1px solid ${C.border}` }}>
                <div style={{ fontSize:11, color:C.text4 }}>{s.l}</div>
                <div style={{ fontFamily:"'Syne',sans-serif", fontSize:20, fontWeight:700, color:s.c, marginTop:4 }}>
                  {loading ? '…' : s.v}
                </div>
              </div>
            ))}
          </div>
          {/* Holdings table */}
          <div style={{ background:'white', borderRadius:16, border:`1px solid ${C.border}`, overflow:'hidden', marginBottom:16 }}>
            <div style={{ overflowX:'auto' }}>
              <TableHeader cols={['Fund','AMC / Type','Invested','Current','Return','Action']}
                widths="2.5fr 1.2fr 100px 100px 80px 180px" />
              {loading
                ? [1,2,3].map(i => <div key={i} style={{ padding:'12px 16px', borderBottom:`1px solid ${C.border}` }}><Sk h={12} /></div>)
                : funds.length === 0
                  ? <EmptyState msg="No holdings found." />
                  : funds.map((f,i) => {
                      const ret = f.invested > 0 ? ((f.current_value-f.invested)/f.invested)*100 : 0
                      return (
                        <div key={f.id} className="mf-hover"
                          style={{ display:'grid', gridTemplateColumns:'2.5fr 1.2fr 100px 100px 80px 180px',
                            padding:'11px 16px', borderBottom:i<funds.length-1?`1px solid ${C.border}`:'none',
                            alignItems:'center', minWidth:640 }}>
                          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                            <div style={{ width:4, height:32, borderRadius:2, background:f.color, flexShrink:0 }} />
                            <div style={{ fontSize:12, fontWeight:500, color:C.text }}>{f.fund_name}</div>
                          </div>
                          <div style={{ fontSize:11, color:C.text4 }}>
                            <div>{f.amc || '—'}</div>
                            <div style={{ fontSize:10, marginTop:2 }}>{f.category}{f.sip_amount>0?` · SIP ₹${f.sip_amount.toLocaleString('en-IN')}/mo`:''}</div>
                          </div>
                          <Mono>{fmtINR(f.invested)}</Mono>
                          <Mono style={{ color:C.mf.main, fontWeight:600 }}>{fmtINR(f.current_value)}</Mono>
                          <Mono style={{ color: ret>=0?C.green:C.red, fontWeight:600 }}>{fmtPct(ret)}</Mono>
                          <div style={{ display:'flex', gap:4 }}>
                            <ActionBtn color={C.green} bg="#ECFDF5" onClick={()=>{ setSelFund(f); setBuyForm({ amount:'', nav:String(f.current_nav), date:new Date().toISOString().split('T')[0], notes:'' }); setModal('buy') }}>Buy</ActionBtn>
                            <ActionBtn color={C.red}   bg="#FFF0F5" onClick={()=>{ setSelFund(f); setSellForm({ units:'', nav:String(f.current_nav), date:new Date().toISOString().split('T')[0], notes:'' }); setModal('sell') }}>Sell</ActionBtn>
                          </div>
                        </div>
                      )
                    })
              }
            </div>
          </div>
          {/* Lumpsum txns */}
          <TxTable label="Lumpsum Transactions" txns={transactions.filter(t=>t.type==='lumpsum')} onDelete={deleteTx} loading={loading} />
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* TRANSACTIONS TAB                                                   */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {tab === 'transactions' && (
        <div className="mf-fade">
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
            <div>
              <div style={{ fontSize:16, fontWeight:600, color:C.text }}>All Transactions</div>
              <div style={{ fontSize:12, color:C.text4, marginTop:2 }}>{transactions.length} total</div>
            </div>
            <button onClick={() => setModal('add-lumpsum')} style={{ background:C.mf.main, color:'white',
              border:'none', borderRadius:10, padding:'10px 20px', fontSize:13, fontWeight:600, cursor:'pointer' }}>
              + New
            </button>
          </div>
          {/* Filters */}
          <div style={{ display:'flex', gap:10, marginBottom:14, flexWrap:'wrap', alignItems:'center' }}>
            <input placeholder="Search fund…" value={search} onChange={e=>setSearch(e.target.value)}
              style={{ ...INP, flex:1, minWidth:180 }} />
            <div style={{ display:'flex', gap:4 }}>
              {['all','sip','lumpsum','buy','sell'].map(f => (
                <button key={f} onClick={() => setTxFilter(f)}
                  style={{ fontSize:11, padding:'6px 12px', borderRadius:6, cursor:'pointer', fontWeight:500,
                    border:`1px solid ${txFilter===f?C.mf.main:C.border}`,
                    background: txFilter===f?C.mf.main:'white',
                    color: txFilter===f?'white':C.text3 }}>
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <TxTable label="" txns={filteredTx} onDelete={deleteTx} loading={loading} showEmpty />
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* PROJECTIONS TAB                                                    */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {tab === 'projections' && (
        <div className="mf-fade">
          <div style={{ fontSize:16, fontWeight:600, color:C.text, marginBottom:16 }}>Wealth Projections</div>
          {/* Period toggle */}
          <div style={{ display:'flex', gap:8, marginBottom:20, flexWrap:'wrap' }}>
            {(['3m','6m','1y','5y'] as ProjPeriod[]).map(p => (
              <button key={p} onClick={() => setProjP(p)}
                style={{ fontSize:13, fontWeight:500, padding:'8px 20px', borderRadius:8, cursor:'pointer',
                  border:`1px solid ${projPeriod===p?C.mf.main:C.border}`,
                  background: projPeriod===p?C.mf.main:'white',
                  color: projPeriod===p?'white':C.text3 }}>
                {{'3m':'3 Months','6m':'6 Months','1y':'1 Year','5y':'5 Years'}[p]}
              </button>
            ))}
          </div>
          {/* Scenario cards */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:20 }}>
            {[
              { l:'Bear Case', k:'bear', xirr:'10%', c:C.red,    desc:'Global slowdown', active:false },
              { l:'Base Case', k:'base', xirr:'13%', c:C.orange, desc:'India story intact', active:true },
              { l:'Bull Case', k:'bull', xirr:'16%', c:C.green,  desc:'Extended bull run', active:false },
            ].map(s => (
              <div key={s.k} style={{ background:'white', border:`${s.active?'2px':'1px'} solid ${s.active?C.mf.main:C.border}`,
                borderRadius:14, padding:20, textAlign:'center',
                boxShadow: s.active?`0 0 0 3px ${C.mf.light}`:undefined }}>
                <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'1px',
                  color:s.c, marginBottom:4 }}>{s.l}</div>
                <div style={{ fontSize:11, color:C.text4, marginBottom:12, fontFamily:"'JetBrains Mono',monospace" }}>@ {s.xirr} XIRR</div>
                <div style={{ fontFamily:"'Syne',sans-serif", fontSize:26, fontWeight:700, color:s.c, marginBottom:8 }}>
                  {loading ? '…' : projData[projPeriod]?.[s.k as 'bear'|'base'|'bull'] || '—'}
                </div>
                <div style={{ fontSize:11, color:C.text4 }}>{s.desc}</div>
              </div>
            ))}
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
            {/* Breakdown */}
            <div style={{ background:'white', borderRadius:16, padding:20, border:`1px solid ${C.border}` }}>
              <div style={{ fontSize:14, fontWeight:600, color:C.text, marginBottom:4 }}>Component Breakdown</div>
              <div style={{ fontSize:11, color:C.text4, marginBottom:16 }}>Base @13% XIRR</div>
              {[
                { l:'Existing Corpus Growth', v:breakdown.corpus.val,   w:Math.min(95,breakdown.corpus.pct),   c:C.blue },
                { l:'New SIP Contribution',   v:breakdown.sipContr.val, w:Math.min(95,breakdown.sipContr.pct), c:C.green },
                { l:'SIP Market Growth',      v:breakdown.sipGrow.val,  w:Math.min(95,breakdown.sipGrow.pct),  c:C.orange },
              ].map(b => (
                <div key={b.l} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 0',
                  borderBottom:`1px solid ${C.border}` }}>
                  <div style={{ fontSize:12, color:C.text2, width:180, flexShrink:0 }}>{b.l}</div>
                  <div style={{ flex:1, height:6, background:'#F3F4F6', borderRadius:3, overflow:'hidden' }}>
                    <div style={{ width:`${b.w}%`, height:'100%', background:b.c, borderRadius:3, transition:'width .8s' }} />
                  </div>
                  <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:12, fontWeight:500,
                    color:b.c, width:70, textAlign:'right' }}>{loading?'…':b.v}</div>
                </div>
              ))}
            </div>
            {/* Milestones */}
            <div style={{ background:'white', borderRadius:16, padding:20, border:`1px solid ${C.border}` }}>
              <div style={{ fontSize:14, fontWeight:600, color:C.text, marginBottom:4 }}>Wealth Milestones</div>
              <div style={{ fontSize:11, color:C.text4, marginBottom:16 }}>Base @13% XIRR</div>
              {loading
                ? [1,2,3,4,5].map(i => <div key={i} style={{ marginBottom:12 }}><Sk h={36} /></div>)
                : milestones.map(m => (
                    <div key={m.label} style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 0',
                      borderBottom:`1px solid ${C.border}` }}>
                      <div style={{ fontSize:18, flexShrink:0 }}>{m.icon}</div>
                      <div>
                        <div style={{ fontSize:13, fontWeight:500, color:C.text }}>{m.label}</div>
                        <div style={{ fontSize:11, color:C.text4, marginTop:2,
                          fontFamily:"'JetBrains Mono',monospace" }}>{m.date}</div>
                      </div>
                      <div style={{ marginLeft:'auto', fontSize:12, fontWeight:600, color:C.mf.main,
                        fontFamily:"'JetBrains Mono',monospace", whiteSpace:'nowrap' }}>{m.range}</div>
                    </div>
                  ))
              }
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* AI ADVISOR TAB                                                     */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {tab === 'agent' && (
        <div className="mf-fade">
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
            <div>
              <div style={{ fontSize:16, fontWeight:600, color:C.text }}>AI Portfolio Advisor</div>
              <div style={{ fontSize:12, color:C.text4, marginTop:2 }}>
                Live context · {fmtINR(totalCurrent)} · {activeFunds.length} active funds
              </div>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, color:C.green, fontWeight:500 }}>
              <div style={{ width:8, height:8, borderRadius:'50%', background:C.green,
                animation:'pulse 2s infinite' }} />Live
              <style>{`@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(1.3)}}`}</style>
            </div>
          </div>

          <div style={{ background:'white', borderRadius:16, padding:24, border:`1px solid ${C.border}`, marginBottom:16 }}>
            {/* Agent header */}
            <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:20 }}>
              <div style={{ width:52, height:52, borderRadius:14, background:C.mf.light,
                display:'flex', alignItems:'center', justifyContent:'center', fontSize:26 }}>🤖</div>
              <div>
                <div style={{ fontSize:15, fontWeight:600, color:C.text }}>KB Wealth Intelligence Agent</div>
                <div style={{ fontSize:12, color:C.text4 }}>Powered by Claude · Live Supabase data</div>
              </div>
            </div>
            {/* Output area */}
            <div style={{ background:'#F8FAFC', border:`1px solid ${C.border}`, borderRadius:10,
              padding:16, minHeight:140, marginBottom:16 }}>
              {agentBusy ? (
                <div style={{ display:'flex', alignItems:'center', gap:10, color:C.text4, fontSize:13 }}>
                  <div style={{ width:16, height:16, border:`2px solid ${C.border}`, borderTopColor:C.mf.main,
                    borderRadius:'50%', animation:'spin .8s linear infinite', flexShrink:0 }} />
                  <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
                  Analysing your portfolio with live data…
                </div>
              ) : agentOut ? (
                <pre style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:12, color:C.text2,
                  lineHeight:1.8, whiteSpace:'pre-wrap', wordBreak:'break-word' }}>{agentOut}</pre>
              ) : (
                <div style={{ textAlign:'center', padding:20, color:C.text4 }}>
                  <div style={{ fontSize:28, marginBottom:10 }}>💡</div>
                  <div style={{ fontSize:14, fontWeight:600, marginBottom:6 }}>Ready to analyse your portfolio</div>
                  <div style={{ fontSize:12, lineHeight:1.6 }}>
                    Choose an action below. AI runs <strong>only when you click</strong>.
                  </div>
                </div>
              )}
            </div>
            {/* Action buttons */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:10 }}>
              {[
                { type:'weekly'     as AgentType, l:'📊 Weekly Brief',       s:'Portfolio score + fund status' },
                { type:'projection' as AgentType, l:'📅 Update Projections', s:'AI-adjusted 3M/6M forecast' },
                { type:'alert'      as AgentType, l:'⚡ Check Alerts',       s:'Red flags, opportunities' },
                { type:'advice'     as AgentType, l:'💡 Get Advice',         s:'Specific actions this month' },
              ].map(a => (
                <button key={a.type} disabled={agentBusy} onClick={() => runAgent(a.type)}
                  style={{ background:'#F8FAFC', border:`1px solid ${C.border}`, borderRadius:10,
                    padding:'12px 16px', cursor:'pointer', textAlign:'left', fontFamily:"'DM Sans',sans-serif",
                    opacity: agentBusy ? .5 : 1 }}>
                  <div style={{ fontSize:13, fontWeight:600, color:C.text, marginBottom:3 }}>{a.l}</div>
                  <div style={{ fontSize:11, color:C.text4 }}>{a.s}</div>
                </button>
              ))}
            </div>
          </div>

          {/* History */}
          {alerts.filter(a => a.alert_type !== 'nav_drop').length > 0 && (
            <div style={{ background:'white', borderRadius:16, padding:20, border:`1px solid ${C.border}` }}>
              <div style={{ fontSize:14, fontWeight:600, color:C.text, marginBottom:16 }}>AI Brief History</div>
              {alerts.filter(a => a.alert_type !== 'nav_drop').slice(0,5).map(a => (
                <div key={a.id} onClick={() => { setAgentOut(a.message); markRead(a.id) }}
                  style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 0',
                    borderBottom:`1px solid ${C.border}`, cursor:'pointer' }}>
                  <div style={{ fontSize:18 }}>📋</div>
                  <div>
                    <div style={{ fontSize:13, fontWeight:500, color:C.text }}>{alertTitle(a)}</div>
                    <div style={{ fontSize:11, color:C.text4, marginTop:2,
                      fontFamily:"'JetBrains Mono',monospace" }}>
                      {new Date(a.triggered_at).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' })}
                    </div>
                  </div>
                  <div style={{ marginLeft:'auto', fontSize:11, color:a.is_read?C.text4:C.mf.main, fontWeight:500 }}>
                    {a.is_read ? 'Read' : 'View'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* MODALS                                                             */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {modal && (
        <div onClick={e => { if(e.target===e.currentTarget) setModal(null) }}
          style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)', zIndex:500,
            display:'flex', alignItems:'center', justifyContent:'center', padding:20, backdropFilter:'blur(4px)' }}>
          <div style={{ background:'white', borderRadius:20, width:'100%', maxWidth:520,
            maxHeight:'85vh', overflowY:'auto', boxShadow:'0 30px 60px rgba(0,0,0,.3)' }}>

            {/* ADD SIP */}
            {modal === 'add-sip' && (
              <Modal title="Add New SIP Fund" onClose={()=>setModal(null)}
                onSave={addSIP} saveLabel="Add SIP Fund" accent={C.mf.main}>
                <FormGrid>
                  <FormRow full><label style={LBL}>Fund Name *</label>
                    <input style={INP} placeholder="e.g. Quant Small Cap Fund Direct"
                      value={sipForm.fund_name} onChange={e=>setSipForm(f=>({...f,fund_name:e.target.value}))} /></FormRow>
                  <FormRow><label style={LBL}>ISIN</label>
                    <input style={INP} placeholder="INF…" value={sipForm.isin} onChange={e=>setSipForm(f=>({...f,isin:e.target.value}))} /></FormRow>
                  <FormRow><label style={LBL}>AMC</label>
                    <input style={INP} placeholder="e.g. Quant MF" value={sipForm.amc} onChange={e=>setSipForm(f=>({...f,amc:e.target.value}))} /></FormRow>
                  <FormRow><label style={LBL}>Category *</label>
                    <select style={INP} value={sipForm.category} onChange={e=>setSipForm(f=>({...f,category:e.target.value}))}>
                      <option value="core">Core</option><option value="growth">Growth</option><option value="satellite">Satellite</option>
                    </select></FormRow>
                  <FormRow><label style={LBL}>Sub Category</label>
                    <input style={INP} placeholder="Mid Cap, Index…" value={sipForm.sub_category} onChange={e=>setSipForm(f=>({...f,sub_category:e.target.value}))} /></FormRow>
                  <FormRow><label style={LBL}>Monthly SIP (₹) *</label>
                    <input style={INP} type="number" placeholder="5000" value={sipForm.sip_amount} onChange={e=>setSipForm(f=>({...f,sip_amount:e.target.value}))} /></FormRow>
                  <FormRow><label style={LBL}>SIP Date</label>
                    <input style={INP} type="number" min="1" max="28" value={sipForm.sip_date} onChange={e=>setSipForm(f=>({...f,sip_date:e.target.value}))} /></FormRow>
                  <FormRow><label style={LBL}>Start Date</label>
                    <input style={INP} type="date" value={sipForm.start_date} onChange={e=>setSipForm(f=>({...f,start_date:e.target.value}))} /></FormRow>
                </FormGrid>
              </Modal>
            )}

            {/* ADD LUMPSUM */}
            {modal === 'add-lumpsum' && (
              <Modal title="Add Lumpsum Investment" onClose={()=>setModal(null)}
                onSave={addLumpsum} saveLabel="Save to Supabase" accent={C.mf.main}>
                <FormGrid>
                  <FormRow full><label style={LBL}>Fund *</label>
                    <select style={INP} value={lumpsumForm.fund_name} onChange={e=>setLumpsumForm(f=>({...f,fund_name:e.target.value}))}>
                      <option value="">Select fund…</option>
                      {funds.map(f=><option key={f.id} value={f.fund_name}>{f.fund_name}</option>)}
                    </select></FormRow>
                  <FormRow><label style={LBL}>Amount (₹) *</label>
                    <input style={INP} type="number" placeholder="50000" value={lumpsumForm.amount} onChange={e=>setLumpsumForm(f=>({...f,amount:e.target.value}))} /></FormRow>
                  <FormRow><label style={LBL}>NAV at Purchase</label>
                    <input style={INP} type="number" step="0.01" placeholder="85.42" value={lumpsumForm.nav} onChange={e=>setLumpsumForm(f=>({...f,nav:e.target.value}))} /></FormRow>
                  <FormRow><label style={LBL}>Date</label>
                    <input style={INP} type="date" value={lumpsumForm.date} onChange={e=>setLumpsumForm(f=>({...f,date:e.target.value}))} /></FormRow>
                  <FormRow full><label style={LBL}>Notes</label>
                    <input style={INP} placeholder="Optional" value={lumpsumForm.notes} onChange={e=>setLumpsumForm(f=>({...f,notes:e.target.value}))} /></FormRow>
                </FormGrid>
                {lumpsumForm.amount && lumpsumForm.nav && (
                  <CalcPreview label="Units to be allotted"
                    val={(Number(lumpsumForm.amount)/Number(lumpsumForm.nav)).toFixed(3)} />
                )}
              </Modal>
            )}

            {/* BUY */}
            {modal === 'buy' && selFund && (
              <Modal title={`Buy — ${selFund.fund_name}`} onClose={()=>setModal(null)}
                onSave={buyFund} saveLabel="Confirm Buy" accent={C.green}>
                <div style={{ fontSize:12, color:C.text4, marginBottom:16 }}>Current NAV: ₹{selFund.current_nav}</div>
                <FormGrid>
                  <FormRow><label style={LBL}>Amount (₹) *</label>
                    <input style={INP} type="number" placeholder="25000" value={buyForm.amount} onChange={e=>setBuyForm(f=>({...f,amount:e.target.value}))} /></FormRow>
                  <FormRow><label style={LBL}>NAV</label>
                    <input style={INP} type="number" step="0.01" value={buyForm.nav} onChange={e=>setBuyForm(f=>({...f,nav:e.target.value}))} /></FormRow>
                  <FormRow><label style={LBL}>Date</label>
                    <input style={INP} type="date" value={buyForm.date} onChange={e=>setBuyForm(f=>({...f,date:e.target.value}))} /></FormRow>
                  <FormRow><label style={LBL}>Notes</label>
                    <input style={INP} placeholder="Optional" value={buyForm.notes} onChange={e=>setBuyForm(f=>({...f,notes:e.target.value}))} /></FormRow>
                </FormGrid>
                {buyForm.amount && buyForm.nav && (
                  <CalcPreview label="Units to be allotted"
                    val={(Number(buyForm.amount)/Number(buyForm.nav)).toFixed(3)} />
                )}
              </Modal>
            )}

            {/* SELL */}
            {modal === 'sell' && selFund && (
              <Modal title={`Sell — ${selFund.fund_name}`} onClose={()=>setModal(null)}
                onSave={sellFund} saveLabel="Confirm Sell" accent={C.red}>
                <div style={{ fontSize:12, color:C.text4, marginBottom:16 }}>
                  Available: {selFund.units.toFixed(3)} units · NAV ₹{selFund.current_nav}
                </div>
                <FormGrid>
                  <FormRow><label style={LBL}>Units to Sell *</label>
                    <input style={INP} type="number" step="0.001" placeholder={`Max ${selFund.units.toFixed(3)}`}
                      value={sellForm.units} onChange={e=>setSellForm(f=>({...f,units:e.target.value}))} /></FormRow>
                  <FormRow><label style={LBL}>NAV</label>
                    <input style={INP} type="number" step="0.01" value={sellForm.nav} onChange={e=>setSellForm(f=>({...f,nav:e.target.value}))} /></FormRow>
                  <FormRow><label style={LBL}>Date</label>
                    <input style={INP} type="date" value={sellForm.date} onChange={e=>setSellForm(f=>({...f,date:e.target.value}))} /></FormRow>
                  <FormRow><label style={LBL}>Notes</label>
                    <input style={INP} placeholder="Optional" value={sellForm.notes} onChange={e=>setSellForm(f=>({...f,notes:e.target.value}))} /></FormRow>
                </FormGrid>
                {sellForm.units && sellForm.nav && (
                  <CalcPreview label="Redemption amount"
                    val={fmtINR(Number(sellForm.units)*Number(sellForm.nav))} />
                )}
              </Modal>
            )}

            {/* EDIT FUND */}
            {modal === 'edit-fund' && selFund && (
              <Modal title={`Edit — ${selFund.fund_name}`} onClose={()=>setModal(null)}
                onSave={updateFund} saveLabel="Save Changes" accent={C.mf.main}>
                <FormGrid>
                  <FormRow><label style={LBL}>SIP Amount (₹)</label>
                    <input style={INP} type="number" value={editForm.sip_amount??''} onChange={e=>setEditForm(f=>({...f,sip_amount:Number(e.target.value)}))} /></FormRow>
                  <FormRow><label style={LBL}>SIP Date</label>
                    <input style={INP} type="number" min="1" max="28" value={editForm.sip_date??''} onChange={e=>setEditForm(f=>({...f,sip_date:Number(e.target.value)}))} /></FormRow>
                  <FormRow><label style={LBL}>Category</label>
                    <select style={INP} value={editForm.category??'core'} onChange={e=>setEditForm(f=>({...f,category:e.target.value as any}))}>
                      <option value="core">Core</option><option value="growth">Growth</option><option value="satellite">Satellite</option>
                    </select></FormRow>
                  <FormRow><label style={LBL}>Sub Category</label>
                    <input style={INP} value={editForm.sub_category??''} onChange={e=>setEditForm(f=>({...f,sub_category:e.target.value}))} /></FormRow>
                </FormGrid>
              </Modal>
            )}

            {/* DELETE FUND */}
            {modal === 'delete' && selFund && (
              <Modal title="Remove Fund" onClose={()=>setModal(null)}
                onSave={deleteFund} saveLabel="Yes, Delete Permanently" accent={C.red}>
                <div style={{ textAlign:'center', padding:'16px 0' }}>
                  <div style={{ fontSize:40, marginBottom:12 }}>🗑️</div>
                  <div style={{ fontSize:16, fontWeight:600, marginBottom:8 }}>Remove {selFund.fund_name}?</div>
                  <div style={{ fontSize:13, color:C.text4, lineHeight:1.6 }}>
                    This will permanently delete the fund and all its transactions from Supabase.
                  </div>
                </div>
              </Modal>
            )}

          </div>
        </div>
      )}

      {/* Toast */}
      {toast.show && (
        <div style={{ position:'fixed', bottom:28, right:28, zIndex:999,
          background: toast.ok ? '#059669' : '#B45309',
          color:'white', padding:'12px 20px', borderRadius:12, fontSize:13, fontWeight:600,
          boxShadow:'0 8px 24px rgba(0,0,0,.2)' }}>
          {toast.ok ? '✓' : '⚠️'} {toast.msg}
        </div>
      )}
    </div>
  )
}

// ─── Small shared sub-components ─────────────────────────────────────────────
function Modal({ title, onClose, onSave, saveLabel, accent, children }: any) {
  return (
    <>
      <div style={{ padding:'20px 24px 16px', borderBottom:`1px solid ${C.border}`,
        display:'flex', justifyContent:'space-between', alignItems:'center',
        position:'sticky', top:0, background:'white', zIndex:1 }}>
        <div style={{ fontFamily:"'Syne',sans-serif", fontSize:16, fontWeight:700, color:C.text }}>{title}</div>
        <button onClick={onClose} style={{ width:30, height:30, borderRadius:'50%',
          border:`1px solid ${C.border}`, background:'#F9FAFB', cursor:'pointer',
          fontSize:14, color:C.text3 }}>✕</button>
      </div>
      <div style={{ padding:'20px 24px' }}>{children}</div>
      <div style={{ padding:'14px 24px 20px', borderTop:`1px solid ${C.border}`,
        display:'flex', justifyContent:'flex-end', gap:10 }}>
        <button onClick={onClose} style={{ padding:'10px 20px', background:'#F9FAFB',
          border:`1px solid ${C.border}`, borderRadius:10, fontSize:13, cursor:'pointer', fontWeight:500 }}>
          Cancel
        </button>
        <button onClick={onSave}
          style={{ padding:'10px 24px', background:accent, color:'white',
            border:'none', borderRadius:10, fontSize:13, fontWeight:600, cursor:'pointer' }}>
          {saveLabel}
        </button>
      </div>
    </>
  )
}

function FormGrid({ children }: any) {
  return <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>{children}</div>
}
function FormRow({ children, full }: any) {
  return <div style={{ gridColumn: full ? '1/-1' : undefined }}>{children}</div>
}
function CalcPreview({ label, val }: { label: string; val: string }) {
  return (
    <div style={{ background:'#EDE9FE', border:'1px solid #DDD6FE', borderRadius:10,
      padding:'12px 16px', marginTop:14, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
      <div style={{ fontSize:12, color:C.text3 }}>{label}</div>
      <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:18, fontWeight:700, color:C.mf.main }}>{val}</div>
    </div>
  )
}

function TableHeader({ cols, widths }: { cols: string[]; widths: string }) {
  return (
    <div style={{ display:'grid', gridTemplateColumns:widths, background:'#F8FAFC',
      padding:'10px 16px', borderBottom:`1px solid ${C.border}`, minWidth:640 }}>
      {cols.map(c => (
        <div key={c} style={{ fontSize:10, fontWeight:600, color:C.text4,
          textTransform:'uppercase', letterSpacing:'1px' }}>{c}</div>
      ))}
    </div>
  )
}

function Mono({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:12, color:C.text2, ...style }}>
      {children}
    </div>
  )
}
function ActionBtn({ children, color, bg, onClick }: any) {
  return (
    <button onClick={onClick}
      style={{ padding:'3px 10px', background:bg, color, border:'none',
        borderRadius:6, fontSize:11, cursor:'pointer', fontWeight:500 }}>
      {children}
    </button>
  )
}
function EmptyState({ msg }: { msg: string }) {
  return (
    <div style={{ padding:32, textAlign:'center', color:C.text4, fontSize:13 }}>
      <div style={{ fontSize:36, marginBottom:10 }}>📊</div>{msg}
    </div>
  )
}

function TxTable({ label, txns, onDelete, loading, showEmpty }: {
  label: string; txns: Transaction[]; onDelete: (id:string)=>void;
  loading: boolean; showEmpty?: boolean;
}) {
  const typeColor: Record<string,{bg:string,c:string}> = {
    sip:     { bg:'#ECFDF5', c:C.green  },
    buy:     { bg:'#ECFDF5', c:C.green  },
    sell:    { bg:'#FFF0F5', c:C.red    },
    lumpsum: { bg:'#EFF6FF', c:C.blue   },
  }
  return (
    <div style={{ background:'white', borderRadius:16, border:`1px solid ${C.border}`, overflow:'hidden' }}>
      {label && (
        <div style={{ padding:'16px 20px', borderBottom:`1px solid ${C.border}`,
          display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div style={{ fontSize:14, fontWeight:600, color:C.text }}>{label}</div>
          <div style={{ fontSize:12, color:C.text4 }}>{txns.length} entries</div>
        </div>
      )}
      <div style={{ overflowX:'auto' }}>
        <TableHeader cols={['Fund','Type','Amount','NAV','Units','Date','Action']}
          widths="2fr 80px 90px 70px 80px 90px 60px" />
        {loading
          ? [1,2,3].map(i => <div key={i} style={{ padding:'12px 16px', borderBottom:`1px solid ${C.border}` }}><Sk_local h={12} /></div>)
          : txns.length === 0 && showEmpty
            ? <EmptyState msg="No transactions found." />
            : txns.map((t,i) => (
                <div key={t.id} style={{ display:'grid', gridTemplateColumns:'2fr 80px 90px 70px 80px 90px 60px',
                  padding:'11px 16px', borderBottom:i<txns.length-1?`1px solid ${C.border}`:'none',
                  alignItems:'center', minWidth:640 }}>
                  <div style={{ fontSize:12, fontWeight:500, color:C.text }}>{t.fund_name}</div>
                  <div>
                    <span style={{ fontSize:10, padding:'2px 7px', borderRadius:4, fontWeight:500,
                      textTransform:'capitalize', ...(typeColor[t.type] || { bg:'#F3F4F6', c:C.text4 }) }}>
                      {t.type}
                    </span>
                  </div>
                  <Mono style={{ color: t.type==='sell'?C.red:C.green, fontWeight:600 }}>
                    {t.type==='sell'?'-':'+'}{fmtINR(t.amount)}
                  </Mono>
                  <Mono>₹{t.nav||'—'}</Mono>
                  <Mono>{t.units>0?t.units.toFixed(3):'—'}</Mono>
                  <Mono style={{ fontSize:11 }}>{t.date}</Mono>
                  <div>
                    <button onClick={()=>onDelete(t.id)}
                      style={{ padding:'3px 8px', background:'#F9FAFB', color:C.text4,
                        border:`1px solid ${C.border}`, borderRadius:6, fontSize:11, cursor:'pointer' }}>🗑</button>
                  </div>
                </div>
              ))
        }
      </div>
    </div>
  )
}

// Inline skeleton for use inside TxTable (can't use outer Sk due to scope)
function Sk_local({ h = 14 }: { h?: number }) {
  return (
    <div style={{
      height: h, width: '100%',
      background: 'linear-gradient(90deg,#E8ECF2 25%,#F5F7FA 50%,#E8ECF2 75%)',
      backgroundSize: '200% 100%', animation: 'skshimmer 1.5s infinite', borderRadius: 6,
    }} />
  )
}