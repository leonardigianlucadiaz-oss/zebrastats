/* ZebraStats — db.js
 * CRUD para tabelas Supabase: profiles, user_favorites,
 * user_alerts, user_settings, zebra_history.
 * Migra automaticamente do localStorage no primeiro login.
 */

// ── SESSION CACHE (fix #16) ────────────────────────────────────
// Usa getSession() (leitura em memória) em vez de getUser() (request de rede)
// para evitar múltiplas chamadas à API por operação.
let _cachedUser    = null;
let _cachedUserTs  = 0;
const _USER_TTL    = 60_000; // 1 minuto

async function _getUser() {
  if (_cachedUser && Date.now() - _cachedUserTs < _USER_TTL) return _cachedUser;
  const sb = ZebraAuth.getSupabase();
  if (!sb) return null;
  const { data: { session } } = await sb.auth.getSession();
  _cachedUser   = session?.user || null;
  _cachedUserTs = Date.now();
  return _cachedUser;
}

// Invalida cache ao fazer logout
window.addEventListener('zs:signout', () => { _cachedUser = null; });

// ── UUID HELPER (fix #8) ───────────────────────────────────────
function _isUUID(id) {
  return typeof id === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}
function _newUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
// Mapa estável de IDs legados (numéricos/string) → UUIDs
function _resolveAlertId(id) {
  if (_isUUID(id)) return id;
  const mapKey = 'zs_alert_id_map';
  let map = {};
  try { map = JSON.parse(localStorage.getItem(mapKey) || '{}'); } catch {}
  if (!map[id]) { map[id] = _newUUID(); localStorage.setItem(mapKey, JSON.stringify(map)); }
  return map[id];
}

// ── FAVORITES ─────────────────────────────────────────────────

async function dbGetFavorites() {
  const sb   = ZebraAuth.getSupabase();
  const user = await _getUser();
  if (!sb || !user) return getFavorites(); // fallback localStorage
  const { data } = await sb.from('user_favorites')
    .select('team_id, team_name, team_meta')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  // Fix #6: retorna objetos completos (não só IDs) para favoritos.html
  return (data || []).map(r => ({
    id:   r.team_id,
    name: r.team_name || r.team_id,
    meta: r.team_meta || {},
  }));
}

async function dbToggleFavorite(teamId, teamName, meta = {}) {
  const sb   = ZebraAuth.getSupabase();
  const user = await _getUser(); // fix #16: usa cache em memória
  if (!sb || !user) return toggleFavorite(teamId, teamName, meta); // fallback

  const { data: existing } = await sb.from('user_favorites')
    .select('id').eq('user_id', user.id).eq('team_id', teamId).single();

  if (existing) {
    await sb.from('user_favorites').delete().eq('id', existing.id);
    return false;
  } else {
    await sb.from('user_favorites').insert({
      user_id: user.id, team_id: teamId,
      team_name: teamName, team_meta: meta
    });
    return true;
  }
}

async function dbIsFavorite(teamId) {
  const sb   = ZebraAuth.getSupabase();
  const user = await _getUser(); // fix #16: usa cache em memória
  if (!sb || !user) return getFavorites().includes(teamId);
  // Fix [27]: maybeSingle() evita erro quando há 0 linhas (single() lança erro nesse caso)
  const { data } = await sb.from('user_favorites')
    .select('id').eq('user_id', user.id).eq('team_id', teamId).maybeSingle();
  return !!data;
}

// ── PROFILES ──────────────────────────────────────────────────

async function dbUpdateProfile({ name, email } = {}) {
  const sb   = ZebraAuth.getSupabase();
  const user = await _getUser();
  if (!sb || !user) return { error: { message: 'Sem sessão ativa' } };
  const updates = { id: user.id, updated_at: new Date().toISOString() };
  if (name)  updates.full_name = name;
  if (email) updates.email     = email;
  // Fix [05]: removido .eq('id', user.id) — é ignorado silenciosamente pelo Supabase JS v2
  // no contexto de upsert; o campo id no objeto já é a chave de conflito do schema.
  const { data, error } = await sb.from('profiles').upsert(updates);
  return { data, error };
}

// ── SETTINGS ──────────────────────────────────────────────────

