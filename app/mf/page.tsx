// app/mf/page.tsx — full file with mobile responsiveness + back nav
'use client'

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { calcProjection, MY_FUNDS } from '@/lib/funds'

// ─── Color map ───────────────────────────────────────────────────────────────
const FUND_COLORS: Record<string, string> = Object.fromEntries(
  MY_FUNDS.map(f => [f.isin, f.color])
)

type Tab        = 'dashboard' | 'sip' | 'lumpsum' | 'projections' | 'agent' | 'transactions'
type ProjPeriod = '3m' | '6m' | '1y' | '5y'
type AgentType  = 'weekly' | 'projection' | 'alert' | 'advice'
type ModalType  = 'add-sip' | 'add-lumpsum' | 'edit-fund' | 'buy' | 'sell' | 'delete' | null
type FundSearchMode = 'sip' | 'lumpsum'

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
  { id: 'sip',         label: 'SIPs',         icon: '🔄' },
  { id: 'lumpsum',     label: 'Lumpsum',      icon: '💰' },
  { id: 'transactions',label: 'Transactions', icon: '📋' },
  { id: 'projections', label: 'Projections',  icon: '📈' },
  { id: 'agent',       label: 'AI Advisor',   icon: '🤖' },
]

const LBL: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 600, color: C.text3,
  textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6,
}
const INP: React.CSSProperties = {
  width: '100%', padding: '10px 12px', border: `1.5px solid ${C.border}`,
  borderRadius: 9, fontSize: 13, outline: 'none', color: '#111', boxSizing: 'border-box',
  fontFamily: "'DM Sans', sans-serif",
}

// ── Mobile-responsive global CSS ─────────────────────────────────────────────
const MF_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=Syne:wght@600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
  *{box-sizing:border-box}
  ::-webkit-scrollbar{width:4px;height:4px}
  ::-webkit-scrollbar-track{background:transparent}
  ::-webkit-scrollbar-thumb{background:rgba(0,0,0,.15);border-radius:2px}
  @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
  @keyframes toastIn{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}
  @keyframes loadBar{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}
  .fade-up{animation:fadeUp .25s ease both}

  /* ── MF layout shell ── */
  .mf-shell{min-height:100vh;background:#F1F5FB;font-family:'DM Sans',-apple-system,sans-serif;display:flex;flex-direction:column}

  /* ── Top header ── */
  .mf-header{
    background:white;border-bottom:1px solid #E5E7EB;
    padding:0 28px;height:64px;display:flex;align-items:center;
    justify-content:space-between;position:sticky;top:0;z-index:100;flex-shrink:0;
  }
  .mf-header-left{display:flex;align-items:center;gap:12px}
  .mf-back-btn{
    display:flex;align-items:center;gap:6px;background:#F1F5FB;
    border:1px solid #E5E7EB;border-radius:10px;padding:7px 12px;
    font-size:13px;font-weight:600;color:#0B1E4F;cursor:pointer;
    text-decoration:none;transition:.15s;white-space:nowrap;
  }
  .mf-back-btn:hover{background:#E8ECF4}

  /* ── Tab bar (desktop horizontal) ── */
  .mf-tabs{
    display:flex;background:white;border-bottom:1px solid #E5E7EB;
    padding:0 28px;gap:4px;overflow-x:auto;flex-shrink:0;
    -webkit-overflow-scrolling:touch;scrollbar-width:none;
  }
  .mf-tabs::-webkit-scrollbar{display:none}
  .mf-tab{
    padding:14px 16px;font-size:13px;font-weight:500;color:#6B7280;
    border:none;background:none;cursor:pointer;border-bottom:2px solid transparent;
    white-space:nowrap;transition:.15s;display:flex;align-items:center;gap:6px;
  }
  .mf-tab.active{color:#7C3AED;border-bottom-color:#7C3AED;font-weight:600}

  /* ── Body ── */
  .mf-body{flex:1;padding:24px 28px 40px;overflow-y:auto}

  /* ── Bottom mobile nav ── */
  .mf-bottom-nav{display:none}

  /* ── Grids ── */
  .mf-grid-4{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:20px}
  .mf-grid-3{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:20px}
  .mf-grid-2{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;margin-bottom:20px}
  .mf-hero{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:20px}

  /* ── Table scroll ── */
  .table-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}

  /* ── Module header ── */
  .module-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px}

  /* ── Modal ── */
  .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px}
  .modal-box{background:white;border-radius:20px;width:520px;max-width:100%;max-height:85vh;overflow-y:auto;box-shadow:0 30px 60px rgba(0,0,0,.3)}

  /* ── Toast ── */
  .mf-toast{position:fixed;bottom:90px;right:20px;z-index:2000;padding:12px 18px;border-radius:12px;font-size:13px;font-weight:500;box-shadow:0 8px 24px rgba(0,0,0,.2);animation:toastIn .25s ease;max-width:calc(100vw - 40px)}

  /* ════════════════════════════════
     TABLET  ≤ 1024px
  ════════════════════════════════ */
  @media(max-width:1024px){
    .mf-header{padding:0 16px}
    .mf-tabs{padding:0 16px}
    .mf-body{padding:20px 16px 32px}
    .mf-grid-4{grid-template-columns:repeat(2,1fr)}
    .mf-hero{grid-template-columns:repeat(2,1fr)}
    .mf-grid-3{grid-template-columns:repeat(2,1fr)}
  }

  /* ════════════════════════════════
     MOBILE  ≤ 768px
  ════════════════════════════════ */
  @media(max-width:768px){
    /* Header shrinks */
    .mf-header{padding:0 14px;height:56px}
    .mf-back-btn span{display:none}   /* hide text, keep arrow icon */
    .mf-header-title{font-size:15px!important}
    .mf-header-subtitle{display:none}

    /* Hide desktop tab bar; show bottom nav */
    .mf-tabs{display:none}
    .mf-bottom-nav{
      display:flex;position:fixed;bottom:0;left:0;right:0;z-index:200;
      background:#0B1E4F;border-top:1px solid rgba(255,255,255,.1);
      padding:6px 0 env(safe-area-inset-bottom,6px);
    }
    .mf-bottom-nav-item{
      flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;
      background:none;border:none;cursor:pointer;padding:6px 2px;
      font-size:9px;font-weight:500;color:rgba(255,255,255,.5);
      transition:.15s;min-width:0;
    }
    .mf-bottom-nav-item.active{color:white}
    .mf-bottom-nav-item .nav-icon{font-size:18px;line-height:1}

    /* Body padding for fixed bottom nav */
    .mf-body{padding:14px 14px 88px}

    /* Grids → single column */
    .mf-grid-4{grid-template-columns:1fr}
    .mf-grid-3{grid-template-columns:1fr}
    .mf-grid-2{grid-template-columns:1fr}
    .mf-hero{grid-template-columns:repeat(2,1fr);gap:10px}

    /* Modal → bottom sheet */
    .modal-overlay{align-items:flex-end!important;padding:0!important}
    .modal-box{width:100%!important;border-radius:20px 20px 0 0!important;max-height:92vh!important}

    /* Toast above bottom nav */
    .mf-toast{bottom:80px}

    /* Module header wraps */
    .module-header{flex-direction:column;align-items:flex-start}

    /* Fund search dropdown */
    .fund-search-drop{max-height:200px!important}

    /* Agent output */
    .agent-output{font-size:13px!important}

    /* Milestone grid → 1 col */
    .milestone-grid{grid-template-columns:1fr!important}

    /* Proj breakdown → stack */
    .proj-breakdown{flex-direction:column!important;gap:8px!important}

    /* Pill tabs (projections period) */
    .period-tabs{flex-wrap:wrap;gap:6px}

    /* Table font shrink */
    .mf-table td, .mf-table th{font-size:12px!important;padding:10px 8px!important}
  }

  @media(max-width:400px){
    .mf-hero{grid-template-columns:1fr}
  }
