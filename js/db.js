/* ZebraStats — db.js
 * CRUD para tabelas Supabase: profiles, user_favorites,
 * user_alerts, user_settings, zebra_history.
 * Migra automaticamente do localStorage no primeiro login.
 */

// ── FAVORITES ─────────────────────────────────────────────────

async function dbGetFavorites() {
  const sb = ZebraAuth.getSupabase();
  const user = await ZebraAuth.getSessionUser();
  if (!sb || !user) return getFavorites(); // fallback localStorage
  const { data } = await sb.from('user_favorites')
    .select('team_id, team_name, team_meta')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  return (data || []).map(r => r.team_id);
}

async function dbToggleFavorite(teamId, teamName, meta = {}) {
  const sb = ZebraAuth.getSupabase();
  const user = await ZebraAuth.getSessionUser();
  if (!sb || !user) return toggleFavorite(teamId, teamName, meta); // fallback

  const { data: existing } = await sb.from('user_favorites')
    .select('id').eq('user_id', user.id).eq('team_id', teamId).single();

  if (existing) {
    await sb.from('user_favorites').delete().eq('id', existing.id);
    return false; // removido
  } else {
    await sb.from('user_favorites').insert({
      user_id: user.id, team_id: teamId,
      team_name: teamName, team_meta: meta
    });
    return true; // adicionado
  }
}

async function dbIsFavorite(teamId) {
  const sb = ZebraAuth.getSupabase();
  const user = await ZebraAuth.getSessionUser();
  if (!sb || !user) return getFavorites().includes(teamId);
  const { data } = await sb.from('user_favorites')
    .select('id').eq('user_id', user.id).eq('team_id', teamId).single();
  return !!data;
}

// ── SETTINGS ──────────────────────────────────────────────────

async function dbGetSettings() {
  const sb = ZebraAuth.getSupabase();
  const user = await ZebraAuth.getSessionUser();
  if (!sb || !user) return null;
  const { data } = await sb.from('user_settings')
    .select('*').eq('user_id', user.id).single();
  return data;
}

async function dbSaveSettings(settings) {
  const sb = ZebraAuth.getSupabase();
  const user = await ZebraAuth.getSessionUser();
  if (!sb || !user) return;
  await sb.from('user_settings').upsert({
    user_id: user.id, ...settings, updated_at: new Date().toISOString()
  });
}

// ── ALERTS ────────────────────────────────────────────────────

async function dbGetAlerts() {
  const sb = ZebraAuth.getSupabase();
  const user = await ZebraAuth.getSessionUser();
  if (!sb || !user) return JSON.parse(localStorage.getItem('zs_alerts') || '[]');
  const { data } = await sb.from('user_alerts')
    .select('*').eq('user_id', user.id);
  return data || [];
}

async function dbSaveAlert(alert) {
  const sb = ZebraAuth.getSupabase();
  const user = await ZebraAuth.getSessionUser();
  if (!sb || !user) {
    const alerts = JSON.parse(localStorage.getItem('zs_alerts') || '[]');
    const idx = alerts.findIndex(a => a.id === alert.id);
    if (idx >= 0) alerts[idx] = alert; else alerts.push(alert);
    localStorage.setItem('zs_alerts', JSON.stringify(alerts));
    return;
  }
  await sb.from('user_alerts').upsert({ user_id: user.id, ...alert });
}

// ── ZEBRA HISTORY ─────────────────────────────────────────────

async function dbLogZebraView(zebra) {
  const sb = ZebraAuth.getSupabase();
  const user = await ZebraAuth.getSessionUser();
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
  const sb = ZebraAuth.getSupabase();
  const user = await ZebraAuth.getSessionUser();
  if (!sb || !user) return;

  const migrationKey = `zs_migrated_${user.id}`;
  if (localStorage.getItem(migrationKey)) return; // já migrado

  try {
    // Migra favoritos
    const localFavs = getFavorites();
    const localFavData = JSON.parse(localStorage.getItem('zebrastats_fav_teams_data') || '{}');
    if (localFavs.length > 0) {
      const rows = localFavs.map(teamId => ({
        user_id: user.id,
        team_id: teamId,
        team_name: localFavData[teamId]?.name || teamId,
        team_meta: localFavData[teamId] || {}
      }));
      await sb.from('user_favorites').upsert(rows, { onConflict: 'user_id,team_id' });
    }

    // Migra tema/settings
    const theme = localStorage.getItem('zs_theme') || 'dark';
    const leagues = JSON.parse(localStorage.getItem('zs_leagues') || '[]');
    await sb.from('user_settings').upsert({
      user_id: user.id,
      theme,
      onboarded: !!localStorage.getItem('zs_onboarded'),
      favorite_leagues: leagues,
      updated_at: new Date().toISOString()
    });

    localStorage.setItem(migrationKey, '1');
    console.log('[DB] Migração localStorage→Supabase concluída');
  } catch(e) {
    console.warn('[DB] Erro na migração:', e.message);
  }
}

window.ZebraDB = {
  dbGetFavorites, dbToggleFavorite, dbIsFavorite,
  dbGetSettings, dbSaveSettings,
  dbGetAlerts, dbSaveAlert,
  dbLogZebraView,
  migrateLocalStorageToSupabase
};
