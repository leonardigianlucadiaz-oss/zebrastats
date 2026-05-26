/* ZebraStats — auth.js
 * Supabase Auth client + helpers compartilhados em todas as páginas.
 * Supabase JS carregado via CDN antes deste arquivo.
 */

// ── CONSTANTES vindas de config.js (fonte única de verdade — fix #10) ──────
// ZEBRA_CONFIG.SUPABASE_URL / ZEBRA_CONFIG.SUPABASE_ANON são a referência canônica.
// Nunca duplique essas chaves aqui.

// Inicializa o cliente Supabase (singleton)
let _supaClient = null;
function getSupabase() {
  if (!_supaClient) {
    if (typeof supabase === 'undefined') {
      console.error('[Auth] @supabase/supabase-js não carregado');
      return null;
    }
    if (typeof ZEBRA_CONFIG === 'undefined') {
      console.error('[Auth] ZEBRA_CONFIG não carregado (config.js deve vir antes de auth.js)');
      return null;
    }
    _supaClient = supabase.createClient(
      ZEBRA_CONFIG.SUPABASE_URL,
      ZEBRA_CONFIG.SUPABASE_ANON
    );
  }
  return _supaClient;
}

// ── AUTH FUNCTIONS ─────────────────────────────────────────────

async function authSignUp(name, email, password) {
  const sb = getSupabase();
  if (!sb) return { error: { message: 'Supabase indisponível' } };
  const { data, error } = await sb.auth.signUp({
    email, password,
    options: { data: { full_name: name, plan: 'free' } }
  });
  // Fix #7: Não faz upsert manual aqui — o trigger on_auth_user_created
  // → handle_new_user() já cria o perfil no banco. Dois writes simultâneos
  // causavam condição de corrida.
  return { data, error };
}

async function authSignIn(email, password) {
  const sb = getSupabase();
  if (!sb) return { error: { message: 'Supabase indisponível' } };
  return await sb.auth.signInWithPassword({ email, password });
}

