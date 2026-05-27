/* ============================================================
   ZebraStats — main.js
   Utilitários globais compartilhados entre todas as telas
   ============================================================ */

// ── TEMA (dark / light) ───────────────────────────────────────
// Aplica imediatamente ao carregar o script para evitar flash
const THEME_KEY = 'zs_theme';
(function _applyInitialTheme() {
  try {
    if (localStorage.getItem(THEME_KEY) === 'light')
      document.documentElement.setAttribute('data-theme', 'light');
  } catch {}
})();

function getTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'dark'; } catch { return 'dark'; }
}

function setTheme(theme) {
  try { localStorage.setItem(THEME_KEY, theme); } catch {}
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  _updateThemeButtons(theme);
}

function toggleTheme() { setTheme(getTheme() === 'dark' ? 'light' : 'dark'); }

function _themeIcon(theme) {
  return theme === 'light'
    ? `<i data-lucide="moon"  style="width:16px;height:16px;display:block;"></i>`
    : `<i data-lucide="sun"   style="width:16px;height:16px;display:block;"></i>`;
}
function _themeTitle(theme) {
  return theme === 'light' ? 'Modo escuro' : 'Modo claro';
}

function _updateThemeButtons(theme) {
  document.querySelectorAll('.zs-theme-toggle').forEach(btn => {
    btn.innerHTML = _themeIcon(theme);
    btn.title     = _themeTitle(theme);
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [btn] });
  });
}

function initThemeToggle() {
  const theme = getTheme();
  const containers = document.querySelectorAll('.navbar__actions, .navbar-actions, [data-theme-toggle-host]');
  containers.forEach(actions => {
    if (actions.querySelector('.zs-theme-toggle')) return;
    const btn = document.createElement('button');
    btn.className = 'navbar__icon zs-theme-toggle';
    btn.style.cssText = 'background:transparent;border:1px solid var(--border);flex-shrink:0;';
    btn.innerHTML = _themeIcon(theme);
    btn.title     = _themeTitle(theme);
    btn.setAttribute('aria-label', _themeTitle(theme));
    btn.addEventListener('click', toggleTheme);
    // Place theme toggle just before the search icon (first `a.navbar__icon`)
    const searchIcon = actions.querySelector('a.navbar__icon[href*="busca"]');
    if (searchIcon) actions.insertBefore(btn, searchIcon);
    else actions.appendChild(btn);
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [btn] });
  });
}

// ── BELL BADGE (contador de notificações não lidas) ───────────
/**
 * Busca o count real de notificações não lidas no Supabase (se logado).
 * Atualiza todos os elementos .zs-bell-badge na página.
 */
async function _updateNotifBadge() {
  const uid = localStorage.getItem('zs_uid');
  if (!uid) {
    // Usuário não logado: esconde badge
    document.querySelectorAll('.zs-bell-badge').forEach(b => {
      b.textContent = '';
      b.style.display = 'none';
    });
    return;
  }
  try {
    const sb = window._sbClient || (window._sbClient = window.supabase.createClient(
      window.ZEBRA_CONFIG.SUPABASE_URL, window.ZEBRA_CONFIG.SUPABASE_ANON
    ));
    const { count } = await sb.from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', uid).eq('read', false);
    document.querySelectorAll('.zs-bell-badge').forEach(b => {
      b.textContent = count > 9 ? '9+' : (count || '');
      b.style.display = count ? 'flex' : 'none';
    });
  } catch(e) { /* silencia erros de rede */ }
}

function updateBellBadge() {
  _updateNotifBadge();
}

function initBellBadge() {
  // Find the bell icon link and inject a badge span if not already present
  document.querySelectorAll('a[href="notificacoes.html"].navbar__icon').forEach(link => {
    if (link.querySelector('.zs-bell-badge')) return; // already injected
    link.style.position = 'relative';
    const badge = document.createElement('span');
    badge.className = 'zs-bell-badge';
    badge.style.cssText = [
      'position:absolute', 'top:-4px', 'right:-4px',
      'min-width:16px', 'height:16px', 'border-radius:8px',
      'background:var(--red)', 'color:#fff',
      'font-size:0.5625rem', 'font-weight:800',
      'display:flex', 'align-items:center', 'justify-content:center',
      'padding:0 3px', 'pointer-events:none',
      'border:1.5px solid var(--bg,#0d1117)',
    ].join(';');
    link.appendChild(badge);
  });
  _updateNotifBadge();
}

