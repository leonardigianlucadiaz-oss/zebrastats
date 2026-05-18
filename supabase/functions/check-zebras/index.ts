import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const LEAGUES: Record<string, string> = {
  ENG: '2021', ESP: '2014', ITA: '2019',
  GER: '2002', BRA: '2013', FRA: '2015', POR: '2017',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const sb = createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  )
  const FD_KEY = Deno.env.get('FOOTBALL_DATA_KEY') || ''

  let alertsSent = 0

  try {
    // Busca todas as partidas de hoje
    const today = new Date().toISOString().split('T')[0]
    const results: any[] = []

    for (const [lid, fdId] of Object.entries(LEAGUES)) {
      try {
        const res = await fetch(
          `https://api.football-data.org/v4/competitions/${fdId}/matches?dateFrom=${today}&dateTo=${today}`,
          { headers: { 'X-Auth-Token': FD_KEY } }
        )
        const json = await res.json()
        const matches = json.matches || []

        for (const m of matches) {
          if (!m.odds) continue
          const homeOdd = m.odds?.homeWin
          const awayOdd = m.odds?.awayWin
          if (!homeOdd || !awayOdd) continue

          // Detecta favorito vs azarão
          const homeFav   = homeOdd < awayOdd
          const favOdd    = homeFav ? homeOdd  : awayOdd
          const dogOdd    = homeFav ? awayOdd  : homeOdd
          const favTeam   = homeFav ? m.homeTeam?.name : m.awayTeam?.name
          const dogTeam   = homeFav ? m.awayTeam?.name : m.homeTeam?.name

          // ZI estimado baseado nas odds
          const zi = Math.round(((dogOdd / favOdd) - 1) * 30)
          if (zi < 40) continue // só zebras relevantes

          results.push({ lid, favTeam, dogTeam, dogOdd, zi, matchId: m.id, kickoff: m.utcDate })
        }
      } catch(e) {
        console.error(`[check-zebras] Erro na liga ${lid}:`, e.message)
      }
    }

    if (!results.length) {
      return new Response(JSON.stringify({ checked: true, alerts: 0 }), {
        headers: { ...CORS, 'Content-Type': 'application/json' }
      })
    }

    // Busca usuários com alertas ativos
    const { data: alerts } = await sb.from('user_alerts')
      .select('user_id, league_id, min_zi, push_enabled, email_enabled')
      .eq('active', true)

    for (const alert of (alerts || [])) {
      const relevant = results.filter(r =>
        (!alert.league_id || r.lid === alert.league_id) &&
        r.zi >= (alert.min_zi || 40)
      )
      if (!relevant.length) continue

      for (const z of relevant) {
        // Salva notificação na tabela
        await sb.from('notifications').insert({
          user_id: alert.user_id,
          type: 'zebra_alert',
          title: `🦓 ZEBRA — ${z.dogTeam} pode surpreender!`,
          body: `ZI ${z.zi} · Odd ${z.dogOdd} · ${z.lid}`,
          data: z,
          read: false,
        })
        alertsSent++
      }
    }

    return new Response(JSON.stringify({ checked: true, alerts: alertsSent, zebras: results.length }), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  } catch(err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }
})
