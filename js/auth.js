/* ZebraStats — auth.js
 * Supabase Auth client + helpers compartilhados em todas as páginas.
 * Supabase JS carregado via CDN antes deste arquivo.
 */

const SUPA_URL  = 'https://wjiicdzpjxacqjwxmtqy.supabase.co';
const SUPA_ANON = 'sb_publishable_fpVIYjV2j7N39MWz81Lumg_WjODiChX';

// Inicializa o cliente Supabase (singleton)
let _supaClient = null;
function getSupabase() {
  if (!_supaClient) {
    if (typeof supabase === 'undefined') {
      console.error('[Auth] @supabase/supabase-js não carregado');
      return null;
    }
    _supaClient = supabase.createClient(SUPA_URL, SUPA_ANON);
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
  if (!error && data?.user) {
    // Cria perfil na tabela profiles
    await sb.from('profiles').upsert({
      id: data.user.id,
      name,
      plan: 'free',
      created_at: new Date().toISOString()
    });
  }
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
  return await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + '/home.html' }
  });
}

async function authSignOut() {
  const sb = getSupabase();
  if (!sb) return;
  await sb.auth.signOut();
  // Limpa dados de sessão local (mantém tema)
  const theme = localStorage.getItem('zs_theme');
  localStorage.clear();
  if (theme) localStorage.setItem('zs_theme', theme);
  window.location.href = 'index.html';
}

async function authResetPassword(email) {
  const sb = getSupabase();
  if (!sb) return { error: { message: 'Supabase indisponível' } };
  return await sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/index.html?reset=1'
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

function getUserPlan(user) {
  return user?.user_metadata?.plan || 'free';
}

function isPro(user) {
  return getUserPlan(user) === 'pro';
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
    const plan  = getUserPlan(user);
    const initial = name.charAt(0).toUpperCase();

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
    localStorage.setItem('zs_user_name',  name);
    localStorage.setItem('zs_user_email', email);
    localStorage.setItem('zs_user_plan',  plan);
  }

  // Listener de mudança de estado (login/logout em outra aba)
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      window.location.href = 'index.html';
    }
  });
}

// Exporta para uso global
window.ZebraAuth = {
  getSupabase, authSignUp, authSignIn, authSignInGoogle, authSignOut,
  authResetPassword, getSessionUser, getProfile, getUserPlan, isPro,
  initAuthUI
};