// ── NAVIGATION ────────────────────────────────────────────────
/**
 * Navega para trás no histórico com fallback para evitar
 * ficar preso em pages sem histórico (ex: acesso direto via URL).
 * @param {string} [fallback='home.html'] URL de destino se não houver histórico
 */
function goBack(fallback) {
  try {
    const ref = document.referrer;
    if (ref && new URL(ref).origin === window.location.origin && ref !== window.location.href) {
      history.back();
      return;
    }
  } catch(e) {}
  window.location.href = fallback || 'home.html';
}

// ── TOAST ─────────────────────────────────────────────────────
/**
 * Exibe uma mensagem toast temporária na parte inferior da tela.
 * @param {string} message - Texto da mensagem
 * @param {number} duration - Duração em ms (padrão: 2500)
 */
function showToast(message, duration = 2500) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => toast.classList.remove('show'), duration);
}

// ── FAVORITOS DE TIMES (localStorage) ────────────────────────
const FAVORITES_KEY      = 'zebrastats_favorites';
const FAV_TEAMS_DATA_KEY = 'zebrastats_fav_teams_data'; // {id → {name,crest,color}}

function getFavorites() {
  try { return JSON.parse(localStorage.getItem(FAVORITES_KEY)) || []; }
  catch { return []; }
}
function saveFavorites(favs) {
  try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs)); }
  catch (e) { console.warn('localStorage indisponível:', e); }
}
function getFavTeamsData() {
  try { return JSON.parse(localStorage.getItem(FAV_TEAMS_DATA_KEY)) || {}; }
  catch { return {}; }
}
function saveFavTeamMeta(id, meta) {
  try {
    const d = getFavTeamsData();
    d[id] = meta;
    localStorage.setItem(FAV_TEAMS_DATA_KEY, JSON.stringify(d));
  } catch {}
}
function toggleFavorite(teamId, teamName, meta = {}) {
  const favs = getFavorites();
  const idx  = favs.indexOf(teamId);
  if (idx >= 0) {
    favs.splice(idx, 1);
    showToast(`${teamName} removido dos favoritos`);
  } else {
    favs.push(teamId);
    if (meta.crest || meta.color) saveFavTeamMeta(teamId, { name: teamName, ...meta });
    showToast(`${teamName} adicionado aos favoritos!`);
  }
  saveFavorites(favs);
  return favs.includes(teamId);
}
function isFavorite(teamId) { return getFavorites().includes(teamId); }

// ── FAVORITOS DE LIGAS ────────────────────────────────────────
const FAV_LEAGUES_KEY = 'zebrastats_fav_leagues';

function getFavLeagues() {
  try { return JSON.parse(localStorage.getItem(FAV_LEAGUES_KEY)) || []; }
  catch { return []; }
}
function toggleFavLeague(lid, name) {
  const favs = getFavLeagues();
  const idx  = favs.indexOf(lid);
  if (idx >= 0) {
    favs.splice(idx, 1);
    showToast(`${name} removida dos favoritos`);
  } else {
    favs.push(lid);
    showToast(`${name} adicionada aos favoritos!`);
  }
  try { localStorage.setItem(FAV_LEAGUES_KEY, JSON.stringify(favs)); } catch {}
  return favs.includes(lid);
}
function isFavLeague(lid) { return getFavLeagues().includes(lid); }

// ── ANIMAÇÃO DE FAVORITO ──────────────────────────────────────
function animFavBtn(btn) {
  btn.classList.remove('fav-pop');
  void btn.offsetWidth; // reflow
  btn.classList.add('fav-pop');
}

// ── BANDEIRAS DE PAÍS (flagcdn.com — universal, sem emoji) ────
const _FLAG_CDN = {
  BRA: 'https://flagcdn.com/w20/br.png',
  ENG: 'https://flagcdn.com/w20/gb-eng.png',
  ESP: 'https://flagcdn.com/w20/es.png',
  ITA: 'https://flagcdn.com/w20/it.png',
  GER: 'https://flagcdn.com/w20/de.png',
  FRA: 'https://flagcdn.com/w20/fr.png',
  POR: 'https://flagcdn.com/w20/pt.png',
  HOL: 'https://flagcdn.com/w20/nl.png',
  NED: 'https://flagcdn.com/w20/nl.png',
  ARG: 'https://flagcdn.com/w20/ar.png',
  MLS: 'https://flagcdn.com/w20/us.png',
  MEX: 'https://flagcdn.com/w20/mx.png',
  UCL: 'https://flagcdn.com/w20/eu.png',
  UEL: 'https://flagcdn.com/w20/eu.png',
};