async function dbGetSettings() {
  const sb   = ZebraAuth.getSupabase();
  const user = await _getUser();
  if (!sb || !user) return null;
  const { data } = await sb.from('user_settings')
    .select('*').eq('user_id', user.id).single();
  return data;
}

async function dbSaveSettings(settings) {
  const sb   = ZebraAuth.getSupabase();
  const user = await _getUser();
  if (!sb || !user) return;
  await sb.from('user_settings').upsert({
    user_id: user.id, ...settings, updated_at: new Date().toISOString()
  });
}

// ── ALERTS ────────────────────────────────────────────────────

async function dbGetAlerts() {
  const sb   = ZebraAuth.getSupabase();
  const user = await _getUser();
  if (!sb || !user) return JSON.parse(localStorage.getItem('zs_alerts') || '[]');
  const { data } = await sb.from('user_alerts')
    .select('*').eq('user_id', user.id);
  return data || [];
}

async function dbSaveAlert(alert) {
  const sb   = ZebraAuth.getSupabase();
  const user = await _getUser();

  // Fix #8: normaliza ID para UUID — Supabase espera UUID no campo id
  const resolvedId = _resolveAlertId(alert.id || String(Date.now()));
  const normalized = { ...alert, id: resolvedId };

  if (!sb || !user) {
    const alerts = JSON.parse(localStorage.getItem('zs_alerts') || '[]');
    const idx = alerts.findIndex(a => a.id === resolvedId);
    if (idx >= 0) alerts[idx] = normalized; else alerts.push(normalized);
    localStorage.setItem('zs_alerts', JSON.stringify(alerts));
    return;
  }
  await sb.from('user_alerts').upsert({ user_id: user.id, ...normalized });
}

// ── ZEBRA HISTORY ─────────────────────────────────────────────

async function dbLogZebraView(zebra) {
  const sb   = ZebraAuth.getSupabase();
  const user = await _getUser();
  if (!sb || !user) return;
  await sb.from('zebra_history').insert({
    user_id: user.id,
    match_home: zebra.home,
    match_away: zebra.away,
    zi: zebra.zi,
    league: zebra.league || zebra.lid,
    match_date: zebra.date
  });
}

// ── MIGRATION: localStorage → Supabase ───────────────────────

async function migrateLocalStorageToSupabase() {
  const sb   = ZebraAuth.getSupabase();
  const user = await _getUser();
  if (!sb || !user) return;

  const migrationKey = `zs_migrated_${user.id}`;
  if (localStorage.getItem(migrationKey)) return; // já migrado

  try {
    // Migra favoritos
    const localFavs    = getFavorites();
    const localFavData = JSON.parse(localStorage.getItem('zebrastats_fav_teams_data') || '{}');
    if (localFavs.length > 0) {
      const rows = localFavs.map(teamId => ({
        user_id:   user.id,
        team_id:   teamId,
        team_name: localFavData[teamId]?.name || teamId,
        team_meta: localFavData[teamId] || {},
      }));
      await sb.from('user_favorites').upsert(rows, { onConflict: 'user_id,team_id' });
    }

    // Migra tema/settings
    const theme   = localStorage.getItem('zs_theme') || 'dark';
    const leagues = JSON.parse(localStorage.getItem('zs_leagues') || '[]');
    await sb.from('user_settings').upsert({
      user_id:         user.id,
      theme,
      onboarded:       !!localStorage.getItem('zs_onboarded'),
      favorite_leagues: leagues,
      updated_at:      new Date().toISOString(),
    });

    localStorage.setItem(migrationKey, '1');
    console.log('[DB] Migração localStorage→Supabase concluída');
  } catch(e) {
    // Fix #17: notifica o usuário em vez de falhar silenciosamente
    console.warn('[DB] Erro na migração:', e.message);
    if (typeof showToast === 'function') {
      showToast('⚠️ Não foi possível sincronizar seus dados salvos. Verifique sua conexão.');
    }
  }
}

window.ZebraDB = {
  dbGetFavorites, dbToggleFavorite, dbIsFavorite,
  dbUpdateProfile,
  dbGetSettings, dbSaveSettings,
  dbGetAlerts, dbSaveAlert,
  dbLogZebraView,
  migrateLocalStorageToSupabase
};
