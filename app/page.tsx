'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { calcProjection, MY_FUNDS } from '@/lib/funds'

// ─── FUND_COLORS built from canonical MY_FUNDS (fixes wrong ISINs) ────────────
const FUND_COLORS: Record<string, string> = Object.fromEntries(
  MY_FUNDS.map(f => [f.isin, f.color])
)

type Tab         = 'dashboard' | 'sip' | 'lumpsum' | 'projections' | 'agent' | 'transactions'
type ProjPeriod  = '3m' | '6m' | '1y' | '5y'
type AgentType   = 'weekly' | 'projection' | 'alert' | 'advice'
type ModalType   = 'add-sip' | 'add-lumpsum' | 'edit-fund' | 'buy' | 'sell' | 'delete' | null

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

const CAT_COLOR: Record<string, string> = {
  core: '#00B386', growth: '#F7941D', satellite: '#6B4EFF',
}

const fmtINR = (n: number) => {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`
  if (n >= 100000)   return `₹${(n / 100000).toFixed(2)} L`
  if (n >= 1000)     return `₹${(n / 1000).toFixed(1)} K`
  return `₹${n.toLocaleString()}`
}
const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`

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
        npv += f.amount / Math.pow(1 + rate, t)
        derivative += (-t * f.amount) / Math.pow(1 + rate, t + 1)
      }
      const newRate = rate - npv / derivative
      if (Math.abs(newRate - rate) < 0.00001) { rate = newRate; break }
      rate = newRate
    }
    return rate * 100
  } catch { return 0 }
}

// ─── Dynamic milestone helper ─────────────────────────────────────────────────
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
  { id: 'dashboard',    label: 'Dashboard',    short: 'Home',    icon: '📊' },
  { id: 'sip',         label: 'SIP Funds',    short: 'SIP',     icon: '🔄' },
  { id: 'lumpsum',     label: 'Lumpsum',      short: 'Lumpsum', icon: '💰' },
  { id: 'transactions',label: 'Transactions', short: 'Txns',    icon: '📋' },
  { id: 'projections', label: 'Projections',  short: 'Forecast',icon: '📈' },
  { id: 'agent',       label: 'AI Advisor',   short: 'AI',      icon: '🤖' },
]

