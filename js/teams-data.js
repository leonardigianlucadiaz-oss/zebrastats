/* ============================================================
   ZebraStats — js/teams-data.js
   FIX 28 — Centralized TEAMS_DATA shared across time.html and explorar.html
   ============================================================ */

// Teams are keyed by slug (same as URL ?team= param on time.html)
window.TEAMS_DATA = window.TEAMS_DATA || {
  torino:        { name: 'Torino FC',              abbr: 'TOR', league: 'Serie A · Itália',                color: '#851414', sdbId: '133761' },
  flamengo:      { name: 'Flamengo',               abbr: 'FLA', league: 'Brasileirão · Série A',           color: '#CC1A1A', sdbId: '134316' },
  'real-madrid': { name: 'Real Madrid',             abbr: 'RMA', league: 'La Liga · Espanha',              color: '#1a1a6e', sdbId: '135260' },
  'man-city':    { name: 'Manchester City',         abbr: 'MCI', league: 'Premier League · Inglaterra',    color: '#6cabdd', sdbId: '133739' },
  bayern:        { name: 'Bayern München',          abbr: 'FCB', league: 'Bundesliga · Alemanha',          color: '#dc052d', sdbId: '133693' },
  psg:           { name: 'Paris Saint-Germain',     abbr: 'PSG', league: 'Ligue 1 · França',               color: '#004170', sdbId: '133718' },
  palmeiras:     { name: 'Palmeiras',               abbr: 'PAL', league: 'Brasileirão · Série A',           color: '#006437', sdbId: '133600' },
  barcelona:     { name: 'Barcelona',               abbr: 'BAR', league: 'La Liga · Espanha',              color: '#a50044', sdbId: '133725' },
  arsenal:       { name: 'Arsenal',                 abbr: 'ARS', league: 'Premier League · Inglaterra',    color: '#ef0107', sdbId: '133604' },
  liverpool:     { name: 'Liverpool',               abbr: 'LIV', league: 'Premier League · Inglaterra',    color: '#c8102e', sdbId: '133616' },
  'atletico-mg': { name: 'Atlético Mineiro',        abbr: 'CAM', league: 'Brasileirão · Série A',          color: '#000000', sdbId: '133607' },
  juventus:      { name: 'Juventus',                abbr: 'JUV', league: 'Serie A · Itália',               color: '#000000', sdbId: '133738' },
};
