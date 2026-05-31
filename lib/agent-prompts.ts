// lib/agent-prompts.ts
// ─── Full Net Worth AI Prompt Engine ────────────────────────────────────────

export interface NetWorthContext {
  user: {
    name: string
    role: string
    since?: string
  }
  netWorth: number
  totalAssets: number
  liquidity: {
    total: number
    mfCorpus: number
    manualInvested: number
    manualGain: number
    breakdown: Array<{ name: string; cat: string; value: number; invested: number }>
  }
  property: {
    total: number
    purchaseTotal: number
    appreciation: number
    breakdown: Array<{ name: string; cat: string; current: number; purchase: number; year?: number }>
  }
  cash: {
    total: number
    breakdown: Array<{ name: string; cat: string; balance: number }>
  }
  liabilities: {
    total: number
    monthlyEMI: number
    avgRate: number
    breakdown: Array<{ name: string; cat: string; outstanding: number; emi: number; rate: number; endDate?: string }>
  }
  mf: {
    corpus: number
    invested: number
    gain: number
    gainPct: number
    xirr: number
    monthlySIP: number
    activeFunds: number
    funds: Array<{
      name: string
      category: string
      sip: number
      invested: number
      current: number
      nav: number
      gain: number
      gainPct: number
    }>
  }
  goals: Array<{
    name: string
    target: number
    current: number
    progress: number
    targetDate?: string
  }>
  projections: {
    mf3mBase: number
    mf1yBase: number
    nw1yBase: number
  }
  nwHistory?: Array<{ month: string; nw: number }>
  recentAlerts?: string[]
}

// ─── Indian currency formatter ────────────────────────────────────────────────
function fmtL(n: number): string {
  const a = Math.abs(n)
  if (a >= 10_000_000) return `₹${(n / 10_000_000).toFixed(2)}Cr`
  if (a >= 100_000)    return `₹${(n / 100_000).toFixed(1)}L`
  if (a >= 1_000)      return `₹${Math.round(n / 1_000)}K`
  return `₹${Math.round(n)}`
}

