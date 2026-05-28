// app/api/agent/route.ts

import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin as supabase } from '@/lib/supabase-server'
import {
  calcProjection,
  formatINR,
  MY_FUNDS,
  TOTAL_SIP,
} from '@/lib/funds'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

const SYSTEM = `
You are KB Wealth AI — institutional-grade Indian mutual fund portfolio strategist.

Rules:
- Be concise, high-signal, actionable.
- Use exact fund names and ₹ values.
- Avoid generic investing advice.
- Focus on portfolio optimization, SIP efficiency, risk, tax, allocation, exits.
- Prefer bullets over paragraphs.
- Maximize insight per token.
- Avoid repeating obvious context.
`

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { type, customPrompt } = body || {}

    let result = ''

    // ─── Custom Prompt ─────────────────────────────────────────────────────
    if (customPrompt) {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 700,
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content: customPrompt,
          },
        ],
      })

      result =
        response.content[0]?.type === 'text'
          ? response.content[0].text
          : ''

    // ─── Built-in Portfolio Intelligence ──────────────────────────────────
    } else if (type) {
      const context = await buildPortfolioContext()

      switch (type) {
        case 'weekly':
          result = await runWeeklyBrief(context)
          break

        case 'projection':
          result = await runProjectionUpdate(context)
          break

        case 'alert':
          result = await runAlertCheck(context)
          break

        case 'advice':
          result = await runAdvice(context)
          break

        default:
          result = await runWeeklyBrief(context)
      }

    } else {
      return NextResponse.json(
        { error: 'Provide type or customPrompt' },
        { status: 400 }
      )
    }

    // ─── Save AI Response to alerts_log ───────────────────────────────────
    try {
      await supabase
        .from('alerts_log')
        .insert({
          alert_type: type || 'custom_ai',
          fund_name: null,
          message: result.substring(0, 500),
          triggered_at: new Date().toISOString(),
          is_read: false,
        })
    } catch (e) {
      console.error('[agent] alerts_log insert failed:', e)
    }

    return NextResponse.json({
      success: true,
      result,
    })

  } catch (error: any) {
    console.error('[agent] fatal:', error)

    return NextResponse.json(
      {
        error: error?.message || 'Agent failed',
      },
      { status: 500 }
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BUILD CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

async function buildPortfolioContext(): Promise<string> {

  // ─── Latest NAVs ────────────────────────────────────────────────────────
  const { data: navs } = await supabase
    .from('nav_history')
    .select('isin, nav, nav_date')
    .in('isin', MY_FUNDS.map(f => f.isin))
    .order('nav_date', { ascending: false })

  // ─── Portfolio Summary ──────────────────────────────────────────────────
  const { data: portfolio } = await supabase
    .from('portfolio_summary')
    .select('*')
    .single()

  // ─── Recent Alerts ──────────────────────────────────────────────────────
  const { data: alerts } = await supabase
    .from('alerts_log')
    .select('alert_type, fund_name, message, triggered_at')
    .order('triggered_at', { ascending: false })
    .limit(5)

  // ─── Latest NAV Per ISIN ────────────────────────────────────────────────
  const navMap: Record<string, { nav: number; date: string }> = {}

  for (const row of navs || []) {
    if (!navMap[row.isin]) {
      navMap[row.isin] = {
        nav: Number(row.nav),
        date: row.nav_date,
      }
    }
  }

  // ─── Compact Fund Summary ───────────────────────────────────────────────
  const compactFunds = MY_FUNDS.map(f => ({
    n: f.name,
    c: f.category,
    sip: f.sip,
    nav: navMap[f.isin]?.nav || 0,
  }))

  // ─── Compact Alerts ─────────────────────────────────────────────────────
  const compactAlerts =
    alerts?.map(a =>
      `${a.alert_type}: ${a.message}`
    ).join('\n') || 'No alerts'

  return `
Date: ${new Date().toDateString()}

Portfolio:
Value=${formatINR(portfolio?.current_value || 0)}
Invested=${formatINR(portfolio?.invested_amount || 0)}
Returns=${formatINR(portfolio?.absolute_return || 0)}
XIRR=${Number(portfolio?.xirr || 0).toFixed(2)}%
SIP=${formatINR(TOTAL_SIP)}/month

Funds:
${JSON.stringify(compactFunds)}

Alerts:
${compactAlerts}

Goals:
1Cr Apr-2026
1.7Cr Apr-2030
8Cr+ Long Term
`
}

// ─────────────────────────────────────────────────────────────────────────────
// WEEKLY BRIEF
// ─────────────────────────────────────────────────────────────────────────────

async function runWeeklyBrief(context: string): Promise<string> {

  const prompt = `
${context}

Generate concise WhatsApp-style portfolio update.

Format:
📊 Portfolio Score /100
📈 Best performer
📉 Weakest area
⚠ Key risk
💡 Best action this week
🎯 Goal progress
💰 SIP summary

Requirements:
- Exact fund names
- Actionable only
- No generic advice
- Max 180 words
`

  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  })

  return res.content[0]?.type === 'text'
    ? res.content[0].text
    : ''
}

// ─────────────────────────────────────────────────────────────────────────────
// PROJECTION ENGINE
// ─────────────────────────────────────────────────────────────────────────────

async function runProjectionUpdate(context: string): Promise<string> {

  const { data: portfolio } = await supabase
    .from('portfolio_summary')
    .select('current_value')
    .single()

  const currentValue = Number(portfolio?.current_value || 0)

  const projections = {
    '3M Bear': formatINR(calcProjection(currentValue, TOTAL_SIP, 3, 10)),
    '3M Base': formatINR(calcProjection(currentValue, TOTAL_SIP, 3, 13)),
    '3M Bull': formatINR(calcProjection(currentValue, TOTAL_SIP, 3, 16)),

    '6M Base': formatINR(calcProjection(currentValue, TOTAL_SIP, 6, 13)),

    '1Y Base': formatINR(calcProjection(currentValue, TOTAL_SIP, 12, 13)),
  }

  const prompt = `
${context}

Projection Scenarios:
${JSON.stringify(projections)}

Output:
- most probable outcome
- outperforming funds
- underperforming funds
- one allocation action

Max 120 words.
`

  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 450,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  })

  return res.content[0]?.type === 'text'
    ? res.content[0].text
    : ''
}

// ─────────────────────────────────────────────────────────────────────────────
// ALERT ENGINE
// ─────────────────────────────────────────────────────────────────────────────

async function runAlertCheck(context: string): Promise<string> {

  const prompt = `
${context}

Analyze portfolio risks and opportunities.

Output:
🔴 Critical
🟡 Watchlist
🟢 Opportunity

Focus:
- valuation excess
- concentration risk
- SIP inefficiency
- direct vs regular leakage
- sector overexposure
- deployment timing
- macro risks

Max 120 words.
`

  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 450,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  })

  return res.content[0]?.type === 'text'
    ? res.content[0].text
    : ''
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTION ENGINE
// ─────────────────────────────────────────────────────────────────────────────

async function runAdvice(context: string): Promise<string> {

  const prompt = `
${context}

Give 3 high-conviction actions for next 30 days.

Requirements:
- exact fund names
- exact ₹ allocation
- one tax optimization
- one rebalance
- one SIP/STP optimization

No generic advice.
Max 150 words.
`

  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 550,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  })

  return res.content[0]?.type === 'text'
    ? res.content[0].text
    : ''
}
