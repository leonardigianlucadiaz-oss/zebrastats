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

  /* ── CACHE sessionStorage ────────────────────────────────────
   * TTL padrão: 10 min. Odds: 24h (fix #9 — The Odds API tem 500 req/mês)
   * Fix 4.2: failed API calls are cached for 30s (ERR_MARKER) to prevent
   * retry storms when the API is down and the user switches tabs rapidly.
   */
  const ERR_MARKER = '__ERR__';
  const ERR_TTL    = 30_000; // 30 seconds
  const _cache = {
    get(k, customTTL) {
      try {
        const raw = sessionStorage.getItem(`zs_${k}`);
        if (!raw) return null;
        const { ts, d } = JSON.parse(raw);
        const ttl = customTTL || 600_000; // 10 min padrão
        // Error marker: suppress retries for 30s, then allow a fresh attempt
        if (typeof d === 'string' && d.startsWith(ERR_MARKER)) {
          if (Date.now() - ts < ERR_TTL) return null; // still within error cooldown → suppress
          sessionStorage.removeItem(`zs_${k}`);       // cooldown expired → allow retry
          return null;
        }
        if (Date.now() - ts > ttl) { sessionStorage.removeItem(`zs_${k}`); return null; }
        return d;
      } catch { return null; }
    },
    set(k, d) {
      try { sessionStorage.setItem(`zs_${k}`, JSON.stringify({ ts: Date.now(), d })); } catch {}
    },
    // Cache a failed fetch so rapid retries are suppressed for ERR_TTL (30s)
    setError(k) {
      try { sessionStorage.setItem(`zs_${k}`, JSON.stringify({ ts: Date.now(), d: ERR_MARKER + k })); } catch {}
    },
  };
  const ODDS_CACHE_TTL = 86_400_000; // 24 horas — preserva quota da Odds API

  /* ── CACHE localStorage (persiste entre abas/recargas) ────────
   * TTL: 30 min para zebras, 60 min para standings.
   * Elimina refetch completo a cada nova aba ou F5.
   */
  const _lsCache = {
    get(k, ttl) {
      try {
        const raw = localStorage.getItem(`zs_lsc_${k}`);
        if (!raw) return null;
        const { ts, d } = JSON.parse(raw);
        if (Date.now() - ts > ttl) { localStorage.removeItem(`zs_lsc_${k}`); return null; }
        return d;
      } catch { return null; }
    },
    set(k, d) {
      try { localStorage.setItem(`zs_lsc_${k}`, JSON.stringify({ ts: Date.now(), d })); } catch {}
    },
  };
  const LS_ZEBRAS_TTL   = 120 * 60 * 1000; // 2h — zebras não mudam rápido, evita hits desnecessários
  const LS_STANDING_TTL = 120 * 60 * 1000; // 2h — standings mudam 1x por rodada

  /* ── PROXY HELPER (Supabase Edge Function) ──────────────────── */
  // Todas as chamadas passam pelo proxy quando disponível.
  // As chaves das APIs externas ficam nos Secrets do Supabase — nunca no frontend.
  // Fix #4: quando o proxy falha, retorna null para que as funções individuais
  // tentem o fallback de chamada direta com chave local (se configurada).
  // O usuário vê tela vazia apenas se AMBOS (proxy + direto) falharem.
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
        // Fix 7.1: envia x-zs-guest: 1 para visitantes não autenticados para que o
        // zebra-proxy possa distingui-los de bots (que não enviam nenhum header de auth).
        // Usuários logados recebem um JWT válido via Supabase client — aqui usamos o
        // anon key como fallback; o JWT real é injetado pelo cliente Supabase nos
        // contextos autenticados.
        const isGuest = !!(typeof localStorage !== 'undefined' && localStorage.getItem('zs_guest'));
        // Nota: sb_publishable_... NÃO é JWT — enviar como Bearer causa 401 no gateway
        // do Supabase antes mesmo de o código da função rodar. Apenas 'apikey' é enviado;
        // para usuários logados, o Supabase JS client injeta o JWT real automaticamente.
        const reqHeaders = { 'apikey': anon };
        if (isGuest) reqHeaders['x-zs-guest'] = '1';
        const r = await fetch(`${base}?${qs}`, { headers: reqHeaders });
        if (!r.ok) {
          // Fix #4: log descritivo — ajuda debug quando Edge Function não está deployada
          console.warn(`[Proxy] ${r.status} para "${action}" — verifique se a Edge Function zebra-proxy está deployada no Supabase.`);
          _cache.setError(ck); // Fix 4.2: cache error to suppress retry storm for 30s
          return null; // dispara fallback na função chamadora
        }
        const data = await r.json();
        if (data?.error) {
          console.warn(`[Proxy] erro da função "${action}": ${data.error}`);
          _cache.setError(ck); // Fix 4.2: cache error to suppress retry storm for 30s
          return null;
        }
        _cache.set(ck, data);
        return data;
      } catch(e) {
        console.warn(`[Proxy] falha de rede para "${action}": ${e.message} — tentando fallback direto.`);
        _cache.setError(ck); // Fix 4.2: cache network failure for 30s
        return null;
      }
    },
  };

  /* ── FD RATE LIMITER ────────────────────────────────────────────
   * FD free tier = 10 req/min → 1 req a cada 6s.
   * Enfileira chamadas reais (cache hits passam direto) e garante
   * mínimo de 6.5s entre disparos para evitar HTTP 429.
   */
  const _fdQueue = (() => {
    let lastTs = 0;
    let busy   = false;
    const queue = [];
    const GAP   = 6_500; // ms entre chamadas (10/min + 500ms buffer)

    function next() {
      if (busy || queue.length === 0) return;
      busy = true;
      const { fn, resolve, reject } = queue.shift();
      const wait = Math.max(0, GAP - (Date.now() - lastTs));
      setTimeout(async () => {
        lastTs = Date.now();
        try { resolve(await fn()); } catch(e) { reject(e); }
        busy = false;
        next();
      }, wait);
    }

    return { run: (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); }) };
  })();

  /* ── FOOTBALL-DATA.ORG ──────────────────────────────────────── */
  const FD = {
    BASE : 'https://api.football-data.org/v4',
    COMPS: { BRA:'BSA', ENG:'PL', ESP:'PD', ITA:'SA', GER:'BL1', FRA:'FL1', UCL:'CL', POR:'PPL', WC:'WC' },
    SEASON(lid) {
      const now = new Date();
      const yr  = now.getFullYear();
      const mo  = now.getMonth(); // 0-indexed; July = 6
      if (lid === 'BRA') return String(yr);
      if (lid === 'WC')  return '2026'; // Copa do Mundo FIFA 2026 (não segue ciclo europeu)
      // European leagues: season starts in July — use current year from July onwards, else year-1
      return String(mo >= 6 ? yr : yr - 1);
    },

    key() {
      return (typeof ZEBRA_CONFIG !== 'undefined' ? ZEBRA_CONFIG.FOOTBALL_DATA_KEY : '') || '';
    },

    // Tenta proxy primeiro; fallback para chamada direta com chave local
    // Cache hits passam direto; chamadas reais passam pelo _fdQueue (rate limit 10 req/min).
    async _fetch(path, lid) {
      const ck = `fd_${path}`;
      const hit = _cache.get(ck); if (hit) return hit;

      return _fdQueue.run(async () => {
        // double-check cache após esperar na fila (outra chamada pode ter preenchido)
        const hit2 = _cache.get(ck); if (hit2) return hit2;

        // 1. Proxy Supabase (chave no servidor)
        if (_proxy.base() && lid) {
          const action = path.includes('/standings') ? 'standings'
                       : path.includes('/matches')   ? 'matches'
                       : path.includes('/scorers')   ? 'fd-scorers'
                       : null;
          if (action) {
            const params = { lid };
            if (action === 'matches') {
              const status = path.match(/status=([^&]+)/)?.[1];
              const limit  = path.match(/limit=(\d+)/)?.[1];
              if (status) params.status = status;
              if (limit)  params.limit  = limit;
            }
            if (action === 'fd-scorers') {
              const limit = path.match(/limit=(\d+)/)?.[1];
              if (limit) params.limit = limit;
            }
            const data = await _proxy.fetch(action, params);
            if (data) { _cache.set(ck, data); return data; }
          }
        }

        // 2. Fallback: chamada direta com chave local
        const k = this.key(); if (!k) return null;
        try {
          const r = await fetch(`${this.BASE}${path}`, { headers: { 'X-Auth-Token': k } });
          if (!r.ok) { console.warn(`[FD] ${r.status} — ${path}`); _cache.setError(ck); return null; }
          const data = await r.json();
          _cache.set(ck, data);
          return data;
        } catch(e) { console.warn('[FD] Erro de rede:', e.message); _cache.setError(ck); return null; }
      });
    },

    async getStandings(lid) {
      const c = this.COMPS[lid]; if (!c) return null;
      const lsKey = `fd_stand_${lid}_${this.SEASON(lid)}`;
      const lsHit = _lsCache.get(lsKey, LS_STANDING_TTL);
      if (lsHit) return lsHit;
      const data = await this._fetch(`/competitions/${c}/standings?season=${this.SEASON(lid)}`, lid);
      if (data) _lsCache.set(lsKey, data);
      return data;
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
    // Fix [16]: /matches/${id} não era detectado pelo pattern matching de _fetch (lid=null).
    // Passa explicitamente action 'matches' e matchId para o proxy processar corretamente.
    async getMatch(id) {
      const ck = `fd_/matches/${id}`;
      const hit = _cache.get(ck); if (hit) return hit;
      if (_proxy.base()) {
        const data = await _proxy.fetch('matches', { matchId: String(id) });
        if (data) { _cache.set(ck, data); return data; }
      }
      return this._fetch(`/matches/${id}`, null);
    },
  };

  /* ── THESPORTSDB ────────────────────────────────────────────── */
  const SDB = {
    BASE    : 'https://www.thesportsdb.com/api/v1/json',
    LEAGUES : { BRA:4351, ENG:4328, ESP:4335, ITA:4332, GER:4331, FRA:4334, POR:4344, UCL:4480, HOL:4337, NED:4337, ARG:4406, MLS:4346, MEX:4350, UEL:4481 },
    SEASONS : { BRA:'2025', ENG:'2024-2025', ESP:'2024-2025', ITA:'2024-2025', GER:'2024-2025', FRA:'2024-2025' },

    // Fix [35]: temporada dinâmica — ligas europeias mudam em julho, Brasileirão em janeiro
    get CURRENT_SEASON() {
      const now = new Date()
      const yr = now.getFullYear()
      const mo = now.getMonth() // 0=jan
      return {
        BRA: String(yr),
        ENG: mo >= 6 ? `${yr}-${yr+1}` : `${yr-1}-${yr}`,
        ESP: mo >= 6 ? `${yr}-${yr+1}` : `${yr-1}-${yr}`,
        ITA: mo >= 6 ? `${yr}-${yr+1}` : `${yr-1}-${yr}`,
        GER: mo >= 6 ? `${yr}-${yr+1}` : `${yr-1}-${yr}`,
        FRA: mo >= 6 ? `${yr}-${yr+1}` : `${yr-1}-${yr}`,
        POR: mo >= 6 ? `${yr}-${yr+1}` : `${yr-1}-${yr}`,
        UCL: mo >= 6 ? `${yr}-${yr+1}` : `${yr-1}-${yr}`,
      }
    },

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
      // Fix [35]: usa temporada dinâmica; SEASONS é fallback estático se lid não estiver em CURRENT_SEASON
      const s  = this.CURRENT_SEASON[lid] || this.SEASONS[lid] || '2024-2025';
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
      return this._fetch(`eventsnext.php?id=${teamId}`, 'sdb-next-events', { teamId });
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
      UCL:'soccer_uefa_champs_league',
    },

    key() { return (typeof ZEBRA_CONFIG !== 'undefined' ? ZEBRA_CONFIG.ODDS_API_KEY : '') || ''; },

    async getRecentScores(lid, daysFrom = 3) {
      if (!this.SPORTS[lid]) return [];
      const ck = `odds_${lid}_${daysFrom}`;
      // Fix #9: TTL de 24h para economizar os 500 req/mês da tier gratuita
      const hit = _cache.get(ck, ODDS_CACHE_TTL); if (hit) return hit;
      // Fix [07]: redireciona para proxy — chave ODDS_API_KEY fica nos Secrets do Supabase,
      // nunca exposta no frontend via apiKey=${k} na URL.
      try {
        const data = await _proxy.fetch('odds-scores', { lid, days: daysFrom });
        if (data) { _cache.set(ck, data); return data; }
        return [];
      } catch(e) { console.warn('[OddsAPI] erro:', e.message); return []; }
    },

    // Retorna mapa: "HomeTeam|AwayTeam" → { homeOdd, awayOdd }
    // Fix #9: cache de 24h — The Odds API tem apenas 500 req/mês na tier gratuita
    async getOddsMap(lid, daysFrom = 3) {
      const oddsMapKey = `oddsmap_${lid}`;
      const cached = _cache.get(oddsMapKey, ODDS_CACHE_TTL);
      if (cached) return cached;

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
      games.forEach(ev => {
        if (!ev.bookmakers?.length) return;
        let homeSum = 0, awaySum = 0, count = 0;
        for (const bm of (ev.bookmakers || [])) {
          const h2h = bm.markets?.find(mk => mk.key === 'h2h');
          if (!h2h) continue;
          const homeOut = h2h.outcomes?.find(o => o.name === ev.home_team);
          const awayOut = h2h.outcomes?.find(o => o.name === ev.away_team);
          if (homeOut && awayOut) { homeSum += homeOut.price; awaySum += awayOut.price; count++; }
        }
        if (!count) return;
        const homeOdd = Math.round((homeSum / count) * 100) / 100;
        const awayOdd = Math.round((awaySum / count) * 100) / 100;
        map[`${ev.home_team}|${ev.away_team}`] = { homeOdd, awayOdd };
      });
      _cache.set(oddsMapKey, map); // guarda com chave própria (TTL aplicado no get)
      return map;
    },
  };

  /* ── API-FOOTBALL (via proxy Supabase) ─────────────────────── */
  const APIF = {
    LEAGUES: {
      // Clubes
      ENG:39, ESP:140, ITA:135, GER:78, FRA:61, BRA:71, POR:94, UCL:2, HOL:88,
      // Seleções nacionais
      WC:1, EUR:4, CPA:9, UNL:5, SAQ:29, EUQ:32, AMI:10, CAN:6, GLD:16,
    },

    // Temporada dinâmica — clubes + seleções
    get SEASONS() {
      const yr = new Date().getFullYear();
      const mo = new Date().getMonth(); // 0-based; julho = 6
      const eu = mo >= 6 ? String(yr) : String(yr - 1);
      return {
        ENG:eu, ESP:eu, ITA:eu, GER:eu, FRA:eu, POR:eu, UCL:eu, HOL:eu, BRA:String(yr),
        // Seleções — cada competição tem ciclo próprio
        WC:  String(yr),
        EUR: mo >= 5 && yr < 2028 ? '2024' : String(yr - (yr % 4)),
        CPA: '2024',
        UNL: mo >= 8 ? String(yr) : String(yr - 1),
        SAQ: mo >= 6 ? String(yr) : String(yr - 1),
        EUQ: String(yr - 1),
        AMI: String(yr),
        CAN: '2025',
        GLD: '2025',
      };
    },

    async _p(action, params = {}) {
      const raw = await _proxy.fetch(action, params);
      return raw?.response ?? null;
    },

    async getFixtures(lid, { last, next } = {}) {
      const season = this.SEASONS[lid] || String(new Date().getFullYear());
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
      const season = this.SEASONS[lid] || String(new Date().getFullYear());
      return this._p('apif-team-stats', { teamId: String(teamId), lid, season });
    },

    async getPredictions(fixtureId) {
      return this._p('apif-predictions', { fixtureId: String(fixtureId) });
    },

    // Partidas ao vivo (todas as ligas ou só uma)
    async getLiveFixtures(lid) {
      return this._p('apif-live', lid ? { lid } : {});
    },

    // Tabela de classificação (mais rica que FD: forma recente, casa/fora)
    async getStandings(lid) {
      const season = this.SEASONS[lid] || String(new Date().getFullYear());
      return this._p('apif-standings', { lid, season });
    },

    // Artilheiros da liga
    async getTopScorers(lid) {
      const season = this.SEASONS[lid] || String(new Date().getFullYear());
      return this._p('apif-top-scorers', { lid, season });
    },

    // Elenco completo (jogadores com foto, nº camisa, posição)
    async getSquad(teamId) {
      const raw = await _proxy.fetch('apif-squad', { teamId: String(teamId) });
      // response = [{ team:{…}, players:[{id, name, number, pos, photo}] }]
      return raw?.response?.[0]?.players ?? null;
    },

    // Top assistentes da liga
    async getTopAssists(lid) {
      const season = this.SEASONS[lid] || String(new Date().getFullYear());
      return this._p('apif-top-assists', { lid, season });
    },

    // Top cartões amarelos da liga
    async getTopYellowCards(lid) {
      const season = this.SEASONS[lid] || String(new Date().getFullYear());
      return this._p('apif-top-yellow', { lid, season });
    },

    // Top cartões vermelhos da liga
    async getTopRedCards(lid) {
      const season = this.SEASONS[lid] || String(new Date().getFullYear());
      return this._p('apif-top-red', { lid, season });
    },

    // Estatísticas detalhadas de um jogador na temporada
    // Retorna array de objetos { player, statistics[] }
    async getPlayerStats(playerId, season) {
      const s = season || String(new Date().getFullYear());
      const raw = await _proxy.fetch('apif-player-stats', { playerId: String(playerId), season: s });
      return raw?.response?.[0] ?? null;
    },

    // Transferências de um time (chegadas e saídas)
    async getTransfers(teamId) {
      return this._p('apif-transfers', { teamId: String(teamId) });
    },

    // Treinador atual de um time
    async getCoach(teamId) {
      const raw = await _proxy.fetch('apif-coach', { teamId: String(teamId) });
      return raw?.response?.[0] ?? null;
    },

    // Rodadas da liga na temporada
    async getRounds(lid, season) {
      const s = season || this.SEASONS[lid] || String(new Date().getFullYear());
      const raw = await _proxy.fetch('apif-rounds', { lid, season: s });
      return raw?.response ?? null;
    },

    // Lesionados/suspensos de uma partida ou time
    async getInjuries(params = {}) {
      // params: { fixtureId } ou { teamId, lid } ou { lid }
      const p = {};
      if (params.fixtureId) p.fixtureId = String(params.fixtureId);
      if (params.teamId)    p.teamId    = String(params.teamId);
      if (params.lid)       p.lid       = params.lid;
      return this._p('apif-injuries', p);
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
        name          : s.player.name,
        team          : s.team?.name || s.team?.shortName || '',
        goals         : s.goals         || 0,
        assists       : s.assists        || 0,
        penalties     : s.penalties      || 0,
        playedMatches : s.playedMatches  || 0,
        flag          : '🌐',
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
      const FINISHED_STATUSES = ['Match Finished', 'Full Time', 'FT', 'After Extra Time', 'After Penalties', 'Finished'];
      // Fix [12]: intHomeScore é string "0" quando placar é 0, que é falsy em JS.
      // Usa verificação explícita para não falhar em jogos 0-X ou 0-0.
      const hasScore = e.intHomeScore !== null && e.intHomeScore !== undefined && e.intHomeScore !== ''
      const isFinished = hasScore && FINISHED_STATUSES.includes(e.strStatus);
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
        const r = ZebraEngine.calc({ homeScore:1, awayScore:0, homeOdd:winnerOdd, awayOdd:1.5 /* estimativa neutra quando só a odd do vencedor está disponível */ });
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
    // Clubes
    ENG:'Premier League', ESP:'La Liga', ITA:'Serie A', GER:'Bundesliga',
    FRA:'Ligue 1', BRA:'Brasileirão', POR:'Liga Portugal', UCL:'Champions League',
    HOL:'Eredivisie', ARG:'Liga Argentina',
    // Seleções nacionais
    WC: 'Copa do Mundo', EUR:'Eurocopa', CPA:'Copa América',
    UNL:'Nations League', SAQ:'Eliminatórias CONMEBOL', EUQ:'Eliminatórias UEFA',
    AMI:'Amistosos FIFA', CAN:'Copa Africana', GLD:'Gold Cup CONCACAF',
  };

  /* ── FETCH REAL ZEBRAS — SELEÇÕES NACIONAIS (via APIF) ─────── */
  const _NT_LIDS = new Set(['WC','EUR','CPA','UNL','SAQ','EUQ','AMI','CAN','GLD']);

  async function fetchRealZebrasNT(lid, limit = 20) {
    if (!_proxy.base()) return [];
    if (typeof ZebraEngine === 'undefined') return [];

    const lsKey = `zebras_${lid}_${limit}`;
    const lsHit = _lsCache.get(lsKey, LS_ZEBRAS_TTL);
    if (lsHit) return lsHit;

    try {
      // Busca últimas N partidas + tabela em paralelo
      const [fixtures, standRaw] = await Promise.all([
        APIF.getFixtures(lid, { last: limit }),
        APIF.getStandings(lid).catch(() => null),
      ]);
      if (!Array.isArray(fixtures) || !fixtures.length) return [];

      // Monta mapa de posição achatando todos os grupos
      const posMap = {};
      if (Array.isArray(standRaw) && standRaw[0]?.league?.standings) {
        for (const group of standRaw[0].league.standings) {
          if (!Array.isArray(group)) continue;
          for (const t of group) {
            if (t.team?.name) posMap[t.team.name] = t.rank;
          }
        }
      }

      // Odds reais (OddsAPI) — opcionais para NT comps
      let oddsMap = {};
      try { oddsMap = await ODDS.getOddsMap(lid, 4); } catch {}

      const zebras = [];
      for (const f of fixtures) {
        const t = APIF.transformFixture(f);
        if (!t?.isFinished || t.hs == null || t.as == null) continue;
        if (t.hs === t.as) continue; // draw (inclui PEN em 90+30 iguais)

        const homePos = posMap[f.teams?.home?.name] || null;
        const awayPos = posMap[f.teams?.away?.name] || null;

        const oddsKey = `${f.teams?.home?.name}|${f.teams?.away?.name}`;
        const realOdds = oddsMap[oddsKey];
        const homeOdd  = realOdds?.homeOdd || null;
        const awayOdd  = realOdds?.awayOdd || null;

        const result = ZebraEngine.calc({
          homeScore: t.hs, awayScore: t.as,
          homeOdd, awayOdd,
          homePosn: homePos, awayPosn: awayPos,
          homeForm: '', awayForm: '', lid,
        });
        if (!result.isZebra) continue;

        let dispHomeOdd = homeOdd, dispAwayOdd = awayOdd;
        if (!dispHomeOdd && homePos && awayPos) {
          const est = ZebraEngine.estimateOdds(homePos, awayPos, '', '');
          dispHomeOdd = est.homeOdd; dispAwayOdd = est.awayOdd;
        }

        const matchDate = new Date(f.fixture.date);
        const age = Date.now() - matchDate.getTime();

        zebras.push({
          id: f.fixture.id,
          home: t.home, away: t.away,
          hs: t.hs, as: t.as,
          league: _LEAGUE_LABEL[lid] || lid, lid,
          date: t.date,
          zi: result.zi, ziClass: result.class,
          azarao: result.azarao,
          odds_h: dispHomeOdd ? parseFloat(dispHomeOdd).toFixed(2) : '–',
          odds_a: dispAwayOdd ? parseFloat(dispAwayOdd).toFixed(2) : '–',
          homeCrest: t.homeLogo || '', awayCrest: t.awayLogo || '',
          realOdds: !!realOdds,
          period: age <= 7*864e5 ? 'week' : age <= 30*864e5 ? 'month' : 'history',
        });
      }

      const sorted = zebras.sort((a, b) => b.zi - a.zi);
      if (sorted.length) _lsCache.set(lsKey, sorted);
      return sorted;
    } catch(e) {
      console.warn('[fetchRealZebrasNT] erro:', e.message);
      return [];
    }
  }

  /* ── FETCH REAL ZEBRAS ──────────────────────────────────────── */
  /**
   * Busca partidas recentes + tabela, calcula ZI real com ZebraEngine.
   * Ligas de clubes: Football-Data.org. Seleções nacionais: API-Football.
   * @param {string} lid  — código de liga (ENG, BRA, ESP… ou WC, EUR, CPA…)
   * @param {number} [limit=20]
   * @returns {Promise<Array>}  Array de zebras ordenadas por ZI desc
   */
  async function fetchRealZebras(lid, limit = 20) {
    if (_NT_LIDS.has(lid)) return fetchRealZebrasNT(lid, limit);
    if (!_proxy.base() && !FD.key()) return [];
    if (typeof ZebraEngine === 'undefined') return [];

    // Check localStorage cache first (30 min) — survives F5 and new tabs
    const lsKey = `zebras_${lid}_${limit}`;
    const lsHit = _lsCache.get(lsKey, LS_ZEBRAS_TTL);
    if (lsHit) return lsHit;

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
        if (!t?.isFinished || t.hs == null || t.as == null) continue;
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
          id: t.id,
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
          period: (() => {
            const matchDate = new Date(m.utcDate);
            const age = Date.now() - matchDate.getTime();
            if (age <= 7 * 24 * 60 * 60 * 1000)  return 'week';
            if (age <= 30 * 24 * 60 * 60 * 1000) return 'month';
            return 'history';
          })(),
        });
      }

      const sorted = zebras.sort((a, b) => b.zi - a.zi);
      if (sorted.length) _lsCache.set(lsKey, sorted); // cache result for 30 min
      return sorted;
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
    // NOTE: oddsApi() only checks proxy availability, NOT whether ODDS_API_KEY is set.
    // A true proxy-up result does NOT guarantee odds calls will succeed — the key must
    // also be configured as a Supabase Secret. Do not use this to gate odds-only UI.
    oddsApi      : () => !!_proxy.base(),
    // isProxyAvailable is the semantically accurate name for the check above:
    isProxyAvailable: () => !!_proxy.base(),
    apiFootball  : () => !!_proxy.base(), // chave APIF_KEY no Supabase Secret
  };

  /* ── PUBLIC ─────────────────────────────────────────────────── */
  return { footballData: FD, sportsDb: SDB, rapidApi: RAPID, oddsApi: ODDS, apiFootball: APIF, transform, zebra, fetchRealZebras, isConfigured };

})();
