import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import Stripe from 'https://esm.sh/stripe@14?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})
const WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET') || ''

serve(async (req) => {
  const sig  = req.headers.get('stripe-signature') || ''
  const body = await req.text()

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, WEBHOOK_SECRET)
  } catch (err) {
    return new Response(`Webhook Error: ${err.message}`, { status: 400 })
  }

  const sb = createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  )

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.CheckoutSession
    const userId  = session.metadata?.userId
    if (userId) {
      // Fix 5.10: usa +13 meses como padrão seguro para não expirar antes de assinantes
      // anuais. TODO: detectar intervalo real via session.subscription → price.recurring.interval
      // quando create-checkout passar metadata.plan = 'annual' | 'monthly'.
      const expires = new Date()
      expires.setMonth(expires.getMonth() + 13) // safe default for up to annual plans
      await sb.from('profiles').update({
        plan: 'pro',
        plan_expires_at: expires.toISOString(),
        stripe_customer_id: session.customer as string,
      }).eq('id', userId)

      // Atualiza user_metadata no Supabase Auth
      await sb.auth.admin.updateUserById(userId, {
        user_metadata: { plan: 'pro' }
      })
    }
  }

  // Fix 5.9: renova plan_expires_at em +1 mês a cada pagamento de invoice mensal.
  // Sem este handler, assinaturas mensais expiram após o primeiro mês.
  if (event.type === 'invoice.payment_succeeded') {
    const invoice = event.data.object as Stripe.Invoice
    const customerId = invoice.customer as string
    // Estende o plano com base na data atual de expiração para evitar perda de dias
    const { data: profile } = await sb.from('profiles')
      .select('id, plan_expires_at').eq('stripe_customer_id', customerId).single()
    if (profile && profile.plan_expires_at) {
      const newExpiry = new Date(profile.plan_expires_at)
      newExpiry.setMonth(newExpiry.getMonth() + 1)
      await sb.from('profiles').update({
        plan: 'pro',
        plan_expires_at: newExpiry.toISOString(),
      }).eq('stripe_customer_id', customerId)
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription
    const { data: profile } = await sb.from('profiles')
      .select('id').eq('stripe_customer_id', sub.customer as string).single()
    if (profile) {
      await sb.from('profiles').update({ plan: 'free' }).eq('id', profile.id)
      await sb.auth.admin.updateUserById(profile.id, {
        user_metadata: { plan: 'free' }
      })
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' }
  })
})
