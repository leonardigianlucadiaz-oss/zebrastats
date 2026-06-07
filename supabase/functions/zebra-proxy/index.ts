// ZebraStats — Edge Function proxy
// Mantém as chaves de API no servidor (nunca expostas no frontend)
// Deploy: Supabase Dashboard → Edge Functions → New Function → colar este código

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-zs-guest",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

// ── IDs das ligas ──────────────────────────────────────────────
const FD_IDS: Record<string, number> = {
  ENG: 2021, ESP: 2014, ITA: 2019, GER: 2002,
  FRA: 2015, BRA: 2013, POR: 2017, UCL: 2001,
  WC: 2000,  // Copa do Mundo FIFA
};
const APIF_IDS: Record<string, number> = {
  // Ligas de clubes
  ENG: 39,  ESP: 140, ITA: 135, GER: 78,
  FRA: 61,  BRA: 71,  POR: 94,  UCL: 2, HOL: 88,
  // Seleções nacionais
  WC:  1,   EUR: 4,   CPA: 9,   UNL: 5,
  SAQ: 29,  EUQ: 32,  AMI: 10,  CAN: 6,  GLD: 16,
};
const APIF_BASE = "https://v3.football.api-sports.io";
const SDB_IDS: Record<string, number> = {
  ENG: 4328, ESP: 4335, ITA: 4332, GER: 4331,
  FRA: 4334, BRA: 4351, POR: 4344, UCL: 4480, HOL: 4337,
};
// Chaves de esporte da The Odds API (soccer_*)
const ODDS_SPORTS: Record<string, string> = {
  ENG: "soccer_epl",
  ESP: "soccer_spain_la_liga",
  ITA: "soccer_italy_serie_a",
  GER: "soccer_germany_bundesliga",
  FRA: "soccer_france_ligue_one",
  BRA: "soccer_brazil_campeonato",
  POR: "soccer_portugal_primeira_liga",
  UCL: "soccer_uefa_champs_league",
  // Seleções nacionais
  WC:  "soccer_fifa_world_cup",
  EUR: "soccer_uefa_euros",
  CPA: "soccer_conmebol_copa_america",
};

