// app/api/seed/route.ts
import { NextResponse } from 'next/server'
import { seedDatabase } from '@/lib/supabase'

export async function GET() {
  const result = await seedDatabase()
  return NextResponse.json(result)
}