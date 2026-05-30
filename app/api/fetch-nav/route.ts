// app/api/fetch-nav/route.ts
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const AMFI_URL            = 'https://www.amfiindia.com/spages/NAVAll.txt'
const ALERT_THRESHOLD_PCT = 5

export async function GET(request: Request) {

  // ── Auth: Bearer token only (cron-job.org sends this header) ────────────
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    console.log('[fetch-nav] Fetching AMFI NAV file...')

    const controller = new AbortController()
    const timeoutId  = setTimeout(() => controller.abort(), 20000)

    let res: Response
    try {
      res = await fetch(AMFI_URL, { cache: 'no-store', signal: controller.signal })
    } finally {
      clearTimeout(timeoutId)
    }

    if (!res.ok) throw new Error(`AMFI returned HTTP ${res.status}`)

    const text  = await res.text()
    const lines = text.split('\n')

    // ── Parse AMFI into ISIN → { nav, date } map ────────────────────────────
    // Columns: [0]SchemeCode [1]ISINGrowth [2]ISINDivReinvest [3]Name [4]NAV [5]Date
    const isinMap = new Map<string, { nav: number; date: string }>()

    for (const line of lines) {
      const parts = line.split(';')
      if (parts.length < 6) continue

      const isinGrowth  = parts[1].trim()
      const isinDivRein = parts[2].trim()
      const nav         = parseFloat(parts[4].trim())
      const date        = parseAmfiDate(parts[5].trim())

      if (isNaN(nav) || nav <= 0 || !date) continue

      if (isinGrowth  && isinGrowth  !== 'N.A.' && isinGrowth  !== '-') isinMap.set(isinGrowth,  { nav, date })
      if (isinDivRein && isinDivRein !== 'N.A.' && isinDivRein !== '-') isinMap.set(isinDivRein, { nav, date })
    }

    console.log(`[fetch-nav] AMFI parsed: ${isinMap.size} ISIN entries`)

    // ── Read ALL funds from DB — not a static hardcoded list ────────────────
    // Any fund added via the UI is automatically included.
    const { data: dbFunds, error: dbError } = await supabaseAdmin
      .from('portfolio_funds')
      .select('id, fund_name, isin, is_active')
      .order('created_at', { ascending: true })

    if (dbError) throw new Error(`DB read failed: ${dbError.message}`)

    if (!dbFunds || dbFunds.length === 0) {
      return NextResponse.json({ success: true, updated: 0, message: 'No funds in portfolio_funds table yet' })
    }

    console.log(`[fetch-nav] Processing ${dbFunds.length} funds from DB...`)

    const results: { fund: string; isin: string; nav: number; date: string }[] = []
    const errors:  { fund: string; isin: string; reason: string }[]             = []

    for (const fund of dbFunds) {
      if (!fund.isin) {
        errors.push({ fund: fund.fund_name, isin: '(none)', reason: 'No ISIN on fund record' })
        continue
      }

      const entry = isinMap.get(fund.isin)

      if (!entry) {
        console.warn(`[fetch-nav] ISIN not found in AMFI: ${fund.isin} (${fund.fund_name})`)
        errors.push({ fund: fund.fund_name, isin: fund.isin, reason: 'ISIN not found in AMFI file' })
        continue
      }

      const { nav, date: navDate } = entry

      // ── Upsert nav_history (historical record) ───────────────────────────
      const { error: navHistError } = await supabaseAdmin
        .from('nav_history')
        .upsert(
          { isin: fund.isin, nav_date: navDate, nav },
          { onConflict: 'isin,nav_date' }
        )

      if (navHistError) {
        console.error(`[fetch-nav] nav_history upsert failed ${fund.isin}:`, navHistError.message)
        errors.push({ fund: fund.fund_name, isin: fund.isin, reason: navHistError.message })
        continue
      }

      // ── Write current_nav to portfolio_funds (used by dashboard MF corpus) ─
      // page.jsx computes MF corpus as Σ(units × current_nav).
      // Without this the MF corpus tile always shows ₹0.
      const { error: navPatchError } = await supabaseAdmin
        .from('portfolio_funds')
        .update({
          current_nav:    nav,
          nav_updated_at: new Date().toISOString(),
        })
        .eq('id', fund.id)

      if (navPatchError) {
        // Non-fatal — nav_history still updated; log and continue
        console.warn(`[fetch-nav] current_nav patch failed ${fund.fund_name}:`, navPatchError.message)
      }

      results.push({ fund: fund.fund_name, isin: fund.isin, nav, date: navDate })
      console.log(`[fetch-nav] ✓ ${fund.fund_name}: ₹${nav} (${navDate})`)
    }

    // ── Weekly NAV drop alerts ───────────────────────────────────────────────
    const alertsCreated = await checkNavAlerts(dbFunds)

    console.log(`[fetch-nav] Done — updated: ${results.length}, failed: ${errors.length}, alerts: ${alertsCreated}`)

    return NextResponse.json({
      success:      true,
      totalFunds:   dbFunds.length,
      updated:      results.length,
      failed:       errors.length,
      navs:         results,
      errors,
      alertsCreated,
    })

  } catch (error) {
    console.error('[fetch-nav] Fatal error:', error)
    return NextResponse.json({ error: 'Failed to fetch NAVs', detail: String(error) }, { status: 500 })
  }
}

