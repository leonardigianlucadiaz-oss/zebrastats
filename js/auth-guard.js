/* ZebraStats — auth-guard.js
 * Verificação de sessão em páginas protegidas.
 * Redireciona para index.html se não autenticado.
 * Redireciona para assinatura.html se rota exige PRO.
 *
 * Uso: inclua este arquivo ANTES do script inline de cada página.
 * Páginas PRO: adicione data-pro-only="true" ao <html> tag.
 */
(async function _authGuard() {
  // Páginas públicas — nunca redirecionar
  const PUBLIC_PAGES = ['index.html', 'cadastro.html', 'onboarding.html', ''];
  const currentPage  = location.pathname.split('/').pop() || 'index.html';
  if (PUBLIC_PAGES.includes(currentPage)) return;

  // Aguarda Supabase estar disponível
  if (typeof ZebraAuth === 'undefined') {
    // auth.js não carregou (CDN timeout?) — redireciona para login por segurança
    const PUBLIC_CHECK = ['index.html', 'cadastro.html', 'onboarding.html', ''];
    const pg = location.pathname.split('/').pop() || 'index.html';
    if (!PUBLIC_CHECK.includes(pg)) {
      window.location.replace('index.html');
    }
    return;
  }

  const user = await ZebraAuth.getSessionUser();

  if (!user) {
    // Não autenticado — redireciona para login
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
})();
