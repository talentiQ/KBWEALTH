'use client'

import { useState, useMemo, useCallback, useEffect } from "react"
import { PieChart, Pie, Cell, Tooltip, AreaChart, Area, XAxis, YAxis, ResponsiveContainer } from "recharts"
import { supabase } from "@/lib/supabase"

// ── HELPERS ───────────────────────────────────────────────────────────────────
const fmtINR = n => {
  const abs = Math.abs(n)
  if (abs >= 10000000) return `₹${(abs/10000000).toFixed(2)} Cr`
  if (abs >= 100000)   return `₹${(abs/100000).toFixed(2)} L`
  if (abs >= 1000)     return `₹${(abs/1000).toFixed(1)} K`
  return `₹${abs.toLocaleString('en-IN')}`
}
const fmtFull = n => `₹${Math.abs(n).toLocaleString('en-IN')}`
const pct     = (a, b) => b > 0 ? ((a / b) * 100).toFixed(1) : '0.0'

const toDate = v => (!v ? null : v.length === 7 ? `${v}-01` : v)

const CAT_ICONS = {
  home_loan:'🏠', personal:'👤', car_loan:'🚗', overdraft:'💳', credit_card:'💳', business:'🏢', other:'📋',
  equity:'📈', mf:'📊', gold:'🥇', ppf:'🏦', fd:'📑', bonds:'💰', nps:'🏛️',
  residential:'🏡', commercial:'🏢', land:'🌱', industrial:'🏗️',
  savings:'🏦', current:'💼', hand:'💵', cashloan:'💰', wallet:'📱',
  investment:'📈', liability:'🏛️', cash:'💵', property:'🏠',
}

const C = {
  sidebar:'#0B1E4F', sidebarActive:'#1E3A8A',
  liability:{ main:'#E8195A', bg:'#FFF0F5', chart:['#E8195A','#FF6B9D','#FFB3CC','#FFD9E8'] },
  liquidity:{ main:'#059669', bg:'#ECFDF5', chart:['#059669','#10B981','#34D399','#6EE7B7'] },
  property: { main:'#D97706', bg:'#FFFBEB', chart:['#D97706','#F59E0B','#FCD34D','#FDE68A'] },
  cash:     { main:'#2563EB', bg:'#EFF6FF', chart:['#2563EB','#3B82F6','#60A5FA','#93C5FD'] },
  mf:       { main:'#7C3AED', bg:'#F5F3FF', chart:['#7C3AED','#8B5CF6','#A78BFA','#C4B5FD'] },
  nw:       { main:'#1E3A8A', accent:'#10B981' },
}

const TABLE = {
  liabilities: 'liabilities',
  liquidity:   'liquidity_assets',
  property:    'property_assets',
  cash:        'cash_balances',
  goals:       'financial_goals',
}

