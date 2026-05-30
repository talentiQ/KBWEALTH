// app/NWPortfolio/components/MFPortalFrame.jsx
'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/db/supabase'

export default function MFPortalFrame() {
  const [token, setToken] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setToken(session?.access_token ?? '')
    })
  }, [])

  if (!token) return null

  return (
    <div style={{ background:'white', borderRadius:16, overflow:'hidden',
      border:'1px solid #E8ECF4', height:700, position:'relative' }}>
      <div style={{ padding:'12px 20px', borderBottom:'1px solid #E8ECF4',
        display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <span style={{ fontSize:14, fontWeight:600, color:'#0B1E4F' }}>
          📊 MF Portfolio Manager
        </span>
        <a href={`${process.env.NEXT_PUBLIC_MF_APP_URL}`}
          target="_blank" rel="noreferrer"
          style={{ fontSize:12, color:'#2563EB', textDecoration:'none' }}>
          Open full screen ↗
        </a>
      </div>
      <iframe
        src={`${process.env.NEXT_PUBLIC_MF_APP_URL}?token=${token}`}
        width="100%"
        height="648"
        frameBorder="0"
        title="Mutual Fund Portfolio"
        style={{ display:'block' }}
      />
    </div>
  )
}