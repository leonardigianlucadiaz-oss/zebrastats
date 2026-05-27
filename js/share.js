/* ============================================================
   ZebraStats — share.js
   Canvas share card generator
   ============================================================ */

function fitText(ctx, text, maxWidth, initialFontSize, fontWeight, fontFamily) {
  let size = initialFontSize;
  ctx.font = `${fontWeight} ${size}px ${fontFamily}`;
  while (ctx.measureText(text).width > maxWidth && size > 20) {
    size -= 4;
    ctx.font = `${fontWeight} ${size}px ${fontFamily}`;
  }
  return size;
}

async function drawShareCard(config) {
  const W = 1080, H = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  await document.fonts.ready;

  // ── BACKGROUND ──────────────────────────────────────
  ctx.fillStyle = '#0D1A2A';
  ctx.fillRect(0, 0, W, H);

  // ── ZEBRA STRIPE DECORATION ─────────────────────────
  ctx.save();
  ctx.globalAlpha = 0.03;
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 160;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(-300 + i * 350, H);
    ctx.lineTo(i * 350 + 300, 0);
    ctx.stroke();
  }
  ctx.restore();

  // ── TOP GREEN STRIPE ─────────────────────────────────
  ctx.fillStyle = '#2EE65C';
  ctx.fillRect(0, 0, W, 10);

  // ── LOGO ─────────────────────────────────────────────
  ctx.font = 'bold 58px Inter, -apple-system, sans-serif';
  ctx.fillStyle = '#2EE65C';
  ctx.textAlign = 'left';
  ctx.fillText('Z', 60, 95);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText('ebraStats', 108, 95);

  // ── LEAGUE + DATE (top right) ─────────────────────────
  ctx.textAlign = 'right';
  ctx.font = '32px Inter, -apple-system, sans-serif';
  ctx.fillStyle = '#889AAA';
  ctx.fillText(config.league || 'Futebol', W - 60, 70);
  ctx.font = '28px Inter, -apple-system, sans-serif';
  ctx.fillText(config.date || '', W - 60, 108);

  // ── DIVIDER LINE ──────────────────────────────────────
  ctx.beginPath();
  ctx.moveTo(60, 140); ctx.lineTo(W - 60, 140);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1; ctx.stroke();

  // ── HOME TEAM ─────────────────────────────────────────
  ctx.textAlign = 'center';
  fitText(ctx, config.homeTeam || 'Casa', 420, 76, 'bold', 'Inter, -apple-system, sans-serif');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(config.homeTeam || 'Casa', W / 2, 340);

  // ── SCORE BOX ────────────────────────────────────────
  const scoreText = config.score || 'vs';
  const bw = 340, bh = 116, bx = (W - bw) / 2, by = 390;
  const isVs = !config.score;
  const bfill = isVs ? 'rgba(255,200,50,0.1)' : 'rgba(46,230,92,0.13)';
  const bstroke = isVs ? 'rgba(255,200,50,0.35)' : 'rgba(46,230,92,0.4)';
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(bx, by, bw, bh, 22);
  } else {
    const r = 22;
    ctx.moveTo(bx + r, by);
    ctx.lineTo(bx + bw - r, by); ctx.arcTo(bx + bw, by, bx + bw, by + r, r);
    ctx.lineTo(bx + bw, by + bh - r); ctx.arcTo(bx + bw, by + bh, bx + bw - r, by + bh, r);
    ctx.lineTo(bx + r, by + bh); ctx.arcTo(bx, by + bh, bx, by + bh - r, r);
    ctx.lineTo(bx, by + r); ctx.arcTo(bx, by, bx + r, by, r);
    ctx.closePath();
  }
  ctx.fillStyle = bfill; ctx.fill();
  ctx.strokeStyle = bstroke; ctx.lineWidth = 2; ctx.stroke();
  ctx.font = `bold ${isVs ? 68 : 92}px Inter, -apple-system, sans-serif`;
  ctx.fillStyle = isVs ? '#FFC832' : '#FFFFFF';
  ctx.fillText(scoreText, W / 2, by + bh / 2 + (isVs ? 22 : 34));

  // ── AWAY TEAM ─────────────────────────────────────────
  fitText(ctx, config.awayTeam || 'Fora', 420, 76, 'bold', 'Inter, -apple-system, sans-serif');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(config.awayTeam || 'Fora', W / 2, 650);

  // ── ZI BADGE ─────────────────────────────────────────
  const zi = parseFloat(config.zi) || 0;
  const ziClass = config.ziClass || (zi >= 7 ? 'grande' : zi >= 4 ? 'media' : 'leve');
  const ziColor  = { grande: '#EE4444', media: '#FFC832', leve: '#889AAA' }[ziClass];
  const ziFill   = { grande: 'rgba(238,68,68,0.16)',  media: 'rgba(255,200,50,0.16)',  leve: 'rgba(136,154,170,0.14)' }[ziClass];
  const ziStroke = { grande: 'rgba(238,68,68,0.5)',   media: 'rgba(255,200,50,0.5)',   leve: 'rgba(136,154,170,0.4)'  }[ziClass];

  const pw = 340, ph = 64, px = (W - pw) / 2, py = 700;
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(px, py, pw, ph, 32);
  } else {
    const r = 32;
    ctx.moveTo(px + r, py);
    ctx.lineTo(px + pw - r, py); ctx.arcTo(px + pw, py, px + pw, py + r, r);
    ctx.lineTo(px + pw, py + ph - r); ctx.arcTo(px + pw, py + ph, px + pw - r, py + ph, r);
    ctx.lineTo(px + r, py + ph); ctx.arcTo(px, py + ph, px, py + ph - r, r);
    ctx.lineTo(px, py + r); ctx.arcTo(px, py, px + r, py, r);
    ctx.closePath();
  }
  ctx.fillStyle = ziFill; ctx.fill();
  ctx.strokeStyle = ziStroke; ctx.lineWidth = 2; ctx.stroke();

  // ZI badge text: "🦓 Zebra Index" (gray) + zi value (colored, bold)
  ctx.font = '30px Inter, -apple-system, sans-serif';
  ctx.fillStyle = '#889AAA';
  ctx.textAlign = 'center';
  ctx.fillText('🦓 Zebra Index', W / 2 - 30, py + ph / 2 + 11);
  ctx.font = 'bold 40px Inter, -apple-system, sans-serif';
  ctx.fillStyle = ziColor;
  ctx.textAlign = 'left';
  ctx.fillText('  ' + (config.zi || '—'), W / 2 + 50, py + ph / 2 + 14);

  // ── QUOTE ────────────────────────────────────────────
  const quotes = {
    grande: '"O azarão derrubou o favorito"',
    media:  '"Uma virada surpreendente"',
    leve:   '"Resultado inesperado"',
  };
  ctx.textAlign = 'center';
  ctx.font = 'italic 30px Inter, -apple-system, sans-serif';
  ctx.fillStyle = 'rgba(136,154,170,0.7)';
  ctx.fillText(quotes[ziClass], W / 2, 840);

  // ── BOTTOM DIVIDER ───────────────────────────────────
  ctx.beginPath(); ctx.moveTo(60, 900); ctx.lineTo(W - 60, 900);
  ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1; ctx.stroke();

  // ── FOOTER ───────────────────────────────────────────
  const domain = window.location.hostname !== 'localhost' ? window.location.hostname : 'zebrastats.com.br';
  ctx.font = '30px Inter, -apple-system, sans-serif';
  ctx.fillStyle = '#889AAA';
  ctx.fillText(domain, W / 2, 970);
  // Green dots flanking text — positioned relative to actual text width
  const dotY = 964;
  const textWidth = ctx.measureText(domain).width;
  const dotOffset = textWidth / 2 + 12;
  ctx.fillStyle = '#2EE65C';
  ctx.beginPath(); ctx.arc(W / 2 - dotOffset, dotY, 3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(W / 2 + dotOffset, dotY, 3, 0, Math.PI * 2); ctx.fill();

  return new Promise(resolve => canvas.toBlob(blob => resolve(blob), 'image/png', 0.95));
}

async function shareMatchCard(config) {
  if (typeof showToast === 'function') showToast('Gerando imagem...');
  try {
    const blob = await drawShareCard(config);
    const file = new File([blob], 'zebrastats-zebra.png', { type: 'image/png' });

    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        title: `${config.homeTeam} ${config.score || 'vs'} ${config.awayTeam} — ZebraStats`,
        text: `🦓 ZI ${config.zi} — ${config.homeTeam} ${config.score || 'vs'} ${config.awayTeam} · ${config.league}`,
        files: [file],
      });
      return;
    }

    // Fallback: share URL only
    const text = `🦓 ZI ${config.zi}! ${config.homeTeam} ${config.score || 'vs'} ${config.awayTeam} (${config.league}) — veja no ZebraStats`;
    if (navigator.share) {
      await navigator.share({ title: 'ZebraStats', text, url: location.href });
      return;
    }

    // Final fallback: download image
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zebrastats-${(config.homeTeam || 'time').replace(/\s+/g, '-')}.png`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    if (typeof showToast === 'function') showToast('Imagem salva!');
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.warn('shareMatchCard error:', err);
      if (typeof showToast === 'function') showToast('Não foi possível compartilhar');
    }
  }
}
