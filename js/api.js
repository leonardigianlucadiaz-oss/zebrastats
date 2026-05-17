/* ZebraStats — API Module v1.0
 * ─────────────────────────────────────────────────────────────────
 * Fontes:
 *   Football-Data.org  — standings, matches, scorers   (requer chave)
 *   TheSportsDB        — logos, tabelas, info de times (chave pública "123")
 *   RapidAPI           — scores ao vivo + odds         (requer chave)
 *
 * Uso:
 *   ZebraAPI.sportsDb.getLeagueTable('ENG')    → sem chave
 *   ZebraAPI.footballData.getMatches('ENG')    → requer chave no Perfil
 *   ZebraAPI.rapidApi.getLiveMatches()         → requer chave no Perfil
 *   ZebraAPI.zebra.fromPositions(18, 2)        → calcula Zebra Index
 * ─────────────────────────────────────────────────────────────────
 */

const ZebraAPI = (() => {

  /* ── CACHE sessionStorage (TTL 5 min) ─────────────────────── */
  const _cache = {
    get(k) {
      try {
        const raw = sessionStorage.getItem(`zs_${k}`);
        if (!raw) return null;
        const { ts, d } = JSON.parse(raw);
        if (Date.now() - ts > 300_000) { sessionStorage.removeItem(`zs_${k}`); return null; }
        return d;
      } catch { return null; }
    },
    set(k, d) {
      try { sessionStorage.setItem(`zs_${k}`, JSON.stringify({ ts: Date.now(), d })); } catch {}
    },
  };

  /* ── PROXY HELPER (Supabase Edge Function) ──────────────────── */
  // Todas as chamadas passam pelo proxy quando disponível.
  // As chaves das APIs externas ficam nos Secrets do Supabase — nunca no frontend.
  const _proxy = {
    base() {
      return (typeof ZEBRA_CONFIG !== 'undefined' && ZEBRA_CONFIG.proxyEnabled)
        ? ZEBRA_CONFIG.PROXY_BASE : null;
    },
    async fetch(action, params = {}) {
      const base = this.base();
      if (!base) return null;
      const qs = new URLSearchParams({ action, ...params }).toString();
      const ck = `proxy_${action}_${qs}`;
      const hit = _cache.get(ck);
      if (hit) return hit;
      try {
        const anon = (typeof ZEBRA_CONFIG !== 'undefined') ? ZEBRA_CONFIG.SUPABASE_ANON : '';
        const r = await fetch(`${base}?${qs}`, {
          headers: {
            'apikey': anon,
            'Authorization': `Bearer ${anon}`,
          }
        });
        if (!r.ok) { console.warn(`[Proxy] ${r.status} — ${action}`, params); return null; }
        const data = await r.json();
        if (data?.error) { console.warn(`[Proxy] erro da função: ${data.error}`); return null; }
        _cache.set(ck, data);
        return data;
      } catch(e) { console.warn('[Proxy] rede:', e.message); return null; }
    },
  };

  /* ── FOOTBALL-DATA.ORG ──────────────────────────────────────── */
  const FD = {
    BASE : 'https://api.football-data.org/v4',
    COMPS: { BRA:'BSA', ENG:'PL', ESP:'PD', ITA:'SA', GER:'BL1', FRA:'FL1', UCL:'CL', POR:'PPL' },
    SEASON(lid) { return lid === 'BRA' ? '2025' : '2024'; },

    key() {
      return (typeof ZEBRA_CONFIG !== 'undefined' ? ZEBRA_CONFIG.FOOTBALL_DATA_KEY : '') || '';
    },

    // Tenta proxy primeiro; fallback para chamada direta com chave local
    async _fetch(path, lid) {
      const ck = `fd_${path}`;
      const hit = _cache.get(ck); if (hit) return hit;

      // 1. Proxy Supabase (chave no servidor)
      if (_proxy.base() && lid) {
        const action = path.includes('/standings') ? 'standings'
                     : path.includes('/matches')   ? 'matches'
                     : null;
        if (action) {
          const params = { lid };
          if (action === 'matches') {
            const status = path.match(/status=([^&]+)/)?.[1];
            const limit  = path.match(/limit=(\d+)/)?.[1];
            if (status) params.status = status;
            if (limit)  params.limit  = limit;
          }
          const data = await _proxy.fetch(action, params);
          if (data) { _cache.set(ck, data); return data; }
        }
      }

      // 2. Fallback: chamada direta com chave local
      const k = this.key(); if (!k) return null;
      try {
        const sep = path.includes('?') ? '&' : '?';
        const r = await fetch(`${this.BASE}${path}${sep}X-Auth-Token=${k}`);
        if (!r.ok) { console.warn(`[FD] ${r.status} — ${path}`); return null; }
        const data = await r.json();
        _cache.set(ck, data);
        return data;
      } catch(e) { console.warn('[FD] Erro de rede:', e.message); return null; }
    },

    async getStandings(lid) {
      const c = this.COMPS[lid]; if (!c) return null;
      return this._fetch(`/competitions/${c}/standings?season=${this.SEASON(lid)}`, lid);
    },
    async getMatches(lid, status, limit = 8) {
      const c = this.COMPS[lid]; if (!c) return null;
      const qs = [`season=${this.SEASON(lid)}`, `limit=${limit}`];
      if (status) qs.push(`status=${status}`);
      return this._fetch(`/competitions/${c}/matches?${qs.join('&')}`, lid);
    },
    async getScorers(lid, limit = 10) {
      const c = this.COMPS[lid]; if (!c) return null;
      return this._fetch(`/competitions/${c}/scorers?season=${this.SEASON(lid)}&limit=${limit}`, lid);
    },
    async getMatch(id) { return this._fetch(`/matches/${id}`, null); },
  };

  /* ── THESPORTSDB ────────────────────────────────────────────── */
  const SDB = {
    BASE    : 'https://www.thesportsdb.com/api/v1/json',
    LEAGUES : { BRA:4351, ENG:4328, ESP:4335, ITA:4332, GER:4331, FRA:4334, POR:4344, UCL:4480, HOL:4337, NED:4337, ARG:4406, MLS:4346, MEX:4350, UEL:4481 },
    SEASONS : { BRA:'2025', ENG:'2024-2025', ESP:'2024-2025', ITA:'2024-2025', GER:'2024-2025', FRA:'2024-2025' },

    key() {
      return (typeof ZEBRA_CONFIG !== 'undefined' ? ZEBRA_CONFIG.THESPORTSDB_KEY : '') || '123';
    },

    async _fetch(ep, proxyAction, proxyParams) {
      const ck = `sdb_${ep}`;
      const hit = _cache.get(ck); if (hit) return hit;

      // 1. Proxy Supabase
      if (proxyAction && _proxy.base()) {
        const data = await _proxy.fetch(proxyAction, proxyParams || {});
        if (data) { _cache.set(ck, data); return data; }
      }

      // 2. Direto (chave pública "123" — sem segredo)
      try {
        const r = await fetch(`${this.BASE}/${this.key()}/${ep}`);
        if (!r.ok) { console.warn(`[SDB] ${r.status} — ${ep}`); return null; }
        const data = await r.json();
        _cache.set(ck, data);
        return data;
      } catch(e) { console.warn('[SDB] Erro de rede:', e.message); return null; }
    },

    async getLeagueInfo(lid) {
      const id = this.LEAGUES[lid]; if (!id) return null;
      return this._fetch(`lookupleague.php?id=${id}`);
    },
    async getLeagueTable(lid) {
      const id = this.LEAGUES[lid]; if (!id) return null;
      const s  = this.SEASONS[lid] || '2024-2025';
      return this._fetch(`lookuptable.php?l=${id}&s=${s}`, 'sdb-table', { lid, season: s });
    },
    async getAllTeams(lid) {
      const id = this.LEAGUES[lid]; if (!id) return null;
      return this._fetch(`lookup_all_teams.php?id=${id}`, 'sdb-teams', { lid });
    },
    async searchTeam(name) {
      return this._fetch(`searchteams.php?t=${encodeURIComponent(name)}`, 'sdb-team', { name });
    },
    async lookupTeam(id) {
      return this._fetch(`lookupteam.php?id=${id}`);
    },
    async getTeamLastEvents(teamId) {
      return this._fetch(`eventslast.php?id=${teamId}`, 'sdb-events-last', { teamId });
    },
    async getTeamNextEvents(teamId) {
      return this._fetch(`eventsnext.php?id=${teamId}`);
    },
    async getSquad(teamId) {
      // Try proxy first
      const proxyData = await _proxy.fetch('sdb-players', { teamId });
      if (proxyData?.player) return proxyData.player;
      // Fallback direct (key 123 is public)
      try {
        const r = await fetch(`${this.BASE}/123/lookup_all_players.php?id=${teamId}`);
        if (r.ok) { const d = await r.json(); return d?.player || []; }
      } catch {}
      return [];
    },
  };

  /* ── RAPIDAPI ───────────────────────────────────────────────── */
  const RAPID = {
    BASE : 'https://free-api-live-football-data.p.rapidapi.com',
    HOST : 'free-api-live-football-data.p.rapidapi.com',

    key() {
      return (typeof ZEBRA_CONFIG !== 'undefined' ? ZEBRA_CONFIG.RAPIDAPI_KEY : '') || '';
    },

    async _fetch(path) {
      const k = this.key(); if (!k) return null;
      const hit = _cache.get(`rapid_${path}`);
      if (hit) return hit;
      try {
        const r = await fetch(`${this.BASE}${path}`, {
          headers: { 'x-rapidapi-key': k, 'x-rapidapi-host': this.HOST },
        });
        if (!r.ok) { console.warn(`[RapidAPI] ${r.status} — ${path}`); return null; }
        const data = await r.json();
        _cache.set(`rapid_${path}`, data);
        return data;
      } catch (e) { console.warn('[RapidAPI] Erro de rede:', e.message); return null; }
    },

    async getLiveMatches()       { return this._fetch('/football-get-all-live-matches'); },
    async getMatchOdds(matchId)  { return this._fetch(`/football-get-match-odds?matchid=${matchId}`); },
  };

  /* ── THE ODDS API (opcional — 500 req/mês grátis) ──────────── */
  // https://the-odds-api.com  → cadastro grátis, chave em Perfil → Configurar APIs
  const ODDS = {
    BASE   : 'https://api.the-odds-api.com/v4',
    SPORTS : {
      ENG:'soccer_epl', ESP:'soccer_spain_la_liga', ITA:'soccer_italy_serie_a',
      GER:'soccer_germany_bundesliga', FRA:'soccer_france_ligue_one',
      BRA:'soccer_brazil_campeonato', POR:'soccer_portugal_primeira_liga',
    },

    key() { return (typeof ZEBRA_CONFIG !== 'undefined' ? ZEBRA_CONFIG.ODDS_API_KEY : '') || ''; },

    async getRecentScores(lid, daysFrom = 3) {
      const k = this.key(); if (!k) return [];
      const sport = this.SPORTS[lid]; if (!sport) return [];
      const ck = `odds_${lid}_${daysFrom}`;
      const hit = _cache.get(ck); if (hit) return hit;
      try {
        const url = `${this.BASE}/sports/${sport}/scores/?apiKey=${k}&daysFrom=${daysFrom}`;
        const r = await fetch(url);
        if (!r.ok) { console.warn(`[OddsAPI] ${r.status}`); return []; }
        const data = await r.json();
        _cache.set(ck, data || []);
        return data || [];
      } catch(e) { console.warn('[OddsAPI] erro:', e.message); return []; }
    },

    // Retorna mapa: "HomeTeam|AwayTeam" → { homeOdd, awayOdd }
    // Usa proxy (odds pré-jogo com bookmakers reais da Europa)
    async getOddsMap(lid) {
      // Tenta via proxy primeiro (chave no servidor)
      let games = await _proxy.fetch('odds', { lid });
      // Fallback: direct com chave local
      if (!games && this.key()) {
        const sport = this.SPORTS[lid]; if (!sport) return {};
        try {
          const r = await fetch(`${this.BASE}/sports/${sport}/odds/?apiKey=${this.key()}&regions=eu&markets=h2h&oddsFormat=decimal`);
          if (r.ok) games = await r.json();
        } catch {}
      }
      if (!Array.isArray(games)) return {};
      const map = {};
      games.forEach(g => {
        if (!g.bookmakers?.length) return;
        const bk = g.bookmakers[0];
        const h2h = bk.markets?.find(m => m.key === 'h2h');
        if (!h2h?.outcomes?.length) return;
        const homeOut = h2h.outcomes.find(o => o.name === g.home_team);
        const awayOut = h2h.outcomes.find(o => o.name === g.away_team);
        if (homeOut && awayOut) {
          map[`${g.home_team}|${g.away_team}`] = { homeOdd: homeOut.price, awayOdd: awayOut.price };
        }
      });
      return map;
    },
  };

  /* ── API-FOOTBALL (via proxy Supabase) ─────────────────────── */
  const APIF = {
    LEAGUES: { ENG:39, ESP:140, ITA:135, GER:78, FRA:61, BRA:71, POR:94, UCL:2, HOL:88 },
    SEASONS: { BRA:'2025', ENG:'2024', ESP:'2024', ITA:'2024', GER:'2024', FRA:'2024', POR:'2024', UCL:'2024', HOL:'2024' },

    async _p(action, params = {}) {
      const raw = await _proxy.fetch(action, params);
      return raw?.response ?? null;
    },

    async getFixtures(lid, { last, next } = {}) {
      const season = this.SEASONS[lid] || '2024';
      const params = { lid, season };
      if (last) params.last = String(last);
      if (next) params.next = String(next);
      return this._p('apif-fixtures', params);
    },

    async getFixtureStats(fixtureId) {
      return this._p('apif-fixture-stats', { fixtureId: String(fixtureId) });
    },

    async getFixtureEvents(fixtureId) {
      return this._p('apif-fixture-events', { fixtureId: String(fixtureId) });
    },

    async getFixtureLineups(fixtureId) {
      return this._p('apif-fixture-lineups', { fixtureId: String(fixtureId) });
    },

    async getH2H(teamId1, teamId2, last = 10) {
      return this._p('apif-h2h', { h2h: `${teamId1}-${teamId2}`, last: String(last) });
    },

    async searchTeam(name) {
      return this._p('apif-team-search', { name });
    },

    async getTeamStats(teamId, lid) {
      const season = this.SEASONS[lid] || '2024';
      return this._p('apif-team-stats', { teamId: String(teamId), lid, season });
    },

    async getPredictions(fixtureId) {
      return this._p('apif-predictions', { fixtureId: String(fixtureId) });
    },

    // Transforma resposta de fixture para formato ZebraStats
    transformFixture(f) {
      if (!f?.fixture) return null;
      const d = new Date(f.fixture.date);
      const home = f.teams?.home;
      const away = f.teams?.away;
      const goals = f.goals;
      const s = f.fixture.status;
      const isFinished = s?.short === 'FT' || s?.short === 'AET' || s?.short === 'PEN';
      const isLive     = ['1H','HT','2H','ET','BT','P','INT'].includes(s?.short);
      return {
        fixtureId  : f.fixture.id,
        home       : home?.name || '',
        away       : away?.name || '',
        homeLogo   : home?.logo || '',
        awayLogo   : away?.logo || '',
        hs         : goals?.home ?? null,
        as         : goals?.away ?? null,
        isFinished,
        isLive,
        isScheduled: !isFinished && !isLive,
        elapsed    : f.fixture.status?.elapsed || null,
        date       : d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', timeZone:'America/Sao_Paulo' }),
        time       : d.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit', timeZone:'America/Sao_Paulo' }),
        round      : f.league?.round || '',
        venue      : f.fixture.venue?.name || '',
        referee    : f.fixture.referee || '',
        homeId     : home?.id,
        awayId     : away?.id,
        homeWinner : home?.winner,
        awayWinner : away?.winner,
      };
    },

    // Transforma estatísticas de fixture → objeto simples
    transformStats(response) {
      if (!Array.isArray(response) || response.length < 2) return null;
      const parse = (arr, key) => {
        const item = arr?.find(s => s.type === key);
        const v = item?.value;
        if (v === null || v === undefined) return null;
        if (typeof v === 'string' && v.endsWith('%')) return parseFloat(v);
        return typeof v === 'number' ? v : parseFloat(v) || null;
      };
      const h = response[0]?.statistics;
      const a = response[1]?.statistics;
      return {
        home: {
          shots      : parse(h, 'Total Shots'),
          shotsOn    : parse(h, 'Shots on Goal'),
          possession : parse(h, 'Ball Possession'),
          corners    : parse(h, 'Corner Kicks'),
          fouls      : parse(h, 'Fouls'),
          yellowCards: parse(h, 'Yellow Cards'),
          redCards   : parse(h, 'Red Cards'),
          offsides   : parse(h, 'Offsides'),
          passes     : parse(h, 'Total passes'),
          passAcc    : parse(h, 'Passes accurate'),
          xg         : parse(h, 'Expected Goals'),
        },
        away: {
          shots      : parse(a, 'Total Shots'),
          shotsOn    : parse(a, 'Shots on Goal'),
          possession : parse(a, 'Ball Possession'),
          corners    : parse(a, 'Corner Kicks'),
          fouls      : parse(a, 'Fouls'),
          yellowCards: parse(a, 'Yellow Cards'),
          redCards   : parse(a, 'Red Cards'),
          offsides   : parse(a, 'Offsides'),
          passes     : parse(a, 'Total passes'),
          passAcc    : parse(a, 'Passes accurate'),
          xg         : parse(a, 'Expected Goals'),
        },
      };
    },
  };

  /* ── TRANSFORMERS ───────────────────────────────────────────── */
  const transform = {

    /* Football-Data.org: standings response → array de times */
    fdStandings(data) {
      if (!data?.standings) return [];
      const table = (data.standings.find(s => s.type === 'TOTAL') || data.standings[0])?.table || [];
      return table.map(t => ({
        pos   : t.position,
        name  : t.team.name,
        abbr  : t.team.tla || '',
        crest : t.team.crest || '',
        p : t.points,
        j : t.playedGames,
        v : t.won,
        e : t.draw,
        d : t.lost,
        gp: t.goalsFor,
        gc: t.goalsAgainst,
        sg: t.goalDifference,
        form: t.form || '',
      }));
    },

    /* Football-Data.org: match object → ZebraStats format */
    fdMatch(m) {
      if (!m || !m.status) return null;
      const LIVE_STATUSES = new Set(['IN_PLAY', 'PAUSED', 'LIVE', 'HALFTIME']);
      const isLive     = LIVE_STATUSES.has(m.status);
      const isFinished = m.status === 'FINISHED';
      const d = new Date(m.utcDate);
      return {
        id         : m.id,
        home       : m.homeTeam.shortName || m.homeTeam.name,
        away       : m.awayTeam.shortName || m.awayTeam.name,
        homeFull   : m.homeTeam.name,
        awayFull   : m.awayTeam.name,
        homeCrest  : m.homeTeam.crest || '',
        awayCrest  : m.awayTeam.crest || '',
        hs         : m.score?.fullTime?.home ?? null,
        as         : m.score?.fullTime?.away ?? null,
        status     : m.status,
        isLive,
        isFinished,
        isScheduled: !isLive && !isFinished,
        winner     : m.score?.winner || null,  // 'HOME_TEAM' | 'AWAY_TEAM' | 'DRAW' | null
        time       : d.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit', timeZone:'America/Sao_Paulo' }),
        date       : d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', timeZone:'America/Sao_Paulo' }),
        utcDate    : m.utcDate,
      };
    },

    /* Football-Data.org: scorers response → array de artilheiros */
    fdScorers(data) {
      if (!data?.scorers) return [];
      return data.scorers.map(s => ({
        name    : s.player.name,
        team    : s.team?.name || s.team?.shortName || '',
        goals   : s.goals || 0,
        assists : s.assists || 0,
        flag    : '🌐',
      }));
    },

    /* TheSportsDB: table row → ZebraStats format */
    sdbRow(t) {
      return {
        pos   : parseInt(t.intRank || '0'),
        name  : t.strTeam || '',
        crest : t.strTeamBadge || t.strBadge || '',
        teamId: t.idTeam || '',
        p : parseInt(t.intPoints           || '0'),
        j : parseInt(t.intPlayed           || '0'),
        v : parseInt(t.intWin              || '0'),
        e : parseInt(t.intDraw             || '0'),
        d : parseInt(t.intLoss             || '0'),
        gp: parseInt(t.intGoalsFor         || '0'),
        gc: parseInt(t.intGoalsAgainst     || '0'),
        sg: parseInt((t.intGoalDifference || '0').replace('+', '')),
      };
    },

    sdbTable(data) {
      if (!data?.table) return [];
      return data.table.map(t => this.sdbRow(t));
    },

    /* TheSportsDB: team object → ZebraStats format */
    sdbTeam(t) {
      if (!t) return null;
      return {
        id         : t.idTeam,
        name       : t.strTeam,
        logo       : t.strTeamBadge || t.strBadge || '',
        country    : t.strCountry || '',
        league     : t.strLeague  || '',
        stadium    : t.strStadium || '',
        founded    : t.intFormedYear || '',
        description: t.strDescriptionPT || t.strDescriptionEN || '',
        facebook   : t.strFacebook || '',
        instagram  : t.strInstagram || '',
      };
    },

    /* TheSportsDB: event object → match format */
    sdbEvent(e) {
      const d = e.dateEvent ? new Date(`${e.dateEvent}T${e.strTime || '00:00:00'}Z`) : null;
      const isFinished = !!(e.intHomeScore && e.intAwayScore !== null && e.strStatus === 'Match Finished');
      return {
        id         : e.idEvent,
        home       : e.strHomeTeam,
        away       : e.strAwayTeam,
        hs         : parseInt(e.intHomeScore || '') || null,
        as         : parseInt(e.intAwayScore || '') || null,
        isFinished,
        isScheduled: !isFinished,
        time       : d ? d.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit', timeZone:'America/Sao_Paulo' }) : '–',
        date       : d ? d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', timeZone:'America/Sao_Paulo' }) : '–',
        venue      : e.strVenue || '',
        round      : e.intRound || '',
      };
    },
  };

  /* ── ZEBRA INDEX ────────────────────────────────────────────── */
  const zebra = {
    fromOdds(winnerOdd) {
      if (typeof ZebraEngine !== 'undefined') {
        const r = ZebraEngine.calc({ homeScore:1, awayScore:0, homeOdd:winnerOdd, awayOdd:1.3 });
        return r.zi;
      }
      const o = parseFloat(winnerOdd);
      if (!o || o <= 1) return 0;
      return parseFloat(Math.min(10, Math.log(o) * 3.8).toFixed(1));
    },
    fromPositions(winnerPos, loserPos, totalTeams = 20) {
      if (typeof ZebraEngine !== 'undefined') {
        const r = ZebraEngine.calc({ homeScore:1, awayScore:0, homePosn:winnerPos, awayPosn:loserPos, lid: totalTeams === 18 ? 'GER' : 'ENG' });
        return r.zi;
      }
      const diff = loserPos - winnerPos;
      if (diff <= 0) return 0;
      return parseFloat(Math.min(10, (diff / totalTeams) * 12).toFixed(1));
    },
    classify(zi) {
      if (zi >= 7) return { cls:'grande', label:'🔴 Grande' };
      if (zi >= 4) return { cls:'media',  label:'🟠 Média'  };
      return           { cls:'leve',   label:'🟡 Leve'   };
    },
  };

  /* ── LEAGUE LABELS ──────────────────────────────────────────── */
  const _LEAGUE_LABEL = {
    ENG:'Premier League', ESP:'La Liga', ITA:'Serie A', GER:'Bundesliga',
    FRA:'Ligue 1', BRA:'Brasileirão', POR:'Liga Portugal', UCL:'Champions League',
  };

  /* ── FETCH REAL ZEBRAS ──────────────────────────────────────── */
  /**
   * Busca partidas recentes + tabela, calcula ZI real com ZebraEngine.
   * Requer Football-Data.org configurado; usa OddsAPI se disponível.
   * @param {string} lid  — código de liga (ENG, BRA, ESP…)
   * @param {number} [limit=20]
   * @returns {Promise<Array>}  Array de zebras ordenadas por ZI desc
   */
  async function fetchRealZebras(lid, limit = 20) {
    if (!_proxy.base() && !FD.key()) return [];
    if (typeof ZebraEngine === 'undefined') return [];

    try {
      // 1. Busca partidas finalizadas + tabela em paralelo
      const [matchData, standData] = await Promise.all([
        FD.getMatches(lid, 'FINISHED', limit),
        FD.getStandings(lid),
      ]);
      if (!matchData?.matches?.length) return [];

      // 2. Monta mapa posição + forma por nome de time
      const posMap  = {};
      const formMap = {};
      if (standData) {
        transform.fdStandings(standData).forEach(t => {
          [t.name, t.abbr].filter(Boolean).forEach(k => {
            posMap[k]  = t.pos;
            formMap[k] = t.form || '';
          });
        });
      }

      // 3. Odds reais (OddsAPI) — opcionais
      let oddsMap = {};
      try { oddsMap = await ODDS.getOddsMap(lid, 4); } catch {}

      // 4. Calcula ZI para cada partida
      const zebras = [];
      for (const m of matchData.matches) {
        const t = transform.fdMatch(m);
        if (!t?.isFinished || !t.hs == null || !t.as == null) continue;
        if (t.winner === 'DRAW' || !t.winner) continue;

        const homePos  = posMap[t.homeFull]  || posMap[t.home];
        const awayPos  = posMap[t.awayFull]  || posMap[t.away];
        const homeForm = formMap[t.homeFull] || formMap[t.home] || '';
        const awayForm = formMap[t.awayFull] || formMap[t.away] || '';

        // Tenta pegar odds reais, senão estima
        const oddsKey = `${t.homeFull}|${t.awayFull}`;
        const realOdds = oddsMap[oddsKey];
        const homeOdd = realOdds?.homeOdd || null;
        const awayOdd = realOdds?.awayOdd || null;

        const result = ZebraEngine.calc({
          homeScore: t.hs, awayScore: t.as,
          homeOdd, awayOdd,
          homePosn: homePos, awayPosn: awayPos,
          homeForm, awayForm, lid,
        });

        if (!result.isZebra) continue;

        // Odds para exibição (reais ou estimadas)
        let dispHomeOdd = homeOdd, dispAwayOdd = awayOdd;
        if (!dispHomeOdd && homePos && awayPos) {
          const est = ZebraEngine.estimateOdds(homePos, awayPos, homeForm, awayForm);
          dispHomeOdd = est.homeOdd;
          dispAwayOdd = est.awayOdd;
        }

        zebras.push({
          home: t.home, away: t.away,
          hs: t.hs, as: t.as,
          league: _LEAGUE_LABEL[lid] || lid, lid,
          date: t.date,
          zi: result.zi,
          ziClass: result.class,
          azarao: result.azarao,
          odds_h: dispHomeOdd ? parseFloat(dispHomeOdd).toFixed(2) : '–',
          odds_a: dispAwayOdd ? parseFloat(dispAwayOdd).toFixed(2) : '–',
          homeCrest: t.homeCrest || '',
          awayCrest: t.awayCrest || '',
          realOdds: !!realOdds,
          period: 'week',
        });
      }

      return zebras.sort((a, b) => b.zi - a.zi);
    } catch(e) {
      console.warn('[fetchRealZebras] erro:', e.message);
      return [];
    }
  }

  /* ── STATUS ─────────────────────────────────────────────────── */
  const isConfigured = {
    footballData : () => !!_proxy.base() || !!FD.key(),
    rapidApi     : () => !!RAPID.key(),
    sportsDb     : () => true,
    oddsApi      : () => !!_proxy.base(),
    apiFootball  : () => !!_proxy.base(), // chave APIF_KEY no Supabase Secret
  };

  /* ── PUBLIC ─────────────────────────────────────────────────── */
  return { footballData: FD, sportsDb: SDB, rapidApi: RAPID, oddsApi: ODDS, apiFootball: APIF, transform, zebra, fetchRealZebras, isConfigured };

})();