/**
 * Retorna HTML de imagem da bandeira do país da liga.
 * Fallback seguro para qualquer browser (sem emoji regional).
 * @param {string} lid  - Código de liga (BRA, ENG, ESP…)
 * @param {number} size - Tamanho em px (padrão 14)
 */
function flagImg(lid, size = 14) {
  const url = _FLAG_CDN[lid];
  if (!url) return '';
  return `<img src="${url}" alt="${lid}" style="width:${size}px;height:${Math.round(size*0.75)}px;object-fit:cover;border-radius:1px;flex-shrink:0;vertical-align:middle;" loading="lazy">`;
}

// ── CACHE GLOBAL DE ESCUDOS ───────────────────────────────────
// LEAGUE_LOGOS pré-baked: URLs diretas do CDN r2.thesportsdb.com
// Motivo: chave gratuita "123" da SDB é instável (rate-limit, CORS,
// resultados errados). URLs são estáveis no CDN deles.
window.TEAM_LOGOS  = window.TEAM_LOGOS  || {};
window.LEAGUE_LOGOS = Object.assign({
  BRA: 'https://r2.thesportsdb.com/images/media/league/badge/lywv7t1766787179.png',
  ENG: 'https://r2.thesportsdb.com/images/media/league/badge/gasy9d1737743125.png',
  ESP: 'https://r2.thesportsdb.com/images/media/league/badge/ja4it51687628717.png',
  ITA: 'https://r2.thesportsdb.com/images/media/league/badge/67q3q21679951383.png',
  GER: 'https://r2.thesportsdb.com/images/media/league/badge/teqh1b1679952008.png',
  FRA: 'https://r2.thesportsdb.com/images/media/league/badge/9f7z9d1742983155.png',
  POR: 'https://r2.thesportsdb.com/images/media/league/badge/lkfko71751917970.png',
  PRT: 'https://r2.thesportsdb.com/images/media/league/badge/lkfko71751917970.png',
  UCL: 'https://r2.thesportsdb.com/images/media/league/badge/facv1u1742998896.png',
  UEL: 'https://r2.thesportsdb.com/images/media/league/badge/zfb7en1701267893.png',
  HOL: 'https://r2.thesportsdb.com/images/media/league/badge/o6qdtj1534771842.png',
  NED: 'https://r2.thesportsdb.com/images/media/league/badge/o6qdtj1534771842.png',
  ARG: 'https://r2.thesportsdb.com/images/media/league/badge/npo8011713382762.png',
  MEX: 'https://r2.thesportsdb.com/images/media/league/badge/po2jzt1687536144.png',
  MLS: 'https://r2.thesportsdb.com/images/media/league/badge/mq0zpu1687640611.png',
  USA: 'https://r2.thesportsdb.com/images/media/league/badge/mq0zpu1687640611.png',
}, window.LEAGUE_LOGOS || {});

function _crestKeys(name) {
  const k = name.toLowerCase().trim();
  return [
    k,
    k.replace(/\s+fc$/i, ''),
    k.replace(/^fc\s+/i, ''),
    k.replace(/\s+afc$/i, ''),
    k.split(' ')[0],          // primeiro token ("man" city → "man")
    k.split(' ').slice(-1)[0], // último token (botafogo "rj" → "rj")
  ];
}

function cacheCrest(name, url) {
  if (!name || !url) return;
  _crestKeys(name).forEach(k => { if (k.length > 1) TEAM_LOGOS[k] = url; });
}

function getCrest(name) {
  if (!name) return '';
  for (const k of _crestKeys(name)) {
    if (TEAM_LOGOS[k]) return TEAM_LOGOS[k];
  }
  return '';
}

function crestImg(name, size = 20) {
  const url = getCrest(name);
  if (!url) return '';
  return `<img src="${url}" alt="${name}" style="width:${size}px;height:${size}px;object-fit:contain;flex-shrink:0;vertical-align:middle;" loading="lazy" onerror="this.style.display='none'">`;
}

async function loadLeagueCrests(lid) {
  if (!window.ZebraAPI) return;
  try {
    const data = await ZebraAPI.sportsDb.getAllTeams(lid);
    (data?.teams || []).forEach(t => {
      const logo = t.strTeamBadge || t.strBadge || '';
      if (logo) {
        cacheCrest(t.strTeam, logo);
        if (t.strTeamShort) cacheCrest(t.strTeamShort, logo);
        if (t.strAlternate) cacheCrest(t.strAlternate, logo);
      }
    });
  } catch(e) { console.warn(`[Crests] ${lid}:`, e.message); }
}

