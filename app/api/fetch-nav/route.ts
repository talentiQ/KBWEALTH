// app/api/fetch-nav/route.ts
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { MY_FUNDS } from '@/lib/funds'

// AMFI publishes all MF NAVs daily — completely free, no auth needed
const AMFI_URL = 'https://www.amfiindia.com/spages/NAVAll.txt'

export async function GET(request: Request) {
  // Protect this route
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    console.log('Fetching NAVs from AMFI...')
    const res = await fetch(AMFI_URL, { cache: 'no-store' })
    const text = await res.text()
    const lines = text.split('\n')

    const today = new Date().toISOString().split('T')[0]
    const results: { fund: string; isin: string; nav: number }[] = []

    for (const fund of MY_FUNDS) {
      // AMFI format: SchemeCode;ISINDivPayoutISINGrowth;ISINDivReinvestment;SchemeName;NetAssetValue;Date
      const line = lines.find(
        (l) => l.includes(fund.isin) && l.split(';').length >= 5
      )

      if (line) {
        const parts = line.split(';')
        const nav = parseFloat(parts[4])

        if (!isNaN(nav) && nav > 0) {
          // Upsert into nav_history using server-side service role creds
          const { error: navError } = await supabaseAdmin
            .from('nav_history')
            .upsert(
              { isin: fund.isin, nav_date: today, nav: nav },
              { onConflict: 'isin,nav_date' }
            )

          if (navError) {
            console.error('NAV upsert failed for', fund.isin, navError)
            continue
          }

          results.push({ fund: fund.name, isin: fund.isin, nav })

          // Update current_nav in portfolio_funds
          const { error: updateError } = await supabaseAdmin
            .from('portfolio_funds')
            .update({ current_nav: nav })
            .eq('isin', fund.isin)

          if (updateError) {
            console.error('current_nav update failed for', fund.isin, updateError)
          }
        }
      }
    }

    // Check for NAV drops > 5% vs last week
    await checkNavAlerts()

    return NextResponse.json({
      success: true,
      date: today,
      updated: results.length,
      navs: results,
    })
  } catch (error) {
    console.error('NAV fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch NAVs' }, { status: 500 })
  }
}

async function checkNavAlerts() {
  for (const fund of MY_FUNDS) {
    // Get last 7 days of NAVs
    const { data } = await supabaseAdmin
      .from('nav_history')
      .select('nav, nav_date')
      .eq('isin', fund.isin)
      .order('nav_date', { ascending: false })
      .limit(8)

    if (data && data.length >= 7) {
      const latestNAV = data[0].nav
      const weekAgoNAV = data[6].nav
      const pctChange = ((latestNAV - weekAgoNAV) / weekAgoNAV) * 100

      if (pctChange <= -5) {
        // Insert red flag alert
        const { error: alertError } = await supabaseAdmin.from('alerts_log').insert({
          alert_type: 'nav_drop',
          fund_name: fund.name,
          title: `${fund.name} dropped ${pctChange.toFixed(1)}% this week`,
          message: `NAV fell from ₹${weekAgoNAV} to ₹${latestNAV}. This is a SIP opportunity — keep your SIP running. Consider a small lumpsum if market drops further.`,
          severity: pctChange <= -10 ? 'critical' : 'warning',
        })

        if (alertError) {
          console.error('alert insert failed for', fund.isin, alertError)
        }
      }
    }
  }
}