// ══════════════════════════════════════════════════════════════════════════════
// AUTH SCREEN
// ══════════════════════════════════════════════════════════════════════════════
function AuthScreen() {
  const [email, setEmail]         = useState('')
  const [pass, setPass]           = useState('')
  const [err, setErr]             = useState('')
  const [loading, setLoading]     = useState(false)
  const [showPass, setShowPass]   = useState(false)
  const [mode, setMode]           = useState('login')
  const [resetSent, setResetSent] = useState(false)

  const login = async () => {
    setLoading(true); setErr('')
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pass })
    if (error) setErr(error.message)
    setLoading(false)
  }

  const resetPassword = async () => {
    if (!email.trim()) { setErr('Enter your email first.'); return }
    setLoading(true); setErr('')
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/`,
    })
    if (error) setErr(error.message)
    else setResetSent(true)
    setLoading(false)
  }

  return (
    <div style={{ minHeight:'100vh', background:'linear-gradient(135deg,#0B1E4F 0%,#1E3A8A 50%,#0B1E4F 100%)', display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div style={{ position:'absolute', inset:0, overflow:'hidden', pointerEvents:'none' }}>
        {[...Array(6)].map((_,i) => (
          <div key={i} style={{ position:'absolute', width:200+i*80, height:200+i*80, borderRadius:'50%', border:'1px solid rgba(255,255,255,.06)', top:`${10+i*12}%`, left:`${5+i*15}%` }} />
        ))}
      </div>
      <div style={{ width:'100%', maxWidth:460, position:'relative', zIndex:1 }}>
        <div style={{ textAlign:'center', marginBottom:32 }}>
          <div style={{ display:'inline-flex', alignItems:'center', gap:12, background:'rgba(255,255,255,.1)', backdropFilter:'blur(8px)', padding:'12px 24px', borderRadius:16, border:'1px solid rgba(255,255,255,.15)' }}>
            <div style={{ width:44, height:44, background:'linear-gradient(135deg,#3B6FD4,#10B981)', borderRadius:12, display:'flex', alignItems:'center', justifyContent:'center', fontSize:22, fontWeight:800, color:'white' }}>₹</div>
            <div style={{ textAlign:'left' }}>
              <div style={{ color:'white', fontSize:20, fontWeight:700, letterSpacing:'-0.5px', fontFamily:"'Syne',sans-serif" }}>WEALTH IQ</div>
              <div style={{ color:'rgba(255,255,255,.6)', fontSize:11, letterSpacing:'2px', textTransform:'uppercase' }}>Intelligence for Your Net Worth.</div>
            </div>
          </div>
        </div>
        <div style={{ background:'white', borderRadius:24, padding:36, boxShadow:'0 40px 80px rgba(0,0,0,.4)' }}>
          <div style={{ marginBottom:28 }}>
            <h2 style={{ fontSize:24, fontWeight:700, color:'#0B1E4F', margin:0, fontFamily:"'Syne',sans-serif" }}>
              {mode === 'login' ? 'Sign in' : 'Reset password'}
            </h2>
            <p style={{ fontSize:13, color:'#6B7280', margin:'6px 0 0' }}>Intelligence for Your Net Worth.</p>
          </div>
          {resetSent ? (
            <div style={{ background:'#F0FDF4', border:'1px solid #86EFAC', borderRadius:10, padding:16, fontSize:13, color:'#166534', textAlign:'center' }}>
              ✓ Check your email for a reset link.
              <button onClick={()=>{setMode('login');setResetSent(false)}} style={{ display:'block', margin:'10px auto 0', background:'none', border:'none', color:'#2563EB', cursor:'pointer', fontSize:12 }}>Back to sign in</button>
            </div>
          ) : (
            <>
              <div style={{ marginBottom:16 }}>
                <label style={LBL}>Email</label>
                <input value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==='Enter'&&(mode==='login'?login():resetPassword())}
                  placeholder="your@email.com" style={{ ...INP, marginTop:6 }} />
              </div>
              {mode === 'login' && (
                <div style={{ marginBottom:8 }}>
                  <label style={LBL}>Password</label>
                  <div style={{ position:'relative', marginTop:6 }}>
                    <input value={pass} type={showPass?'text':'password'} onChange={e=>setPass(e.target.value)} onKeyDown={e=>e.key==='Enter'&&login()}
                      placeholder="••••••••" style={{ ...INP, paddingRight:40 }} />
                    <button onClick={()=>setShowPass(v=>!v)} style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', fontSize:16, color:'#9CA3AF' }}>
                      {showPass?'🙈':'👁️'}
                    </button>
                  </div>
                </div>
              )}
              {err && <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:8, padding:'10px 12px', fontSize:12, color:'#DC2626', marginBottom:12 }}>⚠️ {err}</div>}
              <button onClick={mode==='login'?login:resetPassword} disabled={loading}
                style={{ width:'100%', padding:'14px', background:'linear-gradient(135deg,#1E3A8A,#3B6FD4)', color:'white', border:'none', borderRadius:12, fontSize:15, fontWeight:600, cursor:'pointer', marginTop:8, opacity:loading?.8:1, fontFamily:"'Syne',sans-serif" }}>
                {loading ? '⏳ Please wait…' : mode==='login' ? 'Sign In →' : 'Send Reset Link →'}
              </button>
              <div style={{ textAlign:'center', marginTop:16 }}>
                {mode === 'login'
                  ? <button onClick={()=>{setMode('reset');setErr('')}} style={{ background:'none', border:'none', color:'#6B7280', fontSize:12, cursor:'pointer' }}>Forgot password?</button>
                  : <button onClick={()=>{setMode('login');setErr('')}} style={{ background:'none', border:'none', color:'#2563EB', fontSize:12, cursor:'pointer' }}>← Back to sign in</button>
                }
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// LOADING SCREEN
// ══════════════════════════════════════════════════════════════════════════════
function LoadingScreen() {
  return (
    <div style={{ minHeight:'100vh', background:'#F1F5FB', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:16 }}>
      <div style={{ width:48, height:48, background:'linear-gradient(135deg,#3B6FD4,#10B981)', borderRadius:12, display:'flex', alignItems:'center', justifyContent:'center', fontSize:22, fontWeight:800, color:'white' }}>₹</div>
      <div style={{ fontSize:14, color:'#9CA3AF' }}>Loading your wealth data…</div>
      <style>{`@keyframes loadBar{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}`}</style>
      <div style={{ width:200, height:3, background:'#E5E7EB', borderRadius:2, overflow:'hidden' }}>
        <div style={{ width:'60%', height:'100%', background:'linear-gradient(90deg,#3B6FD4,#10B981)', borderRadius:2, animation:'loadBar 1.2s ease-in-out infinite' }} />
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════════════════════════════════════
export default function KBWealthEnterprise() {
  const [authUser, setAuthUser]       = useState(undefined)
  const [profile, setProfile]         = useState(null)
  const [mod, setMod]                 = useState('overview')
  const [data, setData]               = useState({
    liabilities:[], liquidity:[], property:[], cash:[], goals:[],
    nw_history:[], alerts:[],
    mf_funds:[], mf_transactions:[],
  })
  const [dataLoading, setDataLoading] = useState(false)
  const [modal, setModal]             = useState(null)
  const [toast, setToast]             = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setAuthUser(session?.user ?? null)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!authUser) { setProfile(null); return }
    const loadProfile = async () => {
      const { data, error } = await supabase
        .from('user_profiles').select('*').eq('id', authUser.id).single()
      if (error) {
        setProfile({
          id:        authUser.id,
          full_name: authUser.user_metadata?.full_name ?? authUser.email?.split('@')[0] ?? 'User',
          initials:  (authUser.email?.slice(0,2) ?? 'U').toUpperCase(),
          role:      'member',
          color:     '#3B6FD4',
        })
        return
      }
      setProfile(data)
    }
    loadProfile()
  }, [authUser])

  const loadData = useCallback(async () => {
    if (!authUser) return
    setDataLoading(true)
    const uid = authUser.id
    try {
      const probe = await supabase.from('portfolio_funds').select('user_id').limit(1)
      const mfUserIdMissing =
        !!probe.error &&
        (probe.error.code === 'PGRST204' ||
          probe.error.message?.toLowerCase().includes('user_id') ||
          probe.error.message?.toLowerCase().includes('column'))

      const mfFundsQuery = mfUserIdMissing
        ? supabase.from('portfolio_funds').select('id, fund_name, isin, category, sip_amount, is_active, current_nav').order('created_at', { ascending:true })
        : supabase.from('portfolio_funds').select('id, fund_name, isin, category, sip_amount, is_active, current_nav').eq('user_id', uid).order('created_at', { ascending:true })

      const mfTxQuery = mfUserIdMissing
        ? supabase.from('transactions').select('fund_id, type, amount, units_allotted').order('invest_date', { ascending:false }).limit(500)
        : supabase.from('transactions').select('fund_id, type, amount, units_allotted').eq('user_id', uid).order('invest_date', { ascending:false }).limit(500)

      const [liab, liq, prop, cash, goals, nwh, alerts, mfFunds, mfTx] = await Promise.allSettled([
        supabase.from('liabilities').select('*').eq('user_id', uid).order('created_at', { ascending:true }),
        supabase.from('liquidity_assets').select('*').eq('user_id', uid).order('created_at', { ascending:true }),
        supabase.from('property_assets').select('*').eq('user_id', uid).order('created_at', { ascending:true }),
        supabase.from('cash_balances').select('*').eq('user_id', uid).order('created_at', { ascending:true }),
        supabase.from('financial_goals').select('*').eq('user_id', uid).eq('status','active'),
        supabase.from('net_worth_history').select('*').eq('user_id', uid).order('snapshot_date',{ascending:true}).limit(12),
        supabase.from('alerts_log').select('*').eq('is_read',false).order('triggered_at',{ascending:false}).limit(10),
        mfFundsQuery,
        mfTxQuery,
      ])

      setData({
        liabilities:     liab.status==='fulfilled'    ? (liab.value.data    ?? []) : [],
        liquidity:       liq.status==='fulfilled'     ? (liq.value.data     ?? []) : [],
        property:        prop.status==='fulfilled'    ? (prop.value.data    ?? []) : [],
        cash:            cash.status==='fulfilled'    ? (cash.value.data    ?? []) : [],
        goals:           goals.status==='fulfilled'   ? (goals.value.data   ?? []) : [],
        nw_history:      nwh.status==='fulfilled'     ? (nwh.value.data     ?? []) : [],
        alerts:          alerts.status==='fulfilled'  ? (alerts.value.data  ?? []) : [],
        mf_funds:        mfFunds.status==='fulfilled' ? (mfFunds.value.data ?? []) : [],
        mf_transactions: mfTx.status==='fulfilled'    ? (mfTx.value.data    ?? []) : [],
      })
    } finally {
      setDataLoading(false)
    }
  }, [authUser])

  useEffect(() => { loadData() }, [loadData])

  const triggerSnapshot = useCallback(async () => {
    try { await fetch('/api/snapshot', { method:'POST' }) } catch (_) {}
  }, [])

  const showToast = useCallback((msg, type='success') => {
    setToast({ msg, type }); setTimeout(()=>setToast(null), 2800)
  }, [])

  const saveItem = useCallback(async (module, item) => {
    const table = TABLE[module]
    if (!table) return
    const isNew = !item.id
    let payload = { user_id: authUser.id }

    if (module === 'liabilities') {
      payload = { ...payload, cat:item.cat, name:item.name, bank:item.bank||null,
        outstanding:item.outstanding||0, emi:item.emi||0, rate:item.rate||0,
        end_date:toDate(item.end_date)||null }
    } else if (module === 'liquidity') {
      payload = { ...payload, cat:item.cat, name:item.name,
        value:item.value||0, invested:item.invested||0 }
    } else if (module === 'property') {
      payload = { ...payload, cat:item.cat, name:item.name, loc:item.loc||null,
        purchase:item.purchase||0, current:item.current||0, year:item.year||null }
    } else if (module === 'cash') {
      payload = { ...payload, cat:item.cat, name:item.name, bank:item.bank||null,
        acct:item.acct||null, balance:item.balance||0 }
    } else if (module === 'goals') {
      payload = { ...payload, cat:item.cat, name:item.name, target:item.target||0,
        current:item.current||0, target_date:toDate(item.target_date)||null,
        color:item.color||'#3B6FD4', status:'active' }
    }

    const { error } = isNew
      ? await supabase.from(table).insert(payload)
      : await supabase.from(table).update(payload).eq('id', item.id)

    if (error) { showToast(`Error: ${error.message}`, 'warn'); return }
    setModal(null)
    showToast(isNew ? 'Added successfully' : 'Updated successfully')
    await loadData()
    await triggerSnapshot()
  }, [authUser, loadData, triggerSnapshot, showToast])

  const deleteItem = useCallback(async (module, id) => {
    const table = TABLE[module]
    if (!table) return
    const { error } = await supabase.from(table).delete().eq('id', id)
    if (error) { showToast(`Error: ${error.message}`, 'warn'); return }
    showToast('Deleted', 'warn')
    await loadData(); await triggerSnapshot()
  }, [loadData, triggerSnapshot, showToast])

  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  // ── UPDATED: totals now includes MF corpus in liq ─────────────────────────
  const totals = useMemo(() => {
    const liab     = data.liabilities.reduce((s,x) => s + Number(x.outstanding ?? 0), 0)
    const liqManual= data.liquidity.reduce((s,x)   => s + Number(x.value       ?? 0), 0)
    const prop     = data.property.reduce((s,x)    => s + Number(x.current     ?? 0), 0)
    const cash     = data.cash.reduce((s,x)        => s + Number(x.balance     ?? 0), 0)

    const mfValue = (data.mf_funds || []).reduce((tot, fund) => {
      let units = 0
      for (const t of (data.mf_transactions || []).filter(t => t.fund_id === fund.id)) {
        const u = Number(t.units_allotted || 0)
        if (['sip','lumpsum','buy','stp','switch_in'].includes(t.type)) units += u
        if (['sell','switch_out'].includes(t.type))                      units -= u
      }
      return tot + units * Number(fund.current_nav || 0)
    }, 0)

    const liq    = liqManual + mfValue
    const assets = liq + prop + cash
    return { liab, liq, liqManual, mfValue, prop, cash, assets, nw: assets - liab }
  }, [data])

  const auth = profile ? {
    name:     profile.full_name,
    initials: profile.initials ?? profile.full_name?.slice(0,2).toUpperCase() ?? 'U',
    role:     profile.role,
    color:    profile.color ?? '#3B6FD4',
    email:    authUser?.email ?? '',
  } : null

  const isViewer = auth?.role === 'viewer'

  if (authUser === undefined) return <LoadingScreen />
  if (!authUser)              return <AuthScreen />
  if (!auth)                  return <LoadingScreen />

  const dateLabel = new Date().toLocaleDateString('en-IN', { month:'short', year:'numeric' })

  return (
    <div style={{ display:'flex', minHeight:'100vh', background:'#F1F5FB', fontFamily:"'DM Sans',-apple-system,sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=Syne:wght@600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:rgba(0,0,0,.15);border-radius:2px}
        @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        @keyframes toastIn{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}
        .fade-up{animation:fadeUp .25s ease both}
        .hover-row:hover{background:#F8FAFC!important}
        input,select,textarea,button{font-family:'DM Sans',sans-serif}
      `}</style>

      <Sidebar mod={mod} setMod={setMod} auth={auth} onLogout={handleLogout} alertCount={data.alerts.length} />

      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
        <Header auth={auth} dateLabel={dateLabel} totals={totals} alerts={data.alerts} />
        <div style={{ flex:1, overflowY:'auto', padding:'24px 28px 40px', position:'relative' }}>
          {dataLoading && <div style={{ position:'absolute', top:0, left:0, right:0, height:3, background:'linear-gradient(90deg,#3B6FD4,#10B981)', zIndex:10 }} />}

          {mod==='overview'    && <Overview      data={data} totals={totals} setMod={setMod} />}
          {mod==='liabilities' && <LiabilitiesPage data={data} totals={totals} isViewer={isViewer} onAdd={()=>setModal({type:'add',module:'liabilities',item:{}})} onEdit={item=>setModal({type:'edit',module:'liabilities',item})} onDelete={id=>deleteItem('liabilities',id)} />}
          {mod==='liquidity'   && <LiquidityPage   data={data} totals={totals} isViewer={isViewer} setMod={setMod} onAdd={()=>setModal({type:'add',module:'liquidity',item:{}})} onEdit={item=>setModal({type:'edit',module:'liquidity',item})} onDelete={id=>deleteItem('liquidity',id)} />}
          {mod==='property'    && <PropertyPage    data={data} totals={totals} isViewer={isViewer} onAdd={()=>setModal({type:'add',module:'property',item:{}})} onEdit={item=>setModal({type:'edit',module:'property',item})} onDelete={id=>deleteItem('property',id)} />}
          {mod==='cash'        && <CashPage        data={data} totals={totals} isViewer={isViewer} onAdd={()=>setModal({type:'add',module:'cash',item:{}})} onEdit={item=>setModal({type:'edit',module:'cash',item})} onDelete={id=>deleteItem('cash',id)} />}
          {mod==='networth'    && <NetWorthPage    data={data} totals={totals} />}
          {mod==='goals'       && <GoalsPage       data={data} totals={totals} isViewer={isViewer} onAdd={()=>setModal({type:'add',module:'goals',item:{}})} onEdit={item=>setModal({type:'edit',module:'goals',item})} onDelete={id=>deleteItem('goals',id)} />}
          {mod==='mf'          && <MFPage data={data} isViewer={isViewer} onRefresh={loadData} />}
          {mod==='settings'    && <SettingsPage auth={auth} />}
        </div>
      </div>

      {modal && <ItemModal modal={modal} onClose={()=>setModal(null)} onSave={item=>saveItem(modal.module,item)} />}

      {toast && (
        <div style={{ position:'fixed', bottom:28, right:28, zIndex:999, background:toast.type==='warn'?'#B45309':'#059669', color:'white', padding:'12px 20px', borderRadius:12, fontSize:13, fontWeight:600, boxShadow:'0 8px 24px rgba(0,0,0,.2)', animation:'toastIn .3s ease' }}>
          {toast.type==='warn'?'🗑️':'✓'} {toast.msg}
        </div>
      )}
    </div>
  )
}

