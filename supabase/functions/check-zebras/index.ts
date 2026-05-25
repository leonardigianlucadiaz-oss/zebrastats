// ZebraStats — Cron job: verifica partidas de hoje e dispara alertas de zebra
// Executado diariamente via Supabase Cron (Dashboard → Database → Cron Jobs)
// Configuração sugerida: todos os dias às 08:00 UTC ("0 8 * * *")
//
// SECRETS necessários no Supabase Edge Functions:
//   FOOTBALL_DATA_KEY  — chave da Football-Data.org
//   ODDS_API_KEY       — chave da The Odds API
//   CRON_SECRET        — segredo compartilhado com o cron dispatcher
//                        (adicione em Dashboard → Edge Functions → Secrets)

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Ligas monitoradas (FD ID → lid)
const LEAGUES: Record<string, string> = {
  '2021': 'ENG',  // Premier League
  '2014': 'ESP',  // La Liga
  '2019': 'ITA',  // Serie A
  '2002': 'GER',  // Bundesliga
  '2015': 'FRA',  // Ligue 1
  '2013': 'BRA',  // Brasileirão
  '2017': 'POR',  // Liga Portugal
  '2001': 'UCL',  // Champions League
}

// The Odds API — chave de esporte por liga
const ODDS_SPORTS: Record<string, string> = {
  ENG: 'soccer_epl',
  ESP: 'soccer_spain_la_liga',
  ITA: 'soccer_italy_serie_a',
  GER: 'soccer_germany_bundesliga',
  FRA: 'soccer_france_ligue_one',
  BRA: 'soccer_brazil_campeonato',
  POR: 'soccer_portugal_primeira_liga',
  UCL: 'soccer_uefa_champs_league',
}

// Calcula o Zebra Index (0–10) a partir das odds de casa e fora
// ZI alto = grande zebra potencial (azarão com chance real de vencer)
function calcZI(homeOdd: number, awayOdd: number): { zi: number; favOdd: number; dogOdd: number; dogIsHome: boolean } {
  const dogIsHome = homeOdd > awayOdd
  const favOdd    = dogIsHome ? awayOdd : homeOdd
  const dogOdd    = dogIsHome ? homeOdd : awayOdd
  // Fórmula: quanto maior a disparidade, maior o ZI (máx 10)
  // Ratio 2 (dogOdd/favOdd) → ZI ≈ 3; ratio 3 → ZI ≈ 6; ratio 4+ → ZI ≈ 9+
  const zi = Math.min(10, Math.round(((dogOdd / favOdd) - 1) * 3 * 10) / 10)
  return { zi, favOdd, dogOdd, dogIsHome }
}