// ── Helpers ────────────────────────────────────────────────────
// NOTA: Edge Functions são stateless — esta função faz fetch direto.
// O cache de longa duração (30 min / 60 min) vive no cliente (localStorage).
async function apiFetch(url: string, init?: RequestInit): Promise<unknown> {
  // Timeout de 8s para evitar que APIs lentas travem a Edge Function
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(8_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
  return r.json();
}

// ── Temporada dinâmica ──────────────────────────────────────────
// API-Football representa a temporada pelo ano de início:
//   "2025" = temporada 2025-26 (ligas europeias que começam em ago/set)
//   "2026" = temporada 2026 do Brasileirão (calendário corrido)
// Regra: se o mês corrente for >= julho → nova temporada europeia já começou.
//        se for < julho → ainda estamos no final da temporada anterior.
function defaultSeason(lid = "ENG"): string {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth() + 1; // 1-based
  if (lid === "BRA") return String(year);
  // Seleções nacionais — cada competição tem seu próprio ciclo
  if (lid === "WC")  return String(year);              // Copa do Mundo (2026)
  if (lid === "EUR") return month >= 6 && year < 2028 ? "2024" : String(year - (year % 4));
  if (lid === "CPA") return "2024";                    // Copa América 2024
  if (lid === "UNL") return month >= 9 ? String(year) : String(year - 1);
  if (lid === "SAQ") return month >= 7 ? String(year) : String(year - 1);
  if (lid === "EUQ") return String(year - 1);          // qualifiers UEFA encerraram em 2025
  if (lid === "AMI") return String(year);
  if (lid === "CAN") return "2025";                    // AFCON Jan-Fev 2025
  if (lid === "GLD") return "2025";                    // Gold Cup 2025
  return month >= 7 ? String(year) : String(year - 1);
}

// TheSportsDB usa formato "YYYY-YYYY" para ligas europeias
function defaultSdbSeason(): string {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth() + 1;
  return month >= 7 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

function ok(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ── Handler principal ──────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  // Fix 7.1: bloqueia bots que não enviam nenhum contexto de autenticação.
  // Permite: (1) usuários autenticados com JWT Bearer, (2) guests com header x-zs-guest: 1.
  // O frontend envia x-zs-guest: 1 para visitantes; o Supabase client envia Bearer para
  // usuários logados. Requisições sem nenhum dos dois são de bots/scrapers.
  //
  // LIMITAÇÃO: o header x-zs-guest: 1 é de fácil falsificação por qualquer cliente HTTP.
  // A próxima evolução desta proteção seria rate limiting por IP (ex: via Upstash Redis),
  // que permitiria bloquear abuso mesmo de clientes que conhecem o header.
  // Fix: sb_publishable_... não é JWT — o frontend envia só 'apikey', não 'Authorization Bearer'.
  // Aceita: (1) qualquer header Authorization presente, (2) header apikey (Supabase anon key),
  // (3) x-zs-guest: 1 para visitantes não autenticados.
  const authHeader   = req.headers.get("Authorization") || "";
  const apikeyHeader = req.headers.get("apikey") || "";
  const guestHeader  = req.headers.get("x-zs-guest") || "";
  const hasAuth = authHeader.length > 0 || apikeyHeader.length > 0 || guestHeader === "1";
  if (!hasAuth) {
    console.warn('[zebra-proxy] Request sem auth de origem desconhecida')
    return new Response(JSON.stringify({ error: 'Auth required' }), {
      status: 401, headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }

  const url    = new URL(req.url);
  const action = url.searchParams.get("action") ?? "";
  const lid    = (url.searchParams.get("lid") ?? "ENG").toUpperCase();

  try {

    // ── Health check ─────────────────────────────────────────────
    if (action === "ping") {
      return ok({
        ok: true,
        timestamp: new Date().toISOString(),
        fd:   !!Deno.env.get("FOOTBALL_DATA_KEY"),
        apif: !!Deno.env.get("APIF_KEY"),
        odds: !!Deno.env.get("ODDS_API_KEY"),
      });
    }

    // ════════════════════════════════════════════════════════════
    // ── FOOTBALL-DATA.ORG ────────────────────────────────════════
    // ════════════════════════════════════════════════════════════

    // ── Partidas da liga ─────────────────────────────────────────
    if (action === "matches") {
      const key = Deno.env.get("FOOTBALL_DATA_KEY");
      if (!key) return err("FOOTBALL_DATA_KEY não configurada", 503);
      const lid_id  = FD_IDS[lid];
      if (!lid_id) return err(`Liga desconhecida: ${lid}`, 400);
      const status   = url.searchParams.get("status")   ?? "FINISHED";
      const limit    = url.searchParams.get("limit")    ?? "20";
      const dateFrom = url.searchParams.get("dateFrom") ?? "";
      const dateTo   = url.searchParams.get("dateTo")   ?? "";
      let qs = `status=${status}&limit=${limit}`;
      if (dateFrom) qs += `&dateFrom=${dateFrom}`;
      if (dateTo)   qs += `&dateTo=${dateTo}`;
      const data = await apiFetch(
        `https://api.football-data.org/v4/competitions/${lid_id}/matches?${qs}`,
        { headers: { "X-Auth-Token": key } }
      );
      return ok(data);
    }

    // ── Tabela de classificação ──────────────────────────────────
    if (action === "standings") {
      const key = Deno.env.get("FOOTBALL_DATA_KEY");
      if (!key) return err("FOOTBALL_DATA_KEY não configurada", 503);
      const lid_id = FD_IDS[lid];
      if (!lid_id) return err(`Liga desconhecida: ${lid}`, 400);
      const data = await apiFetch(
        `https://api.football-data.org/v4/competitions/${lid_id}/standings`,
        { headers: { "X-Auth-Token": key } }
      );
      return ok(data);
    }

    // ── Artilharia / artilheiros da competição ───────────────────
    if (action === "fd-scorers") {
      const key = Deno.env.get("FOOTBALL_DATA_KEY");
      if (!key) return err("FOOTBALL_DATA_KEY não configurada", 503);
      const lid_id = FD_IDS[lid];
      if (!lid_id) return err(`Liga desconhecida: ${lid}`, 400);
      const limit = url.searchParams.get("limit") ?? "10";
      const data = await apiFetch(
        `https://api.football-data.org/v4/competitions/${lid_id}/scorers?limit=${limit}`,
        { headers: { "X-Auth-Token": key } }
      );
      return ok(data);
    }

    // ── Detalhes de um time (badge, nome curto, fundação etc.) ───
    if (action === "fd-team") {
      const key    = Deno.env.get("FOOTBALL_DATA_KEY");
      if (!key) return err("FOOTBALL_DATA_KEY não configurada", 503);
      const teamId = url.searchParams.get("teamId") ?? "";
      if (!teamId) return err("Parâmetro 'teamId' obrigatório", 400);
      const data = await apiFetch(
        `https://api.football-data.org/v4/teams/${teamId}`,
        { headers: { "X-Auth-Token": key } }
      );
      return ok(data);
    }

    // ════════════════════════════════════════════════════════════
    // ── THE ODDS API ─────────────────────────────────────────────
    // ════════════════════════════════════════════════════════════

    // ── Odds pré-jogo (bookmakers reais) ─────────────────────────
    if (action === "odds") {
      const key = Deno.env.get("ODDS_API_KEY");
      if (!key) return err("ODDS_API_KEY não configurada — odds serão estimadas", 503);
      const sport = ODDS_SPORTS[lid];
      if (!sport) return err(`Liga sem odds disponível: ${lid}`, 400);
      const data = await apiFetch(
        `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${key}&regions=eu&markets=h2h&oddsFormat=decimal`
      );
      return ok(data);
    }

    // ── Scores recentes / resultados ─────────────────────────────
    if (action === "odds-scores") {
      const key = Deno.env.get("ODDS_API_KEY");
      if (!key) return err("ODDS_API_KEY não configurada", 503);
      const sport = ODDS_SPORTS[lid];
      if (!sport) return err(`Liga sem odds disponível: ${lid}`, 400);
      const days = url.searchParams.get("days") ?? "3";
      const data = await apiFetch(
        `https://api.the-odds-api.com/v4/sports/${sport}/scores/?apiKey=${key}&daysFrom=${days}`
      );
      return ok(data);
    }

    // ════════════════════════════════════════════════════════════
    // ── THESPORTSDB ──────────────────────────────────────────────
    // ════════════════════════════════════════════════════════════

    // ── Buscar time por nome ─────────────────────────────────────
    if (action === "sdb-team") {
      const key  = Deno.env.get("THESPORTSDB_KEY") ?? "123";
      const name = url.searchParams.get("name") ?? "";
      if (!name) return err("Parâmetro 'name' obrigatório", 400);
      const data = await apiFetch(
        `https://www.thesportsdb.com/api/v1/json/${key}/searchteams.php?t=${encodeURIComponent(name)}`
      );
      return ok(data);
    }

    // ── Tabela da liga ───────────────────────────────────────────
    if (action === "sdb-table") {
      const key    = Deno.env.get("THESPORTSDB_KEY") ?? "123";
      const sdb_id = SDB_IDS[lid];
      if (!sdb_id) return err(`Liga desconhecida: ${lid}`, 400);
      const season = url.searchParams.get("season") ?? defaultSdbSeason();
      const data = await apiFetch(
        `https://www.thesportsdb.com/api/v1/json/${key}/lookuptable.php?l=${sdb_id}&s=${season}`
      );
      return ok(data);
    }

    // ── Últimos eventos (resultados recentes) de um time ────────
    if (action === "sdb-events-last") {
      const key    = Deno.env.get("THESPORTSDB_KEY") ?? "123";
      const teamId = url.searchParams.get("teamId") ?? "";
      if (!teamId) return err("Parâmetro 'teamId' obrigatório", 400);
      const data = await apiFetch(
        `https://www.thesportsdb.com/api/v1/json/${key}/eventslast.php?id=${teamId}`
      );
      return ok(data);
    }

    // ── Próximos eventos de um time ──────────────────────────────
    if (action === "sdb-next-events") {
      const key    = Deno.env.get("THESPORTSDB_KEY") ?? "123";
      const teamId = url.searchParams.get("teamId") ?? "";
      if (!teamId) return err("Parâmetro 'teamId' obrigatório", 400);
      const data = await apiFetch(
        `https://www.thesportsdb.com/api/v1/json/${key}/eventsnext.php?id=${teamId}`
      );
      return ok(data);
    }

    // ── Todos os times da liga ───────────────────────────────────
    if (action === "sdb-teams") {
      const key    = Deno.env.get("THESPORTSDB_KEY") ?? "123";
      const sdb_id = SDB_IDS[lid];
      if (!sdb_id) return err(`Liga desconhecida: ${lid}`, 400);
      const data = await apiFetch(
        `https://www.thesportsdb.com/api/v1/json/${key}/lookup_all_teams.php?id=${sdb_id}`
      );
      return ok(data);
    }

    // ── Jogadores de um time (nome, foto, posição, nº camisa) ───
    if (action === "sdb-players") {
      const key    = Deno.env.get("THESPORTSDB_KEY") ?? "123";
      const teamId = url.searchParams.get("teamId") ?? "";
      if (!teamId) return err("Parâmetro 'teamId' obrigatório", 400);
      const data = await apiFetch(
        `https://www.thesportsdb.com/api/v1/json/${key}/lookup_all_players.php?id=${teamId}`
      );
      return ok(data);
    }

    // ── Detalhes de um jogador por ID ────────────────────────────
    if (action === "sdb-player") {
      const key      = Deno.env.get("THESPORTSDB_KEY") ?? "123";
      const playerId = url.searchParams.get("playerId") ?? "";
      if (!playerId) return err("Parâmetro 'playerId' obrigatório", 400);
      const data = await apiFetch(
        `https://www.thesportsdb.com/api/v1/json/${key}/lookupplayer.php?id=${playerId}`
      );
      return ok(data);
    }

    // ════════════════════════════════════════════════════════════
    // ── API-FOOTBALL (v3.football.api-sports.io) ─────────────────
    // ════════════════════════════════════════════════════════════

    // ── Partidas da liga (por temporada, últimas, próximas) ──────
    if (action === "apif-fixtures") {
      const key = Deno.env.get("APIF_KEY");
      if (!key) return err("APIF_KEY não configurada", 503);
      const league = APIF_IDS[lid];
      if (!league) return err(`Liga desconhecida: ${lid}`, 400);
      const season = url.searchParams.get("season") ?? defaultSeason(lid);
      const last   = url.searchParams.get("last");
      const next   = url.searchParams.get("next");
      const date   = url.searchParams.get("date");
      const status = url.searchParams.get("status");
      // Fix: quando next ou last são fornecidos, omite season para buscar
      // as próximas/últimas partidas independentemente da temporada ativa.
      // Incluir season=2024 em maio/2026 retornaria 0 resultados pois a
      // temporada 2024-25 já terminou.
      let qs: string;
      if (next) {
        qs = `league=${league}&next=${next}`;
      } else if (last) {
        qs = `league=${league}&last=${last}`;
      } else {
        qs = `league=${league}&season=${season}`;
        if (date)   qs += `&date=${date}`;
        if (status) qs += `&status=${status}`;
      }
      const data = await apiFetch(`${APIF_BASE}/fixtures?${qs}`,
        { headers: { "x-apisports-key": key } });
      return ok(data);
    }

    // ── Partidas ao vivo ─────────────────────────────────────────
    if (action === "apif-live") {
      const key = Deno.env.get("APIF_KEY");
      if (!key) return err("APIF_KEY não configurada", 503);
      const league = APIF_IDS[lid];
      // Se lid=ALL retorna todos ao vivo; caso contrário filtra pela liga
      const qs = league && lid !== "ALL"
        ? `live=all&league=${league}`
        : `live=all`;
      const data = await apiFetch(`${APIF_BASE}/fixtures?${qs}`,
        { headers: { "x-apisports-key": key } });
      return ok(data);
    }

    // ── Estatísticas da partida (xG, chutes, posse) ──────────────
    if (action === "apif-fixture-stats") {
      const key = Deno.env.get("APIF_KEY");
      if (!key) return err("APIF_KEY não configurada", 503);
      const fixtureId = url.searchParams.get("fixtureId") ?? "";
      if (!fixtureId) return err("Parâmetro 'fixtureId' obrigatório", 400);
      const data = await apiFetch(`${APIF_BASE}/fixtures/statistics?fixture=${fixtureId}`,
        { headers: { "x-apisports-key": key } });
      return ok(data);
    }

    // ── Eventos da partida (gols, cartões, substituições) ────────
    if (action === "apif-fixture-events") {
      const key = Deno.env.get("APIF_KEY");
      if (!key) return err("APIF_KEY não configurada", 503);
      const fixtureId = url.searchParams.get("fixtureId") ?? "";
      if (!fixtureId) return err("Parâmetro 'fixtureId' obrigatório", 400);
      const data = await apiFetch(`${APIF_BASE}/fixtures/events?fixture=${fixtureId}`,
        { headers: { "x-apisports-key": key } });
      return ok(data);
    }

    // ── Escalações confirmadas ───────────────────────────────────
    if (action === "apif-fixture-lineups") {
      const key = Deno.env.get("APIF_KEY");
      if (!key) return err("APIF_KEY não configurada", 503);
      const fixtureId = url.searchParams.get("fixtureId") ?? "";
      if (!fixtureId) return err("Parâmetro 'fixtureId' obrigatório", 400);
      const data = await apiFetch(`${APIF_BASE}/fixtures/lineups?fixture=${fixtureId}`,
        { headers: { "x-apisports-key": key } });
      return ok(data);
    }

    // ── Confronto direto (H2H) ───────────────────────────────────
    if (action === "apif-h2h") {
      const key = Deno.env.get("APIF_KEY");
      if (!key) return err("APIF_KEY não configurada", 503);
      const h2h  = url.searchParams.get("h2h") ?? "";
      if (!h2h) return err("Parâmetro 'h2h' obrigatório (ex: 33-34)", 400);
      const last = url.searchParams.get("last") ?? "10";
      const data = await apiFetch(`${APIF_BASE}/fixtures/headtohead?h2h=${h2h}&last=${last}`,
        { headers: { "x-apisports-key": key } });
      return ok(data);
    }

    // ── Buscar time por nome ─────────────────────────────────────
    if (action === "apif-team-search") {
      const key  = Deno.env.get("APIF_KEY");
      if (!key) return err("APIF_KEY não configurada", 503);
      const name = url.searchParams.get("name") ?? "";
      if (!name) return err("Parâmetro 'name' obrigatório", 400);
      const data = await apiFetch(`${APIF_BASE}/teams?name=${encodeURIComponent(name)}`,
        { headers: { "x-apisports-key": key } });
      return ok(data);
    }

    // ── Estatísticas do time na temporada ────────────────────────
    if (action === "apif-team-stats") {
      const key = Deno.env.get("APIF_KEY");
      if (!key) return err("APIF_KEY não configurada", 503);
      const teamId = url.searchParams.get("teamId") ?? "";
      if (!teamId) return err("Parâmetro 'teamId' obrigatório", 400);
      const league = APIF_IDS[lid];
      if (!league) return err(`Liga desconhecida: ${lid}`, 400);
      const season = url.searchParams.get("season") ?? defaultSeason(lid);
      const data = await apiFetch(
        `${APIF_BASE}/teams/statistics?team=${teamId}&league=${league}&season=${season}`,
        { headers: { "x-apisports-key": key } });
      return ok(data);
    }

    // ── Tabela de classificação da API-Football ──────────────────
    // (mais rica que FD: forma recente, gols casa/fora, sequências)
    if (action === "apif-standings") {
      const key = Deno.env.get("APIF_KEY");
      if (!key) return err("APIF_KEY não configurada", 503);
      const league = APIF_IDS[lid];
      if (!league) return err(`Liga desconhecida: ${lid}`, 400);
      const season = url.searchParams.get("season") ?? defaultSeason(lid);
      const data = await apiFetch(
        `${APIF_BASE}/standings?league=${league}&season=${season}`,
        { headers: { "x-apisports-key": key } });
      return ok(data);
    }

    // ── Artilheiros da liga ──────────────────────────────────────
    if (action === "apif-top-scorers") {
      const key = Deno.env.get("APIF_KEY");
      if (!key) return err("APIF_KEY não configurada", 503);
      const league = APIF_IDS[lid];
      if (!league) return err(`Liga desconhecida: ${lid}`, 400);
      const season = url.searchParams.get("season") ?? defaultSeason(lid);
      const data = await apiFetch(
        `${APIF_BASE}/players/topscorers?league=${league}&season=${season}`,
        { headers: { "x-apisports-key": key } });
      return ok(data);
    }

    // ── Elenco completo de um time (foto, nº camisa, posição) ────
    // Retorna todos os jogadores do time com foto e número de camisa
    if (action === "apif-squad") {
      const key    = Deno.env.get("APIF_KEY");
      if (!key) return err("APIF_KEY não configurada", 503);
      const teamId = url.searchParams.get("teamId") ?? "";
      if (!teamId) return err("Parâmetro 'teamId' obrigatório", 400);
      const data = await apiFetch(
        `${APIF_BASE}/players/squads?team=${teamId}`,
        { headers: { "x-apisports-key": key } });
      return ok(data);
    }

    // ── Lesionados / suspensos da liga ou partida ────────────────
    if (action === "apif-injuries") {
      const key = Deno.env.get("APIF_KEY");
      if (!key) return err("APIF_KEY não configurada", 503);
      const fixtureId = url.searchParams.get("fixtureId");
      const teamId    = url.searchParams.get("teamId");
      const league    = APIF_IDS[lid];
      const season    = url.searchParams.get("season") ?? defaultSeason(lid);
      let qs = "";
      if (fixtureId) {
        qs = `fixture=${fixtureId}`;
      } else if (teamId) {
        qs = `team=${teamId}&league=${league}&season=${season}`;
      } else if (league) {
        qs = `league=${league}&season=${season}`;
      } else {
        return err("Forneça 'fixtureId', 'teamId' ou 'lid'", 400);
      }
      const data = await apiFetch(`${APIF_BASE}/injuries?${qs}`,
        { headers: { "x-apisports-key": key } });
      return ok(data);
    }

    // ── Previsão de resultado ────────────────────────────────────
    if (action === "apif-predictions") {
      const key = Deno.env.get("APIF_KEY");
      if (!key) return err("APIF_KEY não configurada", 503);
      const fixtureId = url.searchParams.get("fixtureId") ?? "";
      if (!fixtureId) return err("Parâmetro 'fixtureId' obrigatório", 400);
      const data = await apiFetch(`${APIF_BASE}/predictions?fixture=${fixtureId}`,
        { headers: { "x-apisports-key": key } });
      return ok(data);
    }

    // ── Top assistentes da liga ──────────────────────────────────
    if (action === "apif-top-assists") {
      const key = Deno.env.get("APIF_KEY");
      if (!key) return err("APIF_KEY não configurada", 503);
      const league = APIF_IDS[lid];
      if (!league) return err(`Liga desconhecida: ${lid}`, 400);
      const season = url.searchParams.get("season") ?? defaultSeason(lid);
      const data = await apiFetch(
        `${APIF_BASE}/players/topassists?league=${league}&season=${season}`,
        { headers: { "x-apisports-key": key } });
      return ok(data);
    }

    // ── Top cartões amarelos ─────────────────────────────────────
    if (action === "apif-top-yellow") {
      const key = Deno.env.get("APIF_KEY");
      if (!key) return err("APIF_KEY não configurada", 503);
      const league = APIF_IDS[lid];
      if (!league) return err(`Liga desconhecida: ${lid}`, 400);
      const season = url.searchParams.get("season") ?? defaultSeason(lid);
      const data = await apiFetch(
        `${APIF_BASE}/players/topyellowcards?league=${league}&season=${season}`,
        { headers: { "x-apisports-key": key } });
      return ok(data);
    }

    // ── Top cartões vermelhos ────────────────────────────────────
    if (action === "apif-top-red") {
      const key = Deno.env.get("APIF_KEY");
      if (!key) return err("APIF_KEY não configurada", 503);
      const league = APIF_IDS[lid];
      if (!league) return err(`Liga desconhecida: ${lid}`, 400);
      const season = url.searchParams.get("season") ?? defaultSeason(lid);
      const data = await apiFetch(
        `${APIF_BASE}/players/topredcards?league=${league}&season=${season}`,
        { headers: { "x-apisports-key": key } });
      return ok(data);
    }

    // ── Estatísticas detalhadas de um jogador ────────────────────
    if (action === "apif-player-stats") {
      const key = Deno.env.get("APIF_KEY");
      if (!key) return err("APIF_KEY não configurada", 503);
      const playerId = url.searchParams.get("playerId") ?? "";
      if (!playerId) return err("Parâmetro 'playerId' obrigatório", 400);
      const season = url.searchParams.get("season") ?? defaultSeason(lid);
      const data = await apiFetch(
        `${APIF_BASE}/players?id=${playerId}&season=${season}`,
        { headers: { "x-apisports-key": key } });
      return ok(data);
    }

    // ── Transferências de um time ────────────────────────────────
    if (action === "apif-transfers") {
      const key = Deno.env.get("APIF_KEY");
      if (!key) return err("APIF_KEY não configurada", 503);
      const teamId = url.searchParams.get("teamId") ?? "";
      if (!teamId) return err("Parâmetro 'teamId' obrigatório", 400);
      const data = await apiFetch(
        `${APIF_BASE}/transfers?team=${teamId}`,
        { headers: { "x-apisports-key": key } });
      return ok(data);
    }

    // ── Treinador de um time ─────────────────────────────────────
    if (action === "apif-coach") {
      const key = Deno.env.get("APIF_KEY");
      if (!key) return err("APIF_KEY não configurada", 503);
      const teamId = url.searchParams.get("teamId") ?? "";
      if (!teamId) return err("Parâmetro 'teamId' obrigatório", 400);
      const data = await apiFetch(
        `${APIF_BASE}/coachs?team=${teamId}`,
        { headers: { "x-apisports-key": key } });
      return ok(data);
    }

    // ── Rodadas da liga na temporada ─────────────────────────────
    if (action === "apif-rounds") {
      const key = Deno.env.get("APIF_KEY");
      if (!key) return err("APIF_KEY não configurada", 503);
      const league = APIF_IDS[lid];
      if (!league) return err(`Liga desconhecida: ${lid}`, 400);
      const season = url.searchParams.get("season") ?? defaultSeason(lid);
      const data = await apiFetch(
        `${APIF_BASE}/fixtures/rounds?league=${league}&season=${season}`,
        { headers: { "x-apisports-key": key } });
      return ok(data);
    }

    return err(
      `Ação desconhecida: '${action}'. Ações disponíveis: ` +
      `ping, matches, standings, fd-scorers, fd-team, ` +
      `odds, odds-scores, ` +
      `sdb-team, sdb-table, sdb-events-last, sdb-next-events, sdb-teams, sdb-players, sdb-player, ` +
      `apif-fixtures, apif-live, apif-fixture-stats, apif-fixture-events, apif-fixture-lineups, ` +
      `apif-h2h, apif-team-search, apif-team-stats, apif-standings, apif-top-scorers, ` +
      `apif-squad, apif-injuries, apif-predictions, ` +
      `apif-top-assists, apif-top-yellow, apif-top-red, apif-player-stats, ` +
      `apif-transfers, apif-coach, apif-rounds`,
      400
    );

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[zebra-proxy] erro:", msg);
    return err(msg, 500);
  }
});
