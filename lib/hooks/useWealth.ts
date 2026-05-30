// lib/hooks/useWealth.ts
'use client'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'
import type {
  Liability, LiquidityAsset, PropertyAsset,
  CashBalance, FinancialGoal, NWSnapshot, Alert
} from '@/lib/types/wealth'

export interface WealthData {
  liabilities:  Liability[]
  liquidity:    LiquidityAsset[]
  property:     PropertyAsset[]
  cash:         CashBalance[]
  goals:        FinancialGoal[]
  nw_history:   NWSnapshot[]
  alerts:       Alert[]
}

const EMPTY: WealthData = {
  liabilities: [], liquidity: [], property: [],
  cash: [], goals: [], nw_history: [], alerts: []
}

export function useWealth(user: User | null) {
  const [data, setData]       = useState<WealthData>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user) { setData(EMPTY); setLoading(false); return }
    setLoading(true)
    try {
      const uid = user.id
      const [liab, liq, prop, cash, goals, nwh, alerts] = await Promise.all([
        supabase.from('liabilities').select('*').eq('user_id', uid).order('created_at'),
        supabase.from('liquidity_assets').select('*').eq('user_id', uid).order('created_at'),
        supabase.from('property_assets').select('*').eq('user_id', uid).order('created_at'),
        supabase.from('cash_balances').select('*').eq('user_id', uid).order('created_at'),
        supabase.from('financial_goals').select('*').eq('user_id', uid).eq('status','active'),
        supabase.from('net_worth_history').select('*').eq('user_id', uid)
          .order('snapshot_date', { ascending: true }).limit(12),
        supabase.from('alerts_log').select('*').eq('is_read', false)
          .order('triggered_at', { ascending: false }).limit(10),
      ])
      setData({
        liabilities: liab.data  ?? [],
        liquidity:   liq.data   ?? [],
        property:    prop.data  ?? [],
        cash:        cash.data  ?? [],
        goals:       goals.data ?? [],
        nw_history:  nwh.data   ?? [],
        alerts:      alerts.data ?? [],
      })
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => { load() }, [load])

  // Optimistic CRUD — updates local state immediately, then syncs DB
  const upsert = useCallback(async (table: string, item: any) => {
    const isNew = !item.id
    const payload = { ...item, user_id: user!.id }
    if (isNew) delete payload.id

    const { data: saved, error } = isNew
      ? await supabase.from(table).insert(payload).select().single()
      : await supabase.from(table).update(payload).eq('id', item.id).select().single()

    if (error) throw error
    await load() // refresh all data after write
    return saved
  }, [user, load])

  const remove = useCallback(async (table: string, id: string) => {
    await supabase.from(table).delete().eq('id', id)
    await load()
  }, [load])

  // Trigger NW snapshot after any write
  const snapshot = useCallback(async () => {
    await fetch('/api/snapshot', { method: 'POST' })
  }, [])

  return { data, loading, error, refetch: load, upsert, remove, snapshot }
}