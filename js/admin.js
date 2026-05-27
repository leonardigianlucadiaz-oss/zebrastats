/* ZebraStats — Painel Admin (apenas para leonardi.gianluca.diaz@gmail.com) */
;(function() {
  const ADMIN_EMAIL = 'leonardi.gianluca.diaz@gmail.com'
  const CLICK_TARGET = 5
  let clickCount = 0
  let clickTimer = null

  function isAdmin() {
    const email = localStorage.getItem('zs_email') || ''
    return email === ADMIN_EMAIL
  }

  function getCurrentPlan() {
    return localStorage.getItem('zebrastats_plan') || 'free'
  }

  function setPlan(plan) {
    localStorage.setItem('zebrastats_plan', plan)
    localStorage.setItem('zs_user_plan', plan)
    // Atualiza badge se disponível
    if (typeof window.initPlanBadge === 'function') window.initPlanBadge()
    // Feedback visual
    const toast = document.createElement('div')
    toast.textContent = `✅ Plano alterado para ${plan.toUpperCase()}`
    toast.style.cssText = `position:fixed;top:80px;left:50%;transform:translateX(-50%);
      background:var(--green);color:var(--dark-text,#0D1A2A);padding:10px 20px;
      border-radius:999px;font-weight:700;z-index:99999;font-size:0.875rem;
      box-shadow:0 4px 20px rgba(46,230,92,0.4);transition:opacity 0.3s`
    document.body.appendChild(toast)
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300) }, 1800)
    setTimeout(() => window.location.reload(), 500)
  }

  function openAdminModal() {
    if (document.getElementById('zs-admin-modal')) return
    const plan = getCurrentPlan()
    const uid  = localStorage.getItem('zs_uid') || '—'
    const email = localStorage.getItem('zs_email') || '—'

    const modal = document.createElement('div')
    modal.id = 'zs-admin-modal'
    modal.innerHTML = `
      <div id="zs-admin-backdrop" style="position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:99990;backdrop-filter:blur(4px)"></div>
      <div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
        z-index:99991;background:var(--card,#0D1A2A);border:1px solid var(--border,#152A3E);
        border-radius:20px;padding:28px;width:min(360px,90vw);
        box-shadow:0 20px 60px rgba(0,0,0,0.6)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
          <span style="font-size:1.1rem;font-weight:800">🛠️ Painel Admin</span>
          <button id="zs-admin-close" style="background:none;border:none;cursor:pointer;
            color:var(--gray);font-size:1.2rem;padding:4px 8px">✕</button>
        </div>
        <div style="background:var(--card2,#152A3E);border-radius:12px;padding:14px;margin-bottom:16px;font-size:0.8125rem">
          <div style="color:var(--gray);margin-bottom:4px">Email</div>
          <div style="font-weight:600;word-break:break-all">${email}</div>
          <div style="color:var(--gray);margin-top:8px;margin-bottom:4px">UID</div>
          <div style="font-weight:600;font-size:0.75rem;opacity:0.7">${uid}</div>
          <div style="color:var(--gray);margin-top:8px;margin-bottom:4px">Plano atual</div>
          <div style="font-weight:800;font-size:1rem;color:${plan==='pro'?'var(--green)':'var(--gray)'}">${plan.toUpperCase()}</div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
          <button id="zs-admin-free" style="padding:12px;border-radius:12px;border:2px solid ${plan==='free'?'var(--green)':'var(--border,#152A3E)'};
            background:${plan==='free'?'rgba(46,230,92,0.1)':'transparent'};cursor:pointer;font-weight:700;
            color:${plan==='free'?'var(--green)':'var(--gray)'};font-size:0.875rem">
            🆓 Simular Free
          </button>
          <button id="zs-admin-pro" style="padding:12px;border-radius:12px;border:2px solid ${plan==='pro'?'var(--green)':'var(--border,#152A3E)'};
            background:${plan==='pro'?'rgba(46,230,92,0.1)':'transparent'};cursor:pointer;font-weight:700;
            color:${plan==='pro'?'var(--green)':'var(--gray)'};font-size:0.875rem">
            ⭐ Simular Pro
          </button>
        </div>
        <div style="font-size:0.75rem;color:var(--gray);text-align:center;opacity:0.6">
          Clique 5× no logo para abrir · <code>?admin</code> na URL
        </div>
      </div>
    `
    document.body.appendChild(modal)

    document.getElementById('zs-admin-close').onclick = () => modal.remove()
    document.getElementById('zs-admin-backdrop').onclick = () => modal.remove()
    document.getElementById('zs-admin-free').onclick = () => { modal.remove(); setPlan('free') }
    document.getElementById('zs-admin-pro').onclick  = () => { modal.remove(); setPlan('pro')  }
  }

  function handleLogoClick() {
    if (!isAdmin()) return
    clickCount++
    clearTimeout(clickTimer)
    clickTimer = setTimeout(() => { clickCount = 0 }, 2000)
    if (clickCount >= CLICK_TARGET) {
      clickCount = 0
      openAdminModal()
    }
  }

  function _maybeShowAdminBtn() {
    const email = localStorage.getItem('zs_email') || ''
    if (email !== ADMIN_EMAIL) return
    const container = document.querySelector('.profile-menu, .settings-list, [id*="settingsList"]')
    if (!container) return
    const adminItem = document.createElement('div')
    adminItem.className = 'profile-menu-item'
    adminItem.innerHTML = `
      <div class="profile-menu-item__icon"><span style="font-size:18px;line-height:1">🛠️</span></div>
      <div class="profile-menu-item__text">
        <div class="profile-menu-item__label" style="color:var(--green);font-weight:700">Painel Admin</div>
        <div class="profile-menu-item__sub">Simular plano PRO / FREE</div>
      </div>
      <span class="profile-menu-item__arrow">›</span>
    `
    adminItem.style.cssText = 'cursor:pointer;border-top:1px solid var(--border);'
    adminItem.onclick = () => openAdminModal()
    container.appendChild(adminItem)
  }

  function init() {
    // Verifica ?admin na URL
    if (new URLSearchParams(window.location.search).has('admin') && isAdmin()) {
      setTimeout(openAdminModal, 300)
    }
    // Detecta cliques no logo (sidebar e navbar)
    document.addEventListener('click', (e) => {
      const logo = e.target.closest('.sidebar__logo, .navbar__brand, [data-admin-trigger], .app-logo')
      if (logo) handleLogoClick()
    })
    // Botão admin no perfil
    _maybeShowAdminBtn()
    // Easter egg: console
    if (isAdmin()) {
      console.log('%c🛠️ ZebraStats Admin Mode', 'color:#2EE65C;font-size:16px;font-weight:bold')
      console.log('%cClique 5× no logo ou adicione ?admin na URL', 'color:#889AAA')
    }
  }

  // Exporta API pública
  window.zsAdmin = { open: openAdminModal }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
