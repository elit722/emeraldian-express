/*! relink-flags.js v2 — Adaptateur ReLink pour Emeraldian Express
 *
 *  - Les clés de section du manifeste (relink-manifest.json) sont EXACTEMENT les id des pages
 *    du site : plus de table de correspondance à maintenir. « home » n'est jamais désactivable.
 *  - Maintenance : écran plein page (message + retour prévu) piloté depuis le panel admin.
 *    Les admins (compte ReLink avec admin.access, ou mode édition du site) passent quand même
 *    et voient une barre orange. Attention : c'est une protection VISUELLE, pas une barrière API.
 *  - Expose : window.RELINK_FLAGS, window.RELINK_BYPASS et l'événement « relink:flags ».
 */
(function () {
  const script = document.currentScript;
  const worker = ((script && script.dataset.worker) || '').replace(/\/$/, '');
  const site = script && script.dataset.site;
  const TOKEN_KEY = (script && script.dataset.tokenKey) || 'tlv_token'; // jeton ReLink du site
  const POLL_MS = 60 * 1000;

  if (!worker || !site) {
    console.warn('[ReLink] data-worker et data-site sont requis.');
    return;
  }

  let FLAGS = null;
  let overlay = null;
  let bar = null;
  let countdown = null;
  const lockedNodes = [];

  const inMaintenance = f => !!(f && (f.maintenance === true || f.site_enabled === false));
  const isDisabled = page =>
    !!(FLAGS && FLAGS.sections && page !== 'home' && FLAGS.sections[page] === false);

  // ── Qui peut passer pendant la maintenance ? ────────────────────────────
  async function isAdmin() {
    try {
      // Mode édition du site (secret du Worker de contenu)
      if (localStorage.getItem('tlv_adm') === '1' && localStorage.getItem('tlv_ctok')) return true;
    } catch (e) { /* stockage indisponible */ }

    let token = null;
    try { token = localStorage.getItem(TOKEN_KEY); } catch (e) {}
    if (!token) return false;
    try {
      const r = await fetch(worker + '/me/permissions?scope=global', {
        headers: { Authorization: 'Bearer ' + token },
      });
      if (!r.ok) return false;
      const d = await r.json();
      return !!(d.permissions && d.permissions.includes('admin.access'));
    } catch (e) {
      return false;
    }
  }

  // ── Écran de maintenance ────────────────────────────────────────────────
  function lockPage() {
    [...document.body.children].forEach(function (el) {
      if (el === overlay || el.hasAttribute('inert')) return;
      el.setAttribute('inert', '');
      lockedNodes.push(el);
    });
    document.documentElement.style.overflow = 'hidden';
  }

  function unlockPage() {
    lockedNodes.splice(0).forEach(function (el) { el.removeAttribute('inert'); });
    document.documentElement.style.overflow = '';
  }

  function formatLeft(ms) {
    const min = Math.max(1, Math.ceil(ms / 60000));
    const d = Math.floor(min / 1440);
    const h = Math.floor((min % 1440) / 60);
    const m = min % 60;
    return (d ? d + ' j ' : '') + (h ? h + ' h ' : '') + (d ? '' : m + ' min');
  }

  function showMaintenance(flags) {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'relink-maintenance';
      overlay.setAttribute('role', 'alertdialog');
      overlay.setAttribute('aria-live', 'polite');
      overlay.style.cssText =
        'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;' +
        'padding:1.5rem;text-align:center;background:#140908;color:#eadfc5;' +
        'font:400 1.25rem/1.65 "Cormorant Garamond",Georgia,serif;overflow:auto';
      overlay.innerHTML =
        '<div style="max-width:34rem;border:1px solid rgba(200,164,85,.35);padding:2.6rem 2rem;' +
        'background:linear-gradient(180deg,rgba(40,17,14,.9),rgba(18,8,7,.96));box-shadow:0 18px 60px #000">' +
        '<div style="font-size:3rem;line-height:1" aria-hidden="true">🚂</div>' +
        '<h1 style="margin:.6rem 0 .4rem;font:400 clamp(1.8rem,6vw,2.6rem) \'IM Fell English SC\',\'Times New Roman\',serif;color:#c8a455;letter-spacing:.04em">Maintenance en cours</h1>' +
        '<div style="height:1px;background:linear-gradient(90deg,transparent,#c8a455,transparent);margin:1rem 0 1.2rem"></div>' +
        '<p data-rl="msg" style="margin:0;font-style:italic;color:#9fb2c6"></p>' +
        '<p data-rl="eta" style="margin:1.3rem 0 0;font:1.15rem \'IM Fell English SC\',serif;color:#c8a455;letter-spacing:.06em"></p>' +
        '</div>';
      document.body.appendChild(overlay);
      lockPage();
    }

    overlay.querySelector('[data-rl="msg"]').textContent =
      flags.maintenance_message || 'Le train est momentanément à l\'arrêt. Nous reprenons la route très bientôt, merci de ta patience !';

    const eta = overlay.querySelector('[data-rl="eta"]');
    clearInterval(countdown);
    countdown = null;
    const until = flags.maintenance_until ? new Date(flags.maintenance_until) : null;
    if (until && !isNaN(until) && until.getTime() > Date.now()) {
      const tick = function () {
        const left = until.getTime() - Date.now();
        eta.textContent = left > 0 ? 'Reprise du voyage dans ' + formatLeft(left) : 'Reprise imminente…';
      };
      tick();
      countdown = setInterval(tick, 30000);
    } else {
      eta.textContent = '';
    }
  }

  function hideMaintenance() {
    clearInterval(countdown);
    countdown = null;
    if (overlay) { overlay.remove(); overlay = null; }
    unlockPage();
  }

  function showAdminBar(on) {
    if (on && !bar) {
      bar = document.createElement('div');
      bar.textContent = '🚧 Maintenance active — le site est caché aux visiteurs, toi tu passes.';
      bar.style.cssText =
        'position:fixed;left:0;right:0;bottom:0;z-index:2147482000;background:#f5a623;color:#000;' +
        'text-align:center;padding:.35rem .6rem;font:600 .9rem system-ui,sans-serif';
      document.body.appendChild(bar);
    } else if (!on && bar) {
      bar.remove();
      bar = null;
    }
  }

  // ── Application des flags ───────────────────────────────────────────────
  function applyFlags(flags, bypass) {
    FLAGS = flags;
    window.RELINK_FLAGS = flags;
    window.RELINK_BYPASS = !!bypass;

    const maint = inMaintenance(flags);
    const blocked = maint && !bypass;

    // Liens/boutons vers une section désactivée (ou tout le site en maintenance)
    document.querySelectorAll('[data-go]').forEach(function (el) {
      el.hidden = blocked || isDisabled(el.getAttribute('data-go'));
    });

    // Éléments optionnels à afficher seulement en maintenance
    document.querySelectorAll('[data-relink-maintenance]').forEach(function (el) {
      el.hidden = !blocked;
    });

    if (blocked) showMaintenance(flags); else hideMaintenance();
    showAdminBar(maint && !!bypass);

    document.dispatchEvent(new CustomEvent('relink:flags', { detail: flags }));
  }

  async function loadFlags() {
    try {
      const response = await fetch(worker + '/flags?site=' + encodeURIComponent(site));
      if (!response.ok) throw new Error('Worker HTTP ' + response.status);
      const flags = await response.json();
      // Le contrôle admin est résolu AVANT l'application : pas de flash de l'écran pour un admin.
      const bypass = inMaintenance(flags) ? await isAdmin() : false;
      applyFlags(flags, bypass);
    } catch (error) {
      // ReLink injoignable : on ne bloque jamais le site.
      console.warn('[ReLink] Impossible de récupérer les flags.', error);
    }
  }

  function start() {
    loadFlags();
    // La maintenance se lève (ou s'active) toute seule, sans rechargement manuel.
    setInterval(function () {
      if (document.visibilityState === 'visible') loadFlags();
    }, POLL_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