async function loadLeagueLogo(lid) {
  if (!window.ZebraAPI) return '';
  if (LEAGUE_LOGOS[lid]) return LEAGUE_LOGOS[lid];
  try {
    const data = await ZebraAPI.sportsDb.getLeagueInfo(lid);
    const badge = data?.leagues?.[0]?.strBadge || data?.leagues?.[0]?.strLogo || '';
    if (badge) LEAGUE_LOGOS[lid] = badge;
    return badge;
  } catch { return ''; }
}

// ── PLANO DO USUÁRIO (localStorage) ───────────────────────────
const PLAN_KEY = 'zebrastats_plan';

function getUserPlan() {
  return localStorage.getItem(PLAN_KEY) || 'free';
}

function setUserPlan(plan) {
  localStorage.setItem(PLAN_KEY, plan);
}

// ── BADGE DE PLANO + DESBLOQUEIO PRO ──────────────────────────
function updatePlanBadge() {
  const plan = getUserPlan();
  const isPro = plan === 'pro';

  // 1. Atualiza todos os badges de plano na página
  document.querySelectorAll('.badge--free').forEach(badge => {
    if (isPro) {
      badge.textContent = 'PRO';
      badge.className = badge.className.replace('badge--free', 'badge--pro');
    }
  });

  // 2. Atualiza texto de plano na sidebar
  document.querySelectorAll('.sidebar__user-plan').forEach(el => {
    el.textContent = isPro ? 'Plano Pro' : 'Plano Free';
  });

  // 3. Atualiza o botão CTA da sidebar
  document.querySelectorAll('.sidebar__footer > a.badge--free, .sidebar__footer > a.badge--pro').forEach(el => {
    if (isPro) {
      el.textContent = '✓ Pro Ativo';
      el.className   = el.className.replace('badge--free','badge--pro');
      el.style.pointerEvents = 'none';
      el.style.opacity = '0.8';
    }
  });

  // 4. Remove lock-banners para usuários PRO
  if (isPro) {
    document.querySelectorAll('.lock-banner').forEach(el => {
      el.style.display = 'none';
    });
    // Remove link "🔒 Pro" no header de seção
    document.querySelectorAll('.section-link.text-gold').forEach(el => {
      el.style.display = 'none';
    });
    // Mostra conteúdo PRO escondido
    document.querySelectorAll('.pro-content').forEach(el => {
      el.style.display = '';
    });
  }

  // 5. Atualiza plano no perfil (se estiver na página)
  const planLabel  = document.getElementById('planLabel');
  const planSub    = document.getElementById('planSub');
  const planBadge2 = document.getElementById('planBadge2');
  if (isPro) {
    if (planLabel)  planLabel.textContent  = 'ZebraStats Pro';
    if (planSub)    planSub.textContent    = 'Acesso completo · Renovação anual';
    if (planBadge2) { planBadge2.textContent = 'PRO'; planBadge2.className = 'badge badge--pro'; }
  }
}

// ── LOADER SIMPLES ─────────────────────────────────────────────
function showLoader(container, message = 'Carregando...') {
  if (!container) return;
  container.innerHTML = `
    <div style="text-align:center;padding:24px;color:var(--gray);font-size:0.875rem;">
      <div style="font-size:1.5rem;margin-bottom:8px;animation:spin 1s linear infinite;display:inline-block;">⚽</div>
      <p>${message}</p>
    </div>
  `;
}

// ── FORMATAR DATA ──────────────────────────────────────────────
function formatDate(date = new Date()) {
  return date.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' });
}

// ── FORMATAR MOEDA ─────────────────────────────────────────────
function formatBRL(value) {
  return new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' }).format(value);
}

// ── NAVEGAÇÃO ATIVA (bottom nav + sidebar) ────────────────────
function setActiveNavItem() {
  const current = window.location.pathname.split('/').pop() || 'home.html';
  document.querySelectorAll('.bottom-nav__item, .sidebar__nav-link').forEach(el => {
    const href = el.getAttribute('href') || '';
    const hrefPage = href.split('/').pop() || '';
    el.classList.toggle('active', hrefPage !== '' && hrefPage === current);
  });
}

// ── ANIMAÇÃO DE NÚMERO (counter) ──────────────────────────────
function animateCounter(el, target, duration = 800) {
  if (!el) return;
  const start = parseInt(el.textContent) || 0;
  const range = target - start;
  const step  = 16;
  const steps = Math.ceil(duration / step);
  let current = 0;
  const timer = setInterval(() => {
    current++;
    el.textContent = Math.round(start + (range * current / steps));
    if (current >= steps) {
      el.textContent = target;
      clearInterval(timer);
    }
  }, step);
}