// ─── Token-efficient context serializer ──────────────────────────────────────
export function buildContext(ctx: NetWorthContext): string {
  const date = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  const debtRatio = ctx.totalAssets > 0
    ? ((ctx.liabilities.total / ctx.totalAssets) * 100).toFixed(1)
    : '0'

  const nwTrend = (() => {
    if (!ctx.nwHistory || ctx.nwHistory.length < 2) return ''
    const last  = ctx.nwHistory[ctx.nwHistory.length - 1]?.nw ?? 0
    const prev  = ctx.nwHistory[ctx.nwHistory.length - 4]?.nw ?? ctx.nwHistory[0]?.nw ?? 0
    const delta = last - prev
    return ` | NW 3M: ${delta >= 0 ? '+' : ''}${fmtL(delta)}`
  })()

  const goalsLine = ctx.goals.length > 0
    ? ctx.goals.map(g => `${g.name}(${g.progress.toFixed(0)}%→${fmtL(g.target)})`).join(', ')
    : 'none'

  const topFunds = [...ctx.mf.funds]
    .sort((a, b) => b.current - a.current)
    .slice(0, 7)
    .map(f => `  • ${f.name} | ${f.category} | SIP:${fmtL(f.sip)}/mo | ${fmtL(f.invested)}→${fmtL(f.current)} (${f.gainPct >= 0 ? '+' : ''}${f.gainPct.toFixed(1)}%)`)
    .join('\n')

  const liabLines = ctx.liabilities.breakdown
    .map(l => `  • ${l.name}(${l.cat}): ${fmtL(l.outstanding)} @ ${l.rate}% | EMI:${fmtL(l.emi)}/mo${l.endDate ? ` ends:${l.endDate}` : ''}`)
    .join('\n')

  const propLines = ctx.property.breakdown
    .map(p => `  • ${p.name}: ${fmtL(p.current)} (bought:${fmtL(p.purchase)}${p.year ? ` in ${p.year}` : ''})`)
    .join('\n')

  const liqLines = ctx.liquidity.breakdown
    .map(l => `  • ${l.name}(${l.cat}): ${fmtL(l.value)} invested:${fmtL(l.invested)}`)
    .join('\n')

  const cashLines = ctx.cash.breakdown
    .map(c => `  • ${c.name}(${c.cat}): ${fmtL(c.balance)}`)
    .join('\n')

  return `USER: ${ctx.user.name} | DATE: ${date}
━━ NET WORTH SNAPSHOT ━━
NW=${fmtL(ctx.netWorth)} | Assets=${fmtL(ctx.totalAssets)} | Liabilities=${fmtL(ctx.liabilities.total)}
Debt/Asset=${debtRatio}% | Monthly EMI=${fmtL(ctx.liabilities.monthlyEMI)} | Avg Rate=${ctx.liabilities.avgRate.toFixed(1)}%${nwTrend}

━━ ASSET ALLOCATION ━━
MF Corpus:  ${fmtL(ctx.mf.corpus)}  (${ctx.totalAssets > 0 ? ((ctx.mf.corpus / ctx.totalAssets) * 100).toFixed(1) : 0}% of assets)
Liquidity:  ${fmtL(ctx.liquidity.total)}  (manual+MF)
Property:   ${fmtL(ctx.property.total)}
Cash:       ${fmtL(ctx.cash.total)}

━━ MF PORTFOLIO ━━
Invested=${fmtL(ctx.mf.invested)} | Current=${fmtL(ctx.mf.corpus)} | Gain=${fmtL(ctx.mf.gain)} (${ctx.mf.gainPct >= 0 ? '+' : ''}${ctx.mf.gainPct.toFixed(1)}%)
XIRR=${ctx.mf.xirr.toFixed(1)}% | SIP=₹${ctx.mf.monthlySIP.toLocaleString('en-IN')}/mo | Active=${ctx.mf.activeFunds} funds
Funds (top by value):
${topFunds || '  none'}

━━ LIABILITIES ━━
${liabLines || '  none'}

━━ PROPERTY ━━
${propLines || '  none'}
Appreciation: ${fmtL(ctx.property.appreciation)} on ${fmtL(ctx.property.purchaseTotal)} purchased

━━ LIQUIDITY (non-MF) ━━
${liqLines || '  none'}

━━ CASH ━━
${cashLines || '  none'}

━━ GOALS ━━
${goalsLine}

━━ PROJECTIONS (base 13%) ━━
MF 3M: ${fmtL(ctx.projections.mf3mBase)} | MF 1Y: ${fmtL(ctx.projections.mf1yBase)} | NW 1Y est: ${fmtL(ctx.projections.nw1yBase)}
${ctx.recentAlerts?.length ? `\n━━ RECENT ALERTS ━━\n${ctx.recentAlerts.slice(0, 3).join('\n')}` : ''}`
}

// ─── System prompt (now a function — FIX: was using un-resolved {USER_NAME}) ──
export function buildSystemPrompt(userName: string): string {
  return `You are Worth IQ — an elite Indian personal finance strategist with CFA + CA-level expertise.

PERSONA: You know ${userName}'s complete financial picture. Speak to them by first name occasionally. Be direct, high-signal, institutional quality.

RULES:
- Use exact ₹ amounts and fund names from the context. Never invent numbers.
- Bullets over paragraphs. Lead with the punchline.
- For MF: reference specific funds by shortened name (e.g. "Parag Parikh" not full name).
- For liabilities: flag rate arbitrage opportunities (loan rate vs MF XIRR).
- For net worth: assess debt/asset health, liquidity ratio, concentration risk.
- No generic advice. Every insight must be specific to the numbers provided.
- Indian tax context: LTCG 12.5% (equity >1yr), STCG 20%, debt indexation removed.
- Maximize insight per token. Omit pleasantries.`
}

// Keep backward-compat export for any caller that imports the old constant
export const SYSTEM_PROMPT = buildSystemPrompt('Investor')

// ─── Agent types ──────────────────────────────────────────────────────────────
export type AgentType =
  | 'weekly_nw'
  | 'mf_review'
  | 'debt_optimizer'
  | 'goal_tracker'
  | 'tax_optimizer'
  | 'rebalance'
  | 'alert_scan'
  | 'cash_flow'
  | 'custom'

