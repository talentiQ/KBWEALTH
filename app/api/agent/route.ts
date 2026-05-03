// app/api/agent/route.ts
import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { supabase } from '@/lib/supabase'
import { calcProjection, formatINR, MY_FUNDS, TOTAL_SIP } from '@/lib/funds'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM = `You are KB's personal institutional-grade wealth management AI.
Be sharp, specific, and actionable. Never give generic MF advice.
Always reference actual fund names and ₹ amounts. Use emojis where appropriate.`

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { type, customPrompt } = body

    let result = ''

    // Path 1: customPrompt from page.tsx (context already included)
    if (customPrompt) {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 800,
        system: SYSTEM,
        messages: [{ role: 'user', content: customPrompt }],
      })
      result = response.content[0].type === 'text' ? response.content[0].text : ''

    // Path 2: type-based (builds context from Supabase itself)
    } else if (type) {
      const context = await buildPortfolioContext()
      switch (type) {
        case 'weekly':     result = await runWeeklyBrief(context); break
        case 'projection': result = await runProjectionUpdate(context); break
        case 'alert':      result = await runAlertCheck(context); break
        case 'advice':     result = await runAdvice(context); break
        default:           result = await runWeeklyBrief(context)
      }
    } else {
      return NextResponse.json({ error: 'Provide type or customPrompt' }, { status: 400 })
    }

    // Save to alerts_log
    await supabase.from('alerts_log').insert({
      alert_type: type || 'custom',
      title: `AI ${type || 'brief'} — ${new Date().toLocaleDateString()}`,
      message: result.substring(0, 500),
      severity: 'info',
    })

    return NextResponse.json({ success: true, result })
  } catch (error: any) {
    console.error('Agent error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

async function buildPortfolioContext(): Promise<string> {
  const { data: navs } = await supabase
    .from('nav_history')
    .select('isin, nav, nav_date')
    .in('isin', MY_FUNDS.map(f => f.isin))
    .order('nav_date', { ascending: false })
    .limit(12)

  const { data: alerts } = await supabase
    .from('alerts_log')
    .select('title, severity, triggered_at')
    .order('triggered_at', { ascending: false })
    .limit(5)

  const navMap: Record<string, { nav: number; date: string }> = {}
  for (const n of navs || []) {
    if (!navMap[n.isin]) navMap[n.isin] = { nav: n.nav, date: n.nav_date }
  }

  const navSummary = MY_FUNDS.map(f =>
    navMap[f.isin]
      ? `${f.name}: NAV Rs.${navMap[f.isin].nav} (${navMap[f.isin].date})`
      : `${f.name}: NAV not yet fetched`
  ).join('\n')

  const alertSummary = alerts?.map(a => `[${a.severity}] ${a.title}`).join('\n') || 'No recent alerts'

  return `KB Portfolio - ${new Date().toDateString()}
Total: Rs.66.87L | Invested: Rs.52.58L | Returns: +Rs.14.29L | XIRR: 14.18%
Monthly SIP: Rs.${TOTAL_SIP.toLocaleString()}/month

Active SIP Funds:
${MY_FUNDS.map(f => `- ${f.name}: Rs.${f.sip.toLocaleString()}/month (${f.category})`).join('\n')}

Latest NAVs:
${navSummary}

Recent Alerts:
${alertSummary}

Pending: Exit ICICI BHARAT 22 FOF (Rs.84.28K) | Switch SBI Contra Regular to Direct (Rs.12.57L) | Deploy Rs.8.73L via STP
Projections (Base @13%): 3M Rs.73.4L | 6M Rs.80.1L | 1Y Rs.91.2L | 5Y Rs.1.71Cr
Goals: Rs.1Cr Apr 2026 | Rs.1.71Cr Apr 2030 | Rs.8-10Cr in 15Y`
}

async function runWeeklyBrief(context: string): Promise<string> {
  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514', max_tokens: 800, system: SYSTEM,
    messages: [{ role: 'user', content: `${context}\n\nGenerate WhatsApp-style weekly brief. 10-12 emoji bullets. Include: portfolio score/100, XIRR status, each fund status, 1 specific action, next SIP reminder.` }],
  })
  return res.content[0].type === 'text' ? res.content[0].text : ''
}

async function runProjectionUpdate(context: string): Promise<string> {
  const cv = 6687000, m = TOTAL_SIP
  const proj = {
    '3M Bear': formatINR(calcProjection(cv, m, 3, 10)),
    '3M Base': formatINR(calcProjection(cv, m, 3, 13)),
    '3M Bull': formatINR(calcProjection(cv, m, 3, 16)),
    '6M Base': formatINR(calcProjection(cv, m, 6, 13)),
    '1Y Base': formatINR(calcProjection(cv, m, 12, 13)),
  }
  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514', max_tokens: 600, system: SYSTEM,
    messages: [{ role: 'user', content: `${context}\n\nProjections: ${JSON.stringify(proj)}\n\nMost realistic scenario now and why? Which fund outperforms/underperforms in 6M? One specific action. Under 150 words.` }],
  })
  return res.content[0].type === 'text' ? res.content[0].text : ''
}

async function runAlertCheck(context: string): Promise<string> {
  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514', max_tokens: 600, system: SYSTEM,
    messages: [{ role: 'user', content: `${context}\n\nCheck alerts for KB's 6 funds. Format: Red Critical | Yellow Warning | Green Opportunity. Cover: ICICI BHARAT exit, SBI Contra expense drag, small/mid cap valuations, HDFC Defence news, Parag Parikh US risks. Max 2 lines each.` }],
  })
  return res.content[0].type === 'text' ? res.content[0].text : ''
}

async function runAdvice(context: string): Promise<string> {
  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514', max_tokens: 700, system: SYSTEM,
    messages: [{ role: 'user', content: `${context}\n\n3 specific actionable moves for THIS MONTH. Exact fund names and amounts. Include: one tax tip, one rebalancing action, one STP deployment decision for Rs.8.73L. Numbered steps.` }],
  })
  return res.content[0].type === 'text' ? res.content[0].text : ''
}