// ── DETECTAR DISPOSITIVO ───────────────────────────────────────
// Usa matchMedia (mais confiável que UA sniffing, cobre DevTools e tablets)
const isMobile = window.matchMedia('(max-width: 768px)').matches;

// ── RIPPLE EFFECT EM BOTÕES ────────────────────────────────────
function addRippleEffect() {
  document.querySelectorAll('.btn, .game-card, .ranking-row').forEach(el => {
    el.addEventListener('click', function(e) {
      const ripple = document.createElement('span');
      const rect   = this.getBoundingClientRect();
      const size   = Math.max(rect.width, rect.height);
      ripple.style.cssText = `
        position:absolute;
        width:${size}px;height:${size}px;
        left:${e.clientX - rect.left - size/2}px;
        top:${e.clientY - rect.top  - size/2}px;
        background:rgba(255,255,255,0.08);
        border-radius:50%;
        transform:scale(0);
        animation:ripple 0.5s linear;
        pointer-events:none;
      `;
      this.style.position = 'relative';
      this.style.overflow = 'hidden';
      this.appendChild(ripple);
      setTimeout(() => ripple.remove(), 500);
    });
  });
}

// ── SCROLL TO TOP ──────────────────────────────────────────────
function scrollToTop(smooth = true) {
  window.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
}

// ── NORMALIZE TEAM SLUG ────────────────────────────────────────
// Maps SDB numeric IDs (e.g. "sdb-133604") to slug keys used in
// the TEAMS object on time.html. Falls back to slug-ifying the
// raw string when no mapping is found.
// FIX 2 — corrected verified SDB IDs for all clubs
const _SDB_TO_SLUG = {
  // Brazilian clubs
  '134316': 'flamengo',
  '146363': 'palmeiras',
  '146366': 'botafogo',
  '146367': 'fluminense',
  '133601': 'corinthians',
  '146368': 'sao-paulo',
  '133609': 'gremio',
  '133611': 'internacional',
  '133607': 'atletico-mg',
  '133608': 'bragantino',
  '133617': 'vasco',
  // Premier League
  '133604': 'arsenal',
  '133610': 'chelsea',
  '133612': 'liverpool',
  '133613': 'man-city',
  '133616': 'man-united',
  '133619': 'tottenham',
  '133614': 'newcastle',
  // La Liga
  '133728': 'real-madrid',
  '133739': 'barcelona',
  '133732': 'atletico',
  // Serie A Italy
  '133706': 'juventus',
  '133704': 'inter',
  '133703': 'ac-milan',
  '133701': 'napoli',
  '133735': 'roma',
  // Ligue 1
  '133731': 'psg',
  '133724': 'lyon',
  '133720': 'marseille',
  '133721': 'monaco',
  // Bundesliga
  '133719': 'bayern',
  '133718': 'dortmund',
  '133705': 'leverkusen',
  // Other
  '133772': 'benfica',
  '133765': 'porto',
  '133769': 'sporting-cp',
  '133632': 'ajax',
  '133761': 'torino',
};

function normalizeTeamSlug(input) {
  if (!input) return '';
  const s = String(input);
  // Handle "sdb-<number>" format
  const sdbMatch = s.match(/^sdb-(\d+)$/i);
  if (sdbMatch) {
    return _SDB_TO_SLUG[sdbMatch[1]] || sdbMatch[1];
  }
  // Handle plain numeric IDs
  if (/^\d+$/.test(s)) {
    return _SDB_TO_SLUG[s] || s;
  }
  // Already a slug or short code — slug-ify just in case
  return s.toLowerCase().replace(/[\s\.]+/g, '-').replace(/[^a-z0-9-]/g, '');
}
window.normalizeTeamSlug = normalizeTeamSlug;

// ── UPDATE SIDEBAR USER ────────────────────────────────────────
function updateSidebarUser() {
  try {
    const name = localStorage.getItem('zs_user_name') || 'Usuário';
    const plan = getUserPlan();
    document.querySelectorAll('.sidebar__user-name').forEach(el => {
      el.textContent = name;
    });
    document.querySelectorAll('.sidebar__user-avatar').forEach(el => {
      el.textContent = (name[0] || 'U').toUpperCase();
    });
    document.querySelectorAll('.sidebar__user-plan').forEach(el => {
      el.textContent = plan === 'pro' ? 'Plano Pro' : 'Plano Free';
    });
  } catch {}
}
window.updateSidebarUser = updateSidebarUser;

