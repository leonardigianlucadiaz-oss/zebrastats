import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import Stripe from 'https://esm.sh/stripe@14?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  // BUG-10 / SEC-1: Verify JWT before processing any request
  const sb = createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_ANON_KEY') || ''
  )
  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.replace('Bearer ', '')
  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }
  const { data: { user }, error: authError } = await sb.auth.getUser(token)
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
      status: 401, headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }
  // Use verified user.id — do not trust any user_id from request body
  const authenticatedUserId = user.id

  try {
    const { priceId, successUrl, cancelUrl } = await req.json()

    // Valida que priceId está na allowlist configurada como secret STRIPE_PRICE_IDS
    // Formato do secret: "price_xxx,price_yyy" (comma-separated)
    const allowedPrices = (Deno.env.get('STRIPE_PRICE_IDS') || '').split(',').filter(Boolean)
    if (allowedPrices.length > 0 && !allowedPrices.includes(priceId)) {
      return new Response(JSON.stringify({ error: 'Invalid price' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' }
      })
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl + '?session_id={CHECKOUT_SESSION_ID}',
      cancel_url:  cancelUrl,
      metadata: { userId: authenticatedUserId },
      allow_promotion_codes: true,
      billing_address_collection: 'required',
    })

    return new Response(
      JSON.stringify({ url: session.url }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  }
})