async function authSignInGoogle() {
  const sb = getSupabase();
  if (!sb) return;
  // Fix #1: usa BASE_URL para funcionar em GitHub Pages com subdiretório
  const base = (typeof ZEBRA_CONFIG !== 'undefined') ? ZEBRA_CONFIG.BASE_URL : window.location.origin;
  return await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${base}/home.html` }
  });
}

async function authSignOut() {
  const sb = getSupabase();
  if (!sb) return;
  await sb.auth.signOut();
  // Fix #18: preserva tema E flag de migração concluída para não perder dados
  // Read uid and migrated key BEFORE clear() so the key suffix is not empty
  const uid      = localStorage.getItem('zs_uid') || '';
  const theme    = localStorage.getItem('zs_theme');
  const migrated = localStorage.getItem(`zs_migrated_${uid}`);
  // Fix [09]: preserva flag de visitante para não perder o header x-zs-guest: 1 após logout
  const wasGuest = localStorage.getItem('zs_guest') === '1'
  localStorage.clear();
  if (theme)    localStorage.setItem('zs_theme', theme);
  if (uid && migrated) localStorage.setItem(`zs_migrated_${uid}`, migrated);
  if (wasGuest) localStorage.setItem('zs_guest', '1')
  window.location.href = 'index.html';
}

async function authUpdatePassword(newPassword) {
  const sb = getSupabase();
  if (!sb) return { error: { message: 'Supabase indisponível' } };
  const { data, error } = await sb.auth.updateUser({ password: newPassword });
  return { data, error };
}

async function authResetPassword(email) {
  const sb = getSupabase();
  if (!sb) return { error: { message: 'Supabase indisponível' } };
  // Fix #1: usa BASE_URL para funcionar em GitHub Pages com subdiretório
  const base = (typeof ZEBRA_CONFIG !== 'undefined') ? ZEBRA_CONFIG.BASE_URL : window.location.origin;
  return await sb.auth.resetPasswordForEmail(email, {
    redirectTo: `${base}/index.html?reset=1`
  });
}

async function getSessionUser() {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getUser();
  return data?.user || null;
}

async function getProfile(userId) {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.from('profiles').select('*').eq('id', userId).single();
  return data;
}

// ── PLAN HELPERS ──────────────────────────────────────────────

// Fallback síncrono (apenas para verificações rápidas de UI local)
function getUserPlan(user) {
  // Fix #3: usa a chave canônica 'zebrastats_plan' (alinhada com main.js)
  return localStorage.getItem('zebrastats_plan')
    || user?.user_metadata?.plan
    || 'free';
}

function isPro(user) {
  return getUserPlan(user) === 'pro';
}

// Fix #2: versão assíncrona que consulta profiles (fonte autoritativa do Stripe)
async function isProFromDB(userId) {
  const sb = getSupabase();
  if (!sb || !userId) return false;
  try {
    const { data } = await sb.from('profiles').select('plan').eq('id', userId).single();
    return data?.plan === 'pro';
  } catch { return false; }
}

// ── AUTH STATE LISTENER ────────────────────────────────────────

/**
 * Injeta dados reais do usuário no sidebar e navbar de qualquer página.
 * Chamado no DOMContentLoaded de todas as páginas autenticadas.
 */
async function initAuthUI() {
  const sb = getSupabase();
  if (!sb) return;

  const { data: { session } } = await sb.auth.getSession();
  const user = session?.user;

  if (user) {
    const name  = user.user_metadata?.full_name || user.email?.split('@')[0] || 'Usuário';
    const email = user.email || '';
    const initial = name.charAt(0).toUpperCase();

    // Fix #2: plano autoritativo vem da tabela profiles (atualizada pelo Stripe webhook).
    // user_metadata.plan só reflete o momento do cadastro — não acompanha upgrades.
    let plan = user.user_metadata?.plan || 'free';
    try {
      const { data: profile } = await sb.from('profiles').select('plan').eq('id', user.id).single();
      if (profile?.plan) plan = profile.plan;
    } catch { /* usa fallback acima */ }

    // Sidebar user info
    const sidebarName  = document.querySelector('.sidebar__user-name');
    const sidebarPlan  = document.querySelector('.sidebar__user-plan');
    const sidebarAvatar = document.querySelector('.sidebar__user-avatar');
    if (sidebarName)  sidebarName.textContent  = name.split(' ')[0];
    if (sidebarPlan)  sidebarPlan.textContent  = plan === 'pro' ? 'Plano PRO 🟢' : 'Plano Free';
    if (sidebarAvatar) sidebarAvatar.textContent = initial;

    // Perfil.html specific elements
    const elName   = document.getElementById('userName');
    const elEmail  = document.getElementById('userEmail');
    const elBadge  = document.getElementById('planBadge');
    const elAvatar = document.getElementById('avatarEl');
    if (elName)   elName.textContent  = name;
    if (elEmail)  elEmail.textContent = email;
    if (elAvatar) elAvatar.textContent = initial;
    if (elBadge) {
      elBadge.textContent = plan === 'pro' ? 'PRO' : 'FREE';
      elBadge.className = plan === 'pro' ? 'badge badge--pro' : 'badge badge--free';
    }

    // Esconde badge FREE→PRO no sidebar se já for PRO
    if (plan === 'pro') {
      document.querySelectorAll('.badge--free').forEach(b => b.style.display = 'none');
    }

    // Salva em localStorage para acesso offline rápido
    // Fix #3: usa 'zebrastats_plan' — mesma chave de main.js (PLAN_KEY)
    localStorage.setItem('zs_user_name',    name);
    localStorage.setItem('zs_user_email',   email);
    localStorage.setItem('zs_uid',          user.id);
    localStorage.setItem('zebrastats_plan', plan); // chave canônica
  }

  // Listener de mudança de estado (login/logout em outra aba)
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      // Fix [11]: evita loop de redirecionamento se já estiver em página de login/cadastro
      const onLoginPage = window.location.pathname.includes('index.html') ||
                          window.location.pathname.includes('cadastro.html') ||
                          window.location.pathname === '/' ||
                          window.location.pathname.endsWith('/')
      if (!onLoginPage) {
        window.location.href = 'index.html'
      }
    }
  });
}

// Exporta para uso global
window.ZebraAuth = {
  getSupabase, authSignUp, authSignIn, authSignInGoogle, authSignOut,
  authUpdatePassword,
  authResetPassword, getSessionUser, getProfile, getUserPlan, isPro,
  isProFromDB,  // Fix #2: versão async consultando profiles table
  initAuthUI
};