// ── MODAL (reutilizável em qualquer página) ────────────────────
/**
 * Abre um modal pelo ID do elemento.
 * Suporta modais com inline display:none (cadastro.html) e
 * com classe .show (perfil.html).
 * @param {string} id - ID do elemento modal
 */
function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  // Inline-style modals: remove o display:none e mostra com block
  if (el.style.display === 'none') el.style.display = 'block';
  // Class-based modals
  el.classList.add('show');
  document.body.style.overflow = 'hidden';
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

/**
 * Fecha um modal pelo ID do elemento.
 * @param {string} id - ID do elemento modal
 */
function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('show');
  // Restaura inline display:none para modais que o usam
  el.style.display = 'none';
  document.body.style.overflow = '';
}
window.openModal  = openModal;
window.closeModal = closeModal;

// ── DESKTOP NAVBAR PAGE TITLE ────────────────────────────────
// Desativado: telas não mostram o próprio nome na barra superior.
// O hambúrguer + brand na sidebar já identificam o contexto.
function initDesktopNavTitle() { /* desativado por design */ }

// ── NAVBAR CONSISTENCY — garante PRO badge + tema + busca + sino ──
/**
 * Injeta os elementos padrão da navbar em TODAS as telas, mesmo as que
 * não têm .navbar__actions (ex: telas com back-button).
 * Ordem: [hamburger] [brand/back] ... [FREE] [crown] [theme] [search] [bell]
 */
function ensureNavbarConsistency() {
  const navbar = document.querySelector('.navbar');
  if (!navbar) return;

  // Garante que .navbar__actions existe
  let actions = navbar.querySelector('.navbar__actions');
  if (!actions) {
    actions = document.createElement('div');
    actions.className = 'navbar__actions';
    actions.style.cssText = 'display:flex;align-items:center;gap:4px;margin-left:auto;flex-shrink:0;';
    navbar.appendChild(actions);
  }

  // Ícone de busca (se ainda não existir)
  if (!actions.querySelector('a[href*="busca"]')) {
    const search = document.createElement('a');
    search.href = 'busca.html';
    search.className = 'navbar__icon';
    search.title = 'Buscar';
    search.setAttribute('aria-label', 'Buscar');
    search.innerHTML = '<i data-lucide="search" style="width:18px;height:18px;"></i>';
    actions.appendChild(search);
  }

  // Ícone de notificações + badge (se ainda não existir)
  if (!actions.querySelector('a[href*="notificacoes"]')) {
    const bell = document.createElement('a');
    bell.href = 'notificacoes.html';
    bell.className = 'navbar__icon';
    bell.id = 'notifBtn';
    bell.title = 'Notificações';
    bell.setAttribute('aria-label', 'Notificações');
    bell.innerHTML = '<i data-lucide="bell" style="width:18px;height:18px;"></i>';
    bell.style.position = 'relative';
    actions.appendChild(bell);
  }

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ── SIDEBAR SECTION LABEL ─────────────────────────────────────
/**
 * Adds a "NAVEGAÇÃO" section label above the first nav item on desktop.
 * Makes the sidebar feel more structured.
 */
function initSidebarLabel() {
  if (window.innerWidth < 1024) return;
  const nav = document.querySelector('.sidebar__nav');
  if (!nav || nav.querySelector('.sidebar__section-label')) return;
  const label = document.createElement('div');
  label.className = 'sidebar__section-label';
  label.textContent = 'NAVEGAÇÃO';
  nav.prepend(label);
}

// ── INJETAR FAVORITOS NA SIDEBAR ──────────────────────────────
/**
 * Adiciona o link "Favoritos" na sidebar entre Ligas/Times e Perfil,
 * caso ainda não exista. Roda após DOMContentLoaded em todas as páginas.
 */
function injectFavoritosNav() {
  const sidebarNav = document.querySelector('.sidebar__nav');
  if (!sidebarNav) return;
  if (sidebarNav.querySelector('a[href="favoritos.html"]')) return;
  const link = document.createElement('a');
  link.href      = 'favoritos.html';
  link.className = 'sidebar__nav-item';
  link.innerHTML = '<i data-lucide="heart"></i><span>Favoritos</span>';
  // Insere antes de Perfil, ou no final
  const perfil = sidebarNav.querySelector('a[href="perfil.html"]');
  if (perfil) sidebarNav.insertBefore(link, perfil);
  else sidebarNav.appendChild(link);
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [link] });
}

