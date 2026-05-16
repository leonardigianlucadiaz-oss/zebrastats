// ZebraStats — Edge Function proxy
// Mantém as chaves de API no servidor (nunca expostas no frontend)
// Deploy: Supabase Dashboard → Edge Functions → New Function → colar este código

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

// ── IDs das ligas ──────────────────────────────────────────────
const FD_IDS: Record<string, number> = {
  ENG: 2021, ESP: 2014, ITA: 2019, GER: 2002,
  FRA: 2015, BRA: 2013, POR: 2017, UCL: 2001,
};
const SDB_IDS: Record<string, number> = {
  ENG: 4328, ESP: 4335, ITA: 4332, GER: 4331,
  FRA: 4334, BRA: 4351, POR: 4344, UCL: 4480, HOL: 4337,
};
const ODDS_SPORTS: Record<string, string> = {
  ENG: "soccer_epl",
  ESP: "soccer_spain_la_liga",
  ITA: "soccer_italy_serie_a",
  GER: "soccer_germany_bundesliga",
  FRA: "soccer_france_ligue_one",
  BRA: "soccer_brazil_campeonato",
  POR: "soccer_portugal_primeira_liga",
};

// ── Cache simples em memória (por invocação) ───────────────────
const _cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

async function fetchCached(url: string, init?: RequestInit): Promise<unknown> {
  const hit = _cache.get(url);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.data;
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
  const data = await r.json();
  _cache.set(url, { data, ts: Date.now() });
  return data;
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

  const url    = new URL(req.url);
  const action = url.searchParams.get("action") ?? "";
  const lid    = (url.searchParams.get("lid") ?? "ENG").toUpperCase();

  try {
    // ── Football-Data.org: partidas ──────────────────────────
    if (action === "matches") {
      const key = Deno.env.get("FOOTBALL_DATA_KEY");
      if (!key) return err("FOOTBALL_DATA_KEY não configurada", 503);
      const lid_id = FD_IDS[lid];
      if (!lid_id) return err(`Liga desconhecida: ${lid}`, 400);
      const status = url.searchParams.get("status") ?? "FINISHED";
      const limit  = url.searchParams.get("limit")  ?? "20";
      const data = await fetchCached(
        `https://api.football-data.org/v4/competitions/${lid_id}/matches?status=${status}&limit=${limit}`,
        { headers: { "X-Auth-Token": key } }
      );
      return ok(data);
    }

    // ── Football-Data.org: tabela de classificação ───────────
    if (action === "standings") {
      const key = Deno.env.get("FOOTBALL_DATA_KEY");
      if (!key) return err("FOOTBALL_DATA_KEY não configurada", 503);
      const lid_id = FD_IDS[lid];
      if (!lid_id) return err(`Liga desconhecida: ${lid}`, 400);
      const data = await fetchCached(
        `https://api.football-data.org/v4/competitions/${lid_id}/standings`,
        { headers: { "X-Auth-Token": key } }
      );
      return ok(data);
    }

    // ── The Odds API: odds pré-jogo (bookmakers reais) ──────
    if (action === "odds") {
      const key = Deno.env.get("ODDS_API_KEY");
      if (!key) return err("ODDS_API_KEY não configurada — odds serão estimadas", 503);
      const sport = ODDS_SPORTS[lid];
      if (!sport) return err(`Liga sem odds disponível: ${lid}`, 400);
      const data = await fetchCached(
        `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${key}&regions=eu&markets=h2h&oddsFormat=decimal`
      );
      return ok(data);
    }

    // ── The Odds API: scores recentes (resultados) ───────────
    if (action === "odds-scores") {
      const key = Deno.env.get("ODDS_API_KEY");
      if (!key) return err("ODDS_API_KEY não configurada", 503);
      const sport = ODDS_SPORTS[lid];
      if (!sport) return err(`Liga sem odds disponível: ${lid}`, 400);
      const days = url.searchParams.get("days") ?? "3";
      const data = await fetchCached(
        `https://api.the-odds-api.com/v4/sports/${sport}/scores/?apiKey=${key}&daysFrom=${days}`
      );
      return ok(data);
    }

    // ── TheSportsDB: buscar time por nome ────────────────────
    if (action === "sdb-team") {
      const key  = Deno.env.get("THESPORTSDB_KEY") ?? "123";
      const name = url.searchParams.get("name") ?? "";
      if (!name) return err("Parâmetro 'name' obrigatório", 400);
      const data = await fetchCached(
        `https://www.thesportsdb.com/api/v1/json/${key}/searchteams.php?t=${encodeURIComponent(name)}`
      );
      return ok(data);
    }

    // ── TheSportsDB: tabela da liga ──────────────────────────
    if (action === "sdb-table") {
      const key    = Deno.env.get("THESPORTSDB_KEY") ?? "123";
      const sdb_id = SDB_IDS[lid];
      if (!sdb_id) return err(`Liga desconhecida: ${lid}`, 400);
      const season = url.searchParams.get("season") ?? "2024-2025";
      const data = await fetchCached(
        `https://www.thesportsdb.com/api/v1/json/${key}/lookuptable.php?l=${sdb_id}&s=${season}`
      );
      return ok(data);
    }

    // ── TheSportsDB: últimos eventos do time ─────────────────
    if (action === "sdb-events-last") {
      const key    = Deno.env.get("THESPORTSDB_KEY") ?? "123";
      const teamId = url.searchParams.get("teamId") ?? "";
      if (!teamId) return err("Parâmetro 'teamId' obrigatório", 400);
      const data = await fetchCached(
        `https://www.thesportsdb.com/api/v1/json/${key}/eventslast.php?id=${teamId}`
      );
      return ok(data);
    }

    // ── TheSportsDB: todos os times da liga ──────────────────
    if (action === "sdb-teams") {
      const key    = Deno.env.get("THESPORTSDB_KEY") ?? "123";
      const sdb_id = SDB_IDS[lid];
      if (!sdb_id) return err(`Liga desconhecida: ${lid}`, 400);
      const data = await fetchCached(
        `https://www.thesportsdb.com/api/v1/json/${key}/lookup_all_teams.php?id=${sdb_id}`
      );
      return ok(data);
    }

    // ── TheSportsDB: jogadores do time ───────────────────────
    if (action === "sdb-players") {
      const key    = Deno.env.get("THESPORTSDB_KEY") ?? "123";
      const teamId = url.searchParams.get("teamId") ?? "";
      if (!teamId) return err("Parâmetro 'teamId' obrigatório", 400);
      const data = await fetchCached(
        `https://www.thesportsdb.com/api/v1/json/${key}/lookup_all_players.php?id=${teamId}`
      );
      return ok(data);
    }

    return err(`Ação desconhecida: '${action}'. Use: matches, standings, odds, odds-scores, sdb-team, sdb-table, sdb-events-last, sdb-teams, sdb-players`, 400);

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[zebra-proxy] erro:", msg);
    return err(msg, 500);
  }
});
