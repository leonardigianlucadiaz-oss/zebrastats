/* ZebraStats — auth-guard.js
 * Verificação de sessão em páginas protegidas.
 * Redireciona para index.html se não autenticado.
 * Suporta modo convidado (zs_guest=1 no localStorage).
 */
(async function _authGuard() {
  const PUBLIC_PAGES = ['index.html', 'cadastro.html', 'onboarding.html', ''];
  const currentPage  = location.pathname.split('/').pop() || 'index.html';
  if (PUBLIC_PAGES.includes(currentPage)) return;

  // ── MODO CONVIDADO ─────────────────────────────────────────
  // Se usuário entrou como convidado, permite acesso sem Supabase
  if (localStorage.getItem('zs_guest') === '1') {
    document.addEventListener('DOMContentLoaded', () => {
      _injectGuestBanner();
      _injectGuestSidebarInfo();
    });
    return;
  }

  // auth.js não carregou (CDN timeout?) — fail closed
  if (typeof ZebraAuth === 'undefined') {
    window.location.replace('index.html');
    return;
  }

  const user = await ZebraAuth.getSessionUser();

  if (!user) {
    const redirect = encodeURIComponent(location.pathname + location.search);
    window.location.replace(`index.html?next=${redirect}`);
    return;
  }

  // Verifica se a página exige PRO
  const isProPage = document.documentElement.dataset.proOnly === 'true';
  if (isProPage && !ZebraAuth.isPro(user)) {
    window.location.replace('assinatura.html');
    return;
  }

  // Inicializa UI com dados reais do usuário
  document.addEventListener('DOMContentLoaded', async () => {
    await ZebraAuth.initAuthUI();
    if (typeof ZebraDB !== 'undefined') {
      await ZebraDB.migrateLocalStorageToSupabase();
    }
  });

  // ── HELPERS MODO CONVIDADO ─────────────────────────────────
  function _injectGuestBanner() {
    if (document.getElementById('guestBanner')) return;
    const banner = document.createElement('div');
    banner.id = 'guestBanner';
    banner.style.cssText = [
      'position:fixed', 'bottom:70px', 'left:50%', 'transform:translateX(-50%)',
      'z-index:9999', 'background:var(--bg-card,#1a1a2e)',
      'border:1px solid var(--green,#2EE65C)', 'border-radius:12px',
      'padding:10px 16px', 'display:flex', 'align-items:center', 'gap:10px',
      'font-size:0.8rem', 'box-shadow:0 4px 20px rgba(0,0,0,0.4)',
      'white-space:nowrap', 'max-width:90vw',
    ].join(';');
    banner.innerHTML = `
      <span style="color:var(--text-muted);">Você está como <strong style="color:var(--white);">Convidado</strong></span>
      <a href="cadastro.html" style="color:var(--green);font-weight:700;text-decoration:none;">Criar conta</a>
      <span style="color:var(--border);">|</span>
      <a href="index.html" onclick="localStorage.removeItem('zs_guest')" style="color:var(--text-muted);text-decoration:none;">Sair</a>
    `;
    document.body.appendChild(banner);
  }

  function _injectGuestSidebarInfo() {
    const sidebarName  = document.querySelector('.sidebar__user-name');
    const sidebarPlan  = document.querySelector('.sidebar__user-plan');
    const sidebarAvatar = document.querySelector('.sidebar__user-avatar');
    if (sidebarName)   sidebarName.textContent  = 'Convidado';
    if (sidebarPlan)   sidebarPlan.textContent  = 'Modo Visitante';
    if (sidebarAvatar) sidebarAvatar.textContent = '?';
    localStorage.setItem('zs_user_name', 'Convidado');
    localStorage.setItem('zs_user_plan', 'free');
  }
})();
