
// lib/db/seed.ts

import { supabaseAdmin } from '@/lib/supabase-server'

export async function seedDatabase() {

  const seedData = [
    {
      isin: 'INF200K01RA0',
      nav: 412.2290,
      nav_date: '2026-05-27',
    },
    {
      isin: 'INF200K01362',
      nav: 374.9242,
      nav_date: '2026-05-27',
    },
    {
      isin: 'INF879O01027',
      nav: 90.9863,
      nav_date: '2026-05-27',
    },
    {
      isin: 'INF336L01NY9',
      nav: 28.9441,
      nav_date: '2026-05-27',
    },
    {
      isin: 'INF204K01K15',
      nav: 197.4799,
      nav_date: '2026-05-27',
    },
    {
      isin: 'INF179K01XQ0',
      nav: 223.5850,
      nav_date: '2026-05-27',
    },
    {
      isin: 'INF179KC1BQ9',
      nav: 16.9903,
      nav_date: '2026-05-27',
    },
    {
      isin: 'INF179KC1GI5',
      nav: 29.2110,
      nav_date: '2026-05-27',
    },
    {
      isin: 'INF740K01PU7',
      nav: 389.9520,
      nav_date: '2026-05-27',
    },
    {
      isin: 'INF769K01AX2',
      nav: 124.0720,
      nav_date: '2026-05-27',
    },
    {
      isin: 'INF109K01BL4',
      nav: 107.1200,
      nav_date: '2026-05-27',
    },
    {
      isin: 'INF109K01Z48',
      nav: 190.8400,
      nav_date: '2026-05-27',
    },
    {
      isin: 'INF109K014O9',
      nav: 955.3300,
      nav_date: '2026-05-27',
    },
    {
      isin: 'INF109KC1FX1',
      nav: 35.6582,
      nav_date: '2026-05-27',
    },
    {
      isin: 'INF109K018M4',
      nav: 219.5700,
      nav_date: '2026-05-27',
    },
    {
      isin: 'INF109KC1LJ8',
      nav: 41.7000,
      nav_date: '2026-05-27',
    },
  ]

  // ─── Clear Existing NAVs ────────────────────────────────────────────────
  const { error: truncateError } = await supabaseAdmin
    .from('nav_history')
    .delete()
    .neq('isin', '')

  if (truncateError) {
    throw truncateError
  }

  // ─── Insert Fresh NAVs ──────────────────────────────────────────────────
  const { error: insertError } = await supabaseAdmin
    .from('nav_history')
    .insert(seedData)

  if (insertError) {
    throw insertError
  }

  return {
    inserted: seedData.length,
    success: true,
  }
}

