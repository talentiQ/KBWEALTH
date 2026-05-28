// app/api/fetch-nav/route.ts
//
// Bug fixes applied:
//  1. Uses NAV date from AMFI response (not server clock) → correct on weekends/holidays
//  2. Matches BOTH ISIN columns in AMFI (Growth + Div Reinvestment)
//  3. Removed update to non-existent `current_nav` column in portfolio_funds
//  4. Fixed alerts_log insert to match actual schema (no `title`, no `severity`)
//  5. Guards against duplicate alerts (checks if alert already exists today)
//  6. Logs per-fund result for easy debugging

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { MY_FUNDS } from '@/lib/funds'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// AMFI publishes all MF NAVs daily — free, no auth
// Format per line: SchemeCode;ISINGrowth;ISINDivReinvestment;SchemeName;NAV;Date
const AMFI_URL = 'https://www.amfiindia.com/spages/NAVAll.txt'
const controller = new AbortController()

const timeout = setTimeout(() => {
  controller.abort()
}, 15000)

const res = await fetch(AMFI_URL, {
  cache: 'no-store',
  signal: controller.signal,
})

clearTimeout(timeout)

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    console.log('[fetch-nav] Fetching from AMFI...')
    const res = await fetch(AMFI_URL, { cache: 'no-store' })
    if (!res.ok) throw new Error(`AMFI returned HTTP ${res.status}`)

    const text = await res.text()
    const lines = text.split('\n')

    const results: { fund: string; isin: string; nav: number; date: string }[] = []
    const errors:  { fund: string; isin: string; reason: string }[] = []

    for (const fund of MY_FUNDS) {
      // ── Step 1: find AMFI line matching this ISIN ───────────────────────
      // AMFI columns: [0]SchemeCode [1]ISINGrowth [2]ISINDivReinvest [3]Name [4]NAV [5]Date
      const line = lines.find((l) => {
        const parts = l.split(';')
        if (parts.length < 6) return false
        // Match against EITHER isin column (growth or div-reinvestment)
        return parts[1].trim() === fund.isin || parts[2].trim() === fund.isin
      })

      if (!line) {
        console.warn(`[fetch-nav] ISIN not found in AMFI: ${fund.isin} (${fund.name})`)
        errors.push({ fund: fund.name, isin: fund.isin, reason: 'ISIN not found in AMFI' })
        continue
      }

      const parts = line.split(';')
      const nav     = parseFloat(parts[4].trim())
      // ── Bug Fix #1: use AMFI's own date, not server clock ────────────────
      // AMFI date format: DD-Mon-YYYY  e.g. "28-May-2025"
      const amfiRaw = parts[5].trim()
      const navDate = parseAmfiDate(amfiRaw)

      if (!navDate) {
        errors.push({ fund: fund.name, isin: fund.isin, reason: `Bad date from AMFI: ${amfiRaw}` })
        continue
      }

      if (isNaN(nav) || nav <= 0) {
        errors.push({ fund: fund.name, isin: fund.isin, reason: `Invalid NAV: ${parts[4]}` })
        continue
      }

      // ── Step 2: upsert nav_history ──────────────────────────────────────
      const { error: navError } = await supabaseAdmin
        .from('nav_history')
        .upsert(
          { isin: fund.isin, nav_date: navDate, nav },
          { onConflict: 'isin,nav_date' }
        )

      if (navError) {
        console.error(`[fetch-nav] nav_history upsert failed for ${fund.isin}:`, navError.message)
        errors.push({ fund: fund.name, isin: fund.isin, reason: navError.message })
        continue
      }

      // ── Step 3: NO current_nav in portfolio_funds schema ─────────────────
      // portfolio_funds has no current_nav column — NAV is always read from nav_history
      // If you later ADD current_nav via migration, uncomment below:
      //
      // await supabaseAdmin
      //   .from('portfolio_funds')
      //   .update({ current_nav: nav, nav_updated_at: new Date().toISOString() })
      //   .eq('isin', fund.isin)

      results.push({ fund: fund.name, isin: fund.isin, nav, date: navDate })
      console.log(`[fetch-nav] ✓ ${fund.name}: ₹${nav} (${navDate})`)
    }

    // ── Step 4: check for weekly NAV drop alerts ──────────────────────────
    const alertsCreated = await checkNavAlerts()

    return NextResponse.json({
      success: true,
      updated: results.length,
      failed: errors.length,
      navs: results,
      errors,
      alertsCreated,
    })
  } catch (error) {
    console.error('[fetch-nav] Fatal error:', error)
    return NextResponse.json({ error: 'Failed to fetch NAVs', detail: String(error) }, { status: 500 })
  }
}

// ─── Parse AMFI date "28-May-2025" → "2025-05-28" ────────────────────────────
function parseAmfiDate(raw: string): string | null {
  try {
    const months: Record<string, string> = {
      Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
      Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
    }
    const [day, mon, year] = raw.split('-')
    if (!day || !mon || !year || !months[mon]) return null
    return `${year}-${months[mon]}-${day.padStart(2, '0')}`
  } catch {
    return null
  }
}

// ─── Check for weekly NAV drops and insert alerts ────────────────────────────
// Bug Fix #2: alerts_log schema = { alert_type, fund_name, message, triggered_at, is_read }
// No `title` column, no `severity` column — removed.
// Bug Fix #3: de-duplicate — skip if an alert of same type+fund exists in last 24h
async function checkNavAlerts(): Promise<number> {
  let alertsCreated = 0

  for (const fund of MY_FUNDS) {
    const { data, error } = await supabaseAdmin
      .from('nav_history')
      .select('nav, nav_date')
      .eq('isin', fund.isin)
      .order('nav_date', { ascending: false })
      .limit(MY_FUNDS.length)

    if (error || !data || data.length < 7) continue

    const latestNAV  = Number(data[0].nav)
    const weekAgoNAV = Number(data[6].nav)
    if (weekAgoNAV <= 0) continue

    const pctChange = ((latestNAV - weekAgoNAV) / weekAgoNAV) * 100

    if (pctChange <= -ALERT_THRESHOLD_PCT) {
      // De-duplicate: skip if same fund already has a nav_drop alert in last 24h
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const { data: existing } = await supabaseAdmin
        .from('alerts_log')
        .select('id')
        .eq('alert_type', 'nav_drop')
        .eq('fund_name', fund.name)
        .gte('triggered_at', since)
        .limit(1)

      if (existing && existing.length > 0) {
        console.log(`[fetch-nav] Skipping duplicate alert for ${fund.name}`)
        continue
      }

      const { error: alertError } = await supabaseAdmin
        .from('alerts_log')
        .insert({
          alert_type:   'nav_drop',
          fund_name:    fund.name,
          // message fits the actual `message` column (no `title`, no `severity`)
          message: `${fund.name} dropped ${Math.abs(pctChange).toFixed(1)}% this week. NAV: ₹${weekAgoNAV} → ₹${latestNAV}. ${
            pctChange <= -10
              ? 'Significant drop — consider lumpsum top-up.'
              : 'Keep SIP running — this is a buying opportunity.'
          }`,
          triggered_at: new Date().toISOString(),
          is_read:      false,
        })

      if (alertError) {
        console.error(`[fetch-nav] Alert insert failed for ${fund.name}:`, alertError.message)
      } else {
        alertsCreated++
        console.log(`[fetch-nav] 🚨 Alert created for ${fund.name} (${pctChange.toFixed(1)}%)`)
      }
    }
  }

  return alertsCreated
}

const ALERT_THRESHOLD_PCT = 5 // Trigger if weekly drop ≥ 5%