// ── Parse AMFI date "28-May-2025" → "2025-05-28" ─────────────────────────────
function parseAmfiDate(raw: string): string | null {
  try {
    const months: Record<string, string> = {
      Jan:'01', Feb:'02', Mar:'03', Apr:'04', May:'05', Jun:'06',
      Jul:'07', Aug:'08', Sep:'09', Oct:'10', Nov:'11', Dec:'12',
    }
    const [day, mon, year] = raw.split('-')
    if (!day || !mon || !year || !months[mon]) return null
    return `${year}-${months[mon]}-${day.padStart(2, '0')}`
  } catch {
    return null
  }
}

// ── Check for weekly NAV drops and insert alerts ──────────────────────────────
async function checkNavAlerts(
  dbFunds: { id: string; fund_name: string; isin: string | null; is_active: boolean | null }[]
): Promise<number> {
  let alertsCreated = 0

  for (const fund of dbFunds) {
    if (!fund.isin) continue

    const { data, error } = await supabaseAdmin
      .from('nav_history')
      .select('nav, nav_date')
      .eq('isin', fund.isin)
      .order('nav_date', { ascending: false })
      .limit(7)

    if (error || !data || data.length < 7) continue

    const latestNAV  = Number(data[0].nav)
    const weekAgoNAV = Number(data[6].nav)
    if (weekAgoNAV <= 0) continue

    const pctChange = ((latestNAV - weekAgoNAV) / weekAgoNAV) * 100
    if (pctChange > -ALERT_THRESHOLD_PCT) continue

    // De-duplicate: skip if alert already exists for this fund in last 24h
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { data: existing } = await supabaseAdmin
      .from('alerts_log')
      .select('id')
      .eq('alert_type', 'nav_drop')
      .eq('fund_name', fund.fund_name)
      .gte('triggered_at', since)
      .limit(1)

    if (existing && existing.length > 0) {
      console.log(`[fetch-nav] Skipping duplicate alert for ${fund.fund_name}`)
      continue
    }

    const isCritical = pctChange <= -10

    const { error: alertError } = await supabaseAdmin
      .from('alerts_log')
      .insert({
        alert_type:   'nav_drop',
        fund_name:    fund.fund_name,
        title:        `NAV Drop Alert: ${fund.fund_name}`,
        severity:     isCritical ? 'critical' : 'warning',
        message:
          `${fund.fund_name} dropped ${Math.abs(pctChange).toFixed(1)}% this week. ` +
          `NAV: ₹${weekAgoNAV.toFixed(2)} → ₹${latestNAV.toFixed(2)}. ` +
          (isCritical
            ? 'Significant drop — consider lumpsum top-up.'
            : 'Keep SIP running — this is a buying opportunity.'),
        triggered_at: new Date().toISOString(),
        is_read:      false,
      })

    if (alertError) {
      console.error(`[fetch-nav] Alert insert failed ${fund.fund_name}:`, alertError.message)
    } else {
      alertsCreated++
      console.log(`[fetch-nav] 🚨 Alert: ${fund.fund_name} (${pctChange.toFixed(1)}%)`)
    }
  }

  return alertsCreated
}