// ── SIDEBAR ───────────────────────────────────────────────────────────────────
function Sidebar({ mod, setMod, auth, onLogout, alertCount }) {
  const navItems = [
    { id:'overview',    label:'Overview',        icon:'⊞' },
    { id:'liabilities', label:'Liabilities',     icon:'🏛️' },
    { id:'liquidity',   label:'Liquidity',       icon:'📊' },
    { id:'mf',          label:'Mutual Funds',    icon:'📈', indent:true },
    { id:'property',    label:'Property Assets', icon:'🏠' },
    { id:'cash',        label:'Cash Balance',    icon:'💵' },
    { id:'networth',    label:'Net Worth',       icon:'📉' },
    { id:'goals',       label:'Goals',           icon:'🎯' },
    { id:'settings',    label:'Settings',        icon:'⚙️' },
  ]
  return (
    <div style={{ width:224, background:C.sidebar, display:'flex', flexDirection:'column', flexShrink:0, overflowY:'auto' }}>
      <div style={{ padding:'24px 20px 20px', borderBottom:'1px solid rgba(255,255,255,.07)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:40, height:40, background:'linear-gradient(135deg,#3B6FD4,#10B981)', borderRadius:10, display:'flex', alignItems:'center', justifyContent:'center', fontSize:20, fontWeight:800, color:'white', flexShrink:0 }}>₹</div>
          <div>
            <div style={{ color:'white', fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:16, lineHeight:1.1 }}>WEALTH IQ</div>
            <div style={{ color:'rgba(255,255,255,.4)', fontSize:9, letterSpacing:'1.5px', textTransform:'uppercase' }}>GOLD</div>
          </div>
        </div>
      </div>
      <nav style={{ flex:1, padding:'16px 10px' }}>
        {navItems.map(item => (
          <button key={item.id} onClick={()=>setMod(item.id)}
            style={{ width:'100%', display:'flex', alignItems:'center', gap:10,
              padding: item.indent ? '7px 12px 7px 28px' : '9px 12px',
              borderRadius:10, border:'none', cursor:'pointer', marginBottom:2, textAlign:'left', transition:'.15s',
              background: mod===item.id ? (item.id==='mf' ? 'rgba(124,58,237,.3)' : C.sidebarActive) : 'transparent',
              color: mod===item.id ? 'white' : item.indent ? 'rgba(255,255,255,.45)' : 'rgba(255,255,255,.55)',
              fontWeight: mod===item.id ? 600 : 400, fontSize: item.indent ? 12 : 13,
            }}>
            <span style={{ fontSize: item.indent ? 14 : 16, flexShrink:0, lineHeight:1 }}>{item.icon}</span>
            <span style={{ flex:1 }}>{item.label}</span>
            {item.id==='mf' && mod!=='mf' && <span style={{ fontSize:9, background:'rgba(124,58,237,.3)', color:'#A78BFA', padding:'1px 6px', borderRadius:3, fontWeight:600 }}>MODULE</span>}
            {mod===item.id && <div style={{ width:4, height:4, borderRadius:'50%', background: item.id==='mf'?'#A78BFA':'#10B981' }} />}
          </button>
        ))}
      </nav>
      <div style={{ padding:'16px 12px', borderTop:'1px solid rgba(255,255,255,.07)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
          <div style={{ width:34, height:34, borderRadius:'50%', background:auth.color, display:'flex', alignItems:'center', justifyContent:'center', color:'white', fontSize:12, fontWeight:700, flexShrink:0 }}>{auth.initials}</div>
          <div>
            <div style={{ color:'white', fontSize:12, fontWeight:600 }}>{auth.name}</div>
            <div style={{ color:'rgba(255,255,255,.4)', fontSize:10 }}>{auth.role}</div>
          </div>
        </div>
        <div style={{ background:'rgba(255,255,255,.05)', borderRadius:8, padding:'8px 12px', marginBottom:8 }}>
          <div style={{ color:'rgba(255,255,255,.5)', fontSize:9, letterSpacing:'1px', textTransform:'uppercase', marginBottom:2 }}>Platform</div>
          <div style={{ color:'rgba(255,255,255,.8)', fontSize:11, fontWeight:500 }}>Intelligence for Your Net Worth.</div>
        </div>
        <button onClick={onLogout} style={{ width:'100%', padding:'8px', background:'rgba(239,68,68,.15)', color:'#FCA5A5', border:'1px solid rgba(239,68,68,.2)', borderRadius:8, fontSize:12, cursor:'pointer', fontWeight:500 }}>
          Sign Out
        </button>
      </div>
    </div>
  )
}

// ── HEADER ────────────────────────────────────────────────────────────────────
function Header({ auth, dateLabel, totals, alerts }) {
  const [showAlerts, setShowAlerts] = useState(false)
  return (
    <div style={{ background:'white', borderBottom:'1px solid #E5E7EB', padding:'0 28px', height:64, display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0, position:'relative', zIndex:50 }}>
      <div>
        <h1 style={{ fontFamily:"'Syne',sans-serif", fontSize:20, fontWeight:700, color:'#0B1E4F', letterSpacing:'-0.3px' }}>Wealth Overview</h1>
        <p style={{ fontSize:11, color:'#9CA3AF', margin:0 }}>Your complete financial Intellegence</p>
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:16 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, background:'#F8FAFC', border:'1px solid #E5E7EB', borderRadius:10, padding:'7px 14px', fontSize:13, color:'#374151', fontWeight:500 }}>
          📅 {dateLabel}
        </div>
        <div style={{ position:'relative' }}>
          <button onClick={()=>setShowAlerts(v=>!v)}
            style={{ width:38, height:38, borderRadius:10, background:'#F8FAFC', border:'1px solid #E5E7EB', cursor:'pointer', fontSize:16, display:'flex', alignItems:'center', justifyContent:'center', position:'relative' }}>
            🔔
            {alerts.length>0 && <div style={{ position:'absolute', top:4, right:4, width:8, height:8, borderRadius:'50%', background:'#E8195A' }} />}
          </button>
          {showAlerts && alerts.length>0 && (
            <div style={{ position:'absolute', top:46, right:0, width:320, background:'white', borderRadius:14, border:'1px solid #E5E7EB', boxShadow:'0 8px 24px rgba(0,0,0,.12)', zIndex:200, overflow:'hidden' }}>
              <div style={{ padding:'12px 16px', borderBottom:'1px solid #F3F4F6', fontSize:12, fontWeight:600, color:'#374151' }}>Alerts ({alerts.length})</div>
              {alerts.map(a => (
                <div key={a.id} style={{ padding:'10px 16px', borderBottom:'1px solid #F9FAFB', fontSize:12 }}>
                  <div style={{ fontWeight:600, color:a.severity==='critical'?'#DC2626':a.severity==='warning'?'#D97706':'#374151', marginBottom:2 }}>{a.title||a.alert_type}</div>
                  <div style={{ color:'#6B7280', fontSize:11 }}>{(a.message||'').slice(0,80)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ background:'linear-gradient(135deg,#0B1E4F,#1E3A8A)', borderRadius:12, padding:'8px 16px', textAlign:'right' }}>
          <div style={{ color:'rgba(255,255,255,.6)', fontSize:9, letterSpacing:'1px', textTransform:'uppercase' }}>Net Worth</div>
          <div style={{ color:'white', fontFamily:"'Syne',sans-serif", fontSize:16, fontWeight:700 }}>{fmtINR(totals.nw)}</div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <div style={{ fontSize:12, color:'#6B7280' }}>Hello, <strong style={{ color:'#111' }}>{auth.name}</strong></div>
          <div style={{ width:36, height:36, borderRadius:'50%', background:auth.color, display:'flex', alignItems:'center', justifyContent:'center', color:'white', fontSize:12, fontWeight:700 }}>{auth.initials}</div>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// OVERVIEW
// ══════════════════════════════════════════════════════════════════════════════
function Overview({ data, totals, setMod }) {
  // ── UPDATED: liquidity items include MF corpus as a line ──────────────────
  const cards = [
    { key:'liabilities', label:'Total Liabilities',
      val:totals.liab,
      items: data.liabilities.map(x=>({name:x.name,val:Number(x.outstanding)})),
      colors:C.liability, icon:'🏛️', mod:'liabilities', sign:-1 },
    { key:'liquidity',   label:'Liquidity (Investments)',
      val:totals.liq,
      items: [
        ...data.liquidity.map(x=>({name:x.name,val:Number(x.value)})),
        ...(totals.mfValue > 0 ? [{ name:'Mutual Funds (MF)', val:totals.mfValue }] : []),
      ],
      colors:C.liquidity, icon:'📈', mod:'liquidity', sign:1 },
    { key:'property',    label:'Property Assets',
      val:totals.prop,
      items: data.property.map(x=>({name:x.name,val:Number(x.current)})),
      colors:C.property, icon:'🏠', mod:'property', sign:1 },
    { key:'cash',        label:'Cash Balance',
      val:totals.cash,
      items: data.cash.map(x=>({name:x.name,val:Number(x.balance)})),
      colors:C.cash, icon:'💵', mod:'cash', sign:1 },
  ]

  const mfValue = useMemo(() => {
    return (data.mf_funds || []).reduce((total, fund) => {
      const fundTxs = (data.mf_transactions || []).filter(t => t.fund_id === fund.id)
      let units = 0
      for (const t of fundTxs) {
        const u = Number(t.units_allotted || 0)
        if (['sip','lumpsum','buy','stp','switch_in'].includes(t.type)) units += u
        if (['sell','switch_out'].includes(t.type))                      units -= u
      }
      const nav = Number(fund.current_nav || 0)
      return total + (units * nav)
    }, 0)
  }, [data.mf_funds, data.mf_transactions])

  return (
    <div className="fade-up">
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:12, marginBottom:20 }}>
        {cards.map(c => (
          <div key={c.key} style={{ background:'white', borderRadius:14, padding:'16px 18px', border:'1px solid #E8ECF4', display:'flex', alignItems:'center', gap:12, cursor:'pointer' }} onClick={()=>setMod(c.mod)}>
            <div style={{ width:48, height:48, borderRadius:14, background:c.colors.bg, display:'flex', alignItems:'center', justifyContent:'center', fontSize:24, flexShrink:0 }}>{c.icon}</div>
            <div>
              <div style={{ fontSize:11, color:'#9CA3AF', fontWeight:500 }}>{c.label}</div>
              <div style={{ fontSize:18, fontWeight:700, color:c.sign<0?C.liability.main:'#0B1E4F', fontFamily:"'Syne',sans-serif" }}>{fmtINR(c.val)}</div>
              <div style={{ fontSize:11, color:c.sign<0?C.liability.main:C.liquidity.main, fontWeight:500 }}>{c.sign>0?'↑':'↓'} {pct(c.val,totals.assets)}% of assets</div>
            </div>
          </div>
        ))}

        <div style={{ background:'linear-gradient(135deg,#0B1E4F,#1E3A8A)', borderRadius:14, padding:'16px 18px', display:'flex', alignItems:'center', gap:12, position:'relative', overflow:'hidden', cursor:'pointer' }} onClick={()=>setMod('mf')}>
          <div style={{ position:'absolute', right:-10, top:-10, width:80, height:80, borderRadius:'50%', border:'1px solid rgba(255,255,255,.1)' }} />
          <div style={{ width:48, height:48, borderRadius:14, background:'rgba(255,255,255,.1)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:24, flexShrink:0 }}>💎</div>
          <div>
            <div style={{ fontSize:11, color:'rgba(255,255,255,.5)', fontWeight:500 }}>MF Corpus</div>
            <div style={{ fontSize:18, fontWeight:700, color:'white', fontFamily:"'Syne',sans-serif" }}>{fmtINR(mfValue)}</div>
            <div style={{ fontSize:11, color:'#A78BFA', fontWeight:500 }}>→ Open MF Module</div>
          </div>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:16, marginBottom:16 }}>
        {cards.map(c => <OverviewCard key={c.key} card={c} totalAssets={totals.assets} onClick={()=>setMod(c.mod)} />)}
      </div>

      <div style={{ background:'white', borderRadius:16, padding:'22px 28px', border:'1px solid #E8ECF4', display:'flex', alignItems:'center', gap:20 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ width:48, height:48, borderRadius:14, background:'#EFF6FF', display:'flex', alignItems:'center', justifyContent:'center', fontSize:22 }}>🏦</div>
          <div>
            <div style={{ fontSize:11, color:'#9CA3AF' }}>Total Assets</div>
            <div style={{ fontFamily:"'Syne',sans-serif", fontSize:22, fontWeight:700, color:'#0B1E4F' }}>{fmtFull(totals.assets)}</div>
          </div>
        </div>
        <div style={{ width:40, height:40, borderRadius:'50%', background:'#F3F4F6', display:'flex', alignItems:'center', justifyContent:'center', fontSize:20, flexShrink:0 }}>−</div>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ width:48, height:48, borderRadius:14, background:'#FFF0F5', display:'flex', alignItems:'center', justifyContent:'center', fontSize:22 }}>🏛️</div>
          <div>
            <div style={{ fontSize:11, color:'#9CA3AF' }}>Total Liabilities</div>
            <div style={{ fontFamily:"'Syne',sans-serif", fontSize:22, fontWeight:700, color:C.liability.main }}>{fmtFull(totals.liab)}</div>
          </div>
        </div>
        <div style={{ width:40, height:40, borderRadius:'50%', background:'#F3F4F6', display:'flex', alignItems:'center', justifyContent:'center', fontSize:20, flexShrink:0 }}>=</div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:11, color:'#9CA3AF' }}>Net Worth</div>
          <div style={{ fontFamily:"'Syne',sans-serif", fontSize:28, fontWeight:800, color:C.nw.main }}>{fmtFull(totals.nw)}</div>
        </div>
        {data.nw_history.length > 0 && (
          <div style={{ width:120, height:60 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.nw_history.map(r=>({ m:r.snapshot_date?.slice(0,7), nw:Number(r.net_worth??0) }))}>
                <defs><linearGradient id="ng" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10B981" stopOpacity={0.3}/><stop offset="95%" stopColor="#10B981" stopOpacity={0}/></linearGradient></defs>
                <Area type="monotone" dataKey="nw" stroke="#10B981" strokeWidth={2} fill="url(#ng)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  )
}

function OverviewCard({ card, totalAssets, onClick }) {
  const pctOfAssets = totalAssets > 0 ? (card.val / totalAssets) * 100 : 0
  const pieData     = card.items.map((it,i) => ({ name:it.name, value:it.val, color:card.colors.chart[i % card.colors.chart.length] }))
  const emptyPie    = [{ name:'empty', value:1, color:'#F3F4F6' }]
  return (
    <div style={{ background:'white', borderRadius:16, padding:20, border:'1px solid #E8ECF4', cursor:'pointer' }} onClick={onClick}>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:16 }}>
        <div style={{ width:40, height:40, borderRadius:12, background:card.colors.bg, display:'flex', alignItems:'center', justifyContent:'center', fontSize:20 }}>{card.icon}</div>
        <div>
          <div style={{ fontSize:12, fontWeight:600, color:'#374151' }}>{card.label}</div>
          <div style={{ fontSize:16, fontWeight:700, color:card.colors.main, fontFamily:"'Syne',sans-serif" }}>{fmtINR(card.val)}</div>
        </div>
      </div>
      {card.items.map((it,i) => (
        <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'5px 0', borderBottom:i<card.items.length-1?'1px solid #F3F4F6':'none' }}>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <div style={{ width:8, height:8, borderRadius:'50%', background:card.colors.chart[i%card.colors.chart.length], flexShrink:0 }} />
            <span style={{ fontSize:11, color:'#6B7280' }}>{it.name}</span>
          </div>
          <span style={{ fontSize:11, fontWeight:600, color:'#374151', fontFamily:"'JetBrains Mono',monospace" }}>{fmtFull(it.val)}</span>
        </div>
      ))}
      <div style={{ display:'flex', justifyContent:'space-between', marginTop:10, paddingTop:8, borderTop:'2px solid #F3F4F6' }}>
        <span style={{ fontSize:11, fontWeight:600, color:'#374151' }}>Total</span>
        <span style={{ fontSize:12, fontWeight:700, color:card.colors.main, fontFamily:"'JetBrains Mono',monospace" }}>{fmtFull(card.val)}</span>
      </div>
      <div style={{ display:'flex', justifyContent:'center', alignItems:'center', marginTop:16, position:'relative' }}>
        <PieChart width={130} height={130}>
          <Pie data={pieData.length?pieData:emptyPie} cx={60} cy={60} innerRadius={42} outerRadius={60} paddingAngle={2} dataKey="value" startAngle={90} endAngle={-270}>
            {(pieData.length?pieData:emptyPie).map((e,i) => <Cell key={i} fill={e.color} />)}
          </Pie>
          <Tooltip formatter={v=>fmtINR(v)} />
        </PieChart>
        <div style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)', textAlign:'center', pointerEvents:'none' }}>
          <div style={{ fontFamily:"'Syne',sans-serif", fontSize:16, fontWeight:700, color:'#0B1E4F', lineHeight:1.1 }}>{pctOfAssets.toFixed(1)}%</div>
          <div style={{ fontSize:9, color:'#9CA3AF', lineHeight:1.2 }}>of Total<br/>Assets</div>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// MODULE TEMPLATE
// ══════════════════════════════════════════════════════════════════════════════
function ModulePage({ title, icon, total, totalLabel, color, items, columns, onAdd, onEdit, onDelete, isViewer, extraContent }) {
  return (
    <div className="fade-up">
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
        <div>
          <h2 style={{ fontFamily:"'Syne',sans-serif", fontSize:22, fontWeight:700, color:'#0B1E4F', marginBottom:4 }}>{icon} {title}</h2>
          <div style={{ fontSize:13, color:'#9CA3AF' }}>{items.length} {items.length===1?'entry':'entries'}</div>
        </div>
        {!isViewer && <button onClick={onAdd} style={{ background:color.main, color:'white', border:'none', borderRadius:10, padding:'10px 20px', fontSize:13, fontWeight:600, cursor:'pointer' }}>+ Add</button>}
      </div>
      <div style={{ background:color.main, borderRadius:16, padding:'20px 24px', marginBottom:20, display:'flex', justifyContent:'space-between', alignItems:'center', color:'white' }}>
        <div>
          <div style={{ fontSize:12, opacity:.7, textTransform:'uppercase', letterSpacing:'1px' }}>{totalLabel}</div>
          <div style={{ fontFamily:"'Syne',sans-serif", fontSize:32, fontWeight:700, marginTop:4 }}>{fmtFull(total)}</div>
          <div style={{ fontSize:12, opacity:.7, marginTop:4 }}>{fmtINR(total)} · {items.length} entries</div>
        </div>
        <div style={{ fontSize:64, opacity:.2 }}>{icon}</div>
      </div>
      {extraContent}
      <div style={{ background:'white', borderRadius:16, border:'1px solid #E8ECF4', overflow:'hidden' }}>
        <div style={{ display:'grid', gridTemplateColumns:columns.map(c=>c.w).join(' ') + ' 90px', background:'#F8FAFC', padding:'10px 16px', borderBottom:'1px solid #E5E7EB' }}>
          {columns.map(c => <div key={c.key} style={{ fontSize:10, fontWeight:600, color:'#9CA3AF', textTransform:'uppercase', letterSpacing:'1px' }}>{c.label}</div>)}
          <div style={{ fontSize:10, fontWeight:600, color:'#9CA3AF', textTransform:'uppercase', letterSpacing:'1px' }}>Actions</div>
        </div>
        {items.length === 0 ? (
          <div style={{ padding:40, textAlign:'center', color:'#9CA3AF', fontSize:14 }}>
            <div style={{ fontSize:48, marginBottom:12 }}>📋</div>
            No entries yet.{!isViewer && <> <span style={{ color:color.main, cursor:'pointer', fontWeight:600 }} onClick={onAdd}>Add your first entry →</span></>}
          </div>
        ) : items.map((item,i) => (
          <div key={item.id} className="hover-row" style={{ display:'grid', gridTemplateColumns:columns.map(c=>c.w).join(' ') + ' 90px', padding:'12px 16px', borderBottom:i<items.length-1?'1px solid #F3F4F6':'none', alignItems:'center' }}>
            {columns.map(c => (
              <div key={c.key} style={{ fontSize:12, color:c.color||'#374151', fontWeight:c.bold?600:400, fontFamily:c.mono?"'JetBrains Mono',monospace":undefined }}>
                {c.render ? c.render(item) : item[c.key]}
              </div>
            ))}
            <div style={{ display:'flex', gap:4 }}>
              {!isViewer && <button onClick={()=>onEdit(item)} style={{ padding:'4px 10px', background:'#EFF6FF', color:'#2563EB', border:'none', borderRadius:6, fontSize:11, cursor:'pointer', fontWeight:500 }}>Edit</button>}
              {!isViewer && <button onClick={()=>onDelete(item.id)} style={{ padding:'4px 8px', background:'#FEF2F2', color:'#DC2626', border:'none', borderRadius:6, fontSize:11, cursor:'pointer' }}>🗑</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── LIABILITIES ───────────────────────────────────────────────────────────────
function LiabilitiesPage({ data, totals, onAdd, onEdit, onDelete, isViewer }) {
  const totalEMI = data.liabilities.reduce((s,x) => s + Number(x.emi ?? 0), 0)
  const avgRate  = data.liabilities.length
    ? (data.liabilities.reduce((s,x) => s + Number(x.rate ?? 0), 0) / data.liabilities.length).toFixed(1) : '0.0'
  return <ModulePage
    title="Liabilities" icon="🏛️" total={totals.liab} totalLabel="Total Outstanding Debt"
    color={C.liability} isViewer={isViewer} items={data.liabilities}
    onAdd={onAdd} onEdit={onEdit} onDelete={onDelete}
    extraContent={
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:16 }}>
        {[{l:'Total Debt',v:fmtFull(totals.liab),c:C.liability.main},{l:'Monthly EMI',v:fmtFull(totalEMI),c:'#D97706'},{l:'Avg Rate',v:`${avgRate}%`,c:'#7C3AED'}].map(s=>(
          <div key={s.l} style={{ background:'white', borderRadius:12, padding:'14px 16px', border:'1px solid #E8ECF4' }}>
            <div style={{ fontSize:11, color:'#9CA3AF' }}>{s.l}</div>
            <div style={{ fontFamily:"'Syne',sans-serif", fontSize:20, fontWeight:700, color:s.c }}>{s.v}</div>
          </div>
        ))}
      </div>
    }
    columns={[
      { key:'name',        label:'Liability',   w:'1.5fr', bold:true, render:item=><><span>{CAT_ICONS[item.cat]||'💳'} {item.name}</span><div style={{fontSize:10,color:'#9CA3AF'}}>{item.bank}</div></> },
      { key:'outstanding', label:'Outstanding', w:'1fr',   mono:true, color:C.liability.main, render:item=>fmtFull(Number(item.outstanding)) },
      { key:'emi',         label:'EMI/Month',   w:'1fr',   mono:true, render:item=>Number(item.emi)>0?fmtFull(Number(item.emi)):'—' },
      { key:'rate',        label:'Rate',        w:'60px',  render:item=>`${item.rate}%` },
      { key:'end_date',    label:'Ends',        w:'80px',  render:item=>item.end_date||'—' },
    ]}
  />
}

// ── LIQUIDITY — UPDATED: includes MF corpus banner + 4-stat summary ───────────
function LiquidityPage({ data, totals, onAdd, onEdit, onDelete, isViewer, setMod }) {
  const invested    = data.liquidity.reduce((s,x) => s + Number(x.invested ?? 0), 0)
  const manualGain  = totals.liqManual - invested
  const mfFundCount = (data.mf_funds || []).length
  const activeSIPs  = (data.mf_funds || []).filter(f => f.is_active && f.sip_amount > 0).length

  return <ModulePage
    title="Liquidity (Investments)" icon="📈"
    total={totals.liq}
    totalLabel="Total Investment Value (incl. MF Corpus)"
    color={C.liquidity} isViewer={isViewer} items={data.liquidity}
    onAdd={onAdd} onEdit={onEdit} onDelete={onDelete}
    extraContent={<>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:12 }}>
        {[
          { l:'Manual Invested', v:fmtFull(invested),       c:'#374151'        },
          { l:'Manual Gain',     v:fmtFull(manualGain),     c:C.liquidity.main },
          { l:'MF Corpus',       v:fmtFull(totals.mfValue), c:C.mf.main        },
          { l:'Total Liquidity', v:fmtFull(totals.liq),     c:C.nw.main        },
        ].map(s => (
          <div key={s.l} style={{ background:'white', borderRadius:12, padding:'14px 16px', border:'1px solid #E8ECF4' }}>
            <div style={{ fontSize:11, color:'#9CA3AF' }}>{s.l}</div>
            <div style={{ fontFamily:"'Syne',sans-serif", fontSize:20, fontWeight:700, color:s.c }}>{s.v}</div>
          </div>
        ))}
      </div>
      <div style={{ background:'linear-gradient(135deg,#F5F3FF,#EDE9FE)', border:'1px solid #DDD6FE', borderRadius:14, padding:'14px 18px', marginBottom:16, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ width:40, height:40, borderRadius:12, background:'#7C3AED', display:'flex', alignItems:'center', justifyContent:'center', fontSize:20, flexShrink:0 }}>📈</div>
          <div>
            <div style={{ fontSize:13, fontWeight:600, color:'#5B21B6' }}>Mutual Funds — auto-synced from MF Module</div>
            <div style={{ fontSize:11, color:'#7C3AED', marginTop:2 }}>
              {mfFundCount > 0
                ? `${mfFundCount} funds · ${activeSIPs} active SIPs · NAV updated daily via AMFI cron`
                : 'No MF funds added yet — go to MF Manager to add SIPs'}
            </div>
          </div>
        </div>
        <div style={{ textAlign:'right', flexShrink:0 }}>
          <div style={{ fontFamily:"'Syne',sans-serif", fontSize:22, fontWeight:700, color:'#7C3AED' }}>
            {totals.mfValue > 0 ? fmtFull(totals.mfValue) : '₹0'}
          </div>
          {setMod && (
            <button onClick={()=>setMod('mf')}
              style={{ fontSize:11, color:'#7C3AED', background:'none', border:'none', cursor:'pointer', fontWeight:600, marginTop:2, display:'block', marginLeft:'auto' }}>
              Open MF Manager →
            </button>
          )}
        </div>
      </div>
      {data.liquidity.length > 0 && totals.mfValue > 0 && (
        <div style={{ fontSize:11, fontWeight:600, color:'#9CA3AF', textTransform:'uppercase', letterSpacing:'1px', marginBottom:8 }}>
          Other Manual Investments
        </div>
      )}
    </>}
    columns={[
      { key:'name',     label:'Asset',         w:'1.5fr', bold:true, render:item=><><span>{CAT_ICONS[item.cat]||'💰'} {item.name}</span>{item.cat==='mf'&&<span style={{marginLeft:6,fontSize:9,background:'#F5F3FF',color:'#7C3AED',padding:'2px 6px',borderRadius:4,fontWeight:600}}>MF →</span>}</> },
      { key:'value',    label:'Current Value', w:'1fr',   mono:true, color:C.liquidity.main, render:item=>fmtFull(Number(item.value)) },
      { key:'invested', label:'Invested',      w:'1fr',   mono:true, render:item=>fmtFull(Number(item.invested)) },
      { key:'gain',     label:'Gain/Loss',     w:'1fr',   render:item=>{
        const g = Number(item.value)-Number(item.invested)
        return <span style={{color:g>=0?C.liquidity.main:C.liability.main,fontFamily:"'JetBrains Mono',monospace",fontSize:12,fontWeight:600}}>{g>=0?'+':''}{fmtINR(g)} ({pct(g,Number(item.invested))}%)</span>
      }},
    ]}
  />
}

// ── PROPERTY ──────────────────────────────────────────────────────────────────
function PropertyPage({ data, totals, onAdd, onEdit, onDelete, isViewer }) {
  const purchased = data.property.reduce((s,x) => s + Number(x.purchase ?? 0), 0)
  const app       = totals.prop - purchased
  return <ModulePage
    title="Property Assets" icon="🏠" total={totals.prop} totalLabel="Total Property Value"
    color={C.property} isViewer={isViewer} items={data.property}
    onAdd={onAdd} onEdit={onEdit} onDelete={onDelete}
    extraContent={
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:16 }}>
        {[{l:'Purchase Value',v:fmtFull(purchased),c:'#374151'},{l:'Appreciation',v:`+${fmtFull(app)}`,c:C.property.main},{l:'Return',v:`+${pct(app,purchased)}%`,c:C.property.main}].map(s=>(
          <div key={s.l} style={{ background:'white', borderRadius:12, padding:'14px 16px', border:'1px solid #E8ECF4' }}>
            <div style={{ fontSize:11, color:'#9CA3AF' }}>{s.l}</div>
            <div style={{ fontFamily:"'Syne',sans-serif", fontSize:20, fontWeight:700, color:s.c }}>{s.v}</div>
          </div>
        ))}
      </div>
    }
    columns={[
      { key:'name',     label:'Property',       w:'1.5fr', bold:true, render:item=><><span>{CAT_ICONS[item.cat]||'🏗️'} {item.name}</span><div style={{fontSize:10,color:'#9CA3AF'}}>{item.loc}</div></> },
      { key:'current',  label:'Current Value',  w:'1fr',   mono:true, color:C.property.main, render:item=>fmtFull(Number(item.current)) },
      { key:'purchase', label:'Purchase Value', w:'1fr',   mono:true, render:item=>fmtFull(Number(item.purchase)) },
      { key:'year',     label:'Year',           w:'60px',  render:item=>item.year||'—' },
      { key:'app',      label:'Appreciation',   w:'1fr',   render:item=><span style={{color:C.liquidity.main,fontFamily:"'JetBrains Mono',monospace",fontSize:12,fontWeight:600}}>+{fmtINR(Number(item.current)-Number(item.purchase))}</span> },
    ]}
  />
}

// ── CASH ──────────────────────────────────────────────────────────────────────
function CashPage({ data, totals, onAdd, onEdit, onDelete, isViewer }) {
  return <ModulePage
    title="Cash Balance" icon="💵" total={totals.cash} totalLabel="Total Liquid Cash"
    color={C.cash} isViewer={isViewer} items={data.cash}
    onAdd={onAdd} onEdit={onEdit} onDelete={onDelete}
    extraContent={null}
    columns={[
      { key:'name',    label:'Account',   w:'1.5fr', bold:true, render:item=><><span>{CAT_ICONS[item.cat]||'🏦'} {item.name}</span><div style={{fontSize:10,color:'#9CA3AF'}}>{item.bank} · {item.acct}</div></> },
      { key:'balance', label:'Balance',   w:'1fr',   mono:true, color:C.cash.main, render:item=>fmtFull(Number(item.balance)) },
      { key:'cat',     label:'Type',      w:'80px',  render:item=><span style={{fontSize:10,background:C.cash.bg,color:C.cash.main,padding:'2px 8px',borderRadius:4,fontWeight:600,textTransform:'capitalize'}}>{item.cat}</span> },
      { key:'pct',     label:'% of Cash', w:'80px',  render:item=><span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12}}>{pct(Number(item.balance),totals.cash)}%</span> },
    ]}
  />
}

// ── NET WORTH ─────────────────────────────────────────────────────────────────
function NetWorthPage({ data, totals }) {
  const chartData = data.nw_history.map(r => ({
    m:      r.snapshot_date?.slice(0,7) ?? '',
    nw:     Number(r.net_worth    ?? 0),
    assets: Number(r.total_assets ?? 0),
    liab:   Number(r.total_liab   ?? 0),
  }))
  return (
    <div className="fade-up">
      <h2 style={{ fontFamily:"'Syne',sans-serif", fontSize:22, fontWeight:700, color:'#0B1E4F', marginBottom:20 }}>📉 Net Worth Analysis</h2>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:20 }}>
        {[
          { l:'Total Assets',     v:fmtFull(totals.assets), c:'#0B1E4F' },
          { l:'Total Liabilities',v:fmtFull(totals.liab),   c:C.liability.main },
          { l:'Net Worth',        v:fmtFull(totals.nw),     c:C.nw.main },
          { l:'Debt/Asset Ratio', v:`${pct(totals.liab,totals.assets)}%`, c:'#D97706' },
        ].map(s=>(
          <div key={s.l} style={{ background:'white', borderRadius:14, padding:'18px', border:'1px solid #E8ECF4' }}>
            <div style={{ fontSize:11, color:'#9CA3AF', marginBottom:6 }}>{s.l}</div>
            <div style={{ fontFamily:"'Syne',sans-serif", fontSize:24, fontWeight:700, color:s.c }}>{s.v}</div>
          </div>
        ))}
      </div>
      <div style={{ background:'white', borderRadius:16, padding:'24px', border:'1px solid #E8ECF4', marginBottom:16 }}>
        <div style={{ fontSize:14, fontWeight:600, color:'#374151', marginBottom:16 }}>
          Net Worth Trend {chartData.length===0 && <span style={{fontSize:12,color:'#9CA3AF',fontWeight:400}}>— snapshots created automatically on each save</span>}
        </div>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={chartData} margin={{left:20,right:20,top:10,bottom:0}}>
              <defs>
                <linearGradient id="nwGrad"  x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#1E3A8A" stopOpacity={0.15}/><stop offset="95%" stopColor="#1E3A8A" stopOpacity={0}/></linearGradient>
                <linearGradient id="assGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#059669" stopOpacity={0.15}/><stop offset="95%" stopColor="#059669" stopOpacity={0}/></linearGradient>
              </defs>
              <XAxis dataKey="m" tick={{fontSize:11,fill:'#9CA3AF'}} axisLine={false} tickLine={false} />
              <YAxis tick={{fontSize:10,fill:'#9CA3AF'}} axisLine={false} tickLine={false} tickFormatter={v=>fmtINR(v)} />
              <Tooltip formatter={(v,n)=>[fmtINR(v),n==='nw'?'Net Worth':n==='assets'?'Total Assets':'Liabilities']} />
              <Area type="monotone" dataKey="assets" stroke="#059669" strokeWidth={2}   fill="url(#assGrad)" name="assets" />
              <Area type="monotone" dataKey="nw"     stroke="#1E3A8A" strokeWidth={2.5} fill="url(#nwGrad)"  name="nw" />
              <Area type="monotone" dataKey="liab"   stroke="#E8195A" strokeWidth={1.5} fill="none" strokeDasharray="4 4" name="liab" />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div style={{height:280,display:'flex',alignItems:'center',justifyContent:'center',color:'#9CA3AF',fontSize:13}}>
            No history yet — start by adding your assets and liabilities.
          </div>
        )}
      </div>
      <div style={{ background:'white', borderRadius:16, padding:'24px', border:'1px solid #E8ECF4' }}>
        <div style={{ fontSize:14, fontWeight:600, color:'#374151', marginBottom:16 }}>Asset Allocation</div>
        <div style={{ display:'flex', height:12, borderRadius:6, overflow:'hidden', marginBottom:16 }}>
          {[{v:totals.liq,c:C.liquidity.main},{v:totals.prop,c:C.property.main},{v:totals.cash,c:C.cash.main}].map((s,i)=>(
            <div key={i} style={{ width:`${pct(s.v,totals.assets)}%`, background:s.c, minWidth:s.v>0?2:0 }} />
          ))}
        </div>
        <div style={{ display:'flex', gap:20 }}>
          {[{l:'Liquidity',v:totals.liq,c:C.liquidity.main},{l:'Property',v:totals.prop,c:C.property.main},{l:'Cash',v:totals.cash,c:C.cash.main}].map(s=>(
            <div key={s.l} style={{ display:'flex', alignItems:'center', gap:8 }}>
              <div style={{ width:10, height:10, borderRadius:2, background:s.c }} />
              <span style={{ fontSize:12, color:'#6B7280' }}>{s.l}</span>
              <span style={{ fontSize:12, fontWeight:600, fontFamily:"'JetBrains Mono',monospace" }}>{pct(s.v,totals.assets)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// MF PAGE
// ══════════════════════════════════════════════════════════════════════════════
function MFPage({ data, isViewer, onRefresh }) {
  const [navFilter, setNavFilter] = useState('all')

  const funds = useMemo(() => {
    return (data.mf_funds || []).map(f => {
      const fundTxs = (data.mf_transactions || []).filter(t => t.fund_id === f.id)
      let invested = 0, units = 0
      for (const t of fundTxs) {
        const amt = Number(t.amount || 0), u = Number(t.units_allotted || 0)
        if (['sip','lumpsum','buy','stp','switch_in'].includes(t.type)) { invested += amt; units += u }
        if (['sell','switch_out'].includes(t.type))                      { units -= u }
      }
      const currentNav   = Number(f.current_nav || 0)
      const currentValue = currentNav > 0 ? units * currentNav : invested
      const gain         = currentValue - invested
      const gainPct      = invested > 0 ? (gain / invested) * 100 : 0
      return { ...f, invested, units, currentNav, currentValue, gain, gainPct }
    })
  }, [data.mf_funds, data.mf_transactions])

  const filtered = funds.filter(f => {
    if (navFilter === 'active')  return f.is_active && f.sip_amount > 0
    if (navFilter === 'holding') return !f.is_active || !f.sip_amount
    return true
  })

  const totalInvested = funds.reduce((s,f) => s + f.invested, 0)
  const totalCurrent  = funds.reduce((s,f) => s + f.currentValue, 0)
  const totalGain     = totalCurrent - totalInvested
  const totalSIP      = funds.filter(f => f.is_active && f.sip_amount > 0).reduce((s,f) => s + Number(f.sip_amount), 0)
  const activeSIPs    = funds.filter(f => f.is_active && f.sip_amount > 0).length

  return (
    <div className="fade-up">
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
        <div>
          <h2 style={{ fontFamily:"'Syne',sans-serif", fontSize:22, fontWeight:700, color:'#0B1E4F', marginBottom:4 }}>📈 Mutual Funds Portfolio</h2>
          <div style={{ fontSize:13, color:'#9CA3AF' }}>{funds.length} funds · {activeSIPs} active SIPs</div>
        </div>
        <div style={{ display:'flex', gap:10 }}>
          <button onClick={onRefresh} style={{ padding:'9px 16px', background:'#F5F3FF', color:'#7C3AED', border:'1px solid #DDD6FE', borderRadius:9, fontSize:13, cursor:'pointer', fontWeight:500 }}>↻ Refresh NAV</button>
          {!isViewer && (
            <a href="/mf" style={{ padding:'9px 16px', background:C.mf.main, color:'white', border:'none', borderRadius:9, fontSize:13, cursor:'pointer', fontWeight:600, textDecoration:'none', display:'flex', alignItems:'center' }}>
              + Manage SIPs
            </a>
          )}
        </div>
      </div>

      <div style={{ background:'linear-gradient(135deg,#5B21B6,#7C3AED)', borderRadius:16, padding:'20px 28px', marginBottom:20, color:'white', display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:20 }}>
        {[
          { l:'Portfolio Value', v:fmtINR(totalCurrent),   sub: fmtFull(totalCurrent) },
          { l:'Total Invested',  v:fmtINR(totalInvested),  sub: fmtFull(totalInvested) },
          { l:'Total Gains',     v:(totalGain>=0?'+':'')+fmtINR(totalGain), sub:`${totalInvested>0?((totalGain/totalInvested)*100).toFixed(2):'0.00'}% return` },
          { l:'Monthly SIP',     v:`₹${totalSIP.toLocaleString('en-IN')}`, sub:`${activeSIPs} active SIPs` },
        ].map(s => (
          <div key={s.l}>
            <div style={{ fontSize:11, opacity:.65, textTransform:'uppercase', letterSpacing:'1px', marginBottom:6 }}>{s.l}</div>
            <div style={{ fontFamily:"'Syne',sans-serif", fontSize:22, fontWeight:700 }}>{s.v}</div>
            <div style={{ fontSize:11, opacity:.6, marginTop:3 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display:'flex', gap:8, marginBottom:16 }}>
        {[['all','All Funds'],['active','Active SIPs'],['holding','Holdings']].map(([val,lbl])=>(
          <button key={val} onClick={()=>setNavFilter(val)}
            style={{ padding:'7px 16px', borderRadius:8, border:'1px solid #E5E7EB', background:navFilter===val?C.mf.main:'white', color:navFilter===val?'white':'#6B7280', fontSize:12, fontWeight:600, cursor:'pointer' }}>
            {lbl}
          </button>
        ))}
        <div style={{ marginLeft:'auto', fontSize:12, color:'#9CA3AF', alignSelf:'center' }}>
          NAV from portfolio_funds.current_nav · updated by cron
        </div>
      </div>

      <div style={{ background:'white', borderRadius:16, border:'1px solid #E8ECF4', overflow:'hidden' }}>
        <div style={{ display:'grid', gridTemplateColumns:'2fr 70px 100px 100px 100px 100px 80px', background:'#F8FAFC', padding:'10px 16px', borderBottom:'1px solid #E5E7EB' }}>
          {['Fund','SIP/mo','NAV','Invested','Current','Gain/Loss','Status'].map(h=>(
            <div key={h} style={{ fontSize:10, fontWeight:600, color:'#9CA3AF', textTransform:'uppercase', letterSpacing:'1px' }}>{h}</div>
          ))}
        </div>
        {filtered.length === 0 ? (
          <div style={{ padding:48, textAlign:'center', color:'#9CA3AF', fontSize:14 }}>
            <div style={{ fontSize:48, marginBottom:12 }}>📊</div>
            No funds found. Add funds via the SIP Manager.
          </div>
        ) : filtered.map((f, i) => (
          <div key={f.id} className="hover-row" style={{ display:'grid', gridTemplateColumns:'2fr 70px 100px 100px 100px 100px 80px', padding:'12px 16px', borderBottom:i<filtered.length-1?'1px solid #F3F4F6':'none', alignItems:'center' }}>
            <div>
              <div style={{ fontSize:13, fontWeight:600, color:'#0B1E4F' }}>{f.fund_name}</div>
              <div style={{ fontSize:10, color:'#9CA3AF', marginTop:2 }}>
                {f.isin && <span style={{ fontFamily:"'JetBrains Mono',monospace" }}>{f.isin}</span>}
                {f.category && <span style={{ marginLeft:6, background:f.category==='core'?'#ECFDF5':f.category==='growth'?'#FFFBEB':'#F5F3FF', color:f.category==='core'?'#059669':f.category==='growth'?'#D97706':'#7C3AED', padding:'1px 6px', borderRadius:3, fontWeight:600 }}>{f.category}</span>}
              </div>
            </div>
            <div style={{ fontSize:12, fontFamily:"'JetBrains Mono',monospace", color: f.sip_amount>0?'#374151':'#9CA3AF' }}>
              {f.sip_amount > 0 ? `₹${Number(f.sip_amount).toLocaleString('en-IN')}` : '—'}
            </div>
            <div style={{ fontSize:12, fontFamily:"'JetBrains Mono',monospace", color:'#374151' }}>
              {f.currentNav > 0 ? `₹${f.currentNav.toFixed(2)}` : '—'}
            </div>
            <div style={{ fontSize:12, fontFamily:"'JetBrains Mono',monospace" }}>
              {f.invested > 0 ? fmtINR(f.invested) : '—'}
            </div>
            <div style={{ fontSize:12, fontFamily:"'JetBrains Mono',monospace", color:C.mf.main, fontWeight:600 }}>
              {f.currentValue > 0 ? fmtINR(f.currentValue) : '—'}
            </div>
            <div style={{ fontSize:12, fontFamily:"'JetBrains Mono',monospace", fontWeight:600, color:f.gain>=0?'#059669':'#E8195A' }}>
              {f.invested > 0 ? `${f.gain>=0?'+':''}${fmtINR(f.gain)} (${f.gainPct.toFixed(1)}%)` : '—'}
            </div>
            <div>
              <span style={{ fontSize:10, padding:'3px 8px', borderRadius:4, fontWeight:600,
                background: f.is_active&&f.sip_amount>0 ? '#ECFDF5' : '#F9FAFB',
                color:      f.is_active&&f.sip_amount>0 ? '#059669' : '#9CA3AF' }}>
                {f.is_active && f.sip_amount > 0 ? 'SIP Active' : f.sip_amount > 0 ? 'SIP Paused' : 'Holding'}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop:16, background:'linear-gradient(135deg,#5B21B6,#7C3AED)', borderRadius:14, padding:'16px 20px', display:'flex', alignItems:'center', justifyContent:'space-between', color:'white' }}>
        <div>
          <div style={{ fontSize:13, fontWeight:600, marginBottom:3 }}>Full MF Manager available</div>
          <div style={{ fontSize:11, opacity:.7 }}>SIP add/edit, AI Advisor, XIRR calculator, projections, transaction history</div>
        </div>
        <a href="/mf" style={{ padding:'10px 20px', background:'rgba(255,255,255,.15)', color:'white', borderRadius:9, fontSize:13, fontWeight:600, textDecoration:'none', border:'1px solid rgba(255,255,255,.2)', whiteSpace:'nowrap' }}>
          Open MF Manager →
        </a>
      </div>
    </div>
  )
}

// ── GOALS ─────────────────────────────────────────────────────────────────────
function GoalsPage({ data, totals, onAdd, onEdit, onDelete, isViewer }) {
  return (
    <div className="fade-up">
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
        <div>
          <h2 style={{ fontFamily:"'Syne',sans-serif", fontSize:22, fontWeight:700, color:'#0B1E4F' }}>🎯 Financial Goals</h2>
          <div style={{ fontSize:13, color:'#9CA3AF' }}>Track your wealth milestones</div>
        </div>
        {!isViewer && <button onClick={onAdd} style={{ background:C.nw.main, color:'white', border:'none', borderRadius:10, padding:'10px 20px', fontSize:13, fontWeight:600, cursor:'pointer' }}>+ Add Goal</button>}
      </div>
      {data.goals.length === 0 ? (
        <div style={{ background:'white', borderRadius:16, padding:48, textAlign:'center', border:'1px solid #E8ECF4', color:'#9CA3AF', fontSize:14 }}>
          <div style={{fontSize:48,marginBottom:12}}>🎯</div>
          No goals yet.{!isViewer && <> <span style={{color:C.nw.main,cursor:'pointer',fontWeight:600}} onClick={onAdd}>Set your first goal →</span></>}
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:16 }}>
          {data.goals.map(g => {
            const prog = Math.min(100, (Number(g.current) / Number(g.target)) * 100)
            const done = Number(g.current) >= Number(g.target)
            return (
              <div key={g.id} style={{ background:'white', borderRadius:16, padding:20, border:'1px solid #E8ECF4' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12 }}>
                  <div>
                    <div style={{ fontSize:14, fontWeight:600, color:'#0B1E4F' }}>{CAT_ICONS[g.cat]||'🎯'} {g.name}</div>
                    <div style={{ fontSize:11, color:'#9CA3AF', marginTop:3 }}>Target: {g.target_date||'—'}</div>
                  </div>
                  <div style={{ display:'flex', gap:4 }}>
                    {!isViewer && <button onClick={()=>onEdit(g)} style={{ padding:'4px 10px', background:'#EFF6FF', color:'#2563EB', border:'none', borderRadius:6, fontSize:11, cursor:'pointer' }}>Edit</button>}
                    {!isViewer && <button onClick={()=>onDelete(g.id)} style={{ padding:'4px 8px', background:'#FEF2F2', color:'#DC2626', border:'none', borderRadius:6, fontSize:11, cursor:'pointer' }}>🗑</button>}
                  </div>
                </div>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
                  <span style={{ fontSize:12, color:'#6B7280' }}>Progress: {fmtINR(Number(g.current))}</span>
                  <span style={{ fontSize:12, fontWeight:600, color:done?C.liquidity.main:'#374151' }}>{prog.toFixed(0)}% {done?'✓ Done':''}</span>
                </div>
                <div style={{ height:8, background:'#F3F4F6', borderRadius:4, overflow:'hidden' }}>
                  <div style={{ width:`${prog}%`, height:'100%', background:done?C.liquidity.main:(g.color||C.nw.main), borderRadius:4, transition:'width 1s' }} />
                </div>
                <div style={{ display:'flex', justifyContent:'space-between', marginTop:8 }}>
                  <span style={{ fontSize:11, color:'#9CA3AF' }}>Current: {fmtFull(Number(g.current))}</span>
                  <span style={{ fontSize:11, color:'#9CA3AF' }}>Target: {fmtFull(Number(g.target))}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── SETTINGS ──────────────────────────────────────────────────────────────────
function SettingsPage({ auth }) {
  return (
    <div className="fade-up">
      <h2 style={{ fontFamily:"'Syne',sans-serif", fontSize:22, fontWeight:700, color:'#0B1E4F', marginBottom:20 }}>⚙️ Settings</h2>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
        <div style={{ background:'white', borderRadius:16, padding:24, border:'1px solid #E8ECF4' }}>
          <div style={{ fontSize:13, fontWeight:600, color:'#374151', marginBottom:16 }}>Your Profile</div>
          <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:20 }}>
            <div style={{ width:56, height:56, borderRadius:'50%', background:auth.color, display:'flex', alignItems:'center', justifyContent:'center', color:'white', fontSize:18, fontWeight:700 }}>{auth.initials}</div>
            <div>
              <div style={{ fontSize:16, fontWeight:600, color:'#0B1E4F' }}>{auth.name}</div>
              <div style={{ fontSize:12, color:'#9CA3AF' }}>{auth.email}</div>
              <div style={{ fontSize:11, background:auth.role==='admin'?'#EFF6FF':'#F0FDF4', color:auth.role==='admin'?'#2563EB':'#059669', padding:'2px 8px', borderRadius:4, display:'inline-block', marginTop:4, fontWeight:600 }}>
                {auth.role?.toUpperCase()}
              </div>
            </div>
          </div>
          <div style={{ fontSize:11, color:'#9CA3AF', background:'#F8FAFC', borderRadius:10, padding:14, lineHeight:1.6 }}>
            Password changes: Supabase Auth dashboard → Users tab → send reset email.
            Role assignment: update <code>user_profiles.role</code> directly in Supabase Table Editor.
          </div>
        </div>
        <div style={{ background:'white', borderRadius:16, padding:24, border:'1px solid #E8ECF4' }}>
          <div style={{ fontSize:13, fontWeight:600, color:'#374151', marginBottom:16 }}>Platform Status</div>
          {[
            { l:'Supabase Auth',       s:'live', i:'🔐' },
            { l:'Row Level Security',  s:'live', i:'🛡️' },
            { l:'NW Snapshot API',     s:'live', i:'📸' },
            { l:'NAV Cron (AMFI)',     s:'live', i:'🔄' },
            { l:'AI Advisor (Agent)',  s:'live', i:'🤖' },
            { l:'MF Portfolio Module', s:'live', i:'📊' },
          ].map(s=>(
            <div key={s.l} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid #F3F4F6' }}>
              <span style={{ fontSize:13, color:'#374151' }}>{s.i} {s.l}</span>
              <span style={{ fontSize:10, padding:'2px 8px', borderRadius:4, fontWeight:600, background:s.s==='live'?'#F0FDF4':'#FFFBEB', color:s.s==='live'?'#059669':'#D97706' }}>
                {s.s==='live'?'● LIVE':'⚙ CONFIG'}
              </span>
            </div>
          ))}
        </div>
        <div style={{ background:'linear-gradient(135deg,#0B1E4F,#1E3A8A)', borderRadius:16, padding:24, gridColumn:'1/-1', color:'white' }}>
          <div style={{ fontSize:14, fontWeight:600, marginBottom:8 }}>📊 MF Portfolio Module — Fully Integrated</div>
          <div style={{ fontSize:12, opacity:.7, lineHeight:1.7 }}>
            MF Corpus on dashboard = Σ(units_held × current_nav) per fund, matching exactly what /mf shows.
            NAV cron updates <code>portfolio_funds.current_nav</code> daily via AMFI.
          </div>
          <div style={{ display:'flex', gap:8, marginTop:16, flexWrap:'wrap' }}>
            {['✓ Live AMFI NAV','✓ XIRR Tracking','✓ AI Advisor','✓ SIP Manager','✓ Shared Auth','✓ RLS Enforced','✓ Corpus Synced'].map(t=>(
              <span key={t} style={{ fontSize:11, background:'rgba(255,255,255,.1)', padding:'4px 10px', borderRadius:6, fontWeight:500 }}>{t}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// ITEM MODAL
// ══════════════════════════════════════════════════════════════════════════════
function ItemModal({ modal, onClose, onSave }) {
  const isLiab = modal.module === 'liabilities'
  const isLiq  = modal.module === 'liquidity'
  const isProp = modal.module === 'property'
  const isCash = modal.module === 'cash'
  const isGoal = modal.module === 'goals'

  const [form, setForm] = useState({
    cat:'', name:'', bank:'', outstanding:0, emi:0, rate:0,
    end_date:'', value:0, invested:0,
    purchase:0, current:0, loc:'', year:new Date().getFullYear(),
    balance:0, acct:'',
    target:0, target_date:'', color:'#3B6FD4',
    ...modal.item,
  })
  const f = (k, v) => setForm(x => ({ ...x, [k]: v }))

  const catOptions = {
    liabilities: [['home_loan','🏠 Home Loan'],['personal','👤 Personal Loan'],['car_loan','🚗 Car Loan'],['overdraft','💳 OD/Overdraft'],['credit_card','💳 Credit Card'],['business','🏢 Business Loan'],['other','📋 Other']],
    liquidity:   [['equity','📈 Equity/Stocks'],['mf','📊 Mutual Funds'],['gold','🥇 Gold/SGB'],['ppf','🏦 PPF/EPF'],['fd','📑 FD'],['bonds','💰 Bonds'],['nps','🏛️ NPS']],
    property:    [['residential','🏡 Residential'],['commercial','🏢 Commercial'],['land','🌱 Land/Plot'],['industrial','🏗️ Industrial']],
    cash:        [['savings','🏦 Savings'],['current','💼 Current'],['hand','💵 Cash in Hand'],['cashloan','💰 Cash Loan Receivable'],['wallet','📱 Digital Wallet']],
    goals:       [['investment','📈 Investment'],['liability','🏛️ Liability'],['property','🏠 Property'],['cash','💵 Cash'],['other','📋 Other']],
  }
  const accentMap = { liabilities:C.liability.main, liquidity:C.liquidity.main, property:C.property.main, cash:C.cash.main, goals:C.nw.main }
  const accent    = accentMap[modal.module] || '#3B6FD4'

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)', zIndex:500, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}
      onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{ background:'white', borderRadius:20, width:520, maxHeight:'85vh', overflow:'auto', boxShadow:'0 30px 60px rgba(0,0,0,.3)' }}>
        <div style={{ padding:'20px 24px 16px', borderBottom:'1px solid #E5E7EB', display:'flex', justifyContent:'space-between', alignItems:'center', position:'sticky', top:0, background:'white', zIndex:1 }}>
          <div style={{ fontFamily:"'Syne',sans-serif", fontSize:16, fontWeight:700, color:'#0B1E4F' }}>
            {modal.item.id ? 'Edit' : 'Add'} {modal.module.charAt(0).toUpperCase()+modal.module.slice(1)}
          </div>
          <button onClick={onClose} style={{ width:30, height:30, borderRadius:'50%', border:'1px solid #E5E7EB', background:'#F9FAFB', cursor:'pointer', fontSize:14, color:'#6B7280' }}>✕</button>
        </div>
        <div style={{ padding:'20px 24px' }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
            <div style={{ gridColumn:'1/-1' }}>
              <label style={LBL}>Category</label>
              <select value={form.cat} onChange={e=>f('cat',e.target.value)} style={INP}>
                <option value="">Select…</option>
                {(catOptions[modal.module]||[]).map(([v,l])=><option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div style={{ gridColumn:'1/-1' }}>
              <label style={LBL}>Name / Description *</label>
              <input value={form.name} onChange={e=>f('name',e.target.value)} placeholder="e.g. Home Loan - SBI" style={INP} />
            </div>
            {(isLiab||isCash) && <div><label style={LBL}>Bank / Institution/ Person</label><input value={form.bank||''} onChange={e=>f('bank',e.target.value)} style={INP} /></div>}
            {isLiab && <>
              <div><label style={LBL}>Outstanding (₹)</label><input type="number" min="0" value={form.outstanding} onChange={e=>f('outstanding',+e.target.value)} style={INP} /></div>
              <div><label style={LBL}>EMI / Month (₹)</label><input type="number" min="0" value={form.emi} onChange={e=>f('emi',+e.target.value)} style={INP} /></div>
              <div><label style={LBL}>Interest Rate (%)</label><input type="number" step=".1" min="0" value={form.rate} onChange={e=>f('rate',+e.target.value)} style={INP} /></div>
              <div><label style={LBL}>End Date</label><input type="month" value={form.end_date?.slice(0,7)||''} onChange={e=>f('end_date',e.target.value)} style={INP} /></div>
            </>}
            {isLiq && <>
              <div><label style={LBL}>Current Value (₹)</label><input type="number" min="0" value={form.value} onChange={e=>f('value',+e.target.value)} style={INP} /></div>
              <div><label style={LBL}>Invested Amount (₹)</label><input type="number" min="0" value={form.invested} onChange={e=>f('invested',+e.target.value)} style={INP} /></div>
            </>}
            {isProp && <>
              <div style={{ gridColumn:'1/-1' }}><label style={LBL}>Location</label><input value={form.loc||''} onChange={e=>f('loc',e.target.value)} style={INP} /></div>
              <div><label style={LBL}>Purchase Value (₹)</label><input type="number" min="0" value={form.purchase} onChange={e=>f('purchase',+e.target.value)} style={INP} /></div>
              <div><label style={LBL}>Current Value (₹)</label><input type="number" min="0" value={form.current} onChange={e=>f('current',+e.target.value)} style={INP} /></div>
              <div><label style={LBL}>Purchase Year</label><input type="number" min="1950" max="2030" value={form.year} onChange={e=>f('year',+e.target.value)} style={INP} /></div>
            </>}
            {isCash && <>
              <div><label style={LBL}>Account No. (last 4)</label><input value={form.acct||''} onChange={e=>f('acct',e.target.value)} placeholder="****1234" style={INP} /></div>
              <div style={{ gridColumn:'1/-1' }}><label style={LBL}>Balance (₹)</label><input type="number" min="0" value={form.balance} onChange={e=>f('balance',+e.target.value)} style={INP} /></div>
            </>}
            {isGoal && <>
              <div><label style={LBL}>Target Amount (₹)</label><input type="number" min="0" value={form.target} onChange={e=>f('target',+e.target.value)} style={INP} /></div>
              <div><label style={LBL}>Current Amount (₹)</label><input type="number" min="0" value={form.current} onChange={e=>f('current',+e.target.value)} style={INP} /></div>
              <div><label style={LBL}>Target Date</label><input type="month" value={form.target_date?.slice(0,7)||''} onChange={e=>f('target_date',e.target.value)} style={INP} /></div>
            </>}
          </div>
        </div>
        <div style={{ padding:'14px 24px 20px', borderTop:'1px solid #E5E7EB', display:'flex', justifyContent:'flex-end', gap:10 }}>
          <button onClick={onClose} style={{ padding:'10px 20px', background:'#F9FAFB', border:'1px solid #E5E7EB', borderRadius:10, fontSize:13, cursor:'pointer', fontWeight:500 }}>Cancel</button>
          <button onClick={()=>onSave(form)} disabled={!form.name}
            style={{ padding:'10px 24px', background:accent, color:'white', border:'none', borderRadius:10, fontSize:13, fontWeight:600, cursor:'pointer', opacity:form.name?1:.5 }}>
            {modal.item.id ? 'Save Changes' : 'Add Entry'}
          </button>
        </div>
      </div>
    </div>
  )
}

const LBL = { display:'block', fontSize:11, fontWeight:600, color:'#6B7280', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:6 }
const INP = { width:'100%', padding:'10px 12px', border:'1.5px solid #E5E7EB', borderRadius:9, fontSize:13, outline:'none', color:'#111', boxSizing:'border-box' }