// ── BOTTOM NAV (mobile) ───────────────────────────────────────
function initBottomNav() {
  const nav = document.querySelector('.bottom-nav');
  if (!nav) return;
  const current = window.location.pathname.split('/').pop() || 'home.html';
  const items = [
    { href: 'home.html',    icon: 'home',    label: 'Home' },
    { href: 'zebras.html',  icon: 'zap',     label: 'Zebras' },
    { href: 'liga.html',    icon: 'trophy',  label: 'Ligas' },
    { href: 'busca.html',   icon: 'search',  label: 'Busca' },
    { href: 'perfil.html',  icon: 'user',    label: 'Perfil' },
  ];
  nav.innerHTML = items.map(item => {
    const active = item.href === current || (current === '' && item.href === 'home.html');
    return `<a href="${item.href}" class="bottom-nav__item${active ? ' active' : ''}">
      <span class="bottom-nav__icon"><i data-lucide="${item.icon}" style="width:20px;height:20px;display:block;"></i></span>
      ${item.label}
    </a>`;
  }).join('');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ── SIDEBAR ATIVA POR PÁGINA ──────────────────────────────────
function initSidebarActive() {
  const path = window.location.pathname.split('/').pop() || 'home.html';
  document.querySelectorAll('.sidebar__nav-item').forEach(a => {
    a.classList.toggle('active', a.getAttribute('href') === path);
  });
  document.querySelectorAll('.bottom-nav__item').forEach(a => {
    a.classList.toggle('active', a.getAttribute('href') === path);
  });
}

// ── PULL-TO-REFRESH ───────────────────────────────────────────
function initPullToRefresh(callback) {
  let startY = 0;
  let pulling = false;
  const indicator = document.querySelector('.ptr-indicator');

  document.addEventListener('touchstart', e => {
    startY = e.touches[0].clientY;
    pulling = window.scrollY === 0;
  }, { passive: true });

  document.addEventListener('touchend', e => {
    if (!pulling) return;
    const deltaY = e.changedTouches[0].clientY - startY;
    if (deltaY >= 60) {
      if (indicator) indicator.classList.add('visible');
      if (typeof callback === 'function') callback();
      setTimeout(() => {
        if (indicator) indicator.classList.remove('visible');
      }, 1500);
    }
    pulling = false;
  }, { passive: true });
}

// ── EMPTY STATE HTML ──────────────────────────────────────────
function emptyStateHTML(icon, title, sub, actionLabel, actionHref) {
  return `<div class="empty-state">
    <i data-lucide="${icon}" style="width:32px;height:32px;"></i>
    <div class="empty-state__title">${title}</div>
    ${sub ? `<div class="empty-state__sub">${sub}</div>` : ''}
    ${actionLabel ? `<a href="${actionHref}" class="filter-chip" style="margin-top:8px;">${actionLabel}</a>` : ''}
  </div>`;
}

// ── HAMBURGER MENU (desktop + mobile) ────────────────────────
function initHamburger() {
  const navbar = document.querySelector('.navbar');
  const sidebar = document.querySelector('.app-sidebar');
  if (!navbar || !sidebar) return;

  // Botão hambúrguer — display controlado pelo CSS (flex em ≥768px, none em mobile)
  const btn = document.createElement('button');
  btn.className = 'hamburger-btn navbar__icon';
  btn.setAttribute('aria-label', 'Menu');
  btn.style.cssText = 'background:none;border:none;cursor:pointer;color:var(--white);align-items:center;justify-content:center;width:36px;height:36px;border-radius:8px;flex-shrink:0;';
  btn.innerHTML = '<i data-lucide="menu" style="width:20px;height:20px;"></i>';
  navbar.insertBefore(btn, navbar.firstChild);

  // Backdrop
  const backdrop = document.createElement('div');
  backdrop.className = 'sidebar-backdrop';
  document.body.appendChild(backdrop);

  // Botão fechar dentro da sidebar
  let closeBtn = sidebar.querySelector('.sidebar-close-btn');
  if (!closeBtn) {
    closeBtn = document.createElement('button');
    closeBtn.className = 'sidebar-close-btn';
    closeBtn.setAttribute('aria-label', 'Fechar menu');
    closeBtn.style.cssText = 'position:absolute;top:14px;right:14px;background:none;border:none;cursor:pointer;color:var(--gray);display:none;align-items:center;padding:4px;border-radius:6px;';
    closeBtn.innerHTML = '<i data-lucide="x" style="width:18px;height:18px;"></i>';
    sidebar.style.position = 'fixed'; // garante posicionamento
    sidebar.appendChild(closeBtn);
  }

  function openSidebar() {
    sidebar.classList.add('sidebar--open');
    backdrop.classList.add('active');
    document.body.style.overflow = 'hidden';
    closeBtn.style.display = 'flex';
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
  function closeSidebar() {
    sidebar.classList.remove('sidebar--open');
    backdrop.classList.remove('active');
    document.body.style.overflow = '';
    closeBtn.style.display = 'none';
  }

  btn.addEventListener('click', () => {
    sidebar.classList.contains('sidebar--open') ? closeSidebar() : openSidebar();
  });
  backdrop.addEventListener('click', closeSidebar);
  closeBtn.addEventListener('click', closeSidebar);

  // Fecha ao navegar por um link da sidebar
  sidebar.querySelectorAll('.sidebar__nav-item').forEach(link => {
    link.addEventListener('click', closeSidebar);
  });

  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [btn] });
}

