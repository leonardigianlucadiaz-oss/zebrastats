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

// ── FAVORITOS (localStorage) ───────────────────────────────────
const FAVORITES_KEY = 'zebrastats_favorites';

function getFavorites() {
  try {
    return JSON.parse(localStorage.getItem(FAVORITES_KEY)) || [];
  } catch {
    return [];
  }
}

function saveFavorites(favs) {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs));
  } catch (e) {
    console.warn('localStorage indisponível:', e);
  }
}

function toggleFavorite(teamId, teamName) {
  const favs = getFavorites();
  const idx  = favs.indexOf(teamId);
  if (idx >= 0) {
    favs.splice(idx, 1);
    showToast(`${teamName} removido dos favoritos`);
  } else {
    favs.push(teamId);
    showToast(`⭐ ${teamName} adicionado aos favoritos`);
  }
  saveFavorites(favs);
  return favs.includes(teamId);
}

function isFavorite(teamId) {
  return getFavorites().includes(teamId);
}

// ── PLANO DO USUÁRIO (localStorage) ───────────────────────────
const PLAN_KEY = 'zebrastats_plan';

function getUserPlan() {
  return localStorage.getItem(PLAN_KEY) || 'free';
}

function setUserPlan(plan) {
  localStorage.setItem(PLAN_KEY, plan);
}

// ── BADGE DE PLANO NA NAVBAR ───────────────────────────────────
function updatePlanBadge() {
  const badge = document.querySelector('.badge--free, .badge--pro');
  if (!badge) return;
  const plan = getUserPlan();
  if (plan === 'pro') {
    badge.textContent = 'PRO';
    badge.className   = badge.className.replace('badge--free', 'badge--pro');
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

// ── NAVEGAÇÃO ATIVA (bottom nav) ──────────────────────────────
function setActiveNavItem() {
  const current = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.bottom-nav__item').forEach(item => {
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
    .fade-in-up {
      animation: fadeInUp 0.35s ease both;
    }
    .card, .game-card, .plan-card, .auth-card {
      animation: fadeInUp 0.35s ease both;
    }
  `;
  document.head.appendChild(style);
});