// Normaliza nome de time para comparação (remove acentos, caixa baixa)
// Fix 7.4: usa escape Unicode explícito ̀-ͯ para evitar fragilidade
// de encoding de caracteres combinadores literais no source.
function normName(s: string): string {
  return s.toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // combining diacritical marks Unicode range
    .replace(/[^a-z0-9]/g, '')
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  // Fix 7.2: verifica CRON_SECRET para impedir invocações não autorizadas.
  // Configure CRON_SECRET como Supabase Edge Function Secret e passe-o
  // no header "Authorization: Bearer <secret>" do seu dispatcher de cron.
  const cronSecret = Deno.env.get('CRON_SECRET') || ''
  const authHeader = req.headers.get('Authorization') || ''
  const providedSecret = authHeader.replace('Bearer ', '')
  if (cronSecret && providedSecret !== cronSecret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }

  const sb = createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  )
  const FD_KEY   = Deno.env.get('FOOTBALL_DATA_KEY') || ''
  const ODDS_KEY = Deno.env.get('ODDS_API_KEY') || ''

  if (!FD_KEY) {
    return new Response(JSON.stringify({ error: 'FOOTBALL_DATA_KEY não configurada' }), {
      status: 503, headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }

  let alertsSent = 0
  const zebraMatches: any[] = []

  try {
    const today    = new Date().toISOString().split('T')[0]
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().split('T')[0]

    // ── 1. Busca partidas de hoje em todas as ligas ──────────────
    // Fix 10.2: aguarda 6.5s entre cada chamada à Football-Data.org (free tier:
    // 10 req/min). Com 8 ligas a função leva ~52s total — dentro do limite de
    // 150s do Supabase Edge Function.
    const todayMatches: Array<{ lid: string; homeTeam: string; awayTeam: string; matchId: number; kickoff: string }> = []

    for (const [fdId, lid] of Object.entries(LEAGUES)) {
      try {
        const res  = await fetch(
          `https://api.football-data.org/v4/competitions/${fdId}/matches?dateFrom=${today}&dateTo=${tomorrow}&status=SCHEDULED`,
          { headers: { 'X-Auth-Token': FD_KEY } }
        )
        if (!res.ok) continue
        const json    = await res.json()
        const matches = json.matches || []
        for (const m of matches) {
          todayMatches.push({
            lid,
            homeTeam: m.homeTeam?.name ?? '',
            awayTeam: m.awayTeam?.name ?? '',
            matchId:  m.id,
            kickoff:  m.utcDate,
          })
        }
      } catch (e: any) {
        console.error(`[check-zebras] Erro FD liga ${lid}:`, e.message)
      }
      // Aguarda 6.5s entre chamadas para respeitar o limite de 10 req/min da FD free tier
      await new Promise(r => setTimeout(r, 6500))
    }

    if (!todayMatches.length) {
      return new Response(JSON.stringify({ checked: true, alerts: 0, message: 'Sem partidas hoje' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' }
      })
    }

    // ── 2. Busca odds por liga (The Odds API) ────────────────────
    // Fix 4.3: busca odds de todas as ligas em paralelo (Promise.all) em vez de
    // sequencial, reduzindo o tempo de espera de N×latência para 1×latência.
    const lidSet = [...new Set(todayMatches.map(m => m.lid))]
    const oddsMap: Record<string, { home: string; away: string; homeOdd: number; awayOdd: number }[]> = {}

    if (ODDS_KEY) {
      const oddsResults = await Promise.all(
        lidSet.map(async (lid) => {
          const sport = ODDS_SPORTS[lid]
          if (!sport) return [lid, []] as [string, any[]]
          try {
            const res = await fetch(
              `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${ODDS_KEY}&regions=eu&markets=h2h&oddsFormat=decimal`
            )
            if (!res.ok) return [lid, []] as [string, any[]]
            const events = await res.json()
            const mapped = (Array.isArray(events) ? events : []).map((ev: any) => {
              // Pega a melhor odd média entre os bookmakers disponíveis
              let homeSum = 0, awaySum = 0, count = 0
              for (const bm of (ev.bookmakers || [])) {
                const h2h = bm.markets?.find((mk: any) => mk.key === 'h2h')
                if (!h2h) continue
                const home = h2h.outcomes?.find((o: any) => o.name === ev.home_team)
                const away = h2h.outcomes?.find((o: any) => o.name === ev.away_team)
                if (home && away) { homeSum += home.price; awaySum += away.price; count++ }
              }
              if (!count) return null
              return {
                home:    ev.home_team,
                away:    ev.away_team,
                homeOdd: Math.round((homeSum / count) * 100) / 100,
                awayOdd: Math.round((awaySum / count) * 100) / 100,
              }
            }).filter(Boolean)
            return [lid, mapped] as [string, any[]]
          } catch (e: any) {
            console.error(`[check-zebras] Odds API erro (${lid}):`, e.message)
            return [lid, []] as [string, any[]]
          }
        })
      )
      // Constrói o mapa de odds a partir dos resultados paralelos
      for (const [lid, odds] of oddsResults) {
        oddsMap[lid as string] = odds as any[]
      }
    }

    // ── 3. Cruza partidas FD com odds ────────────────────────────
    for (const match of todayMatches) {
      const lidOdds = oddsMap[match.lid] || []

      // Tenta encontrar a partida nas odds pelo nome do time (normalizado)
      const homeNorm = normName(match.homeTeam)
      const awayNorm = normName(match.awayTeam)
      const oddsEntry = lidOdds.find(o => {
        if (!o) return false
        const oHome = normName(o.home)
        const oAway = normName(o.away)
        const homeMatch = oHome.includes(homeNorm.slice(0, 8)) || homeNorm.includes(oHome.slice(0, 8))
        const awayMatch = oAway.includes(awayNorm.slice(0, 8)) || awayNorm.includes(oAway.slice(0, 8))
        return homeMatch && awayMatch
      })

      if (!oddsEntry) continue // sem odds = pula

      const { zi, favOdd, dogOdd, dogIsHome } = calcZI(oddsEntry.homeOdd, oddsEntry.awayOdd)
      if (zi < 3) continue // só zebras relevantes (ZI ≥ 3 de 10)

      const favTeam = dogIsHome ? match.awayTeam : match.homeTeam
      const dogTeam = dogIsHome ? match.homeTeam : match.awayTeam

      zebraMatches.push({
        lid:      match.lid,
        favTeam,
        dogTeam,
        favOdd,
        dogOdd,
        zi,
        matchId:  match.matchId,
        kickoff:  match.kickoff,
      })
    }

    if (!zebraMatches.length) {
      return new Response(JSON.stringify({ checked: true, alerts: 0, partidas: todayMatches.length }), {
        headers: { ...CORS, 'Content-Type': 'application/json' }
      })
    }

    // ── 4. Busca usuários com alertas ativos ─────────────────────
    const { data: alerts } = await sb.from('user_alerts')
      .select('user_id, league_id, min_zi, push_enabled, email_enabled')
      .eq('active', true)

    for (const alert of (alerts || [])) {
      const minZi = alert.min_zi ?? 4 // ZI mínimo padrão = 4 (escala 0-10)
      const relevant = zebraMatches.filter(r =>
        (!alert.league_id || r.lid === alert.league_id) &&
        r.zi >= minZi
      )
      if (!relevant.length) continue

      for (const z of relevant) {
        await sb.from('notifications').insert({
          user_id: alert.user_id,
          type:    'zebra_alert',
          title:   `🦓 ZEBRA — ${z.dogTeam} pode surpreender!`,
          body:    `ZI ${z.zi.toFixed(1)} · Odd ${z.dogOdd} · ${z.lid}`,
          data:    z,
          read:    false,
        })
        alertsSent++
      }
    }

    return new Response(
      JSON.stringify({ checked: true, alerts: alertsSent, zebras: zebraMatches.length, partidas: todayMatches.length }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    )

  } catch (e: any) {
    console.error('[check-zebras] Erro geral:', e.message)
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }
})
