import { createUserClient, supabaseAdmin } from '@/lib/supabase-server'

export async function POST() {
  const userClient = await createUserClient()

  const {
    data: { user },
  } = await userClient.auth.getUser()

  if (!user) {
    return Response.json(
      { error: 'Unauthorized' },
      { status: 401 }
    )
  }

  const { error } = await supabaseAdmin.rpc(
    'snapshot_net_worth',
    {
      p_user_id: user.id,
    }
  )

  if (error) {
    return Response.json(
      { error: error.message },
      { status: 500 }
    )
  }

  return Response.json({ ok: true })
}