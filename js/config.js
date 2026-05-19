/* ZebraStats — Configuração de APIs
 * -------------------------------------------------------
 * As chaves das APIs externas ficam seguras no servidor
 * (Supabase Edge Function). O frontend só conhece a URL
 * pública do proxy — nunca as chaves em si.
 *
 * Para configurar as chaves no servidor:
 *   Supabase Dashboard → Edge Functions → zebra-proxy
 *   → Secrets → adicionar FOOTBALL_DATA_KEY e ODDS_API_KEY
 *
 * Football-Data.org → https://www.football-data.org/client/register (grátis)
 * The Odds API      → https://the-odds-api.com (grátis, 500 req/mês)
 * TheSportsDB       → chave pública "123" — já inclusa
 */
const ZEBRA_CONFIG = {
  // ── Supabase proxy (chaves ficam no servidor) ────────────────
  SUPABASE_URL:  'https://wjiicdzpjxacqjwxmtqy.supabase.co',
  SUPABASE_ANON: 'sb_publishable_fpVIYjV2j7N39MWz81Lumg_WjODiChX',
  PROXY_BASE:    'https://wjiicdzpjxacqjwxmtqy.supabase.co/functions/v1/zebra-proxy',

  // ── BASE_URL: compatível com GitHub Pages em subdiretório (#1) ──
  // Ex: https://user.github.io/zebrastats  (não /home.html)
  get BASE_URL() {
    return window.location.origin +
      window.location.pathname.replace(/\/[^/]*$/, '');
  },

  // ── Indica se o proxy está disponível ───────────────────────
  // Proxy é a estratégia primária; a api.js tem fallback por chamada direta (#4)
  get proxyEnabled() { return true; },

  // ── Legado: chaves locais (fallback se proxy indisponível) ───
  get FOOTBALL_DATA_KEY() { return localStorage.getItem('zs_fd_key')    || ''; },
  get THESPORTSDB_KEY()   { return localStorage.getItem('zs_sdb_key')   || '123'; },
  get RAPIDAPI_KEY()      { return localStorage.getItem('zs_rapid_key') || ''; },
  get ODDS_API_KEY()      { return localStorage.getItem('zs_odds_key')  || ''; },
};
