/* ============================================================
   ZebraStats — main.js
   Utilitários globais compartilhados entre todas as telas
   ============================================================ */

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
window.TEAM_LOGOS  = window.TEAM_LOGOS  || {};
window.LEAGUE_LOGOS = window.LEAGUE_LOGOS || {};

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
  const current = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.bottom-nav__item, .sidebar__nav-item').forEach(item => {
    const href = item.getAttribute('href') || '';
    if (href && current.includes(href.replace('.html',''))) {
      item.classList.add('active');
    }
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
const isMobile = /Mobi|Android|iPhone/i.test(navigator.userAgent);

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

// ── INIT GLOBAL ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  updatePlanBadge();
  addRippleEffect();
  setActiveNavItem();

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