// ─── Prompt builder (now accepts full ctx object to resolve placeholders) ─────
// FIX: old version passed only serialized string so {XIRR}, {EMI}, {SIP},
//      {CASH} were never replaced — they appeared literally in the prompt.
export function buildPrompt(
  type: AgentType,
  ctxString: string,
  custom?: string,
  ctxData?: NetWorthContext,   // ← NEW: pass raw data for placeholder injection
): { prompt: string; maxTokens: number } {

  // Resolved values from raw context (with safe fallbacks)
  const xirr  = ctxData ? ctxData.mf.xirr.toFixed(1) + '%'                   : 'N/A'
  const emi   = ctxData ? fmtL(ctxData.liabilities.monthlyEMI) + '/mo'        : 'N/A'
  const sip   = ctxData ? `₹${ctxData.mf.monthlySIP.toLocaleString('en-IN')}/mo` : 'N/A'
  const cash  = ctxData ? fmtL(ctxData.cash.total)                             : 'N/A'
  const name  = ctxData?.user.name ?? 'the investor'

  switch (type) {

    case 'weekly_nw':
      return {
        maxTokens: 600,
        prompt: `${ctxString}

Generate a WhatsApp-style weekly net worth update for ${name}.

Format exactly:
📊 NW Score: X/100 (1-line rationale)
📈 Best asset move this week
📉 Biggest drag
⚠️ Top risk right now
💡 #1 action this week (specific ₹ amount + fund/account name)
🎯 Goal: on track / at risk — which one and by how much
💳 Debt health: is loan rate (${ctxData ? ctxData.liabilities.avgRate.toFixed(1) : '?'}%) above or below MF XIRR (${xirr})?
💰 SIP ${sip} — optimal or needs adjustment?

Rules: exact names, exact ₹, max 200 words, zero generic lines.`
      }

    case 'mf_review':
      return {
        maxTokens: 550,
        prompt: `${ctxString}

Deep MF portfolio review for ${name}. Current XIRR: ${xirr}

Output:
🏆 Best fund (name + return %)
⚠️ Weakest fund + specific reason to hold or exit
📊 Category allocation gap — what % core/growth/satellite and what's ideal
🔄 SIP ${sip} — which fund is over/under-deployed
💎 Best lumpsum opportunity right now (exact fund + ₹ amount)
📉 XIRR ${xirr} vs Nifty 50 / category benchmark — verdict
🎯 Corpus gap to nearest unmet goal
📅 Next SIP action this month (date-specific)

Max 180 words. Fund names must match context exactly.`
      }

    case 'debt_optimizer':
      return {
        maxTokens: 450,
        prompt: `${ctxString}

Debt optimization for ${name}. Monthly EMI load: ${emi} | MF XIRR: ${xirr}

Output:
🔴 Highest-cost loan (exact name + rate + outstanding)
💡 Rate arbitrage decision: MF XIRR ${xirr} vs avg loan ${ctxData ? ctxData.liabilities.avgRate.toFixed(1) : '?'}% — prepay or invest? Give ₹ recommendation
📅 Recommended prepayment sequence (highest rate → lowest)
💰 Optimal monthly split: EMI ${emi} + SIP ${sip} + prepayment — suggest reallocation
🏦 Any loan > 9%? Flag refinancing opportunity
⚡ Single action this month to cut total interest paid by maximum ₹

Max 150 words. Use exact loan names and ₹ amounts from context.`
      }

    case 'goal_tracker':
      return {
        maxTokens: 500,
        prompt: `${ctxString}

Goal gap analysis for ${name}.

For each goal from context above:
- Progress % and ₹ current vs target
- Monthly SIP needed to close gap by target date (assume 12% CAGR)
- On track ✅ / At risk ⚠️ / Behind 🔴

Then:
🎯 Goal most at risk + specific rescue plan (₹ amount to add)
💡 Goal achievable earliest — current trajectory date
📊 Overall goal funding score: X/10
⚡ One SIP reallocation to accelerate top priority goal

Max 180 words. Use goal names exactly as in context.`
      }

    case 'tax_optimizer':
      return {
        maxTokens: 500,
        prompt: `${ctxString}

Indian tax optimization for ${name}. FY ending Mar 2027. Current XIRR: ${xirr}

Output:
📋 LTCG harvesting: which fund, estimated ₹ gain crystallizable, ₹ tax saved at 12.5%
💡 ELSS: current allocation vs ₹1.5L 80C limit — gap
⚠️ STCG exposure: any fund bought < 12 months? Flag and advise timing
🏠 Property: if sale planned, capital gain estimate
💳 Home loan: interest deduction being utilized? Max ₹2L sec 24(b)
🔄 Debt funds: post-indexation-removal, shift to equity savings fund?
⚡ Must-do before Mar 31 2027 (specific ₹ action + fund)

Max 160 words. Reference actual fund names from context.`
      }

    case 'rebalance':
      return {
        maxTokens: 550,
        prompt: `${ctxString}

Portfolio rebalancing for ${name}.

📊 Current allocation:
  - Equity MF: X% | Target: 60-70%
  - Debt/Liquid: X% | Target: 10-15%
  - Property: X% | Target: 20-25%
  - Cash: X% | Target: 5-10%
  (Calculate exact % from context numbers above)

🔴 Most overweight asset — by exactly ₹X
🟢 Most underweight asset — opportunity
🔄 Specific rebalance trade:
   → Reduce: [exact fund/asset] by ₹X
   → Add:    [exact fund/asset] by ₹X
   → Suggested timeline
💡 SIP redirect: any fund to pause and redirect SIP to?
⚡ Net worth impact of executing this rebalance

Max 160 words. Exact fund names and ₹ amounts only.`
      }

    case 'alert_scan':
      return {
        maxTokens: 500,
        prompt: `${ctxString}

Portfolio risk & opportunity scan for ${name}.
Monthly EMI: ${emi} | Monthly SIP: ${sip} | XIRR: ${xirr} | Cash: ${cash}

Rate each finding as:
🔴 CRITICAL — act within 7 days
🟡 WATCH — act within 30 days
🟢 OPPORTUNITY — act within 90 days

Scan these areas:
- EMI burden as % of estimated income (proxy: EMI ÷ SIP × 3)
- Concentration risk (any single fund > 25% of corpus?)
- Underperforming funds (gainPct < 5% over context period)
- Goal timeline breach risk
- Property illiquidity risk
- Cash drag (cash idle when XIRR ${xirr})
- Rate arbitrage (any loan > XIRR?)
- SIP amount relative to corpus growth rate

Max 3 items per category. Format: [issue] → [specific action] → [₹ impact]
Max 160 words total.`
      }

    case 'cash_flow':
      return {
        maxTokens: 400,
        prompt: `${ctxString}

Monthly cash flow & liquidity for ${name}.
Current: EMI=${emi} | SIP=${sip} | Cash=${cash}

💸 Total monthly committed outflow = EMI + SIP (calculate from context)
🏦 Emergency fund runway: ${cash} ÷ monthly outflow = X months
   Recommended: 6 months. Status: adequate / inadequate?
⚠️ Liquidity ratio: liquid assets (cash + liquid MF) vs total liabilities
💡 Cash drag: is any idle cash in savings when it could earn ${xirr} in liquid/arbitrage fund? Flag ₹ amount
🔄 Optimization: move ₹X from [specific account] to [specific fund] for Y% better return
📈 At current SIP + corpus growth rate, monthly surplus in 12M: ₹Z

Max 130 words. Use exact account and fund names from context.`
      }

    case 'custom':
      return {
        maxTokens: 700,
        prompt: `${ctxString}\n\n${custom || 'Provide a comprehensive portfolio overview with 3 specific actions for this month.'}`
      }

    default:
      return { maxTokens: 400, prompt: ctxString }
  }
}

// ─── Token budget ─────────────────────────────────────────────────────────────
export const DAILY_TOKEN_LIMIT   = 15_000  // per user per day
export const CONTEXT_TOKEN_EST   = 1_100   // estimated input tokens per call

export function estimateTotalTokens(maxOutputTokens: number): number {
  return CONTEXT_TOKEN_EST + maxOutputTokens
}