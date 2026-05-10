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

  /* ── FOOTBALL-DATA.ORG ──────────────────────────────────────── */
  const FD = {
    BASE : 'https://api.football-data.org/v4',
    // código → competition code (v4)
    COMPS: { BRA:'BSA', ENG:'PL', ESP:'PD', ITA:'SA', GER:'BL1', FRA:'FL1', UCL:'CL', POR:'PPL' },
    // código → season start year
    SEASON(lid) { return lid === 'BRA' ? '2025' : '2024'; },

    key() {
      return (typeof ZEBRA_CONFIG !== 'undefined' ? ZEBRA_CONFIG.FOOTBALL_DATA_KEY : '') || '';
    },

    async _fetch(path) {
      const k = this.key();
      if (!k) return null;
      const ck = `fd_${path}`;
      const hit = _cache.get(ck);
      if (hit) return hit;
      try {
        // Usa query param em vez de header customizado para evitar CORS preflight
        const sep = path.includes('?') ? '&' : '?';
        const url = `${this.BASE}${path}${sep}X-Auth-Token=${k}`;
        const r = await fetch(url);
        if (!r.ok) { console.warn(`[FD] ${r.status} — ${path}`); return null; }
        const data = await r.json();
        _cache.set(ck, data);
        return data;
      } catch (e) { console.warn('[FD] Erro de rede:', e.message); return null; }
    },

    async getStandings(lid) {
      const c = this.COMPS[lid]; if (!c) return null;
      return this._fetch(`/competitions/${c}/standings?season=${this.SEASON(lid)}`);
    },
    async getMatches(lid, status, limit = 8) {
      const c = this.COMPS[lid]; if (!c) return null;
      const qs = [`season=${this.SEASON(lid)}`, `limit=${limit}`];
      if (status) qs.push(`status=${status}`);
      return this._fetch(`/competitions/${c}/matches?${qs.join('&')}`);
    },
    async getScorers(lid, limit = 10) {
      const c = this.COMPS[lid]; if (!c) return null;
      return this._fetch(`/competitions/${c}/scorers?season=${this.SEASON(lid)}&limit=${limit}`);
    },
    async getMatch(id) { return this._fetch(`/matches/${id}`); },
  };

  /* ── THESPORTSDB ────────────────────────────────────────────── */
  const SDB = {
    BASE    : 'https://www.thesportsdb.com/api/v1/json',
    LEAGUES : { BRA:4351, ENG:4328, ESP:4335, ITA:4332, GER:4331, FRA:4334, POR:4344, UCL:2008 },
    SEASONS : { BRA:'2025', ENG:'2024-2025', ESP:'2024-2025', ITA:'2024-2025', GER:'2024-2025', FRA:'2024-2025' },

    key() {
      return (typeof ZEBRA_CONFIG !== 'undefined' ? ZEBRA_CONFIG.THESPORTSDB_KEY : '') || '123';
    },

    async _fetch(ep) {
      const url = `${this.BASE}/${this.key()}/${ep}`;
      const hit = _cache.get(`sdb_${ep}`);
      if (hit) return hit;
      try {
        const r = await fetch(url);
        if (!r.ok) { console.warn(`[SDB] ${r.status} — ${ep}`); return null; }
        const data = await r.json();
        _cache.set(`sdb_${ep}`, data);
        return data;
      } catch (e) { console.warn('[SDB] Erro de rede:', e.message); return null; }
    },

    async getLeagueInfo(lid) {
      const id = this.LEAGUES[lid]; if (!id) return null;
      return this._fetch(`lookupleague.php?id=${id}`);
    },
    async getLeagueTable(lid) {
      const id = this.LEAGUES[lid]; if (!id) return null;
      const s = this.SEASONS[lid] || '2024-2025';
      return this._fetch(`lookuptable.php?l=${id}&s=${s}`);
    },
    async getAllTeams(lid) {
      const id = this.LEAGUES[lid]; if (!id) return null;
      return this._fetch(`lookup_all_teams.php?id=${id}`);
    },
    async searchTeam(name) {
      return this._fetch(`searchteams.php?t=${encodeURIComponent(name)}`);
    },
    async lookupTeam(id) {
      return this._fetch(`lookupteam.php?id=${id}`);
    },
    async getTeamLastEvents(teamId) {
      return this._fetch(`eventslast.php?id=${teamId}`);
    },
    async getTeamNextEvents(teamId) {
      return this._fetch(`eventsnext.php?id=${teamId}`);
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
    /* A partir de odds: odd alta do vencedor = ele era azarão */
    fromOdds(winnerOdd) {
      const o = parseFloat(winnerOdd);
      if (!o || o <= 1) return 0;
      return parseFloat(Math.min(10, Math.log(o) * 3.8).toFixed(1));
    },

    /* A partir de posições na tabela: vencedor estava mais abaixo */
    fromPositions(winnerPos, loserPos, totalTeams = 20) {
      const diff = loserPos - winnerPos;   // + = vencedor era pior colocado
      if (diff <= 0) return 0;             // resultado esperado
      return parseFloat(Math.min(10, (diff / totalTeams) * 12).toFixed(1));
    },

    classify(zi) {
      if (zi >= 7) return { cls:'grande', label:'🔴 Grande' };
      if (zi >= 4) return { cls:'media',  label:'🟠 Média'  };
      return           { cls:'leve',   label:'🟡 Leve'   };
    },
  };

  /* ── STATUS ─────────────────────────────────────────────────── */
  const isConfigured = {
    footballData : () => !!FD.key(),
    rapidApi     : () => !!RAPID.key(),
    sportsDb     : () => true,   // chave pública "123" sempre disponível
  };

  /* ── PUBLIC ─────────────────────────────────────────────────── */
  return { footballData: FD, sportsDb: SDB, rapidApi: RAPID, transform, zebra, isConfigured };

})();
