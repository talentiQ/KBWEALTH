import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import {
  buildContext,
  buildPrompt,
  DAILY_TOKEN_LIMIT,
  estimateTotalTokens,
  type AgentType,
  type NetWorthContext,
  SYSTEM_PROMPT,
} from '@/lib/agent-prompts'

export const runtime = 'nodejs'

const AGENT_TYPES: AgentType[] = [
  'weekly_nw',
  'mf_review',
  'debt_optimizer',
  'goal_tracker',
  'tax_optimizer',
  'rebalance',
  'alert_scan',
  'cash_flow',
  'custom',
]

function num(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function pct(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0
}

function fmtDate(value: unknown): string | undefined {
  if (!value) return undefined
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().split('T')[0]
}

function first<T>(row: Record<string, T>, keys: string[], fallback: T): T {
  for (const key of keys) {
    const value = row[key]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return fallback
}

async function getUsage(userId: string, today: string) {
  const { data } = await supabase
    .from('agent_usage')
    .select('tokens_used')
    .eq('user_id', userId)
    .eq('date', today)
    .maybeSingle()

  return num(data?.tokens_used)
}

async function saveUsage(userId: string, today: string, tokensUsedToday: number) {
  const payload = { user_id: userId, date: today, tokens_used: tokensUsedToday }
  const { error } = await supabase
    .from('agent_usage')
    .upsert(payload, { onConflict: 'user_id,date' })

  if (!error) return

  const update = await supabase
    .from('agent_usage')
    .update({ tokens_used: tokensUsedToday })
    .eq('user_id', userId)
    .eq('date', today)

  if (!update.error) return

  await supabase.from('agent_usage').insert(payload)
}

async function buildUserContext(userId: string): Promise<NetWorthContext> {
  const [
    fundsRes,
    txRes,
    liabilitiesRes,
    liquidityRes,
    propertyRes,
    cashRes,
    goalsRes,
    historyRes,
    alertsRes,
  ] = await Promise.all([
    supabase.from('portfolio_funds').select('*').eq('user_id', userId),
    supabase.from('transactions').select('*').eq('user_id', userId),
    supabase.from('liabilities').select('*').eq('user_id', userId),
    supabase.from('liquidity_assets').select('*').eq('user_id', userId),
    supabase.from('property_assets').select('*').eq('user_id', userId),
    supabase.from('cash_balances').select('*').eq('user_id', userId),
    supabase.from('financial_goals').select('*').eq('user_id', userId).eq('status', 'active'),
    supabase
      .from('net_worth_history')
      .select('*')
      .eq('user_id', userId)
      .order('snapshot_date', { ascending: true })
      .limit(12),
    supabase
      .from('alerts_log')
      .select('*')
      .eq('user_id', userId)
      .order('triggered_at', { ascending: false })
      .limit(10),
  ])

  const funds = fundsRes.data ?? []
  const transactions = txRes.data ?? []
  const liabilities = liabilitiesRes.data ?? []
  const liquidity = liquidityRes.data ?? []
  const property = propertyRes.data ?? []
  const cash = cashRes.data ?? []
  const goals = goalsRes.data ?? []
  const history = historyRes.data ?? []
  const alerts = alertsRes.data ?? []

  const mfFunds = funds.map((fund: any) => {
    const fundTxs = transactions.filter((tx: any) => tx.fund_id === fund.id)
    const invested = fundTxs.reduce((sum: number, tx: any) => {
      return ['sip', 'lumpsum', 'buy', 'stp', 'switch_in'].includes(tx.type)
        ? sum + num(tx.amount)
        : sum
    }, num(fund.invested))
    const current = num(first(fund, ['current_value', 'current'], invested))
    const gain = current - invested

    return {
      name: String(first(fund, ['fund_name', 'name'], 'Unnamed fund')),
      category: String(first(fund, ['category', 'sub_category'], 'uncategorized')),
      sip: num(first(fund, ['sip_amount', 'monthly_sip'], 0)),
      invested,
      current,
      nav: num(first(fund, ['current_nav', 'nav'], 0)),
      gain,
      gainPct: pct(gain, invested),
    }
  })

  const mfCorpus = mfFunds.reduce((sum, fund) => sum + fund.current, 0)
  const mfInvested = mfFunds.reduce((sum, fund) => sum + fund.invested, 0)
  const mfGain = mfCorpus - mfInvested
  const propertyTotal = property.reduce((sum: number, row: any) => {
    return sum + num(first(row, ['current_value', 'current', 'value'], 0))
  }, 0)
  const propertyPurchase = property.reduce((sum: number, row: any) => {
    return sum + num(first(row, ['purchase_value', 'purchase_price', 'purchase'], 0))
  }, 0)
  const cashTotal = cash.reduce((sum: number, row: any) => {
    return sum + num(first(row, ['balance', 'current_balance', 'value'], 0))
  }, 0)
  const liquidityManual = liquidity.reduce((sum: number, row: any) => {
    return sum + num(first(row, ['current_value', 'value', 'balance'], 0))
  }, 0)
  const liabilityTotal = liabilities.reduce((sum: number, row: any) => {
    return sum + num(first(row, ['outstanding', 'outstanding_amount', 'balance'], 0))
  }, 0)
  const totalAssets = mfCorpus + liquidityManual + propertyTotal + cashTotal
  const netWorth = totalAssets - liabilityTotal

  return {
    user: { name: 'Investor', role: 'Worth IQ user' },
    netWorth,
    totalAssets,
    liquidity: {
      total: liquidityManual + mfCorpus,
      mfCorpus,
      manualInvested: liquidity.reduce((sum: number, row: any) => {
        return sum + num(first(row, ['invested', 'amount_invested', 'principal'], 0))
      }, 0),
      manualGain: liquidityManual,
      breakdown: liquidity.map((row: any) => ({
        name: String(first(row, ['name', 'asset_name'], 'Liquidity asset')),
        cat: String(first(row, ['category', 'type'], 'liquidity')),
        value: num(first(row, ['current_value', 'value', 'balance'], 0)),
        invested: num(first(row, ['invested', 'amount_invested', 'principal'], 0)),
      })),
    },
    property: {
      total: propertyTotal,
      purchaseTotal: propertyPurchase,
      appreciation: propertyTotal - propertyPurchase,
      breakdown: property.map((row: any) => ({
        name: String(first(row, ['name', 'property_name'], 'Property')),
        cat: String(first(row, ['category', 'type'], 'property')),
        current: num(first(row, ['current_value', 'current', 'value'], 0)),
        purchase: num(first(row, ['purchase_value', 'purchase_price', 'purchase'], 0)),
        year: num(first(row, ['purchase_year', 'year'], 0)) || undefined,
      })),
    },
    cash: {
      total: cashTotal,
      breakdown: cash.map((row: any) => ({
        name: String(first(row, ['name', 'account_name'], 'Cash account')),
        cat: String(first(row, ['category', 'type'], 'cash')),
        balance: num(first(row, ['balance', 'current_balance', 'value'], 0)),
      })),
    },
    liabilities: {
      total: liabilityTotal,
      monthlyEMI: liabilities.reduce((sum: number, row: any) => {
        return sum + num(first(row, ['emi', 'monthly_emi'], 0))
      }, 0),
      avgRate: liabilities.length
        ? liabilities.reduce((sum: number, row: any) => sum + num(first(row, ['rate', 'interest_rate'], 0)), 0) / liabilities.length
        : 0,
      breakdown: liabilities.map((row: any) => ({
        name: String(first(row, ['name', 'loan_name'], 'Liability')),
        cat: String(first(row, ['category', 'type'], 'loan')),
        outstanding: num(first(row, ['outstanding', 'outstanding_amount', 'balance'], 0)),
        emi: num(first(row, ['emi', 'monthly_emi'], 0)),
        rate: num(first(row, ['rate', 'interest_rate'], 0)),
        endDate: fmtDate(first(row, ['end_date', 'maturity_date'], '')),
      })),
    },
    mf: {
      corpus: mfCorpus,
      invested: mfInvested,
      gain: mfGain,
      gainPct: pct(mfGain, mfInvested),
      xirr: 0,
      monthlySIP: mfFunds.reduce((sum, fund) => sum + fund.sip, 0),
      activeFunds: funds.filter((fund: any) => fund.is_active !== false).length,
      funds: mfFunds,
    },
    goals: goals.map((row: any) => {
      const target = num(first(row, ['target_amount', 'target'], 0))
      const current = num(first(row, ['current_amount', 'current'], 0))
      return {
        name: String(first(row, ['name', 'goal_name'], 'Goal')),
        target,
        current,
        progress: pct(current, target),
        targetDate: fmtDate(first(row, ['target_date', 'deadline'], '')),
      }
    }),
    projections: {
      mf3mBase: mfCorpus * Math.pow(1 + 0.13, 3 / 12),
      mf1yBase: (mfCorpus + mfFunds.reduce((sum, fund) => sum + fund.sip, 0) * 12) * 1.13,
      nw1yBase: netWorth * 1.08,
    },
    nwHistory: history.map((row: any) => ({
      month: String(first(row, ['snapshot_date', 'month', 'created_at'], '')),
      nw: num(first(row, ['net_worth', 'nw', 'value'], 0)),
    })),
    recentAlerts: alerts.map((row: any) => String(first(row, ['message', 'alert'], ''))).filter(Boolean),
  }
}

export async function POST(request: Request) {
  try {
    const { type, customPrompt, userId } = await request.json()

    if (!userId || typeof userId !== 'string') {
      return NextResponse.json({ error: 'Missing userId.' }, { status: 400 })
    }

    const agentType: AgentType = AGENT_TYPES.includes(type) ? type : 'custom'
    const today = new Date().toISOString().split('T')[0]
    const used = await getUsage(userId, today)
    const context = buildContext(await buildUserContext(userId))
    const { prompt, maxTokens } = buildPrompt(agentType, context, customPrompt)
    const estimatedTokens = estimateTotalTokens(maxTokens)

    if (used + estimatedTokens > DAILY_TOKEN_LIMIT) {
      return NextResponse.json(
        {
          error: 'Daily AI limit reached.',
          usage: {
            tokensUsedToday: used,
            remaining: Math.max(0, DAILY_TOKEN_LIMIT - used),
            tokenLimit: DAILY_TOKEN_LIMIT,
          },
        },
        { status: 429 },
      )
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY is not configured.' },
        { status: 500 },
      )
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const message = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    })

    const result = message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n')
      .trim()

    const actualTokens = message.usage.input_tokens + message.usage.output_tokens
    const tokensUsedToday = used + actualTokens
    await saveUsage(userId, today, tokensUsedToday)

    await supabase.from('alerts_log').insert({
      user_id: userId,
      alert_type: agentType,
      message: result.slice(0, 1000),
      is_read: false,
    })

    return NextResponse.json({
      result,
      usage: {
        tokensUsedToday,
        remaining: Math.max(0, DAILY_TOKEN_LIMIT - tokensUsedToday),
        tokenLimit: DAILY_TOKEN_LIMIT,
      },
    })
  } catch (error: any) {
    console.error('agent route error:', error)
    return NextResponse.json(
      { error: error?.message ?? 'AI advisor failed.' },
      { status: 500 },
    )
  }
}
