/*! relink-flags.js — Adaptateur ReLink pour Emeraldian Express */
(function () {
  const script = document.currentScript;

  const worker = ((script && script.dataset.worker) || '').replace(/\/$/, '');
  const site = script && script.dataset.site;

  if (!worker || !site) {
    console.warn('[ReLink] data-worker et data-site sont requis.');
    return;
  }

  /*
   * Correspondance entre les pages de ton site
   * et les sections déclarées dans le manifest.
   */
  const FLAGMAP = {
    lore: 'lore',
    reglement: 'reglement',
    partenaires: 'partenaires',
    ajouts: 'ajouts',
    about: 'about',
    staff: 'staff',
    aide: 'aide',

    // Ton site utilise "apply",
    // mais ton système ReLink utilise "team".
    apply: 'team'
  };

  let FLAGS = null;

  function isDisabled(page) {
    if (!FLAGS || !FLAGS.sections) return false;

    const section = FLAGMAP[page];

    return !!(
      section &&
      FLAGS.sections[section] === false
    );
  }

  function applyFlags(flags) {
    FLAGS = flags;

    // Rend les flags accessibles à ton propre JavaScript
    window.RELINK_FLAGS = flags;

    /*
     * Cache les boutons/liens data-go
     * correspondant aux sections désactivées.
     */
    document.querySelectorAll('[data-go]').forEach(function (element) {
      const page = element.getAttribute('data-go');

      if (FLAGMAP[page]) {
        element.hidden = isDisabled(page);
      }
    });

    /*
     * Si tout le site est désactivé,
     * on cache les éléments contrôlables.
     */
    if (flags.site_enabled === false) {
      document.querySelectorAll('[data-go]').forEach(function (element) {
        element.hidden = true;
      });

      document.querySelectorAll('[data-relink-maintenance]').forEach(function (element) {
        element.hidden = false;
      });
    } else {
      document.querySelectorAll('[data-relink-maintenance]').forEach(function (element) {
        element.hidden = true;
      });
    }

    /*
     * Permet à ton script principal de réagir
     * quand les flags sont chargés.
     */
    document.dispatchEvent(
      new CustomEvent('relink:flags', {
        detail: flags
      })
    );
  }

  async function loadFlags() {
    try {
      const response = await fetch(
        worker + '/flags?site=' + encodeURIComponent(site)
      );

      if (!response.ok) {
        throw new Error('Worker HTTP ' + response.status);
      }

      const flags = await response.json();

      applyFlags(flags);

    } catch (error) {
      /*
       * Si ReLink est inaccessible,
       * on ne bloque pas le site.
       */
      console.warn(
        '[ReLink] Impossible de récupérer les flags.',
        error
      );
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadFlags);
  } else {
    loadFlags();
  }
})();