`

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
    sip_amount: '', sip_date: '1', start_date: '', confirmed_nav: 0,
  })
  const [fundSearch, setFundSearch]       = useState('')
  const [fundResults, setFundResults]     = useState<any[]>([])
  const [fundSearching, setFundSearching] = useState(false)
  const [isinConfirmed, setIsinConfirmed] = useState(false)
  const [navPreview, setNavPreview]       = useState<{ nav: number; date: string } | null>(null)
  const fundSearchTimer                   = useRef<any>(null)
  const [lumpsumForm, setLumpsumForm] = useState({ fund_name: '', isin: '', amc: '', amount: '', nav: '', date: '', notes: '', confirmed_nav: 0 })
  const [buyForm,  setBuyForm]  = useState({ amount: '', nav: '', date: new Date().toISOString().split('T')[0], notes: '' })
  const [sellForm, setSellForm] = useState({ units:  '', nav: '', date: new Date().toISOString().split('T')[0], notes: '' })
  const [editForm, setEditForm] = useState<Partial<Fund>>({})

  const showToast = useCallback((msg: string, ok = true) => {
    setToast({ msg, show: true, ok })
    setTimeout(() => setToast(t => ({ ...t, show: false })), 2800)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id ?? null)
    })
  }, [])

  useEffect(() => { if (userId) loadAll() }, [userId])

  // ── Back navigation ────────────────────────────────────────────────────────
  const goBack = () => { window.location.href = '/' }

  // ── Load all MF data ──────────────────────────────────────────────────────
  async function loadAll() {
    if (!userId) return
    setLoading(true)
    try {
      const probe = await supabase.from('portfolio_funds').select('user_id').limit(1)
      const userIdColMissing =
        !!probe.error &&
        (probe.error.code === 'PGRST204' ||
          probe.error.message?.toLowerCase().includes('user_id') ||
          probe.error.message?.toLowerCase().includes('column'))

      let pfQuery = supabase.from('portfolio_funds').select('*').order('category')
      if (!userIdColMissing) pfQuery = pfQuery.eq('user_id', userId) as any
      const { data: pfData, error: pfErr } = await pfQuery
      if (pfErr) console.error('portfolio_funds:', pfErr)

      let txQuery = supabase
        .from('transactions')
        .select('*, portfolio_funds(fund_name)')
        .order('invest_date', { ascending: false })
      if (!userIdColMissing) txQuery = txQuery.eq('user_id', userId) as any
      const { data: txData, error: txErr } = await txQuery
      if (txErr) console.error('transactions:', txErr)

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

      let alertQuery = supabase
        .from('alerts_log')
        .select('*')
        .order('triggered_at', { ascending: false })
        .limit(30)
      if (!userIdColMissing) alertQuery = alertQuery.eq('user_id', userId) as any
      const { data: alertData } = await alertQuery

      if (!pfData?.length) {
        setFunds([]); setTx([]); setAlerts(alertData || [])
        setLoading(false); return
      }

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
    const m = ({ '3m': 3, '6m': 6, '1y': 12, '5y': 60 } as Record<string, number>)[projPeriod]
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
    const mBase   = monthsToTarget(totalCurrent, totalSIP, t.target, 13)
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

  // ── Fund search (AMFI via mfapi.in) ──────────────────────────────────────
  const searchFunds = useCallback(async (query: string) => {
    const q = query.trim()
    if (q.length < 2) { setFundResults([]); return }
    setFundSearching(true)
    try {
      const res  = await fetch(`/api/mf-search?q=${encodeURIComponent(q)}`)
      if (!res.ok) throw new Error('Fund search failed')
      const data = await res.json()
      setFundResults((data || []).slice(0, 12))
    } catch {
      setFundResults([])
    } finally {
      setFundSearching(false)
    }
  }, [])

  const onFundSearchChange = (val: string, mode: FundSearchMode = 'sip') => {
    setFundSearch(val)
    setIsinConfirmed(false)
    setNavPreview(null)
    if (mode === 'sip') {
      setSipForm(f => ({ ...f, fund_name: val, isin: '', confirmed_nav: 0 }))
    } else {
      setLumpsumForm(f => ({ ...f, fund_name: val, isin: '', confirmed_nav: 0, nav: '' }))
    }
    clearTimeout(fundSearchTimer.current)
    fundSearchTimer.current = setTimeout(() => searchFunds(val), 300)
  }

  const onFundSelect = async (result: any, mode: FundSearchMode = 'sip') => {
    const isin     = result.isinGrowth || result.isinDivReinvestment || ''
    const fundName = result.schemeName || ''
    const amc      = fundName.split(' ')[0] || ''
    setFundSearch(fundName)
    setFundResults([])
    if (mode === 'sip') {
      setSipForm(f => ({ ...f, fund_name: fundName, isin, amc, confirmed_nav: 0 }))
    } else {
      setLumpsumForm(f => ({ ...f, fund_name: fundName, isin, amc, confirmed_nav: 0 }))
    }
    if (result.schemeCode) {
      setFundSearching(true)
      try {
        const res  = await fetch(`/api/mf-search?schemeCode=${encodeURIComponent(result.schemeCode)}`)
        if (!res.ok) throw new Error('NAV lookup failed')
        const data = await res.json()
        const nav  = Number(data?.data?.[0]?.nav || 0)
        const date = data?.data?.[0]?.date || ''
        setNavPreview({ nav, date })
        if (mode === 'sip') {
          setSipForm(f => ({ ...f, confirmed_nav: nav }))
        } else {
          setLumpsumForm(f => ({ ...f, confirmed_nav: nav, nav: nav ? String(nav) : f.nav }))
        }
      } catch {
        setNavPreview(null)
      } finally {
        setFundSearching(false)
      }
    }
    setIsinConfirmed(true)
  }

  const resetSipForm = () => {
    setSipForm({ fund_name: '', isin: '', amc: '', category: 'core', sub_category: '', sip_amount: '', sip_date: '1', start_date: '', confirmed_nav: 0 })
    setFundSearch(''); setFundResults([]); setIsinConfirmed(false); setNavPreview(null)
  }

  const resetLumpsumForm = () => {
    setLumpsumForm({ fund_name: '', isin: '', amc: '', amount: '', nav: '', date: '', notes: '', confirmed_nav: 0 })
    setFundSearch(''); setFundResults([]); setIsinConfirmed(false); setNavPreview(null)
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────
  const addSIP = async () => {
    if (!isinConfirmed)      { showToast('Please select a fund from the search results', false); return }
    if (!sipForm.fund_name)  { showToast('Fund name required', false); return }
    if (!sipForm.isin)       { showToast('Valid ISIN required', false); return }
    if (!sipForm.sip_amount) { showToast('Enter monthly SIP amount', false); return }
    const payload: Record<string, any> = {
      fund_name: sipForm.fund_name, isin: sipForm.isin,
      category: sipForm.category,
      sip_amount: Number(sipForm.sip_amount), sip_date: Number(sipForm.sip_date),
      start_date: sipForm.start_date || null, current_nav: sipForm.confirmed_nav || null,
      is_active: true,
    }
    if (userId) payload.user_id = userId
    const { error } = await supabase.from('portfolio_funds').insert(payload)
    if (error) { showToast('Error: ' + error.message, false); return }
    showToast(`${sipForm.fund_name} added`)
    resetSipForm(); setModal(null); loadAll()
  }

  const addLumpsum = async () => {
    if (!lumpsumForm.fund_name || !lumpsumForm.amount) { showToast('Fund and amount required', false); return }
    let fund = funds.find(f => f.isin === lumpsumForm.isin || f.fund_name === lumpsumForm.fund_name)

    if (!fund) {
      if (!isinConfirmed || !lumpsumForm.isin) { showToast('Please select a fund from the search results', false); return }

      const fundPayload: Record<string, any> = {
        fund_name: lumpsumForm.fund_name,
        isin: lumpsumForm.isin,
        category: 'core',
        sip_amount: 0,
        sip_date: 1,
        start_date: null,
        current_nav: lumpsumForm.confirmed_nav || Number(lumpsumForm.nav) || null,
        is_active: true,
      }
      if (userId) fundPayload.user_id = userId

      const { data: insertedFund, error: fundError } = await supabase
        .from('portfolio_funds')
        .insert(fundPayload)
        .select('id, fund_name, isin')
        .single()

      if (fundError) { showToast('Error: ' + fundError.message, false); return }
      fund = insertedFund as Fund
    }

    const amount = Number(lumpsumForm.amount)
    const nav    = Number(lumpsumForm.nav) || 0
    const payload: Record<string, any> = {
      fund_id: fund.id, type: 'lumpsum', amount,
      nav_at_purchase: nav || null,
      units_allotted:  nav > 0 ? amount / nav : null,
      invest_date:     lumpsumForm.date || new Date().toISOString().split('T')[0],
      notes:           lumpsumForm.notes || null,
    }
    if (userId) payload.user_id = userId
    const { error } = await supabase.from('transactions').insert(payload)
    if (error) { showToast('Error: ' + error.message, false); return }
    showToast('Lumpsum investment added')
    resetLumpsumForm()
    setModal(null); loadAll()
  }

  const recordBuy = async () => {
    if (!selFund || !buyForm.amount) { showToast('Amount required', false); return }
    const amount = Number(buyForm.amount), nav = Number(buyForm.nav) || 0
    const payload: Record<string, any> = {
      fund_id: selFund.id, type: 'buy', amount,
      nav_at_purchase: nav || null,
      units_allotted:  nav > 0 ? amount / nav : null,
      invest_date:     buyForm.date,
      notes:           buyForm.notes || null,
    }
    if (userId) payload.user_id = userId
    const { error } = await supabase.from('transactions').insert(payload)
    if (error) { showToast('Error: ' + error.message, false); return }
    showToast('Buy transaction recorded')
    setBuyForm({ amount: '', nav: '', date: new Date().toISOString().split('T')[0], notes: '' })
    setModal(null); setSelFund(null); loadAll()
  }

  const recordSell = async () => {
    if (!selFund || !sellForm.units) { showToast('Units required', false); return }
    const units = Number(sellForm.units), nav = Number(sellForm.nav) || 0
    const payload: Record<string, any> = {
      fund_id: selFund.id, type: 'sell', amount: units * nav,
      nav_at_purchase: nav || null, units_allotted: units,
      invest_date:     sellForm.date,
      notes:           sellForm.notes || null,
    }
    if (userId) payload.user_id = userId
    const { error } = await supabase.from('transactions').insert(payload)
    if (error) { showToast('Error: ' + error.message, false); return }
    showToast('Sell transaction recorded')
    setSellForm({ units: '', nav: '', date: new Date().toISOString().split('T')[0], notes: '' })
    setModal(null); setSelFund(null); loadAll()
  }

  const saveFundEdit = async () => {
    if (!selFund) return
    const { error } = await supabase.from('portfolio_funds').update({
      sip_amount:   Number(editForm.sip_amount ?? selFund.sip_amount),
      sip_date:     Number(editForm.sip_date   ?? selFund.sip_date),
      is_active:    editForm.is_active ?? selFund.is_active,
      category:     editForm.category  ?? selFund.category,
      current_nav:  Number(editForm.current_nav ?? selFund.current_nav) || null,
    }).eq('id', selFund.id)
    if (error) { showToast('Error: ' + error.message, false); return }
    showToast('Fund updated')
    setModal(null); setSelFund(null); loadAll()
  }

  const deleteFund = async () => {
    if (!selFund) return
    const { error } = await supabase.from('portfolio_funds').delete().eq('id', selFund.id)
    if (error) { showToast('Error: ' + error.message, false); return }
    showToast('Fund removed')
    setModal(null); setSelFund(null); loadAll()
  }

  const runAgent = async (type: AgentType) => {
    setAgentBusy(true); setAgentOut('')
    try {
      const prompts: Record<AgentType, string> = {
        weekly:     `You are a mutual fund advisor. Give a concise weekly portfolio review:\n\n${portfolioCtx}`,
        projection: `You are a mutual fund advisor. Analyze projections and give actionable advice:\n\n${portfolioCtx}`,
        alert:      `You are a mutual fund advisor. Identify risk alerts and opportunities:\n\n${portfolioCtx}`,
        advice:     `You are a mutual fund advisor. Suggest portfolio rebalancing and next steps:\n\n${portfolioCtx}`,
      }
      const res = await fetch('/api/mf-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompts[type] }),
      })
      const data = await res.json()
      setAgentOut(data.result || data.error || 'No response')
    } catch (e) { setAgentOut('Agent unavailable. Please try again.') }
    setAgentBusy(false)
  }

  // ── Filtered transactions ─────────────────────────────────────────────────
  const filteredTx = useMemo(() => {
    return transactions.filter(t => {
      const matchType = txFilter === 'all' || t.type === txFilter
      const matchSrch = !search || t.fund_name.toLowerCase().includes(search.toLowerCase())
      return matchType && matchSrch
    })
  }, [transactions, txFilter, search])

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#F1F5FB', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      <style>{MF_CSS}</style>
      <div style={{ width: 48, height: 48, background: 'linear-gradient(135deg,#7C3AED,#A78BFA)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 800, color: 'white' }}>📊</div>
      <div style={{ fontSize: 14, color: '#9CA3AF' }}>Loading portfolio…</div>
      <div style={{ width: 200, height: 3, background: '#E5E7EB', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: '60%', height: '100%', background: 'linear-gradient(90deg,#7C3AED,#A78BFA)', borderRadius: 2, animation: 'loadBar 1.2s ease-in-out infinite' }} />
      </div>
    </div>
  )

  // ── Tab content ───────────────────────────────────────────────────────────
  const renderTab = () => {
    switch (tab) {
      case 'dashboard':    return <DashboardTab funds={funds} totalInvested={totalInvested} totalCurrent={totalCurrent} totalGain={totalGain} gainPct={gainPct} xirr={xirr} totalSIP={totalSIP} activeFunds={activeFunds} bestReturn={bestReturn} onBuy={(f: Fund) => { setSelFund(f); setModal('buy') }} onSell={(f: Fund) => { setSelFund(f); setModal('sell') }} onEdit={(f: Fund) => { setSelFund(f); setEditForm({ ...f }); setModal('edit-fund') }} />
      case 'sip':          return <SIPTab funds={funds.filter(f => f.sip_amount > 0)} onEdit={(f: Fund) => { setSelFund(f); setEditForm({ ...f }); setModal('edit-fund') }} onDelete={(f: Fund) => { setSelFund(f); setModal('delete') }} onBuy={(f: Fund) => { setSelFund(f); setModal('buy') }} />
      case 'lumpsum':      return <LumpsumTab funds={funds} transactions={transactions.filter(t => t.type === 'lumpsum')} />
      case 'transactions': return <TransactionsTab transactions={filteredTx} txFilter={txFilter} setTxFilter={setTxFilter} search={search} setSearch={setSearch} />
      case 'projections':  return <ProjectionsTab projData={projData} projPeriod={projPeriod} setProjP={setProjP} breakdown={breakdown} milestones={milestones} totalCurrent={totalCurrent} totalSIP={totalSIP} />
      //case 'agent'    :        return <AgentTab agentOut={agentOut} agentBusy={agentBusy} runAgent={runAgent} alerts={alerts} />
      case 'agent'      : return <AgentTab alerts={alerts} />
      default:             return null
    }
  }

  return (
    <div className="mf-shell">
      <style>{MF_CSS}</style>

      {/* ── Top Header ─────────────────────────────────────────────────── */}
      <header className="mf-header">
        <div className="mf-header-left">
          {/* Back button */}
          <button className="mf-back-btn" onClick={goBack} title="Back to Dashboard">
            <span style={{ fontSize: 16 }}>←</span>
            <span>Dashboard</span>
          </button>

          {/* Page identity */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, background: 'linear-gradient(135deg,#7C3AED,#A78BFA)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>📊</div>
            <div>
              <div className="mf-header-title" style={{ fontSize: 16, fontWeight: 700, color: C.text, lineHeight: 1.1, fontFamily: "'Syne',sans-serif" }}>Mutual Funds</div>
              <div className="mf-header-subtitle" style={{ fontSize: 11, color: C.text3 }}>Portfolio Manager</div>
            </div>
          </div>
        </div>

        {/* Right actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => { resetSipForm(); setModal('add-sip') }}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.mf.main, color: 'white', border: 'none', borderRadius: 10, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            <span>+</span>
            <span className="mf-header-subtitle" style={{ color: 'white', fontSize: 13 }}>Add SIP</span>
          </button>
          <button
            onClick={() => { resetLumpsumForm(); setModal('add-lumpsum') }}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#F5F3FF', color: C.mf.main, border: `1px solid ${C.mf.light}`, borderRadius: 10, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            <span>💰</span>
            <span className="mf-header-subtitle" style={{ color: C.mf.main, fontSize: 13 }}>Lumpsum</span>
          </button>
        </div>
      </header>

      {/* ── Desktop Tab Bar ─────────────────────────────────────────────── */}
      <nav className="mf-tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`mf-tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id as Tab)}
          >
            <span>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      {/* ── Page Body ───────────────────────────────────────────────────── */}
      <main className="mf-body">
        {renderTab()}
      </main>

      {/* ── Mobile Bottom Nav ───────────────────────────────────────────── */}
      <nav className="mf-bottom-nav">
        {/* Back item */}
        <button className="mf-bottom-nav-item" onClick={goBack} title="Dashboard">
          <span className="nav-icon">🏠</span>
          <span>Home</span>
        </button>
        {TABS.map(t => (
          <button
            key={t.id}
            className={`mf-bottom-nav-item ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id as Tab)}
          >
            <span className="nav-icon">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      {/* ── Toast ───────────────────────────────────────────────────────── */}
      {toast.show && (
        <div
          className="mf-toast"
          style={{ background: toast.ok ? '#059669' : '#E8195A', color: 'white' }}
        >
          {toast.ok ? '✓' : '⚠️'} {toast.msg}
        </div>
      )}

      {/* ── Modals ──────────────────────────────────────────────────────── */}
      {modal && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) { setModal(null); setSelFund(null) } }}>
          <div className="modal-box">

            {/* Add SIP */}
            {modal === 'add-sip' && (
              <ModalShell title="Add SIP Fund" onClose={() => { setModal(null); resetSipForm() }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {/* Fund search */}
                  <div style={{ position: 'relative' }}>
                    <label style={LBL}>Search Fund *</label>
                    <input
                      value={fundSearch}
                      onChange={e => onFundSearchChange(e.target.value)}
                      placeholder="e.g. Parag Parikh Flexi Cap"
                      style={{ ...INP, borderColor: isinConfirmed ? '#059669' : fundSearch && !isinConfirmed ? '#F59E0B' : C.border }}
                    />
                    {fundSearching && <div style={{ position: 'absolute', right: 10, top: 32, fontSize: 12, color: C.text3 }}>⏳</div>}
                    {isinConfirmed && <div style={{ position: 'absolute', right: 10, top: 32, fontSize: 14, color: '#059669' }}>✓</div>}

                    {/* Dropdown */}
                    {fundResults.length > 0 && (
                      <div className="fund-search-drop" style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: `1px solid ${C.border}`, borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.12)', zIndex: 100, maxHeight: 260, overflowY: 'auto' }}>
                        {fundResults.map((r, i) => (
                          <button key={i} onClick={() => onFundSelect(r)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, color: C.text2, borderBottom: i < fundResults.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                            <div style={{ fontWeight: 500 }}>{r.schemeName}</div>
                            <div style={{ fontSize: 11, color: C.text4, marginTop: 2 }}>{r.isinGrowth || r.isinDivReinvestment}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {navPreview && (
                    <div style={{ background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#166534' }}>
                      Latest NAV: <strong>₹{navPreview.nav}</strong> as of {navPreview.date}
                    </div>
                  )}

                  <div className="mf-grid-2" style={{ marginBottom: 0 }}>
                    <div>
                      <label style={LBL}>Monthly SIP (₹) *</label>
                      <input type="number" value={sipForm.sip_amount} onChange={e => setSipForm(f => ({ ...f, sip_amount: e.target.value }))} placeholder="5000" style={INP} />
                    </div>
                    <div>
                      <label style={LBL}>SIP Date</label>
                      <select value={sipForm.sip_date} onChange={e => setSipForm(f => ({ ...f, sip_date: e.target.value }))} style={INP}>
                        {[1, 5, 7, 10, 15, 20, 25, 28].map(d => <option key={d} value={d}>{d}th</option>)}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label style={LBL}>Category</label>
                    <select value={sipForm.category} onChange={e => setSipForm(f => ({ ...f, category: e.target.value as any }))} style={INP}>
                      <option value="core">Core</option>
                      <option value="growth">Growth</option>
                      <option value="satellite">Satellite</option>
                    </select>
                  </div>

                  <div>
                    <label style={LBL}>Start Date</label>
                    <input type="date" value={sipForm.start_date} onChange={e => setSipForm(f => ({ ...f, start_date: e.target.value }))} style={INP} />
                  </div>

                  <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
                    <button onClick={() => { setModal(null); resetSipForm() }} style={{ flex: 1, padding: '11px', border: `1.5px solid ${C.border}`, borderRadius: 10, background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: C.text2 }}>Cancel</button>
                    <button onClick={addSIP} style={{ flex: 2, padding: '11px', background: C.mf.main, color: 'white', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Add Fund</button>
                  </div>
                </div>
              </ModalShell>
            )}

            {/* Add Lumpsum */}
            {modal === 'add-lumpsum' && (
              <ModalShell title="Add Lumpsum Investment" onClose={() => { setModal(null); resetLumpsumForm() }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={{ position: 'relative' }}>
                    <label style={LBL}>Search Fund *</label>
                    <input
                      value={fundSearch}
                      onChange={e => onFundSearchChange(e.target.value, 'lumpsum')}
                      placeholder="e.g. Nippon India Small Cap"
                      style={{ ...INP, borderColor: isinConfirmed ? '#059669' : fundSearch && !isinConfirmed ? '#F59E0B' : C.border }}
                    />
                    {fundSearching && <div style={{ position: 'absolute', right: 10, top: 32, fontSize: 12, color: C.text3 }}>...</div>}
                    {isinConfirmed && <div style={{ position: 'absolute', right: 10, top: 32, fontSize: 14, color: '#059669' }}>OK</div>}

                    {fundResults.length > 0 && (
                      <div className="fund-search-drop" style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: `1px solid ${C.border}`, borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.12)', zIndex: 100, maxHeight: 260, overflowY: 'auto' }}>
                        {fundResults.map((r, i) => (
                          <button key={i} onClick={() => onFundSelect(r, 'lumpsum')} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, color: C.text2, borderBottom: i < fundResults.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                            <div style={{ fontWeight: 500 }}>{r.schemeName}</div>
                            <div style={{ fontSize: 11, color: C.text4, marginTop: 2 }}>{r.isinGrowth || r.isinDivReinvestment}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="mf-grid-2" style={{ marginBottom: 0 }}>
                    <div>
                      <label style={LBL}>Amount (₹) *</label>
                      <input type="number" value={lumpsumForm.amount} onChange={e => setLumpsumForm(f => ({ ...f, amount: e.target.value }))} placeholder="50000" style={INP} />
                    </div>
                    <div>
                      <label style={LBL}>NAV at Purchase</label>
                      <input type="number" value={lumpsumForm.nav} onChange={e => setLumpsumForm(f => ({ ...f, nav: e.target.value }))} placeholder="Optional" style={INP} />
                    </div>
                  </div>
                  <div>
                    <label style={LBL}>Date</label>
                    <input type="date" value={lumpsumForm.date} onChange={e => setLumpsumForm(f => ({ ...f, date: e.target.value }))} style={INP} />
                  </div>
                  <div>
                    <label style={LBL}>Notes</label>
                    <input value={lumpsumForm.notes} onChange={e => setLumpsumForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional" style={INP} />
                  </div>
                  <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
                    <button onClick={() => { setModal(null); resetLumpsumForm() }} style={{ flex: 1, padding: '11px', border: `1.5px solid ${C.border}`, borderRadius: 10, background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: C.text2 }}>Cancel</button>
                    <button onClick={addLumpsum} style={{ flex: 2, padding: '11px', background: C.mf.main, color: 'white', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Add Investment</button>
                  </div>
                </div>
              </ModalShell>
            )}

            {/* Buy */}
            {modal === 'buy' && selFund && (
              <ModalShell title={`Buy — ${selFund.fund_name}`} onClose={() => { setModal(null); setSelFund(null) }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div className="mf-grid-2" style={{ marginBottom: 0 }}>
                    <div>
                      <label style={LBL}>Amount (₹) *</label>
                      <input type="number" value={buyForm.amount} onChange={e => setBuyForm(f => ({ ...f, amount: e.target.value }))} placeholder="10000" style={INP} />
                    </div>
                    <div>
                      <label style={LBL}>NAV</label>
                      <input type="number" value={buyForm.nav} onChange={e => setBuyForm(f => ({ ...f, nav: e.target.value }))} placeholder={String(selFund.current_nav || '')} style={INP} />
                    </div>
                  </div>
                  <div>
                    <label style={LBL}>Date</label>
                    <input type="date" value={buyForm.date} onChange={e => setBuyForm(f => ({ ...f, date: e.target.value }))} style={INP} />
                  </div>
                  <div>
                    <label style={LBL}>Notes</label>
                    <input value={buyForm.notes} onChange={e => setBuyForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional" style={INP} />
                  </div>
                  <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
                    <button onClick={() => { setModal(null); setSelFund(null) }} style={{ flex: 1, padding: '11px', border: `1.5px solid ${C.border}`, borderRadius: 10, background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: C.text2 }}>Cancel</button>
                    <button onClick={recordBuy} style={{ flex: 2, padding: '11px', background: C.green, color: 'white', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Record Buy</button>
                  </div>
                </div>
              </ModalShell>
            )}

            {/* Sell */}
            {modal === 'sell' && selFund && (
              <ModalShell title={`Sell — ${selFund.fund_name}`} onClose={() => { setModal(null); setSelFund(null) }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={{ background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#92400E' }}>
                    Units held: <strong>{selFund.units.toFixed(4)}</strong> @ NAV ₹{selFund.current_nav}
                  </div>
                  <div className="mf-grid-2" style={{ marginBottom: 0 }}>
                    <div>
                      <label style={LBL}>Units to Sell *</label>
                      <input type="number" value={sellForm.units} onChange={e => setSellForm(f => ({ ...f, units: e.target.value }))} placeholder="0.0000" style={INP} />
                    </div>
                    <div>
                      <label style={LBL}>NAV</label>
                      <input type="number" value={sellForm.nav} onChange={e => setSellForm(f => ({ ...f, nav: e.target.value }))} placeholder={String(selFund.current_nav || '')} style={INP} />
                    </div>
                  </div>
                  {sellForm.units && sellForm.nav && (
                    <div style={{ background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#166534' }}>
                      Estimated proceeds: <strong>₹{(Number(sellForm.units) * Number(sellForm.nav)).toLocaleString('en-IN')}</strong>
                    </div>
                  )}
                  <div>
                    <label style={LBL}>Date</label>
                    <input type="date" value={sellForm.date} onChange={e => setSellForm(f => ({ ...f, date: e.target.value }))} style={INP} />
                  </div>
                  <div>
                    <label style={LBL}>Notes</label>
                    <input value={sellForm.notes} onChange={e => setSellForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional" style={INP} />
                  </div>
                  <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
                    <button onClick={() => { setModal(null); setSelFund(null) }} style={{ flex: 1, padding: '11px', border: `1.5px solid ${C.border}`, borderRadius: 10, background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: C.text2 }}>Cancel</button>
                    <button onClick={recordSell} style={{ flex: 2, padding: '11px', background: C.red, color: 'white', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Record Sell</button>
                  </div>
                </div>
              </ModalShell>
            )}

            {/* Edit Fund */}
            {modal === 'edit-fund' && selFund && (
              <ModalShell title={`Edit — ${selFund.fund_name}`} onClose={() => { setModal(null); setSelFund(null) }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div className="mf-grid-2" style={{ marginBottom: 0 }}>
                    <div>
                      <label style={LBL}>Monthly SIP (₹)</label>
                      <input type="number" value={editForm.sip_amount ?? selFund.sip_amount} onChange={e => setEditForm(f => ({ ...f, sip_amount: Number(e.target.value) }))} style={INP} />
                    </div>
                    <div>
                      <label style={LBL}>SIP Date</label>
                      <select value={editForm.sip_date ?? selFund.sip_date} onChange={e => setEditForm(f => ({ ...f, sip_date: Number(e.target.value) }))} style={INP}>
                        {[1, 5, 7, 10, 15, 20, 25, 28].map(d => <option key={d} value={d}>{d}th</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="mf-grid-2" style={{ marginBottom: 0 }}>
                    <div>
                      <label style={LBL}>Category</label>
                      <select value={editForm.category ?? selFund.category} onChange={e => setEditForm(f => ({ ...f, category: e.target.value as any }))} style={INP}>
                        <option value="core">Core</option>
                        <option value="growth">Growth</option>
                        <option value="satellite">Satellite</option>
                      </select>
                    </div>
                    <div>
                      <label style={LBL}>Latest NAV (₹)</label>
                      <input type="number" value={editForm.current_nav ?? selFund.current_nav} onChange={e => setEditForm(f => ({ ...f, current_nav: Number(e.target.value) }))} style={INP} />
                    </div>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, cursor: 'pointer', color: C.text2 }}>
                    <input type="checkbox" checked={editForm.is_active ?? selFund.is_active} onChange={e => setEditForm(f => ({ ...f, is_active: e.target.checked }))} />
                    Active SIP
                  </label>
                  <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
                    <button onClick={() => { setModal(null); setSelFund(null) }} style={{ flex: 1, padding: '11px', border: `1.5px solid ${C.border}`, borderRadius: 10, background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: C.text2 }}>Cancel</button>
                    <button onClick={saveFundEdit} style={{ flex: 2, padding: '11px', background: C.mf.main, color: 'white', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Save Changes</button>
                  </div>
                </div>
              </ModalShell>
            )}

            {/* Delete */}
            {modal === 'delete' && selFund && (
              <ModalShell title="Remove Fund" onClose={() => { setModal(null); setSelFund(null) }}>
                <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>🗑️</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 8 }}>Remove {selFund.fund_name}?</div>
                  <div style={{ fontSize: 13, color: C.text3, marginBottom: 24, lineHeight: 1.6 }}>
                    This will remove the fund from your portfolio. Past transactions won't be deleted.
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button onClick={() => { setModal(null); setSelFund(null) }} style={{ flex: 1, padding: '11px', border: `1.5px solid ${C.border}`, borderRadius: 10, background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: C.text2 }}>Cancel</button>
                    <button onClick={deleteFund} style={{ flex: 1, padding: '11px', background: C.red, color: 'white', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Remove Fund</button>
                  </div>
                </div>
              </ModalShell>
            )}

          </div>
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// SHARED COMPONENTS
// ════════════════════════════════════════════════════════════════════════════

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h3 style={{ fontSize: 17, fontWeight: 700, color: C.text, margin: 0, fontFamily: "'Syne',sans-serif" }}>{title}</h3>
        <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${C.border}`, background: '#F8FAFC', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
      </div>
      {children}
    </div>
  )
}

function StatCard({ label, value, sub, color, icon }: { label: string; value: string; sub?: string; color?: string; icon?: string }) {
  return (
    <div style={{ background: 'white', borderRadius: 14, padding: '16px 18px', border: `1px solid ${C.border}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
        {icon && <span style={{ fontSize: 18 }}>{icon}</span>}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color || C.text, fontFamily: "'Syne',sans-serif", lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: C.text3, marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

function FundRow({ fund, onEdit, onDelete, onBuy, onSell }: {
  fund: Fund; onEdit?: () => void; onDelete?: () => void; onBuy?: () => void; onSell?: () => void
}) {
  const gain    = fund.current_value - fund.invested
  const gainPct = fund.invested > 0 ? (gain / fund.invested) * 100 : 0
  const isPos   = gain >= 0

  return (
    <tr className="hover-row" style={{ borderBottom: `1px solid ${C.border}`, transition: '.15s' }}>
      <td style={{ padding: '14px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: fund.color, flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text, lineHeight: 1.2 }}>{fund.fund_name}</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 3 }}>
              <span style={{ fontSize: 10, background: CAT_BG[fund.category] || '#F5F3FF', color: CAT_COLOR[fund.category] || C.mf.main, padding: '2px 7px', borderRadius: 4, fontWeight: 600 }}>{fund.category}</span>
              {fund.sub_category && <span style={{ fontSize: 10, color: C.text4 }}>{fund.sub_category}</span>}
            </div>
          </div>
        </div>
      </td>
      <td style={{ padding: '14px 12px', fontSize: 13, color: C.text2, textAlign: 'right' }}>
        {fund.sip_amount > 0 ? <span style={{ fontWeight: 600, color: C.mf.main }}>₹{fund.sip_amount.toLocaleString('en-IN')}/mo</span> : '—'}
        {fund.sip_date > 0 && fund.sip_amount > 0 && <div style={{ fontSize: 10, color: C.text4 }}>{fund.sip_date}th</div>}
      </td>
      <td style={{ padding: '14px 12px', textAlign: 'right' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{fmtINR(fund.invested)}</div>
        <div style={{ fontSize: 10, color: C.text4 }}>{fund.units.toFixed(3)} units</div>
      </td>
      <td style={{ padding: '14px 12px', textAlign: 'right' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{fmtINR(fund.current_value)}</div>
        <div style={{ fontSize: 11, color: C.text4 }}>NAV ₹{fund.current_nav}</div>
      </td>
      <td style={{ padding: '14px 12px', textAlign: 'right' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: isPos ? C.green : C.red }}>
          {isPos ? '+' : ''}{fmtINR(gain)}
        </div>
        <div style={{ fontSize: 11, color: isPos ? C.green : C.red }}>
          {isPos ? '+' : ''}{gainPct.toFixed(1)}%
        </div>
      </td>
      <td style={{ padding: '14px 12px' }}>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {onBuy  && <Btn label="Buy"  color={C.green}   onClick={onBuy} />}
          {onSell && <Btn label="Sell" color={C.red}     onClick={onSell} />}
          {onEdit && <Btn label="Edit" color={C.mf.main} onClick={onEdit} />}
          {onDelete && <Btn label="✕" color={C.text3} onClick={onDelete} />}
        </div>
      </td>
    </tr>
  )
}

function Btn({ label, color, onClick }: { label: string; color: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ padding: '5px 10px', fontSize: 11, fontWeight: 600, background: color + '15', color, border: `1px solid ${color}30`, borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap' }}>
      {label}
    </button>
  )
}

// ── Mobile fund card (used instead of table rows on narrow screens) ──────────
function FundCard({ fund, onEdit, onBuy, onSell, onDelete }: {
  fund: Fund; onEdit?: () => void; onBuy?: () => void; onSell?: () => void; onDelete?: () => void
}) {
  const gain    = fund.current_value - fund.invested
  const gainPct = fund.invested > 0 ? (gain / fund.invested) * 100 : 0
  const isPos   = gain >= 0
  return (
    <div style={{ background: 'white', borderRadius: 14, padding: 16, border: `1px solid ${C.border}`, marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flex: 1, minWidth: 0 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: fund.color, flexShrink: 0, marginTop: 4 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text, lineHeight: 1.3 }}>{fund.fund_name}</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              <span style={{ fontSize: 10, background: CAT_BG[fund.category] || '#F5F3FF', color: CAT_COLOR[fund.category] || C.mf.main, padding: '2px 7px', borderRadius: 4, fontWeight: 600 }}>{fund.category}</span>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
          {onEdit   && <Btn label="Edit" color={C.mf.main} onClick={onEdit} />}
          {onDelete && <Btn label="✕"   color={C.text3}   onClick={onDelete} />}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 10, color: C.text4, marginBottom: 2 }}>Invested</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{fmtINR(fund.invested)}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: C.text4, marginBottom: 2 }}>Current</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{fmtINR(fund.current_value)}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: C.text4, marginBottom: 2 }}>Gain/Loss</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: isPos ? C.green : C.red }}>
            {isPos ? '+' : ''}{gainPct.toFixed(1)}%
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 11, color: C.text3 }}>
          {fund.sip_amount > 0 ? `SIP ₹${fund.sip_amount.toLocaleString('en-IN')}/mo` : 'Lumpsum'} · NAV ₹{fund.current_nav}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {onBuy  && <Btn label="Buy"  color={C.green} onClick={onBuy} />}
          {onSell && <Btn label="Sell" color={C.red}   onClick={onSell} />}
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// TAB COMPONENTS
// ════════════════════════════════════════════════════════════════════════════

function DashboardTab({ funds, totalInvested, totalCurrent, totalGain, gainPct, xirr, totalSIP, activeFunds, bestReturn, onBuy, onSell, onEdit }: any) {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768)
    check(); window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  return (
    <div className="fade-up">
      {/* Hero metrics */}
      <div className="mf-hero">
        <StatCard label="Portfolio Value"    value={fmtINR(totalCurrent)}  sub={`${gainPct >= 0 ? '+' : ''}${gainPct.toFixed(1)}% overall`} color={C.mf.main} icon="📊" />
        <StatCard label="Total Invested"     value={fmtINR(totalInvested)} icon="💰" />
        <StatCard label="Total Gain/Loss"    value={`${totalGain >= 0 ? '+' : ''}${fmtINR(totalGain)}`} color={totalGain >= 0 ? C.green : C.red} icon={totalGain >= 0 ? '📈' : '📉'} />
        <StatCard label="XIRR"               value={`${xirr >= 0 ? '+' : ''}${xirr.toFixed(1)}%`} color={xirr >= 0 ? C.green : C.red} sub="annualised" icon="🎯" />
      </div>

      {/* Secondary stats */}
      <div className="mf-grid-3">
        <StatCard label="Monthly SIP"    value={`₹${totalSIP.toLocaleString('en-IN')}`} sub={`${activeFunds.length} active funds`} icon="🔄" />
        <StatCard label="Best Performer" value={`+${bestReturn.toFixed(1)}%`} color={C.green} icon="🏆" />
        <StatCard label="Funds Tracked"  value={String(funds.length)} icon="📋" />
      </div>

      {/* Fund list */}
      <div style={{ background: 'white', borderRadius: 16, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}` }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: C.text, margin: 0, fontFamily: "'Syne',sans-serif" }}>All Holdings</h3>
        </div>

        {isMobile ? (
          <div style={{ padding: '12px 14px' }}>
            {funds.map((f: Fund) => (
              <FundCard key={f.id} fund={f}
                onBuy={() => onBuy(f)} onSell={() => onSell(f)} onEdit={() => onEdit(f)}
              />
            ))}
            {!funds.length && <EmptyState msg="No funds yet. Add your first SIP." />}
          </div>
        ) : (
          <div className="table-scroll">
            <table className="mf-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#F8FAFC' }}>
                  {['Fund', 'SIP', 'Invested', 'Current', 'Gain/Loss', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '10px 12px', fontSize: 11, fontWeight: 600, color: C.text3, textAlign: h === 'Fund' ? 'left' : 'right', textTransform: 'uppercase', letterSpacing: '0.4px', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {funds.map((f: Fund) => (
                  <FundRow key={f.id} fund={f}
                    onBuy={() => onBuy(f)} onSell={() => onSell(f)} onEdit={() => onEdit(f)}
                  />
                ))}
                {!funds.length && (
                  <tr><td colSpan={6} style={{ padding: 40, textAlign: 'center', color: C.text3, fontSize: 14 }}>No funds yet — add your first SIP.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function SIPTab({ funds, onEdit, onDelete, onBuy }: any) {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768)
    check(); window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  const active   = funds.filter((f: Fund) => f.is_active)
  const inactive = funds.filter((f: Fund) => !f.is_active)

  return (
    <div className="fade-up">
      <div className="mf-grid-3">
        <StatCard label="Active SIPs"  value={String(active.length)}  icon="🔄" />
        <StatCard label="Monthly Flow" value={`₹${active.reduce((s: number, f: Fund) => s + f.sip_amount, 0).toLocaleString('en-IN')}`} icon="💸" />
        <StatCard label="Paused SIPs"  value={String(inactive.length)} icon="⏸️" />
      </div>

      <div style={{ background: 'white', borderRadius: 16, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}` }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: C.text, margin: 0, fontFamily: "'Syne',sans-serif" }}>SIP Funds</h3>
        </div>
        {isMobile ? (
          <div style={{ padding: '12px 14px' }}>
            {funds.map((f: Fund) => (
              <FundCard key={f.id} fund={f}
                onEdit={() => onEdit(f)} onDelete={() => onDelete(f)} onBuy={() => onBuy(f)}
              />
            ))}
            {!funds.length && <EmptyState msg="No SIP funds. Add one to get started." />}
          </div>
        ) : (
          <div className="table-scroll">
            <table className="mf-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#F8FAFC' }}>
                  {['Fund', 'SIP', 'Invested', 'Current', 'Gain/Loss', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '10px 12px', fontSize: 11, fontWeight: 600, color: C.text3, textAlign: h === 'Fund' ? 'left' : 'right', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {funds.map((f: Fund) => (
                  <FundRow key={f.id} fund={f}
                    onEdit={() => onEdit(f)} onDelete={() => onDelete(f)} onBuy={() => onBuy(f)}
                  />
                ))}
                {!funds.length && (
                  <tr><td colSpan={6} style={{ padding: 40, textAlign: 'center', color: C.text3 }}>No SIP funds yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function LumpsumTab({ funds, transactions }: any) {
  const total = transactions.reduce((s: number, t: Transaction) => s + t.amount, 0)
  return (
    <div className="fade-up">
      <div className="mf-grid-2">
        <StatCard label="Total Lumpsum Invested" value={fmtINR(total)} icon="💰" />
        <StatCard label="Lumpsum Transactions"   value={String(transactions.length)} icon="📋" />
      </div>
      <div style={{ background: 'white', borderRadius: 16, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}` }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: C.text, margin: 0, fontFamily: "'Syne',sans-serif" }}>Lumpsum Transactions</h3>
        </div>
        <div className="table-scroll">
          <table className="mf-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#F8FAFC' }}>
                {['Fund', 'Date', 'Amount', 'NAV', 'Units'].map(h => (
                  <th key={h} style={{ padding: '10px 12px', fontSize: 11, fontWeight: 600, color: C.text3, textAlign: h === 'Fund' ? 'left' : 'right', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {transactions.map((t: Transaction) => (
                <tr key={t.id} className="hover-row" style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: '12px', fontSize: 13, fontWeight: 500, color: C.text }}>{t.fund_name}</td>
                  <td style={{ padding: '12px', fontSize: 12, color: C.text3, textAlign: 'right' }}>{t.date}</td>
                  <td style={{ padding: '12px', fontSize: 13, fontWeight: 600, color: C.text, textAlign: 'right' }}>{fmtINR(t.amount)}</td>
                  <td style={{ padding: '12px', fontSize: 12, color: C.text3, textAlign: 'right' }}>₹{t.nav}</td>
                  <td style={{ padding: '12px', fontSize: 12, color: C.text3, textAlign: 'right' }}>{t.units.toFixed(4)}</td>
                </tr>
              ))}
              {!transactions.length && (
                <tr><td colSpan={5} style={{ padding: 40, textAlign: 'center', color: C.text3 }}>No lumpsum transactions yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function TransactionsTab({ transactions, txFilter, setTxFilter, search, setSearch }: any) {
  const typeColors: Record<string, string> = {
    sip: C.mf.main, buy: C.green, lumpsum: C.blue, sell: C.red, switch_out: C.orange,
  }
  return (
    <div className="fade-up">
      {/* Filters */}
      <div style={{ background: 'white', borderRadius: 14, padding: '14px 16px', border: `1px solid ${C.border}`, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search fund…"
            style={{ ...INP, width: 'auto', flex: '1 1 160px', minWidth: 120 }}
          />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {['all','sip','buy','lumpsum','sell'].map(f => (
              <button key={f} onClick={() => setTxFilter(f)}
                style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, borderRadius: 8, border: `1px solid ${txFilter === f ? C.mf.main : C.border}`, background: txFilter === f ? C.mf.bg : 'white', color: txFilter === f ? C.mf.main : C.text3, cursor: 'pointer', textTransform: 'capitalize' }}>
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ background: 'white', borderRadius: 16, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
        <div className="table-scroll">
          <table className="mf-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#F8FAFC' }}>
                {['Fund', 'Type', 'Date', 'Amount', 'NAV', 'Units'].map(h => (
                  <th key={h} style={{ padding: '10px 12px', fontSize: 11, fontWeight: 600, color: C.text3, textAlign: h === 'Fund' ? 'left' : 'right', textTransform: 'uppercase', letterSpacing: '0.4px', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {transactions.map((t: Transaction) => (
                <tr key={t.id} className="hover-row" style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: '12px', fontSize: 13, fontWeight: 500, color: C.text, maxWidth: 180 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.fund_name}</div>
                  </td>
                  <td style={{ padding: '12px', textAlign: 'right' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, background: (typeColors[t.type] || C.text3) + '15', color: typeColors[t.type] || C.text3, padding: '3px 8px', borderRadius: 6, textTransform: 'uppercase' }}>{t.type}</span>
                  </td>
                  <td style={{ padding: '12px', fontSize: 12, color: C.text3, textAlign: 'right', whiteSpace: 'nowrap' }}>{t.date}</td>
                  <td style={{ padding: '12px', fontSize: 13, fontWeight: 600, color: C.text, textAlign: 'right' }}>{fmtINR(t.amount)}</td>
                  <td style={{ padding: '12px', fontSize: 12, color: C.text3, textAlign: 'right' }}>₹{t.nav || '—'}</td>
                  <td style={{ padding: '12px', fontSize: 12, color: C.text3, textAlign: 'right' }}>{t.units ? t.units.toFixed(4) : '—'}</td>
                </tr>
              ))}
              {!transactions.length && (
                <tr><td colSpan={6} style={{ padding: 40, textAlign: 'center', color: C.text3 }}>No transactions found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function ProjectionsTab({ projData, projPeriod, setProjP, breakdown, milestones, totalCurrent, totalSIP }: any) {
  const PERIODS: ProjPeriod[] = ['3m', '6m', '1y', '5y']
  const p = projData[projPeriod] || {}
  return (
    <div className="fade-up">
      {/* Period selector */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }} className="period-tabs">
        {PERIODS.map(per => (
          <button key={per} onClick={() => setProjP(per)}
            style={{ padding: '8px 20px', borderRadius: 10, border: `1.5px solid ${projPeriod === per ? C.mf.main : C.border}`, background: projPeriod === per ? C.mf.bg : 'white', color: projPeriod === per ? C.mf.main : C.text3, fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: '.15s' }}>
            {per === '3m' ? '3 Months' : per === '6m' ? '6 Months' : per === '1y' ? '1 Year' : '5 Years'}
          </button>
        ))}
      </div>

      {/* Scenario cards */}
      <div className="mf-grid-3" style={{ marginBottom: 20 }}>
        {[
          { label: '🐻 Bear (10%)',  val: p.bear, color: C.red },
          { label: '📊 Base (13%)',  val: p.base, color: C.mf.main },
          { label: '🐂 Bull (16%)',  val: p.bull, color: C.green },
        ].map(s => (
          <div key={s.label} style={{ background: 'white', borderRadius: 14, padding: '18px 20px', border: `1px solid ${C.border}`, textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: C.text3, marginBottom: 8 }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: s.color, fontFamily: "'Syne',sans-serif" }}>{s.val}</div>
          </div>
        ))}
      </div>

      {/* Breakdown */}
      <div style={{ background: 'white', borderRadius: 16, padding: '20px', border: `1px solid ${C.border}`, marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: C.text, margin: '0 0 16px', fontFamily: "'Syne',sans-serif" }}>Value Breakdown</h3>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }} className="proj-breakdown">
          {[
            { label: 'Corpus Growth', val: breakdown.corpus.val,   pct: breakdown.corpus.pct,   color: C.mf.main },
            { label: 'SIP Invested',  val: breakdown.sipContr.val, pct: breakdown.sipContr.pct, color: C.blue },
            { label: 'SIP Growth',    val: breakdown.sipGrow.val,  pct: breakdown.sipGrow.pct,  color: C.green },
          ].map(b => (
            <div key={b.label} style={{ flex: '1 1 130px', background: '#F8FAFC', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ fontSize: 11, color: C.text3, marginBottom: 4 }}>{b.label}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: b.color, fontFamily: "'Syne',sans-serif" }}>{b.val}</div>
              <div style={{ fontSize: 11, color: C.text4, marginTop: 2 }}>{b.pct.toFixed(1)}% of total</div>
            </div>
          ))}
        </div>
      </div>

      {/* Milestones */}
      <div style={{ background: 'white', borderRadius: 16, padding: '20px', border: `1px solid ${C.border}` }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: C.text, margin: '0 0 16px', fontFamily: "'Syne',sans-serif" }}>Wealth Milestones</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }} className="milestone-grid">
          {milestones.map((m: any) => {
            const reached = m.date === '✓ Reached'
            return (
              <div key={m.label} style={{ background: reached ? '#F0FDF4' : '#F8FAFC', borderRadius: 12, padding: '14px 16px', border: `1px solid ${reached ? '#86EFAC' : C.border}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 20 }}>{m.icon}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: reached ? C.green : C.mf.main }}>{m.date}</span>
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.text, fontFamily: "'Syne',sans-serif" }}>{m.label}</div>
                <div style={{ fontSize: 11, color: C.text3, marginTop: 3 }}>{m.range}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function AgentTab({ agentOut, agentBusy, runAgent, alerts }: any) {
  const actions: { type: AgentType; label: string; icon: string; desc: string }[] = [
    { type: 'weekly',     label: 'Weekly Review',   icon: '📋', desc: 'Portfolio performance summary' },
    { type: 'projection', label: 'Projection',       icon: '📈', desc: 'Future value analysis' },
    { type: 'alert',      label: 'Risk Alerts',      icon: '⚠️', desc: 'Identify risks & opportunities' },
    { type: 'advice',     label: 'Rebalance Advice', icon: '⚖️', desc: 'Allocation suggestions' },
  ]
  return (
    <div className="fade-up">
      {/* Action buttons */}
      <div className="mf-grid-2" style={{ marginBottom: 20 }}>
        {actions.map(a => (
          <button key={a.type} onClick={() => runAgent(a.type)} disabled={agentBusy}
            style={{ background: 'white', border: `1.5px solid ${C.border}`, borderRadius: 14, padding: '16px', textAlign: 'left', cursor: agentBusy ? 'not-allowed' : 'pointer', opacity: agentBusy ? 0.6 : 1, transition: '.15s' }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>{a.icon}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{a.label}</div>
            <div style={{ fontSize: 11, color: C.text3, marginTop: 3 }}>{a.desc}</div>
          </button>
        ))}
      </div>

      {/* Output */}
      {(agentBusy || agentOut) && (
        <div style={{ background: 'white', borderRadius: 16, padding: '20px', border: `1px solid ${C.border}` }}>
          {agentBusy ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: C.text3 }}>
              <div style={{ width: 16, height: 16, border: `2px solid ${C.mf.main}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              <span>AI Advisor is analysing your portfolio…</span>
            </div>
          ) : (
            <pre className="agent-output" style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 14, color: C.text2, whiteSpace: 'pre-wrap', lineHeight: 1.7, margin: 0 }}>{agentOut}</pre>
          )}
        </div>
      )}

      {/* Alerts */}
      {alerts.length > 0 && (
        <div style={{ marginTop: 20, background: 'white', borderRadius: 16, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.border}` }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: C.text, margin: 0, fontFamily: "'Syne',sans-serif" }}>Recent Alerts</h3>
          </div>
          {alerts.slice(0, 5).map((a: Alert) => (
            <div key={a.id} style={{ padding: '12px 18px', borderBottom: `1px solid ${C.border}`, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 18 }}>{a.alert_type === 'risk' ? '⚠️' : a.alert_type === 'opportunity' ? '💡' : '🔔'}</span>
              <div>
                <div style={{ fontSize: 13, color: C.text2, lineHeight: 1.4 }}>{a.message}</div>
                <div style={{ fontSize: 11, color: C.text4, marginTop: 3 }}>{new Date(a.triggered_at).toLocaleDateString('en-IN')}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function EmptyState({ msg }: { msg: string }) {
  return (
    <div style={{ padding: '40px 20px', textAlign: 'center', color: C.text3, fontSize: 14 }}>
      <div style={{ fontSize: 32, marginBottom: 10 }}>📭</div>
      {msg}
    </div>
  )
}
