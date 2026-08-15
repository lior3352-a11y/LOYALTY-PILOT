import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const authHeader = req.headers.get('Authorization') || ''
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim()

    if (!jwt) throw new Error('Missing authorization')

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: userData, error: userError } = await adminClient.auth.getUser(jwt)
    if (userError || !userData.user) throw new Error('Invalid session')

    const { data: adminRow, error: adminError } = await adminClient
      .from('system_admins')
      .select('user_id')
      .eq('user_id', userData.user.id)
      .maybeSingle()

    if (adminError) throw adminError
    if (!adminRow) throw new Error('Not authorized')

    const body = await req.json()
    const email = String(body?.email || '').trim().toLowerCase()
    const password = String(body?.password || '')
    const businessId = Number(body?.business_id)
    const role = String(body?.role || 'staff')

    if (!email || !email.includes('@')) throw new Error('Invalid email')
    if (password.length < 8) throw new Error('Password must be at least 8 characters')
    if (!Number.isInteger(businessId) || businessId <= 0) throw new Error('Invalid business')
    if (!['owner', 'manager', 'staff'].includes(role)) throw new Error('Invalid role')

    const { data: business, error: businessError } = await adminClient
      .from('businesses')
      .select('id')
      .eq('id', businessId)
      .maybeSingle()

    if (businessError) throw businessError
    if (!business) throw new Error('Business not found')

    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

    if (createError || !created.user) {
      throw new Error(createError?.message || 'User creation failed')
    }

    const newUserId = created.user.id

    const { error: linkError } = await adminClient
      .from('business_users')
      .insert({ user_id: newUserId, business_id: businessId, role })

    if (linkError) {
      await adminClient.auth.admin.deleteUser(newUserId)
      throw linkError
    }

    return new Response(JSON.stringify({
      success: true,
      user_id: newUserId,
      email,
      business_id: businessId,
      role,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
