/* ZebraStats — Configuração de APIs
 * -------------------------------------------------------
 * As chaves ficam no localStorage do navegador — nunca
 * expostas no código-fonte ou no repositório.
 *
 * Configure em: Perfil → Integração de Dados
 *
 * Football-Data.org  → https://www.football-data.org/client/register  (grátis)
 * RapidAPI           → https://rapidapi.com/Creativesdev/api/free-api-live-football-data (grátis)
 * TheSportsDB        → chave pública "123" — nenhuma configuração necessária
 */
const ZEBRA_CONFIG = {
  get FOOTBALL_DATA_KEY() { return localStorage.getItem('zs_fd_key')    || ''; },
  get THESPORTSDB_KEY()   { return localStorage.getItem('zs_sdb_key')   || '123'; },
  get RAPIDAPI_KEY()      { return localStorage.getItem('zs_rapid_key') || ''; },
};
