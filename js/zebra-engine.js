/* ============================================================
   ZebraStats — Zebra Engine v1.0
   Calcula o Zebra Index (ZI) de uma partida de futebol.

   ZI escala 0–10:
     >= 7.0 → Grande Zebra  (🔴 vermelho)
     >= 4.0 → Zebra Média   (🟠 dourado)
     >= 2.0 → Zebra Leve    (🟡 cinza)
     <  2.0 → Não é zebra

   Entradas (em ordem de confiabilidade):
     1. Odds de mercado      — peso 0.65
     2. Posição na tabela    — peso 0.25
     3. Forma recente        — peso 0.10
   ============================================================ */

const ZebraEngine = (() => {

  const THRESHOLDS = { GRANDE: 7.0, MEDIA: 4.0, LEVE: 2.0 };
  const LEAGUE_SIZES = { ENG:20, ESP:20, ITA:20, GER:18, FRA:20, BRA:20, POR:18, UCL:32 };

  // ── PARSE FORM ───────────────────────────────────────────────
  // Aceita "W,W,D,L,W" ou "WWDLW" → { pts, maxPts, ratio }
  function parseForm(str) {
    if (!str) return null;
    const rs = str.toUpperCase().replace(/[^WDL]/g, '').split('').filter(Boolean);
    if (!rs.length) return null;
    const pts = rs.reduce((a, r) => a + (r==='W'?3:r==='D'?1:0), 0);
    return { pts, maxPts: rs.length * 3, ratio: pts / (rs.length * 3) };
  }

  // ── COMPONENTE 1 — ODDS ──────────────────────────────────────
  // winnerOdd: odd de vitória do time que ganhou (o azarão)
  // Quanto maior a odd, maior a surpresa → maior o ZI
  function _ziOdds(winnerOdd) {
    const o = parseFloat(winnerOdd);
    if (!o || o <= 1.05) return 0;
    // P_winner = probabilidade implícita do vencedor
    // ZI = (1 - P_winner) * 10.5, cap em 9.8
    const p = 1 / o;
    return Math.min(9.8, (1 - p) * 10.5);
  }

  // ── COMPONENTE 2 — POSIÇÃO NA TABELA ────────────────────────
  // winnerPos: posição do vencedor (1=líder, 20=lanterna)
  // loserPos:  posição do perdedor
  // Zebra = vencedor estava ABAIXO do perdedor (pos maior = pior)
  function _ziPos(winnerPos, loserPos, leagueSize) {
    if (!winnerPos || !loserPos || winnerPos <= loserPos) return 0;
    const diff = winnerPos - loserPos; // positivo = vencedor era mais fraco
    const sz   = leagueSize || 20;
    // Normaliza: diff / (sz-1) → 0 a 1; multiplica por 10
    return Math.min(10, (diff / (sz - 1)) * 11);
  }

  // ── COMPONENTE 3 — FORMA RECENTE ────────────────────────────
  // Bônus quando o perdedor estava em melhor forma que o vencedor
  function _ziForm(winnerFormStr, loserFormStr) {
    const wf = parseForm(winnerFormStr);
    const lf = parseForm(loserFormStr);
    if (!wf || !lf) return 0;
    const diff = lf.ratio - wf.ratio; // positivo = perdedor estava melhor
    if (diff <= 0) return 0;
    return Math.min(10, diff * 10);
  }

  // ── DETERMINAR AZARÃO ────────────────────────────────────────
  // Retorna null se não é zebra, ou { azarao, winnerOdd, loserOdd, isDraw }
  // Fix #19: empates de azarão são zebras legítimas (favorito deveria vencer mas não venceu).
  // Ex: lanterna em 0-0 contra líder = zebra de empate. ZI calculado com fator 0.6.
  function _detectZebra({ homeScore, awayScore, homeOdd, awayOdd, homePosn, awayPosn }) {
    if (homeScore == null || awayScore == null) return null;

    const isDraw  = homeScore === awayScore;
    const homeWon = !isDraw && homeScore > awayScore;
    const awayWon = !isDraw && !homeWon;

    // Por odds (mais confiável)
    if (homeOdd && awayOdd && homeOdd !== awayOdd) {
      const homeIsFav = homeOdd < awayOdd;
      if (!isDraw) {
        if (homeWon && !homeIsFav) return { azarao:'home', winnerOdd:homeOdd, loserOdd:awayOdd, isDraw:false };
        if (awayWon &&  homeIsFav) return { azarao:'away', winnerOdd:awayOdd, loserOdd:homeOdd, isDraw:false };
        return null; // favorito ganhou
      }
      // Empate: zebra se havia favorito claro (diff de odds > 0.4)
      const oddsGap = Math.abs((1/homeOdd) - (1/awayOdd));
      if (oddsGap >= 0.15) {
        // "azarao" = o mais fraco que segurou o empate (oposto do favorito)
        // Fix [15]: homeIsFav → azarão é o away (mais fraco que empatou)
        //           !homeIsFav → azarão é o home
        return { azarao: homeIsFav ? 'away' : 'home', winnerOdd: homeIsFav ? awayOdd : homeOdd, loserOdd: homeIsFav ? homeOdd : awayOdd, isDraw: true };
      }
      return null; // jogo equilibrado, empate não surpreende
    }

    // Por posição (fallback)
    if (homePosn && awayPosn && homePosn !== awayPosn) {
      const homeIsFav = homePosn < awayPosn;
      if (!isDraw) {
        if (homeWon && !homeIsFav) return { azarao:'home', winnerOdd:null, loserOdd:null, isDraw:false };
        if (awayWon &&  homeIsFav) return { azarao:'away', winnerOdd:null, loserOdd:null, isDraw:false };
        return null;
      }
      // Empate: zebra apenas se diferença de posição for grande (≥7)
      if (Math.abs(homePosn - awayPosn) >= 7) {
        // Fix [15]: azarão = o mais fraco (oposto do favorito) que segurou o empate
        return { azarao: homeIsFav ? 'away' : 'home', winnerOdd: null, loserOdd: null, isDraw: true };
      }
      return null;
    }

    return null;
  }

  // ── ESTIMATIVA DE ODDS (quando não há odds reais) ───────────
  function estimateOdds(homePosn, awayPosn, homeFormStr, awayFormStr, leagueSize = 20) {
    const sz = leagueSize;
    const hPos = Math.max(1, Math.min(sz, homePosn || Math.ceil(sz/2)));
    const aPos = Math.max(1, Math.min(sz, awayPosn || Math.ceil(sz/2)));

    const hStr = 1 - (hPos - 1) / (sz - 1);
    const aStr = 1 - (aPos - 1) / (sz - 1);

    const hForm = parseForm(homeFormStr);
    const aForm = parseForm(awayFormStr);
    const hFR = hForm ? hForm.ratio : 0.5;
    const aFR = aForm ? aForm.ratio : 0.5;

    const hPow = hStr * 0.55 + hFR * 0.35 + 0.10; // +0.10 vantagem de campo
    const aPow = aStr * 0.55 + aFR * 0.35;
    const draw = 0.25;
    const tot  = hPow + aPow + draw;

    return {
      homeOdd: parseFloat((tot / hPow).toFixed(2)),
      awayOdd: parseFloat((tot / aPow).toFixed(2)),
    };
  }

  // ── CALC — função principal ──────────────────────────────────
  /**
   * @param {object} p
   * @param {number}  p.homeScore
   * @param {number}  p.awayScore
   * @param {number}  [p.homeOdd]     Odd vitória mandante
   * @param {number}  [p.awayOdd]     Odd vitória visitante
   * @param {number}  [p.homePosn]    Posição na tabela
   * @param {number}  [p.awayPosn]
   * @param {string}  [p.homeForm]    "W,D,L,W,W" ou "WDLWW"
   * @param {string}  [p.awayForm]
   * @param {string}  [p.lid]         Código de liga (para tamanho da tabela)
   * @returns {{ zi:number, class:string|null, azarao:string|null, isZebra:boolean }}
   */
  function calc(p) {
    const leagueSize = LEAGUE_SIZES[p.lid] || 20;
    const zebra = _detectZebra(p);
    if (!zebra) return { zi:0, class:null, azarao:null, isZebra:false };

    const isHome = zebra.azarao === 'home';
    const winnerPos  = isHome ? p.homePosn  : p.awayPosn;
    const loserPos   = isHome ? p.awayPosn  : p.homePosn;
    const winnerForm = isHome ? p.homeForm  : p.awayForm;
    const loserForm  = isHome ? p.awayForm  : p.homeForm;

    let winnerOdd = zebra.winnerOdd;
    // Se não há odds reais, estima
    if (!winnerOdd && winnerPos && loserPos) {
      const est = estimateOdds(
        isHome ? p.homePosn : p.awayPosn,
        isHome ? p.awayPosn : p.homePosn,
        isHome ? p.homeForm : p.awayForm,
        isHome ? p.awayForm : p.homeForm,
        leagueSize
      );
      winnerOdd = isHome ? est.homeOdd : est.awayOdd;
    }

    const Z_odds = winnerOdd ? _ziOdds(winnerOdd) : 0;
    const Z_pos  = _ziPos(winnerPos, loserPos, leagueSize);
    const Z_form = _ziForm(winnerForm, loserForm);

    let zi;
    const hasOdds = Z_odds > 0;
    const hasPos  = Z_pos  > 0;
    const hasForm = Z_form > 0;

    if (hasOdds && hasPos && hasForm) {
      zi = Z_odds * 0.65 + Z_pos * 0.25 + Z_form * 0.10;
    } else if (hasOdds && hasPos) {
      zi = Z_odds * 0.72 + Z_pos * 0.28;
    } else if (hasOdds) {
      zi = Z_odds;
    } else if (hasPos && hasForm) {
      zi = Z_pos * 0.75 + Z_form * 0.25;
    } else if (hasPos) {
      zi = Z_pos * 0.70;
    } else {
      return { zi:0, class:null, azarao:null, isZebra:false };
    }

    // Fix #19: empates reduzem o ZI em 40% — é surpreendente, mas menos que derrota
    if (zebra.isDraw) zi *= 0.6;

    zi = Math.round(Math.min(9.9, Math.max(0, zi)) * 10) / 10;
    const cls = zi >= THRESHOLDS.GRANDE ? 'grande'
              : zi >= THRESHOLDS.MEDIA  ? 'media'
              : zi >= THRESHOLDS.LEVE   ? 'leve'
              : null;

    return { zi, class: cls, azarao: zebra.azarao, isDraw: zebra.isDraw || false, isZebra: cls !== null };
  }

  // ── BATCH ────────────────────────────────────────────────────
  function calcBatch(matches) {
    return matches
      .map(m => ({ ...m, ...calc(m) }))
      .filter(m => m.isZebra)
      .sort((a, b) => b.zi - a.zi);
  }

  // ── CLASSIFY (standalone) ────────────────────────────────────
  function classify(zi) {
    if (zi >= THRESHOLDS.GRANDE) return 'grande';
    if (zi >= THRESHOLDS.MEDIA)  return 'media';
    if (zi >= THRESHOLDS.LEVE)   return 'leve';
    return null;
  }

  return { calc, calcBatch, classify, estimateOdds, parseForm, THRESHOLDS, LEAGUE_SIZES };
})();

window.ZebraEngine = ZebraEngine;