export default function KBWealth() {
  const [tab, setTab]               = useState<Tab>('dashboard')
  const [funds, setFunds]           = useState<Fund[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [alerts, setAlerts]         = useState<Alert[]>([])
  const [loading, setLoading]       = useState(true)
  const [modal, setModal]           = useState<ModalType>(null)
  const [selectedFund, setSelectedFund] = useState<Fund | null>(null)
  const [projPeriod, setProjPeriod] = useState<ProjPeriod>('3m')
  const [agentOutput, setAgentOutput] = useState('')
  const [agentLoading, setAgentLoading] = useState(false)
  const [toast, setToast]           = useState({ msg: '', show: false, type: 'success' as 'success' | 'error' })
  const [txFilter, setTxFilter]     = useState('all')
  const [searchQuery, setSearchQuery] = useState('')

  const [sipForm, setSipForm]       = useState({
    fund_name: '', isin: '', amc: '', category: 'core', sub_category: '',
    sip_amount: '', sip_date: '1', start_date: '', color: '#00B386',
  })
  const [lumpsumForm, setLumpsumForm] = useState({ fund_name: '', amount: '', nav: '', date: '', notes: '' })
  const [buyForm, setBuyForm]       = useState({ amount: '', nav: '', date: new Date().toISOString().split('T')[0], notes: '' })
  const [sellForm, setSellForm]     = useState({ units: '', nav: '', date: new Date().toISOString().split('T')[0], notes: '' })
  const [editForm, setEditForm]     = useState<Partial<Fund>>({})

  const showToast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, show: true, type })
    setTimeout(() => setToast(t => ({ ...t, show: false })), 2800)
  }, [])

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const { data: pfData, error: pfError } = await supabase
        .from('portfolio_funds').select('*').order('category')
      if (pfError) console.error('portfolio_funds:', pfError)

      const { data: txData, error: txError } = await supabase
        .from('transactions').select('*, portfolio_funds(fund_name)')
        .order('invest_date', { ascending: false })
      if (txError) console.error('transactions:', txError)

      // ── FIX: filter nav_history to only fund ISINs — no more blind limit(100) ──
      const isins = (pfData || []).map(f => f.isin).filter(Boolean)
      const { data: navData, error: navError } = await supabase
        .from('nav_history')
        .select('isin, nav, nav_date')
        .in('isin', isins)
        .order('nav_date', { ascending: false })
      if (navError) console.error('nav_history:', navError)

      const { data: alertData, error: alertError } = await supabase
        .from('alerts_log').select('*').order('triggered_at', { ascending: false }).limit(30)
      if (alertError) console.error('alerts_log:', alertError)

      if (!pfData || pfData.length === 0) { setLoading(false); return }

      // Build nav map (most recent per ISIN)
      const navMap: Record<string, number> = {}
      for (const n of navData || []) {
        if (!navMap[n.isin]) navMap[n.isin] = n.nav
      }

      const enriched: Fund[] = (pfData || []).map(f => {
        const myTxs = (txData || []).filter(t => t.fund_id === f.id)
        let invested = 0, units = 0
        for (const t of myTxs) {
          const amt = Number(t.amount), u = Number(t.units_allotted) || 0
          if (['sip','lumpsum','buy','stp','switch_in'].includes(t.type)) { invested += amt; units += u }
          if (['sell','switch_out'].includes(t.type)) { units -= u }
        }
        const nav = navMap[f.isin] || 0
        const cv  = nav > 0 ? units * nav : (f.current_value || invested)
        return {
          ...f, invested, units,
          current_nav:   nav,
          current_value: cv,
          is_active:     f.is_active ?? true,
          color:         FUND_COLORS[f.isin] || CAT_COLOR[f.category] || '#0066FF',
        }
      })

      setFunds(enriched)
      setTransactions((txData || []).map(t => ({
        id: t.id, fund_id: t.fund_id,
        fund_name: t.portfolio_funds?.fund_name || '—',
        type: t.type, amount: Number(t.amount),
        nav: Number(t.nav_at_purchase) || 0,
        units: Number(t.units_allotted) || 0,
        date: t.invest_date, status: 'completed', notes: t.notes || '',
      })))
      setAlerts(alertData || [])
    } catch (e) { console.error('loadAll error:', e) }
    setLoading(false)
  }

  // ── Portfolio metrics (all computed, nothing hardcoded) ───────────────────
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

  // ── Projections — live, not hardcoded ────────────────────────────────────
  const projData = useMemo(() => {
    const cv = totalCurrent, sip = totalSIP
    return {
      '3m': { bear: fmtINR(calcProjection(cv, sip, 3,  10)), base: fmtINR(calcProjection(cv, sip, 3,  13)), bull: fmtINR(calcProjection(cv, sip, 3,  16)) },
      '6m': { bear: fmtINR(calcProjection(cv, sip, 6,  10)), base: fmtINR(calcProjection(cv, sip, 6,  13)), bull: fmtINR(calcProjection(cv, sip, 6,  16)) },
      '1y': { bear: fmtINR(calcProjection(cv, sip, 12, 10)), base: fmtINR(calcProjection(cv, sip, 12, 13)), bull: fmtINR(calcProjection(cv, sip, 12, 16)) },
      '5y': { bear: fmtINR(calcProjection(cv, sip, 60, 10)), base: fmtINR(calcProjection(cv, sip, 60, 13)), bull: fmtINR(calcProjection(cv, sip, 60, 16)) },
    }
  }, [totalCurrent, totalSIP])

  // ── Projections component breakdown ──────────────────────────────────────
  const breakdown = useMemo(() => {
    const m   = { '3m': 3, '6m': 6, '1y': 12, '5y': 60 }[projPeriod]
    const r   = 13 / 12 / 100
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

  // ── Milestones — computed from live data ──────────────────────────────────
  const milestones = useMemo(() => {
    const targets = [
      { icon: '🎯', label: '₹75L milestone',  target: 7500000  },
      { icon: '🚀', label: '₹80L milestone',  target: 8000000  },
      { icon: '💎', label: '₹1 Crore',        target: 10000000 },
      { icon: '🏆', label: '₹1.71 Crore',     target: 17100000 },
      { icon: '👑', label: '₹3.74 Crore',     target: 37400000 },
    ]
    return targets.map(t => {
      const mBase = monthsToTarget(totalCurrent, totalSIP, t.target, 13)
      const mBear = monthsToTarget(totalCurrent, totalSIP, t.target, 10)
      const mBull = monthsToTarget(totalCurrent, totalSIP, t.target, 16)
      const already = totalCurrent >= t.target
      const bearV = mBear ? fmtINR(calcProjection(totalCurrent, totalSIP, mBear, 13)) : '—'
      const bullV = mBull ? fmtINR(calcProjection(totalCurrent, totalSIP, mBull ?? 0, 16)) : '—'
      return {
        ...t,
        date:  already ? 'Already reached ✓' : targetDate(mBase),
        range: already ? fmtINR(totalCurrent) : `${fmtINR(calcProjection(totalCurrent, totalSIP, mBase ?? 0, 10))}–${fmtINR(calcProjection(totalCurrent, totalSIP, mBase ?? 0, 16))}`,
      }
    })
  }, [totalCurrent, totalSIP])

  // ── Portfolio context for AI (always live) ────────────────────────────────
  const portfolioCtx = `KB's Live Portfolio — ${new Date().toDateString()}
Total Value: ${fmtINR(totalCurrent)} | Invested: ${fmtINR(totalInvested)} | Returns: ${fmtINR(totalGain)} (${fmtPct(gainPct)}) | XIRR: ${fmtPct(xirr)}
Monthly SIP: ₹${totalSIP.toLocaleString()}/month across ${activeFunds.length} active funds

Active SIP Funds:
${activeFunds.map(f => `• ${f.fund_name} | ₹${f.sip_amount.toLocaleString()}/mo | NAV ₹${f.current_nav} | Invested ${fmtINR(f.invested)} | Current ${fmtINR(f.current_value)} | Return ${fmtPct(f.invested > 0 ? ((f.current_value - f.invested) / f.invested) * 100 : 0)}`).join('\n')}

All Holdings (${funds.length} funds):
${funds.map(f => `• ${f.fund_name}: ${fmtINR(f.current_value)} (${f.category})`).join('\n')}

3M Projection (Base @13%): ${projData['3m']?.base || '—'}
Goals: ₹1Cr by ${milestones[2]?.date || '—'} | ₹1.71Cr by ${milestones[3]?.date || '—'}`

  // ── CRUD ─────────────────────────────────────────────────────────────────
  const addSIP = async () => {
    if (!sipForm.fund_name || !sipForm.sip_amount) { showToast('Fund name and SIP amount required', 'error'); return }
    const { error } = await supabase.from('portfolio_funds').insert({
      fund_name: sipForm.fund_name, isin: sipForm.isin, amc: sipForm.amc,
      category: sipForm.category, sub_category: sipForm.sub_category,
      sip_amount: Number(sipForm.sip_amount), sip_date: Number(sipForm.sip_date),
      start_date: sipForm.start_date || null, target_pct: 0, is_active: true,
    })
    if (error) { showToast('Error: ' + error.message, 'error'); return }
    showToast(`SIP added for ${sipForm.fund_name}`)
    setSipForm({ fund_name:'', isin:'', amc:'', category:'core', sub_category:'', sip_amount:'', sip_date:'1', start_date:'', color:'#00B386' })
    setModal(null); loadAll()
  }

  const addLumpsum = async () => {
    if (!lumpsumForm.fund_name || !lumpsumForm.amount) { showToast('Fund and amount required', 'error'); return }
    const fund = funds.find(f => f.fund_name === lumpsumForm.fund_name)
    if (!fund) { showToast('Select a fund from the list', 'error'); return }
    const amount = Number(lumpsumForm.amount)
    const nav    = Number(lumpsumForm.nav) || 0
    const units  = nav > 0 ? amount / nav : 0
    const { error } = await supabase.from('transactions').insert({
      fund_id: fund.id, type: 'lumpsum', amount,
      nav_at_purchase: nav || null, units_allotted: units || null,
      invest_date: lumpsumForm.date || new Date().toISOString().split('T')[0],
      notes: lumpsumForm.notes || null,
    })
    if (error) { showToast('Error: ' + error.message, 'error'); return }
    showToast(`Lumpsum of ${fmtINR(amount)} saved`)
    setLumpsumForm({ fund_name:'', amount:'', nav:'', date:'', notes:'' })
    setModal(null); loadAll()
  }

  const buyFund = async () => {
    if (!selectedFund || !buyForm.amount) { showToast('Enter amount', 'error'); return }
    const amount = Number(buyForm.amount), nav = Number(buyForm.nav) || selectedFund.current_nav
    const { error } = await supabase.from('transactions').insert({
      fund_id: selectedFund.id, type: 'buy', amount,
      nav_at_purchase: nav, units_allotted: nav > 0 ? amount / nav : 0,
      invest_date: buyForm.date, notes: buyForm.notes || null,
    })
    if (error) { showToast('Error: ' + error.message, 'error'); return }
    showToast(`Bought ${fmtINR(amount)} of ${selectedFund.fund_name}`)
    setModal(null); loadAll()
  }

  const sellFund = async () => {
    if (!selectedFund || !sellForm.units) { showToast('Enter units', 'error'); return }
    const units = Number(sellForm.units), nav = Number(sellForm.nav) || selectedFund.current_nav
    if (units > selectedFund.units) { showToast('Insufficient units', 'error'); return }
    const { error } = await supabase.from('transactions').insert({
      fund_id: selectedFund.id, type: 'sell', amount: units * nav,
      nav_at_purchase: nav, units_allotted: units,
      invest_date: sellForm.date, notes: sellForm.notes || null,
    })
    if (error) { showToast('Error: ' + error.message, 'error'); return }
    showToast(`Sell order placed — ${fmtINR(units * nav)}`)
    setModal(null); loadAll()
  }

  const deleteTx = async (id: string) => {
    const { error } = await supabase.from('transactions').delete().eq('id', id)
    if (error) { showToast('Error: ' + error.message, 'error'); return }
    showToast('Transaction deleted'); loadAll()
  }

  const updateFund = async () => {
    if (!selectedFund) return
    // Strip computed/UI-only fields before save
    const { invested, current_value, units, current_nav, color, ...safeEdits } = editForm as any
    const { error } = await supabase.from('portfolio_funds').update(safeEdits).eq('id', selectedFund.id)
    if (error) { showToast('Error: ' + error.message, 'error'); return }
    showToast('Fund updated'); setModal(null); loadAll()
  }

  const deleteFund = async () => {
    if (!selectedFund) return
    await supabase.from('transactions').delete().eq('fund_id', selectedFund.id)
    const { error } = await supabase.from('portfolio_funds').delete().eq('id', selectedFund.id)
    if (error) { showToast('Error: ' + error.message, 'error'); return }
    showToast(`${selectedFund.fund_name} removed`); setModal(null); loadAll()
  }

  const toggleSIP = async (fund: Fund) => {
    const { error } = await supabase.from('portfolio_funds').update({ is_active: !fund.is_active }).eq('id', fund.id)
    if (error) { showToast('Error: ' + error.message, 'error'); return }
    showToast(!fund.is_active ? 'SIP resumed' : 'SIP paused'); loadAll()
  }

  const markAlertRead = async (id: string) => {
    await supabase.from('alerts_log').update({ is_read: true }).eq('id', id)
    setAlerts(a => a.map(x => x.id === id ? { ...x, is_read: true } : x))
  }

  // ── AI Agent — only fires when user explicitly clicks ────────────────────
  const QUICK_PROMPTS: Record<AgentType, string> = {
    weekly:     `Generate a sharp WhatsApp-style weekly brief for KB. Emojis. 10-12 bullet lines. Include portfolio score/100, XIRR status, each fund's status, one specific action this week, next SIP reminder. Be specific.\n\n${portfolioCtx}`,
    projection: `Based on Indian market conditions ${new Date().toDateString()}, give KB a realistic 3M and 6M projection. Which scenario (bear/base/bull) is most likely? Which of his funds will outperform/underperform? Be specific with numbers.\n\n${portfolioCtx}`,
    alert:      `Check KB's portfolio for active alerts as of ${new Date().toDateString()}. Format: 🔴 Critical | 🟡 Warning | 🟢 Opportunity. Cover: pending exits, regular-plan expense drags, sectoral risks, rebalancing needs. Max 2 lines per alert.\n\n${portfolioCtx}`,
    advice:     `Give KB 3 highly specific actionable moves for this month. Reference exact fund names and ₹ amounts. Include one tax tip, one rebalancing action, one deployment decision.\n\n${portfolioCtx}`,
  }

  const runAgent = useCallback(async (type: AgentType) => {
    setAgentLoading(true)
    setAgentOutput('Analysing your portfolio...')
    try {
      const res  = await fetch('/api/agent', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customPrompt: QUICK_PROMPTS[type] }),
      })
      const data = await res.json()
      setAgentOutput(data.result || 'No response from agent.')

      // ── FIX: insert only columns that exist in alerts_log schema ──────────
      await supabase.from('alerts_log').insert({
        alert_type:   type === 'weekly' ? 'weekly_brief' : type,
        fund_name:    'AI_AGENT',
        message:      (data.result || '').slice(0, 500),
        triggered_at: new Date().toISOString(),
        is_read:      false,
      })
      loadAll()   // refresh alerts list after new one is inserted
    } catch {
      setAgentOutput('⚠️ Could not connect to AI agent.')
    }
    setAgentLoading(false)
  }, [portfolioCtx])

  // ── Filtered transactions ─────────────────────────────────────────────────
  const filteredTx = transactions.filter(t => {
    if (txFilter !== 'all' && t.type !== txFilter) return false
    if (searchQuery && !t.fund_name.toLowerCase().includes(searchQuery.toLowerCase())) return false
    return true
  })

  // ── Action Centre: only AI-generated alerts, not nav_drop system alerts ───
  const actionAlerts = alerts.filter(a =>
    ['weekly_brief','weekly','projection','alert','advice','custom'].includes(a.alert_type)
    && !a.is_read
  ).slice(0, 4)

  const unreadAlerts = alerts.filter(a => !a.is_read)

  const Sk = ({ h = 14, w = '100%', mb = 0 }: { h?: number; w?: string | number; mb?: number }) => (
    <div style={{
      height: h, width: w, marginBottom: mb,
      background: 'linear-gradient(90deg,#E8ECF2 25%,#F5F7FA 50%,#E8ECF2 75%)',
      backgroundSize: '200% 100%', animation: 'shimmer 1.5s infinite', borderRadius: 6,
    }} />
  )

  const getFundStatus = (f: Fund): { label: string; st: string } => {
    if (!f.is_active) return { label: 'SIP Paused', st: 'warn' }
    if (f.sip_amount > 0) return { label: 'SIP Active', st: 'ok' }
    return { label: 'Hold', st: 'neutral' }
  }

  // ── Helper: decode alert_type into a readable action title ────────────────
  const alertTitle = (a: Alert): string => {
    const map: Record<string, string> = {
      weekly_brief: '📊 Weekly Brief',
      weekly:       '📊 Weekly Brief',
      projection:   '📅 Projection Update',
      alert:        '⚡ Portfolio Alert',
      advice:       '💡 Advisor Recommendation',
      custom:       '🤖 AI Insight',
    }
    return map[a.alert_type] || `🔔 ${a.alert_type}`
  }
  const alertClass = (a: Alert): string => {
    const map: Record<string, string> = {
      alert: 'critical', advice: 'warning',
      projection: 'info', weekly_brief: 'info', weekly: 'info',
    }
    return map[a.alert_type] || 'info'
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div style={{ minHeight: '100vh', background: '#F5F7FA', fontFamily: "'DM Sans',-apple-system,sans-serif" }}>
      <style>{STYLES}</style>

      <nav className="topnav">
        <div className="topnav-inner">
          <div className="brand">
            <div className="brand-icon">₹</div>
            <div>
              <div className="brand-name">KB Wealth</div>
              <div className="brand-sub">Portfolio Manager</div>
            </div>
          </div>
          <div className="nav-tabs">
            {TABS.map(t => (
              <button key={t.id} className={`ntab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id as Tab)}>
                <span>{t.icon}</span><span>{t.label}</span>
              </button>
            ))}
          </div>
          <div className="nav-right">
            {unreadAlerts.length > 0 && <div className="alert-count">{unreadAlerts.length}</div>}
            <div className="xirr-pill">XIRR {loading ? '...' : fmtPct(xirr)}</div>
            <div className="avatar">KB</div>
          </div>
        </div>
      </nav>

      <main className="main">

        {/* DASHBOARD */}
        {tab === 'dashboard' && (
          <div className="fade-in">
            <div className="portfolio-hero">
              <div>
                <div className="ph-label">Total Portfolio Value</div>
                {loading
                  ? <div style={{ height: 52, width: 200 }} className="sk-white" />
                  : <div className="ph-value">{fmtINR(totalCurrent)}</div>
                }
                {/* ── FIX: removed hardcoded day P&L ── */}
                <div className="ph-change">
                  <span className="gain-badge">{totalGain >= 0 ? '+' : ''}{fmtINR(totalGain)} ({fmtPct(gainPct)})</span>
                </div>
              </div>
              <div className="ph-stats">
                {[
                  { label: 'Invested',     value: fmtINR(totalInvested) },
                  { label: 'Monthly SIP',  value: `₹${totalSIP.toLocaleString()}` },
                  { label: 'XIRR',         value: loading ? '...' : fmtPct(xirr), green: xirr >= 0 },
                  { label: 'Active Funds', value: String(activeFunds.length) },
                ].map(s => (
                  <div key={s.label} className="ph-stat">
                    <div className="ph-stat-l">{s.label}</div>
                    <div className="ph-stat-v" style={s.green ? { color: '#7BFFD1' } : {}}>
                      {loading ? '...' : s.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="qs-grid">
              {[
                { label: 'Total Invested',  value: fmtINR(totalInvested),   sub: `${funds.length} funds`,       color: '#0066FF', bg: '#EEF4FF' },
                { label: 'Total Returns',   value: fmtINR(totalGain),        sub: fmtPct(gainPct),              color: '#00B386', bg: '#E6FAF5' },
                { label: '3M Target',       value: projData['3m']?.base || '—', sub: 'Base @13% XIRR',         color: '#F7941D', bg: '#FFF4E6' },
                { label: 'Portfolio Score', value: `${Math.min(100,Math.max(60,Math.round(70+gainPct/2+activeFunds.length)))}/100`, sub: 'After cleanup', color: '#6B4EFF', bg: '#F0EEFF' },
              ].map(s => (
                <div key={s.label} className="qs-card" style={{ '--acc': s.color, '--acb': s.bg } as any}>
                  <div className="qs-l">{s.label}</div>
                  <div className="qs-v" style={{ color: s.color }}>{loading ? '...' : s.value}</div>
                  <div className="qs-s">{s.sub}</div>
                </div>
              ))}
            </div>

            <div className="dash-grid">
              <div className="card">
                <div className="card-header">
                  <div className="card-title">Live Allocation</div>
                  <div className="card-sub">{funds.length} funds</div>
                </div>
                {loading
                  ? [1,2,3,4,5,6].map(i => (
                      <div key={i} style={{ display:'flex', gap:8, marginBottom:10 }}>
                        <Sk h={8} w={8} /><Sk h={8} w="60%" /><Sk h={8} w="20%" />
                      </div>
                    ))
                  : funds.map(f => {
                      const pct = totalCurrent > 0 ? (f.current_value / totalCurrent) * 100 : 0
                      return (
                        <div key={f.id} className="alloc-row">
                          <div className="alloc-dot" style={{ background: f.color }} />
                          <div className="alloc-name">
                            {f.fund_name.replace(' Direct','').replace(' Fund','').split(' ').slice(0,3).join(' ')}
                          </div>
                          <div className="alloc-bar-w">
                            <div className="alloc-bar">
                              <div className="alloc-fill" style={{ width: `${pct}%`, background: f.color }} />
                            </div>
                          </div>
                          <div className="alloc-pct">{pct.toFixed(1)}%</div>
                          <div className="alloc-val">{fmtINR(f.current_value)}</div>
                        </div>
                      )
                    })
                }
              </div>

              {/* ── FIX: Action Centre shows ONLY previous AI results, no auto-agent call ── */}
              <div className="card">
                <div className="card-header">
                  <div className="card-title">Action Centre</div>
                  {/* Refresh now just reloads DB — does NOT call Claude API */}
                  <button className="btn-sm" onClick={loadAll}>↻ Refresh</button>
                </div>

                {loading ? (
                  [1,2,3].map(i => <div key={i} style={{ marginBottom:10 }}><Sk h={60} /></div>)
                ) : actionAlerts.length === 0 ? (
                  <div style={{ padding:'20px 0', textAlign:'center', color:'#9EA3BA', fontSize:13 }}>
                    <div style={{ fontSize:28, marginBottom:8 }}>🤖</div>
                    No AI recommendations yet.
                    <br />Run <strong>AI Advisor → Check Alerts</strong> to generate actions.
                  </div>
                ) : (
                  actionAlerts.map(a => (
                    <div key={a.id} className={`action-item ${alertClass(a)}`}
                      onClick={() => markAlertRead(a.id)} style={{ cursor:'pointer' }}>
                      <div className="action-ico">
                        {{ critical:'⚡', warning:'🟡', info:'💡', success:'✅' }[alertClass(a)] || '🔔'}
                      </div>
                      <div style={{ flex:1 }}>
                        <div className={`action-title ${alertClass(a)}`}>{alertTitle(a)}</div>
                        <div className="action-desc">{a.message.slice(0, 120)}…</div>
                        <div style={{ fontSize:10, color:'#9EA3BA', marginTop:3 }}>
                          {new Date(a.triggered_at).toLocaleDateString('en-IN', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}
                        </div>
                      </div>
                      <div style={{ fontSize:10, color:'#9EA3BA', marginLeft:'auto', flexShrink:0 }}>tap to dismiss</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* SIP FUNDS */}
        {tab === 'sip' && (
          <div className="fade-in">
            <div className="page-header">
              <div>
                <div className="page-title">SIP Portfolio</div>
                <div className="page-sub">{activeFunds.length} active SIPs · ₹{totalSIP.toLocaleString()}/month</div>
              </div>
              <button className="btn-primary" onClick={() => setModal('add-sip')}>+ Add SIP</button>
            </div>
            {loading
              ? [1,2,3].map(i => <div key={i} className="fund-card"><Sk h={20} mb={12} /><Sk h={60} /></div>)
              : (['core','growth','satellite'] as const).map(cat => {
                  const cf = funds.filter(f => f.category === cat)
                  if (!cf.length) return null
                  const ci = cf.reduce((s,f) => s+f.invested,0)
                  const cc = cf.reduce((s,f) => s+f.current_value,0)
                  return (
                    <div key={cat}>
                      <div className="cat-header">
                        <span className={`cat-badge ${cat}`}>{cat.toUpperCase()}</span>
                        <div className="cat-stats">
                          <span>{fmtINR(cc)}</span>
                          <span className={cc>ci?'green':'red'}>{fmtPct(ci>0?((cc-ci)/ci)*100:0)}</span>
                        </div>
                      </div>
                      {cf.map(f => {
                        const ret = f.invested > 0 ? ((f.current_value - f.invested) / f.invested) * 100 : 0
                        return (
                          <div key={f.id} className="fund-card">
                            <div className="fund-card-top">
                              <div className="fund-color-bar" style={{ background: f.color }} />
                              <div className="fund-info">
                                <div className="fund-name">{f.fund_name}</div>
                                <div className="fund-meta">
                                  <span className="fund-amc">{f.amc || f.category}</span>
                                  {f.sub_category && <span className="fund-cat-pill">{f.sub_category}</span>}
                                  <span className={f.is_active && f.sip_amount > 0 ? 'sip-active-pill' : 'sip-paused-pill'}>
                                    {f.sip_amount > 0 ? (f.is_active ? 'SIP Active' : 'SIP Paused') : 'No SIP'}
                                  </span>
                                </div>
                              </div>
                              <div className="fund-return-block">
                                <div className={`fund-ret ${ret >= 0 ? 'green' : 'red'}`}>{fmtPct(ret)}</div>
                                <div className="fund-gain">{fmtINR(Math.abs(f.current_value - f.invested))}</div>
                              </div>
                            </div>
                            <div className="fund-stats-row">
                              {f.sip_amount > 0 && (
                                <div className="fsr"><div className="fsr-l">SIP/Month</div><div className="fsr-v">₹{f.sip_amount.toLocaleString()}</div></div>
                              )}
                              <div className="fsr"><div className="fsr-l">Invested</div><div className="fsr-v">{fmtINR(f.invested)}</div></div>
                              <div className="fsr"><div className="fsr-l">Current</div><div className="fsr-v">{fmtINR(f.current_value)}</div></div>
                              <div className="fsr"><div className="fsr-l">Units</div><div className="fsr-v">{f.units.toFixed(3)}</div></div>
                              <div className="fsr"><div className="fsr-l">NAV</div><div className="fsr-v">₹{f.current_nav}</div></div>
                            </div>
                            <div className="fund-actions">
                              <button className="fa-btn buy" onClick={() => { setSelectedFund(f); setBuyForm({ amount:'', nav:String(f.current_nav), date:new Date().toISOString().split('T')[0], notes:'' }); setModal('buy') }}>+ Buy</button>
                              <button className="fa-btn sell" onClick={() => { setSelectedFund(f); setSellForm({ units:'', nav:String(f.current_nav), date:new Date().toISOString().split('T')[0], notes:'' }); setModal('sell') }}>− Sell</button>
                              <button className="fa-btn edit" onClick={() => { setSelectedFund(f); setEditForm({ sip_amount:f.sip_amount, sip_date:f.sip_date, current_nav:f.current_nav, is_active:f.is_active, category:f.category, sub_category:f.sub_category }); setModal('edit-fund') }}>✏️ Edit</button>
                              {f.sip_amount > 0 && <button className="fa-btn pause" onClick={() => toggleSIP(f)}>{f.is_active ? '⏸ Pause' : '▶ Resume'}</button>}
                              <button className="fa-btn del" onClick={() => { setSelectedFund(f); setModal('delete') }}>🗑</button>
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

        {/* LUMPSUM */}
        {tab === 'lumpsum' && (
          <div className="fade-in">
            <div className="page-header">
              <div>
                <div className="page-title">Lumpsum Holdings</div>
                <div className="page-sub">{loading ? '...' : `${funds.length} positions`}</div>
              </div>
              <button className="btn-primary" onClick={() => setModal('add-lumpsum')}>+ Add Lumpsum</button>
            </div>
            <div className="qs-grid" style={{ marginBottom: 20 }}>
              {[
                { label: 'Total Invested', value: fmtINR(totalInvested),                           color: '#0066FF', bg: '#EEF4FF' },
                { label: 'Current Value',  value: fmtINR(totalCurrent),                            color: '#00B386', bg: '#E6FAF5' },
                { label: 'Total Gain',     value: (totalGain>=0?'+':'')+fmtINR(totalGain),         color: '#00B386', bg: '#E6FAF5' },
                { label: 'Best Return',    value: loading ? '...' : fmtPct(bestReturn),             color: '#6B4EFF', bg: '#F0EEFF' },
              ].map(s => (
                <div key={s.label} className="qs-card" style={{ '--acc': s.color, '--acb': s.bg } as any}>
                  <div className="qs-l">{s.label}</div>
                  <div className="qs-v" style={{ color: s.color }}>{loading ? '...' : s.value}</div>
                </div>
              ))}
            </div>
            <div className="card">
              <div className="card-header">
                <div className="card-title">All Holdings</div>
                <div className="card-sub">{loading ? '...' : `${funds.length} positions`}</div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <div className="lt-header lt-grid-lump">
                  <div>Fund</div><div>AMC / Type</div><div>Invested</div><div>Current</div><div>Return</div><div>Status / Action</div>
                </div>
                {loading
                  ? [1,2,3,4,5,6].map(i => <div key={i} className="lt-row lt-grid-lump">{[1,2,3,4,5,6].map(j => <Sk key={j} h={12} />)}</div>)
                  : funds.length === 0
                    ? <div style={{ padding:24, color:'#9EA3BA', textAlign:'center' }}>No funds found.</div>
                    : funds.map(f => {
                        const ret = f.invested > 0 ? ((f.current_value - f.invested) / f.invested) * 100 : 0
                        const { label: statusLabel, st: statusSt } = getFundStatus(f)
                        const typeStr = [f.sub_category || f.category, f.sip_amount > 0 ? `SIP ₹${f.sip_amount.toLocaleString()}/mo` : null, !f.is_active ? '⏸ Paused' : null].filter(Boolean).join(' · ')
                        return (
                          <div key={f.id} className="lt-row lt-grid-lump">
                            <div>
                              <div className="lt-fund" style={{ display:'flex', alignItems:'center', gap:6 }}>
                                <div style={{ width:4, height:32, borderRadius:2, background:f.color, flexShrink:0 }} />
                                <span>{f.fund_name}</span>
                              </div>
                            </div>
                            <div style={{ fontSize:11, color:'#9EA3BA', lineHeight:1.5 }}>
                              <div>{f.amc || '—'}</div><div style={{ fontSize:10 }}>{typeStr}</div>
                            </div>
                            <div className="lt-mono">{fmtINR(f.invested)}</div>
                            <div className="lt-mono">{fmtINR(f.current_value)}</div>
                            <div className={`lt-mono ${ret>=0?'green':'red'}`}>{fmtPct(ret)}</div>
                            <div style={{ display:'flex', alignItems:'center', gap:5, flexWrap:'wrap' }}>
                              <span className={`spill ${statusSt}`}>{statusLabel}</span>
                              <button className="fa-btn buy" style={{ padding:'3px 10px', fontSize:11 }} onClick={() => { setSelectedFund(f); setBuyForm({ amount:'', nav:String(f.current_nav), date:new Date().toISOString().split('T')[0], notes:'' }); setModal('buy') }}>Buy</button>
                              <button className="fa-btn sell" style={{ padding:'3px 10px', fontSize:11 }} onClick={() => { setSelectedFund(f); setSellForm({ units:'', nav:String(f.current_nav), date:new Date().toISOString().split('T')[0], notes:'' }); setModal('sell') }}>Sell</button>
                            </div>
                          </div>
                        )
                      })
                }
              </div>
            </div>
            <div className="card" style={{ marginTop:16 }}>
              <div className="card-header">
                <div className="card-title">Lumpsum Transactions</div>
                <div className="card-sub">{transactions.filter(t=>t.type==='lumpsum').length} entries</div>
              </div>
              <div style={{ overflowX:'auto' }}>
                <div className="lt-header lt-grid7">
                  <div>Fund</div><div>Type</div><div>Amount</div><div>NAV</div><div>Units</div><div>Date</div><div>Action</div>
                </div>
                {transactions.filter(t=>t.type==='lumpsum').map(t => (
                  <div key={t.id} className="lt-row lt-grid7">
                    <div className="lt-fund">{t.fund_name}</div>
                    <div><span className="ttype lumpsum">lumpsum</span></div>
                    <div className="lt-mono green">+{fmtINR(t.amount)}</div>
                    <div className="lt-mono">₹{t.nav||'—'}</div>
                    <div className="lt-mono">{t.units>0?t.units.toFixed(3):'—'}</div>
                    <div className="lt-mono" style={{ fontSize:11 }}>{t.date}</div>
                    <div><button className="fa-btn del" style={{ padding:'3px 8px', fontSize:11 }} onClick={()=>deleteTx(t.id)}>🗑</button></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TRANSACTIONS */}
        {tab === 'transactions' && (
          <div className="fade-in">
            <div className="page-header">
              <div><div className="page-title">Transactions</div><div className="page-sub">{transactions.length} total</div></div>
              <button className="btn-primary" onClick={() => setModal('add-lumpsum')}>+ New</button>
            </div>
            <div className="card">
              <div className="tx-filters">
                <input className="tx-search" placeholder="Search fund..." value={searchQuery} onChange={e=>setSearchQuery(e.target.value)} />
                <div className="tx-ftabs">
                  {['all','sip','lumpsum','buy','sell'].map(f => (
                    <button key={f} className={`ftab${txFilter===f?' active':''}`} onClick={()=>setTxFilter(f)}>{f.toUpperCase()}</button>
                  ))}
                </div>
              </div>
              <div style={{ overflowX:'auto' }}>
                <div className="lt-header lt-grid7">
                  <div>Fund</div><div>Type</div><div>Amount</div><div>NAV</div><div>Units</div><div>Date</div><div>Action</div>
                </div>
                {filteredTx.map(t => (
                  <div key={t.id} className="lt-row lt-grid7">
                    <div className="lt-fund">{t.fund_name}</div>
                    <div><span className={`ttype ${t.type}`}>{t.type}</span></div>
                    <div className={`lt-mono ${t.type==='sell'?'red':'green'}`}>{t.type==='sell'?'-':'++'}{fmtINR(t.amount)}</div>
                    <div className="lt-mono">₹{t.nav||'—'}</div>
                    <div className="lt-mono">{t.units>0?t.units.toFixed(3):'—'}</div>
                    <div className="lt-mono" style={{ fontSize:11 }}>{t.date}</div>
                    <div><button className="fa-btn del" style={{ padding:'3px 8px', fontSize:11 }} onClick={()=>deleteTx(t.id)}>🗑</button></div>
                  </div>
                ))}
                {!loading && filteredTx.length === 0 && <div style={{ padding:20, color:'#9EA3BA', textAlign:'center' }}>No transactions found</div>}
              </div>
            </div>
          </div>
        )}

        {/* PROJECTIONS — all data computed from live portfolio */}
        {tab === 'projections' && (
          <div className="fade-in">
            <div className="page-header"><div className="page-title">Wealth Projections</div></div>
            <div className="proj-bar">
              {(['3m','6m','1y','5y'] as ProjPeriod[]).map(p => (
                <button key={p} className={`period-btn${projPeriod===p?' active':''}`} onClick={()=>setProjPeriod(p)}>
                  {p==='3m'?'3 Months':p==='6m'?'6 Months':p==='1y'?'1 Year':'5 Years'}
                </button>
              ))}
            </div>
            <div className="scenario-row">
              {[
                { label:'Bear Case', key:'bear', xirr:'10%', color:'#E63946', desc:'Global slowdown, India moderates' },
                { label:'Base Case', key:'base', xirr:'13%', color:'#F7941D', desc:'Most likely — India story intact', active: true },
                { label:'Bull Case', key:'bull', xirr:'16%', color:'#00B386', desc:'All themes fire, extended bull run' },
              ].map(s => (
                <div key={s.key} className={`sc-card${s.active?' active':''}`}>
                  <div className="sc-label" style={{ color: s.color }}>{s.label}</div>
                  <div className="sc-xirr">@ {s.xirr} XIRR</div>
                  <div className="sc-val" style={{ color: s.color }}>
                    {loading ? '...' : projData[projPeriod]?.[s.key as 'bear'|'base'|'bull'] || '—'}
                  </div>
                  <div className="sc-desc">{s.desc}</div>
                </div>
              ))}
            </div>
            <div className="dash-grid">
              {/* Component Breakdown — computed from live data */}
              <div className="card">
                <div className="card-header"><div className="card-title">Component Breakdown</div><div className="card-sub">Base @13% XIRR</div></div>
                {[
                  { label:'Existing Corpus Growth', val: breakdown.corpus.val,   w: Math.min(95, breakdown.corpus.pct),   color:'#0066FF' },
                  { label:'New SIP Contribution',   val: breakdown.sipContr.val, w: Math.min(95, breakdown.sipContr.pct), color:'#00B386' },
                  { label:'SIP Market Growth',      val: breakdown.sipGrow.val,  w: Math.min(95, breakdown.sipGrow.pct),  color:'#F7941D' },
                ].map(b => (
                  <div key={b.label} className="br-row">
                    <div className="br-label">{b.label}</div>
                    <div className="br-bar-w"><div className="br-bar"><div className="br-fill" style={{ width:`${b.w}%`, background:b.color }} /></div></div>
                    <div className="br-val" style={{ color:b.color }}>{loading ? '...' : b.val}</div>
                  </div>
                ))}
              </div>
              {/* Milestones — computed from live totalCurrent + totalSIP */}
              <div className="card">
                <div className="card-header"><div className="card-title">Wealth Milestones</div><div className="card-sub">Base @13% XIRR</div></div>
                {loading
                  ? [1,2,3,4,5].map(i => <div key={i} style={{ marginBottom:12 }}><Sk h={40} /></div>)
                  : milestones.map(m => (
                      <div key={m.label} className="ms-row">
                        <div className="ms-ico">{m.icon}</div>
                        <div><div className="ms-label">{m.label}</div><div className="ms-date">{m.date}</div></div>
                        <div className="ms-val">{m.range}</div>
                      </div>
                    ))
                }
              </div>
            </div>
          </div>
        )}

        {/* AI ADVISOR */}
        {tab === 'agent' && (
          <div className="fade-in">
            <div className="page-header">
              <div>
                <div className="page-title">AI Portfolio Advisor</div>
                <div className="page-sub">Live context · {fmtINR(totalCurrent)} portfolio · {activeFunds.length} active funds</div>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, color:'#00B386', fontWeight:500 }}>
                <div className="live-dot" />Live
              </div>
            </div>
            <div className="agent-card">
              <div className="agent-hdr">
                <div style={{ fontSize:32 }}>🤖</div>
                <div>
                  <div className="agent-name">KB Wealth Intelligence Agent</div>
                  <div className="agent-sub">Powered by Claude · Updated with live Supabase data</div>
                </div>
              </div>
              <div className="agent-out">
                {agentLoading
                  ? <div className="agent-loading"><div className="spinner" />Analysing your portfolio with live data...</div>
                  : agentOutput
                    ? <pre className="agent-text">{agentOutput}</pre>
                    : <div className="agent-ph">
                        <div style={{ fontSize:32, marginBottom:10 }}>💡</div>
                        <div className="agent-ph-title">Ready to analyse your portfolio</div>
                        <div className="agent-ph-sub">
                          Choose an action below. AI runs <strong>only when you click</strong> — no background calls.
                        </div>
                      </div>
                }
              </div>
              <div className="agent-btns">
                {[
                  { type:'weekly'     as AgentType, label:'📊 Weekly Brief',       desc:'Portfolio score + fund status + action items' },
                  { type:'projection' as AgentType, label:'📅 Update Projections', desc:'AI-adjusted 3M/6M forecast' },
                  { type:'alert'      as AgentType, label:'⚡ Check Alerts',       desc:'Red flags, opportunities, risks' },
                  { type:'advice'     as AgentType, label:'💡 Get Advice',         desc:'Specific actions to take this month' },
                ].map(a => (
                  <button key={a.type} className={`agent-btn${agentLoading?' loading':''}`}
                    disabled={agentLoading} onClick={() => runAgent(a.type)}>
                    <div className="agent-btn-l">{a.label}</div>
                    <div className="agent-btn-s">{a.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {alerts.filter(a => a.alert_type !== 'nav_drop').length > 0 && (
              <div className="card" style={{ marginTop:16 }}>
                <div className="card-header"><div className="card-title">AI Brief History</div></div>
                {alerts.filter(a => a.alert_type !== 'nav_drop').slice(0,5).map(a => (
                  <div key={a.id} className="ms-row" style={{ cursor:'pointer' }}
                    onClick={() => { setAgentOutput(a.message); markAlertRead(a.id) }}>
                    <div className="ms-ico">📋</div>
                    <div>
                      <div className="ms-label">{alertTitle(a)}</div>
                      <div className="ms-date">{new Date(a.triggered_at).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })}</div>
                    </div>
                    <div style={{ fontSize:11, color:a.is_read?'#9EA3BA':'#0066FF', fontWeight:500, marginLeft:'auto' }}>
                      {a.is_read ? 'Read' : 'View'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </main>

      {/* MODALS */}
      {modal && (
        <div className="modal-overlay" onClick={e => { if(e.target===e.currentTarget) setModal(null) }}>
          <div className="modal">
            {modal === 'add-sip' && <>
              <div className="modal-hdr"><div className="modal-title">Add New SIP Fund</div><button className="modal-x" onClick={()=>setModal(null)}>✕</button></div>
              <div className="modal-body">
                <div className="fg">
                  <div className="fg-full"><label>Fund Name *</label><input placeholder="e.g. Quant Small Cap Fund Direct" value={sipForm.fund_name} onChange={e=>setSipForm(f=>({...f,fund_name:e.target.value}))} /></div>
                  <div><label>ISIN</label><input placeholder="INF..." value={sipForm.isin} onChange={e=>setSipForm(f=>({...f,isin:e.target.value}))} /></div>
                  <div><label>AMC</label><input placeholder="e.g. Quant MF" value={sipForm.amc} onChange={e=>setSipForm(f=>({...f,amc:e.target.value}))} /></div>
                  <div><label>Category *</label><select value={sipForm.category} onChange={e=>setSipForm(f=>({...f,category:e.target.value}))}><option value="core">Core</option><option value="growth">Growth</option><option value="satellite">Satellite</option></select></div>
                  <div><label>Sub Category</label><input placeholder="Mid Cap, Index…" value={sipForm.sub_category} onChange={e=>setSipForm(f=>({...f,sub_category:e.target.value}))} /></div>
                  <div><label>Monthly SIP (₹) *</label><input type="number" placeholder="e.g. 5000" value={sipForm.sip_amount} onChange={e=>setSipForm(f=>({...f,sip_amount:e.target.value}))} /></div>
                  <div><label>SIP Date</label><input type="number" min="1" max="28" value={sipForm.sip_date} onChange={e=>setSipForm(f=>({...f,sip_date:e.target.value}))} /></div>
                  <div><label>Start Date</label><input type="date" value={sipForm.start_date} onChange={e=>setSipForm(f=>({...f,start_date:e.target.value}))} /></div>
                </div>
              </div>
              <div className="modal-ftr"><button className="btn-ghost" onClick={()=>setModal(null)}>Cancel</button><button className="btn-primary" onClick={addSIP}>Add SIP Fund</button></div>
            </>}

            {modal === 'add-lumpsum' && <>
              <div className="modal-hdr"><div className="modal-title">Add Lumpsum Investment</div><button className="modal-x" onClick={()=>setModal(null)}>✕</button></div>
              <div className="modal-body">
                <div className="fg">
                  <div className="fg-full"><label>Fund *</label><select value={lumpsumForm.fund_name} onChange={e=>setLumpsumForm(f=>({...f,fund_name:e.target.value}))}><option value="">Select fund…</option>{funds.map(f=><option key={f.id} value={f.fund_name}>{f.fund_name}</option>)}</select></div>
                  <div><label>Amount (₹) *</label><input type="number" placeholder="e.g. 50000" value={lumpsumForm.amount} onChange={e=>setLumpsumForm(f=>({...f,amount:e.target.value}))} /></div>
                  <div><label>NAV at Purchase</label><input type="number" step="0.01" placeholder="e.g. 85.42" value={lumpsumForm.nav} onChange={e=>setLumpsumForm(f=>({...f,nav:e.target.value}))} /></div>
                  <div><label>Date</label><input type="date" value={lumpsumForm.date} onChange={e=>setLumpsumForm(f=>({...f,date:e.target.value}))} /></div>
                  <div className="fg-full"><label>Notes</label><input placeholder="Optional notes" value={lumpsumForm.notes} onChange={e=>setLumpsumForm(f=>({...f,notes:e.target.value}))} /></div>
                </div>
                {lumpsumForm.amount && lumpsumForm.nav && (<div className="calc-preview"><div>Units to be allotted</div><div className="calc-val">{(Number(lumpsumForm.amount)/Number(lumpsumForm.nav)).toFixed(3)}</div></div>)}
              </div>
              <div className="modal-ftr"><button className="btn-ghost" onClick={()=>setModal(null)}>Cancel</button><button className="btn-primary" onClick={addLumpsum}>Save to Supabase</button></div>
            </>}

            {modal === 'buy' && selectedFund && <>
              <div className="modal-hdr"><div><div className="modal-title">Buy — {selectedFund.fund_name}</div><div style={{ fontSize:12, color:'#9EA3BA', marginTop:3 }}>Current NAV: ₹{selectedFund.current_nav}</div></div><button className="modal-x" onClick={()=>setModal(null)}>✕</button></div>
              <div className="modal-body">
                <div className="fg">
                  <div><label>Amount (₹) *</label><input type="number" placeholder="e.g. 25000" value={buyForm.amount} onChange={e=>setBuyForm(f=>({...f,amount:e.target.value}))} /></div>
                  <div><label>NAV</label><input type="number" step="0.01" value={buyForm.nav} onChange={e=>setBuyForm(f=>({...f,nav:e.target.value}))} /></div>
                  <div><label>Date</label><input type="date" value={buyForm.date} onChange={e=>setBuyForm(f=>({...f,date:e.target.value}))} /></div>
                  <div className="fg-full"><label>Notes</label><input placeholder="Optional" value={buyForm.notes} onChange={e=>setBuyForm(f=>({...f,notes:e.target.value}))} /></div>
                </div>
                {buyForm.amount && buyForm.nav && (<div className="calc-preview"><div>Units to be allotted</div><div className="calc-val">{(Number(buyForm.amount)/Number(buyForm.nav)).toFixed(3)}</div></div>)}
              </div>
              <div className="modal-ftr"><button className="btn-ghost" onClick={()=>setModal(null)}>Cancel</button><button className="btn-primary" style={{ background:'#00B386' }} onClick={buyFund}>Confirm Buy</button></div>
            </>}

            {modal === 'sell' && selectedFund && <>
              <div className="modal-hdr"><div><div className="modal-title">Sell — {selectedFund.fund_name}</div><div style={{ fontSize:12, color:'#9EA3BA', marginTop:3 }}>Available: {selectedFund.units.toFixed(3)} units · NAV ₹{selectedFund.current_nav}</div></div><button className="modal-x" onClick={()=>setModal(null)}>✕</button></div>
              <div className="modal-body">
                <div className="fg">
                  <div><label>Units to Sell *</label><input type="number" step="0.001" placeholder={`Max ${selectedFund.units.toFixed(3)}`} value={sellForm.units} onChange={e=>setSellForm(f=>({...f,units:e.target.value}))} /></div>
                  <div><label>NAV</label><input type="number" step="0.01" value={sellForm.nav} onChange={e=>setSellForm(f=>({...f,nav:e.target.value}))} /></div>
                  <div><label>Date</label><input type="date" value={sellForm.date} onChange={e=>setSellForm(f=>({...f,date:e.target.value}))} /></div>
                  <div className="fg-full"><label>Notes</label><input placeholder="Optional" value={sellForm.notes} onChange={e=>setSellForm(f=>({...f,notes:e.target.value}))} /></div>
                </div>
                {sellForm.units && sellForm.nav && (<div className="calc-preview"><div>Redemption amount</div><div className="calc-val">{fmtINR(Number(sellForm.units)*Number(sellForm.nav))}</div></div>)}
              </div>
              <div className="modal-ftr"><button className="btn-ghost" onClick={()=>setModal(null)}>Cancel</button><button className="btn-primary" style={{ background:'#E63946' }} onClick={sellFund}>Confirm Sell</button></div>
            </>}

            {modal === 'edit-fund' && selectedFund && <>
              <div className="modal-hdr"><div className="modal-title">Edit — {selectedFund.fund_name}</div><button className="modal-x" onClick={()=>setModal(null)}>✕</button></div>
              <div className="modal-body">
                <div className="fg">
                  <div><label>SIP Amount (₹)</label><input type="number" value={editForm.sip_amount??''} onChange={e=>setEditForm(f=>({...f,sip_amount:Number(e.target.value)}))} /></div>
                  <div><label>SIP Date</label><input type="number" min="1" max="28" value={editForm.sip_date??''} onChange={e=>setEditForm(f=>({...f,sip_date:Number(e.target.value)}))} /></div>
                  <div><label>Category</label><select value={editForm.category??'core'} onChange={e=>setEditForm(f=>({...f,category:e.target.value as any}))}><option value="core">Core</option><option value="growth">Growth</option><option value="satellite">Satellite</option></select></div>
                  <div className="fg-full"><label>Sub Category</label><input value={editForm.sub_category??''} onChange={e=>setEditForm(f=>({...f,sub_category:e.target.value}))} /></div>
                </div>
              </div>
              <div className="modal-ftr"><button className="btn-ghost" onClick={()=>setModal(null)}>Cancel</button><button className="btn-primary" onClick={updateFund}>Save Changes</button></div>
            </>}

            {modal === 'delete' && selectedFund && <>
              <div className="modal-hdr"><div className="modal-title">Remove Fund</div><button className="modal-x" onClick={()=>setModal(null)}>✕</button></div>
              <div className="modal-body">
                <div style={{ textAlign:'center', padding:'16px 0' }}>
                  <div style={{ fontSize:40, marginBottom:12 }}>🗑️</div>
                  <div style={{ fontSize:16, fontWeight:600, marginBottom:8 }}>Remove {selectedFund.fund_name}?</div>
                  <div style={{ fontSize:13, color:'#9EA3BA', lineHeight:1.6 }}>This will delete the fund and all its transactions from Supabase permanently.</div>
                </div>
              </div>
              <div className="modal-ftr"><button className="btn-ghost" onClick={()=>setModal(null)}>Cancel</button><button className="btn-primary" style={{ background:'#E63946' }} onClick={deleteFund}>Yes, Delete Permanently</button></div>
            </>}
          </div>
        </div>
      )}

      <div className={`toast${toast.show?' show':''} ${toast.type}`}>{toast.msg}</div>

      <nav className="bnav">
        {TABS.map(t => (
          <button key={t.id} className={`bn${tab===t.id?' active':''}`} onClick={()=>setTab(t.id as Tab)}>
            <div className="bn-ico">{t.icon}</div>
            <div className="bn-lbl">{t.short}</div>
          </button>
        ))}
      </nav>
    </div>
  )
}

const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@300;400;500&display=swap');
:root{
  --bg:#F5F7FA;--white:#fff;--border:#E8ECF2;--border2:#D4DBE8;
  --text:#1A2332;--text2:#4A5568;--text3:#8896AA;
  --blue:#0066FF;--blight:#EEF4FF;
  --green:#00B386;--glight:#E6FAF5;
  --red:#E63946;--rlight:#FEF2F2;
  --orange:#F7941D;--olight:#FFF7ED;
  --purple:#6B4EFF;--plight:#F0EEFF;
}
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{background:var(--bg);color:var(--text);font-family:'DM Sans',-apple-system,sans-serif;min-height:100vh;padding-bottom:72px}
input,select,button{font-family:'DM Sans',sans-serif}
::-webkit-scrollbar{width:4px;height:4px}
::-webkit-scrollbar-track{background:var(--bg)}
::-webkit-scrollbar-thumb{background:var(--border2);border-radius:2px}
@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(1.3)}}
.fade-in{animation:fadeIn .2s ease both}
.topnav{background:var(--white);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:100;box-shadow:0 1px 8px rgba(0,0,0,.04)}
.topnav-inner{max-width:1280px;margin:0 auto;padding:0 24px;display:flex;align-items:center;height:60px;gap:0}
.brand{display:flex;align-items:center;gap:10px;margin-right:28px;flex-shrink:0}
.brand-icon{width:36px;height:36px;background:linear-gradient(135deg,#0066FF,#00B386);border-radius:10px;display:flex;align-items:center;justify-content:center;color:white;font-size:18px;font-weight:700}
.brand-name{font-size:15px;font-weight:700;letter-spacing:-.3px}
.brand-sub{font-size:10px;color:var(--text3);letter-spacing:.5px;text-transform:uppercase}
.nav-tabs{display:flex;flex:1;overflow-x:auto;scrollbar-width:none}
.nav-tabs::-webkit-scrollbar{display:none}
.ntab{font-size:13px;font-weight:500;padding:0 14px;height:60px;color:var(--text3);background:none;border:none;cursor:pointer;display:flex;align-items:center;gap:6px;border-bottom:2px solid transparent;white-space:nowrap;transition:.15s}
.ntab:hover{color:var(--text2)}
.ntab.active{color:var(--blue);border-bottom-color:var(--blue)}
.nav-right{display:flex;align-items:center;gap:10px;margin-left:auto;padding-left:16px}
.alert-count{background:var(--red);color:white;border-radius:50%;width:20px;height:20px;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center}
.xirr-pill{font-family:'DM Mono',monospace;font-size:11px;background:var(--glight);color:var(--green);border:1px solid rgba(0,179,134,.2);padding:5px 12px;border-radius:20px;font-weight:500}
.avatar{width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,#0066FF,#00B386);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;color:white}
.main{max-width:1280px;margin:0 auto;padding:24px 24px 40px}
.page-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}
.page-title{font-size:22px;font-weight:700;letter-spacing:-.4px}
.page-sub{font-size:13px;color:var(--text3);margin-top:2px}
.portfolio-hero{background:linear-gradient(135deg,#0050CC,#0066FF);border-radius:16px;padding:28px 32px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:20px;color:white}
.ph-label{font-size:11px;opacity:.7;letter-spacing:.5px;text-transform:uppercase;margin-bottom:6px;font-family:'DM Mono',monospace}
.ph-value{font-size:clamp(32px,5vw,48px);font-weight:700;letter-spacing:-1px;line-height:1}
.ph-change{display:flex;align-items:center;gap:10px;margin-top:8px;flex-wrap:wrap}
.gain-badge{background:rgba(255,255,255,.2);color:white;padding:3px 10px;border-radius:20px;font-size:12px;font-family:'DM Mono',monospace}
.ph-stats{display:flex;gap:28px;flex-wrap:wrap}
.ph-stat{text-align:right}
.ph-stat-l{font-size:10px;opacity:.6;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;font-family:'DM Mono',monospace}
.ph-stat-v{font-size:18px;font-weight:600}
.qs-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:20px}
.qs-card{background:var(--white);border:1px solid var(--border);border-radius:12px;padding:16px 18px}
.qs-l{font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px;font-family:'DM Mono',monospace}
.qs-v{font-size:22px;font-weight:700;line-height:1}
.qs-s{font-size:11px;color:var(--text3);margin-top:5px}
.card{background:var(--white);border:1px solid var(--border);border-radius:14px;padding:20px;margin-bottom:16px}
.card-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
.card-title{font-size:14px;font-weight:600}
.card-sub{font-size:12px;color:var(--text3)}
.btn-sm{font-size:11px;padding:5px 12px;border:1px solid var(--border);border-radius:7px;background:var(--blight);color:var(--blue);cursor:pointer;font-weight:500}
.dash-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
@media(max-width:900px){.dash-grid{grid-template-columns:1fr}}
.alloc-row{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.alloc-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.alloc-name{font-size:12px;color:var(--text2);width:150px;flex-shrink:0}
.alloc-bar-w{flex:1}
.alloc-bar{height:6px;background:#F0F4F8;border-radius:3px;overflow:hidden}
.alloc-fill{height:100%;border-radius:3px;transition:width .8s}
.alloc-pct{font-family:'DM Mono',monospace;font-size:11px;color:var(--text3);width:36px;text-align:right}
.alloc-val{font-family:'DM Mono',monospace;font-size:11px;color:var(--text2);width:64px;text-align:right}
.action-item{padding:12px 14px;border-radius:10px;display:flex;gap:10px;align-items:flex-start;margin-bottom:8px;border:1px solid transparent}
.action-item.critical{background:var(--rlight);border-color:rgba(230,57,70,.15)}
.action-item.warning{background:var(--olight);border-color:rgba(247,148,29,.15)}
.action-item.success{background:var(--glight);border-color:rgba(0,179,134,.15)}
.action-item.info{background:var(--blight);border-color:rgba(0,102,255,.12)}
.action-ico{font-size:15px;flex-shrink:0;margin-top:1px}
.action-title{font-size:12.5px;font-weight:600;margin-bottom:2px}
.action-title.critical{color:var(--red)}
.action-title.warning{color:#B45309}
.action-title.success{color:var(--green)}
.action-title.info{color:var(--blue)}
.action-desc{font-size:11px;color:var(--text3);line-height:1.6}
.cat-header{display:flex;align-items:center;justify-content:space-between;margin:16px 0 10px}
.cat-badge{font-size:10px;font-weight:700;padding:3px 10px;border-radius:4px;letter-spacing:1.5px}
.cat-badge.core{background:var(--glight);color:var(--green)}
.cat-badge.growth{background:var(--olight);color:var(--orange)}
.cat-badge.satellite{background:var(--plight);color:var(--purple)}
.cat-stats{display:flex;gap:12px;font-size:13px;font-weight:500}
.fund-card{background:var(--white);border:1px solid var(--border);border-radius:14px;padding:16px 18px;margin-bottom:10px;transition:box-shadow .15s}
.fund-card:hover{box-shadow:0 2px 16px rgba(0,0,0,.06)}
.fund-card-top{display:flex;align-items:flex-start;gap:12px;margin-bottom:14px}
.fund-color-bar{width:4px;height:44px;border-radius:2px;flex-shrink:0;margin-top:2px}
.fund-info{flex:1}
.fund-name{font-size:14px;font-weight:600;margin-bottom:5px}
.fund-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.fund-amc{font-size:11px;color:var(--text3)}
.fund-cat-pill{font-size:10px;background:var(--blight);color:var(--blue);padding:2px 7px;border-radius:4px;font-weight:500}
.sip-active-pill{font-size:10px;background:var(--glight);color:var(--green);padding:2px 7px;border-radius:4px;font-weight:500}
.sip-paused-pill{font-size:10px;background:var(--olight);color:var(--orange);padding:2px 7px;border-radius:4px;font-weight:500}
.fund-return-block{text-align:right}
.fund-ret{font-size:16px;font-weight:700;font-family:'DM Mono',monospace}
.fund-gain{font-size:11px;color:var(--text3);font-family:'DM Mono',monospace;margin-top:2px}
.fund-stats-row{display:flex;gap:0;padding:10px 0;border-top:1px solid var(--border);border-bottom:1px solid var(--border);margin-bottom:12px;overflow-x:auto}
.fsr{flex:1;text-align:center;border-right:1px solid var(--border);min-width:70px}
.fsr:last-child{border-right:none}
.fsr-l{font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.8px;margin-bottom:4px;font-family:'DM Mono',monospace}
.fsr-v{font-size:13px;font-weight:500;font-family:'DM Mono',monospace}
.fund-actions{display:flex;gap:6px;flex-wrap:wrap}
.fa-btn{font-size:12px;font-weight:500;padding:5px 14px;border-radius:7px;cursor:pointer;border:1px solid transparent;transition:.15s}
.fa-btn.buy{background:var(--glight);color:var(--green);border-color:rgba(0,179,134,.2)}
.fa-btn.buy:hover{background:var(--green);color:white}
.fa-btn.sell{background:var(--rlight);color:var(--red);border-color:rgba(230,57,70,.2)}
.fa-btn.sell:hover{background:var(--red);color:white}
.fa-btn.edit{background:var(--blight);color:var(--blue);border-color:rgba(0,102,255,.2)}
.fa-btn.edit:hover{background:var(--blue);color:white}
.fa-btn.pause{background:#F8F9FA;color:var(--text2);border-color:var(--border)}
.fa-btn.pause:hover{background:var(--text2);color:white}
.fa-btn.del{background:#F8F9FA;color:var(--text3);border-color:var(--border)}
.fa-btn.del:hover{background:var(--red);color:white;border-color:var(--red)}
.lt-grid-lump{display:grid;grid-template-columns:2.5fr 1.2fr 100px 100px 80px 180px;gap:0;min-width:700px}
.lt-grid7{display:grid;grid-template-columns:2fr 80px 90px 70px 80px 90px 60px;gap:0;min-width:640px}
.lt-header{font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.8px;padding:8px 12px;background:#FAFBFC;border-bottom:1px solid var(--border);font-family:'DM Mono',monospace}
.lt-row{padding:11px 12px;border-bottom:1px solid var(--border);align-items:center}
.lt-row:last-child{border-bottom:none}
.lt-row:hover{background:#FAFBFC}
.lt-fund{font-size:12.5px;font-weight:400}
.lt-mono{font-family:'DM Mono',monospace;font-size:12px;color:var(--text2)}
.spill{font-size:10px;padding:3px 8px;border-radius:20px;font-weight:500}
.spill.ok{background:var(--glight);color:var(--green)}
.spill.warn{background:var(--olight);color:var(--orange)}
.spill.critical{background:var(--rlight);color:var(--red)}
.spill.neutral{background:#F5F7FA;color:var(--text3)}
.ttype{font-size:10px;padding:2px 7px;border-radius:4px;font-weight:500;text-transform:capitalize}
.ttype.sip{background:var(--glight);color:var(--green)}
.ttype.buy{background:var(--glight);color:var(--green)}
.ttype.sell{background:var(--rlight);color:var(--red)}
.ttype.lumpsum{background:var(--blight);color:var(--blue)}
.tx-filters{display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap}
.tx-search{flex:1;min-width:180px;background:#F5F7FA;border:1px solid var(--border);border-radius:8px;padding:8px 14px;font-size:13px;outline:none}
.tx-search:focus{border-color:var(--blue);background:white}
.tx-ftabs{display:flex;gap:4px}
.ftab{font-size:11px;padding:5px 12px;border-radius:6px;border:1px solid var(--border);background:white;color:var(--text3);cursor:pointer;font-weight:500;transition:.15s}
.ftab.active{background:var(--blue);color:white;border-color:var(--blue)}
.proj-bar{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap}
.period-btn{font-size:13px;font-weight:500;padding:8px 20px;border-radius:8px;border:1px solid var(--border);background:white;color:var(--text3);cursor:pointer;transition:.15s}
.period-btn.active{background:var(--blue);color:white;border-color:var(--blue)}
.scenario-row{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px}
.sc-card{background:white;border:1px solid var(--border);border-radius:14px;padding:20px;text-align:center}
.sc-card.active{border-color:var(--blue);box-shadow:0 0 0 3px rgba(0,102,255,.08)}
.sc-label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px}
.sc-xirr{font-size:11px;color:var(--text3);margin-bottom:12px;font-family:'DM Mono',monospace}
.sc-val{font-size:28px;font-weight:700;margin-bottom:8px;letter-spacing:-.5px}
.sc-desc{font-size:11.5px;color:var(--text3);line-height:1.5}
.br-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)}
.br-row:last-child{border-bottom:none}
.br-label{font-size:12px;color:var(--text2);width:180px;flex-shrink:0}
.br-bar-w{flex:1}
.br-bar{height:6px;background:#F0F4F8;border-radius:3px;overflow:hidden}
.br-fill{height:100%;border-radius:3px;transition:width .8s}
.br-val{font-family:'DM Mono',monospace;font-size:12px;font-weight:500;width:70px;text-align:right}
.ms-row{display:flex;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid var(--border)}
.ms-row:last-child{border-bottom:none}
.ms-ico{font-size:18px;flex-shrink:0}
.ms-label{font-size:13px;font-weight:500}
.ms-date{font-size:11px;color:var(--text3);margin-top:2px;font-family:'DM Mono',monospace}
.ms-val{margin-left:auto;font-size:14px;font-weight:600;color:var(--blue);font-family:'DM Mono',monospace;white-space:nowrap}
.live-dot{width:8px;height:8px;border-radius:50%;background:var(--green);animation:pulse 2s infinite}
.agent-card{background:white;border:1px solid var(--border);border-radius:16px;padding:24px}
.agent-hdr{display:flex;align-items:center;gap:14px;margin-bottom:20px}
.agent-name{font-size:16px;font-weight:600;margin-bottom:3px}
.agent-sub{font-size:12px;color:var(--text3)}
.agent-out{background:#F8FAFC;border:1px solid var(--border);border-radius:10px;padding:16px;min-height:140px;margin-bottom:16px}
.agent-loading{display:flex;align-items:center;gap:10px;color:var(--text3);font-size:13px}
.spinner{width:16px;height:16px;border:2px solid var(--border);border-top-color:var(--blue);border-radius:50%;animation:spin .8s linear infinite;flex-shrink:0}
.agent-text{font-family:'DM Mono',monospace;font-size:12px;color:var(--text2);line-height:1.8;white-space:pre-wrap;word-break:break-word}
.agent-ph{text-align:center;padding:20px}
.agent-ph-title{font-size:14px;font-weight:600;margin-bottom:6px}
.agent-ph-sub{font-size:12px;color:var(--text3);line-height:1.6;max-width:360px;margin:0 auto}
.agent-btns{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}
.agent-btn{background:#F5F7FA;border:1px solid var(--border);border-radius:10px;padding:12px 16px;cursor:pointer;text-align:left;transition:.15s;font-family:'DM Sans',sans-serif}
.agent-btn:hover{border-color:var(--blue);background:var(--blight)}
.agent-btn.loading{opacity:.5;pointer-events:none}
.agent-btn-l{font-size:13px;font-weight:600;margin-bottom:3px}
.agent-btn-s{font-size:11px;color:var(--text3)}
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:300;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px)}
.modal{background:white;border-radius:16px;width:100%;max-width:520px;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.15)}
.modal-hdr{padding:20px 24px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:flex-start}
.modal-title{font-size:16px;font-weight:700}
.modal-x{width:28px;height:28px;border-radius:50%;border:1px solid var(--border);background:var(--bg);color:var(--text3);cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:.15s}
.modal-x:hover{background:var(--red);color:white;border-color:var(--red)}
.modal-body{padding:20px 24px}
.modal-ftr{padding:14px 24px 20px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:10px}
.fg{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:4px}
.fg-full{grid-column:1/-1}
.fg label{display:block;font-size:11px;color:var(--text3);font-weight:500;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;font-family:'DM Mono',monospace}
.fg input,.fg select{width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;color:var(--text);background:white;outline:none;transition:.15s;font-family:'DM Sans',sans-serif}
.fg input:focus,.fg select:focus{border-color:var(--blue);box-shadow:0 0 0 3px rgba(0,102,255,.08)}
.calc-preview{background:var(--blight);border:1px solid rgba(0,102,255,.15);border-radius:10px;padding:12px 16px;margin-top:14px;display:flex;justify-content:space-between;align-items:center}
.calc-val{font-size:18px;font-weight:700;color:var(--blue);font-family:'DM Mono',monospace}
.btn-primary{background:var(--blue);color:white;border:none;border-radius:9px;padding:10px 20px;font-size:13px;font-weight:600;cursor:pointer;transition:.15s;font-family:'DM Sans',sans-serif}
.btn-primary:hover{opacity:.9}
.btn-ghost{background:white;color:var(--text2);border:1px solid var(--border);border-radius:9px;padding:10px 20px;font-size:13px;font-weight:500;cursor:pointer;font-family:'DM Sans',sans-serif}
.btn-ghost:hover{background:#F5F7FA}
.toast{position:fixed;bottom:80px;left:50%;transform:translateX(-50%) translateY(16px);background:#1A2332;color:white;padding:10px 20px;border-radius:20px;font-size:13px;font-weight:500;opacity:0;pointer-events:none;transition:.3s;white-space:nowrap;z-index:400}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
.toast.error{background:var(--red)}
.bnav{position:fixed;bottom:0;left:0;right:0;background:white;border-top:1px solid var(--border);display:none;padding:6px 0 max(6px,env(safe-area-inset-bottom));z-index:200;box-shadow:0 -2px 10px rgba(0,0,0,.05)}
.bn{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;padding:5px 2px;cursor:pointer;color:var(--text3);background:none;border:none;transition:.15s;font-family:'DM Sans',sans-serif}
.bn.active{color:var(--blue)}
.bn-ico{font-size:18px;line-height:1}
.bn-lbl{font-size:9px;font-weight:500}
.green{color:var(--green)!important}
.red{color:var(--red)!important}
.blue{color:var(--blue)!important}
@media(max-width:768px){
  .main{padding:14px 14px 40px}
  .topnav-inner{padding:0 14px}
  .nav-tabs{display:none}
  .portfolio-hero{padding:18px}
  .ph-stats{gap:14px}
  .bnav{display:flex}
  .fund-stats-row{overflow-x:auto}
  .scenario-row{grid-template-columns:1fr}
  .fg{grid-template-columns:1fr}
  .fg-full{grid-column:auto}
  .lt-grid-lump{grid-template-columns:2fr 1fr 90px 90px 70px 160px}
}
.sk-white{background:rgba(255,255,255,.3);border-radius:6px;animation:shimmer 1.5s infinite;background-size:200% 100%}
`