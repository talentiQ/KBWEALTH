// app/api/seed/route.ts

import { NextResponse } from 'next/server'
import { seedDatabase } from '@/lib/db/seed'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const result = await seedDatabase()

    return NextResponse.json({
      success: true,
      result,
    })

  } catch (error: any) {
    console.error('[seed]', error)

    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Seed failed',
      },
      { status: 500 }
    )
  }
}

