// lib/types/wealth.ts
export interface Liability {
  id: string
  user_id: string
  cat: 'home_loan' | 'personal' | 'car_loan' | 'overdraft' | 'credit_card' | 'business' | 'other'
  name: string
  bank?: string
  outstanding: number
  emi: number
  rate: number
  end_date?: string   // ← DB column name (not "end")
  notes?: string
}

export interface LiquidityAsset {
  id: string
  user_id: string
  cat: 'equity' | 'mf' | 'gold' | 'ppf' | 'fd' | 'bonds' | 'nps' | 'other'
  name: string
  value: number
  invested: number
  isin?: string
  units?: number
}

export interface PropertyAsset {
  id: string
  user_id: string
  cat: 'residential' | 'commercial' | 'land' | 'industrial' | 'other'
  name: string
  loc?: string
  purchase: number
  current: number
  year?: number
  area_sqft?: number
}

export interface CashBalance {
  id: string
  user_id: string
  cat: 'savings' | 'current' | 'hand' | 'fd' | 'wallet' | 'other'
  name: string
  bank?: string
  acct?: string
  balance: number
}

export interface FinancialGoal {
  id: string
  user_id: string
  name: string
  cat?: 'investment' | 'liability' | 'property' | 'cash' | 'other'
  target: number
  current: number
  target_date?: string
  color?: string
  status?: 'active' | 'completed' | 'paused'
}

export interface NWSnapshot {
  snapshot_date: string
  total_assets: number
  total_liab: number
  net_worth: number
  liq_value: number
  prop_value: number
  cash_value: number
}

export interface Alert {
  id: string
  title: string
  message: string
  severity: 'info' | 'warning' | 'critical'
  is_read: boolean
  triggered_at: string
}