// ── PLAN BADGE (FREE/crown) ────────────────────────────────────
function initPlanBadge() {
  // Only inject on pages that have .navbar__actions (brand pages)
  // Back-button pages (alertas, perfil, partida…) do NOT have .navbar__actions
  const actions = document.querySelector('.navbar__actions');
  if (!actions) return;

  // Dedup: skip if any plan indicator already present
  if (actions.querySelector('.plan-badge, #planBadge, .badge--free')) return;

  const plan = localStorage.getItem('zebrastats_plan') || 'free';
  if (plan === 'pro') return; // PRO users don't see FREE badge

  // FREE badge (subtle pill)
  const badge = document.createElement('span');
  badge.className = 'plan-badge';
  badge.textContent = 'FREE';
  badge.style.cssText = 'font-size:0.6rem;font-weight:800;padding:2px 6px;border-radius:4px;background:transparent;color:var(--text-muted,#888);border:1px solid var(--border,#2a2a3e);letter-spacing:0.05em;cursor:pointer;white-space:nowrap;flex-shrink:0;';
  badge.addEventListener('click', () => { window.location.href = 'assinatura.html'; });

  // Crown upgrade button
  const crown = document.createElement('button');
  crown.className = 'navbar__icon plan-crown';
  crown.title = 'Fazer upgrade para PRO';
  crown.setAttribute('aria-label', 'Upgrade para PRO');
  crown.style.cssText = 'background:var(--gold-dim,rgba(255,200,50,0.1));color:var(--gold,#FFD700);border:1px solid rgba(255,200,50,0.25);flex-shrink:0;';
  crown.innerHTML = '<i data-lucide="crown" style="width:16px;height:16px;"></i>';
  crown.addEventListener('click', () => { window.location.href = 'assinatura.html'; });

  // Prepend: FREE badge then crown, before the existing icons
  actions.prepend(crown);
  actions.prepend(badge);

  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [crown] });
}

// ── INIT GLOBAL ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  ensureNavbarConsistency(); // garante search + bell em TODAS as telas (antes dos outros inits)
  updatePlanBadge();
  addRippleEffect();
  injectFavoritosNav(); // must run BEFORE setActiveNavItem so the Favoritos link exists when active-state is assigned
  setActiveNavItem();
  initSidebarActive();
  initThemeToggle();
  initPlanBadge();
  initDesktopNavTitle(); // no-op — desativado
  initSidebarLabel();
  updateSidebarUser();
  initBottomNav();
  initHamburger();
  initBellBadge();

  // ── PWA: inject manifest link ──────────────────────────────────
  if (!document.querySelector('link[rel="manifest"]')) {
    const _mlink = document.createElement('link');
    _mlink.rel   = 'manifest';
    _mlink.href  = 'manifest.json';
    document.head.appendChild(_mlink);
  }

  // ── PWA: register service worker ──────────────────────────────
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }

  // Adiciona animação de ripple e spinner via CSS
  const style = document.createElement('style');
  style.textContent = `
    @keyframes ripple {
      to { transform: scale(2.5); opacity: 0; }
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    @keyframes fadeInUp {
      from { opacity: 0; transform: translateY(16px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes fav-pop {
      0%   { transform: scale(1); }
      35%  { transform: scale(1.55) rotate(-8deg); }
      60%  { transform: scale(0.88) rotate(4deg); }
      80%  { transform: scale(1.12); }
      100% { transform: scale(1); }
    }
    .fav-pop { animation: fav-pop 0.42s cubic-bezier(.36,.07,.19,.97) both; }
    .fade-in-up {
      animation: fadeInUp 0.35s ease both;
    }
    .card, .game-card, .plan-card, .auth-card {
      animation: fadeInUp 0.35s ease both;
    }
  `;
  document.head.appendChild(style);
});
