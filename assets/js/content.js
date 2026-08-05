(function () {
  "use strict";

  // Marca de última interacción del usuario con la página.
  let lastUserInteractionAt = Date.now();

  function markUserInteraction() {
    lastUserInteractionAt = Date.now();
  }

  // ─── Dark mode ────────────────────────────────────────────────────────────────

  const DARK_LINK_ID = "zep-dark-mode-css";
  const DARK_FLASH_ID = "zep-dark-flash";
  // Espejo del flag en el localStorage de la propia página (no el de la
  // extensión): se lee de forma SÍNCRONA apenas arranca el content script,
  // sin esperar la respuesta async de chrome.storage.local, que puede tardar
  // lo suficiente como para que el navegador ya haya pintado en blanco.
  const DARK_MODE_LS_KEY = "zepDarkModeMirror";
  let darkModeEnabled = false;
  let darkModeEnforcerStarted = false;

  // Inyectar fondo oscuro de forma INMEDIATA en <html> para evitar el flash
  // blanco mientras storage responde (que es async). Se elimina después.
  function injectFlashGuard() {
    if (document.getElementById(DARK_FLASH_ID)) return;
    const style = document.createElement("style");
    style.id = DARK_FLASH_ID;
    // Apunta a <html> porque <body> puede no existir aún (document_start)
    style.textContent = "html { background-color: #222c32 !important; }";
    // documentElement siempre existe en document_start
    document.documentElement.appendChild(style);
  }

  function removeFlashGuard() {
    const el = document.getElementById(DARK_FLASH_ID);
    if (el) el.remove();
  }

  function ensureDarkModeApplied() {
    if (!darkModeEnabled) return;

    const existing = document.getElementById(DARK_LINK_ID);
    if (!existing && document.head) {
      const link = document.createElement("link");
      link.id = DARK_LINK_ID;
      link.rel = "stylesheet";
      link.type = "text/css";
      link.href = chrome.runtime.getURL("assets/css/dark-mode.css");
      document.head.appendChild(link);
    }

    if (document.body && !document.body.classList.contains("dark-mode")) {
      document.body.classList.add("dark-mode");
    }
  }

  function startDarkModeEnforcer() {
    if (darkModeEnforcerStarted) return;
    darkModeEnforcerStarted = true;

    // El sitio (GeneXus) recarga por ajax secciones enteras (el menú lateral,
    // por ejemplo) reemplazando nodos del DOM; eso puede sacarle la clase
    // "dark-mode" a <body> por un instante. Como todas las reglas de
    // dark-mode.css están bajo el selector "body.dark-mode ...", en ese
    // instante TODO se ve sin estilo (blanco) hasta que este observer
    // reacciona. injectFlashGuard() (ver más abajo) se deja montado todo el
    // tiempo que el modo oscuro esté activo para tapar ese hueco.
    const observer = new MutationObserver(function () {
      injectFlashGuard();
      ensureDarkModeApplied();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });

    document.addEventListener("visibilitychange", function () {
      if (!darkModeEnabled || document.visibilityState !== "visible") return;
      injectFlashGuard();
      ensureDarkModeApplied();
    });
  }

  // Estilo de los modales propios de la extensión (favoritos / WhatsApp).
  // Se controla por JS -en vez de depender sólo del CSS del sitio- porque
  // estos nodos se inyectan dinámicamente y así se evita cualquier pelea de
  // especificidad con las reglas de dark-mode.css.
  function modalCardStyle(extra) {
    const bg = darkModeEnabled ? "rgba(34,44,50,0.97)" : "rgba(255,255,255,0.97)";
    const color = darkModeEnabled ? "#e0e0e0" : "#212529";
    return (
      "background:" +
      bg +
      ";color:" +
      color +
      ";backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);" +
      (extra || "")
    );
  }

  function refreshModalCardsTheme() {
    document.querySelectorAll(".ext-modal-card").forEach(function (card) {
      card.style.cssText = modalCardStyle(card.dataset.baseStyle || "");
    });
  }

  function applyDarkMode(enabled) {
    darkModeEnabled = enabled;
    refreshModalCardsTheme();

    // <body> puede no existir si se llama muy temprano; esperar al DOM
    function toggle() {
      document.body.classList.toggle("dark-mode", enabled);
      const existing = document.getElementById(DARK_LINK_ID);
      if (enabled) {
        if (!existing) {
          const link = document.createElement("link");
          link.id = DARK_LINK_ID;
          link.rel = "stylesheet";
          link.type = "text/css";
          link.href = chrome.runtime.getURL("assets/css/dark-mode.css");
          document.head.appendChild(link);
        }
        // El guard queda montado mientras dure la sesión con modo oscuro
        // activo (no se saca apenas carga el CSS): GeneXus puede volver a
        // sacarle la clase "dark-mode" a <body> más adelante (ajax parcial
        // de alguna sección) y este observer no siempre reacciona antes del
        // siguiente frame pintado. Mantenerlo puesto evita ese flash
        // intermitente; se retira recién cuando el usuario apaga la opción.
        injectFlashGuard();
      } else {
        if (existing) existing.remove();
        removeFlashGuard();
      }
    }

    if (enabled) {
      startDarkModeEnforcer();
      ensureDarkModeApplied();
    }

    if (document.body) {
      toggle();
    } else {
      document.addEventListener("DOMContentLoaded", toggle, { once: true });
    }
  }

  function readDarkModeMirror() {
    try {
      return localStorage.getItem(DARK_MODE_LS_KEY) === "1";
    } catch (e) {
      // localStorage puede estar bloqueado en algún perfil; sin la
      // optimización anti-flash el modo oscuro igual funciona (sólo async).
      return false;
    }
  }

  function writeDarkModeMirror(enabled) {
    try {
      localStorage.setItem(DARK_MODE_LS_KEY, enabled ? "1" : "0");
    } catch (e) {
      // Ignorar: ver readDarkModeMirror.
    }
  }

  function initDarkMode() {
    // 1) Lectura SÍNCRONA del espejo en el localStorage de la página, para
    //    oscurecer antes del primer pintado sin esperar a chrome.storage.local
    //    (que es async y puede tardar lo suficiente como para que el
    //    navegador ya haya pintado en blanco, causando el flash).
    const mirrorDark = readDarkModeMirror();
    if (mirrorDark) {
      injectFlashGuard();
      applyDarkMode(true);
    }

    // 2) Confirmar contra la fuente de verdad (chrome.storage.local) y
    //    corregir si el espejo estaba desactualizado.
    chrome.storage.local.get("darkMode", function (data) {
      const enabled = !!data.darkMode;
      writeDarkModeMirror(enabled);
      if (enabled !== mirrorDark) {
        applyDarkMode(enabled);
      } else if (!enabled) {
        removeFlashGuard();
      }
    });

    chrome.storage.onChanged.addListener(function (changes) {
      if ("darkMode" in changes) {
        const enabled = !!changes.darkMode.newValue;
        writeDarkModeMirror(enabled);
        applyDarkMode(enabled);
      }
    });
  }

  // Ejecutar initDarkMode lo antes posible (document_start)
  initDarkMode();

  // Helper de depuración: expuesto en window para ejecutar desde la consola del navegador.
  // Uso: findLightElements()
  window.findLightElements = function () {
    let found = 0;
    document.querySelectorAll("*").forEach(function (el) {
      const style = window.getComputedStyle(el);
      const bg = style.backgroundColor;
      const color = style.color;
      if (bg === "rgb(255, 255, 255)" || bg === "rgba(255, 255, 255, 1)") {
        console.log(
          "BG BLANCO:",
          el.tagName,
          el.className || "(sin clase)",
          el,
        );
        found++;
      }
      if (color === "rgb(0, 0, 0)") {
        console.log(
          "TEXTO NEGRO:",
          el.tagName,
          el.className || "(sin clase)",
          el,
        );
        found++;
      }
    });
    console.log("findLightElements: " + found + " elemento(s) encontrado(s).");
  };

  // ─── Monitoreo pendientes (tramiteprincipal) ─────────────────────────────────

  function extractCount(text) {
    const match = (text || "").match(/\((\d+)\)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  function reportToServiceWorker(linkEl) {
    const count = extractCount(linkEl.textContent);
    const href = linkEl.getAttribute("href") || "";
    // Guardar la URL de pendientes con su token actual para que el service worker la use
    if (href) {
      const fullUrl = "https://app.chaco.gob.ar/tramites/servlet/" + href;
      // Se guarda en storage.session (memoria, no persiste en disco) porque
      // la URL contiene el token de sesión vigente.
      chrome.storage.session.set({ pendingUrl: fullUrl });
    }
    chrome.runtime.sendMessage({
      type: "pendingCount",
      count: count,
      href: href,
    });
  }

  function reportInGestionToServiceWorker(linkEl) {
    const count = extractCount(linkEl.textContent);
    const href = linkEl.getAttribute("href") || "";
    if (href) {
      const fullUrl = "https://app.chaco.gob.ar/tramites/servlet/" + href;
      chrome.storage.session.set({ inGestionUrl: fullUrl, pendingUrl: fullUrl });
    }
    chrome.runtime.sendMessage({
      type: "inGestionCount",
      count: count,
      href: href,
    });
  }

  function initPendientes() {
    const linkEl = document.getElementById("3");
    if (!linkEl) return;
    reportToServiceWorker(linkEl);
    const observer = new MutationObserver(() => reportToServiceWorker(linkEl));
    observer.observe(linkEl, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  function initEnGestionMonitor() {
    const linkEl = document.getElementById("4");
    if (!linkEl) return;

    reportInGestionToServiceWorker(linkEl);

    const observer = new MutationObserver(function () {
      reportInGestionToServiceWorker(linkEl);
    });
    observer.observe(linkEl, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // Verificar cada 1 minuto sin recargar la página.
    setInterval(function () {
      reportInGestionToServiceWorker(linkEl);
    }, 60 * 1000);
  }

  function getPendingStatus() {
    const linkEl = document.getElementById("3");
    const href = linkEl ? linkEl.getAttribute("href") || "" : "";
    const count = linkEl ? extractCount(linkEl.textContent) : 0;
    const inGestionEl = document.getElementById("4");
    const inGestionHref = inGestionEl
      ? inGestionEl.getAttribute("href") || ""
      : "";
    const inGestionCount = inGestionEl
      ? extractCount(inGestionEl.textContent)
      : 0;
    return {
      count: count,
      href: href,
      inGestionCount: inGestionCount,
      inGestionHref: inGestionHref,
      hasFocus: document.hasFocus() && document.visibilityState === "visible",
      lastInteraction: lastUserInteractionAt,
    };
  }

  function replaceHeaderLogo() {
    const target = chrome.runtime.getURL("assets/img/logochico.png");
    const logos = document.querySelectorAll(
      'img[src*="/tramites/static/Resources/logochico.png"]',
    );
    logos.forEach(function (img) {
      if (img.getAttribute("src") !== target) {
        img.setAttribute("src", target);
      }
    });
  }

  function initActivityTracking() {
    const opts = { capture: true, passive: true };
    ["pointerdown", "keydown", "scroll", "touchstart"].forEach((eventName) => {
      document.addEventListener(eventName, markUserInteraction, opts);
    });
    window.addEventListener("focus", markUserInteraction);
    document.addEventListener("visibilitychange", markUserInteraction);
  }

  // ─── WhatsApp en reasignartramite ────────────────────────────────────────────

  function getTramiteId() {
    const el = document.getElementById("span_W0015TRAMITEIDENTIFICACION");
    return el ? el.textContent.trim() : "";
  }

  function normalize(str) {
    return (str || "").toUpperCase().replace(/\s+/g, " ").trim();
  }

  function openWhatsApp(phone, tramite) {
    const clean = phone.replace(/\D/g, "");
    const msg = encodeURIComponent("Te asigné un nuevo trámite " + tramite);
    const webUrl =
      "https://web.whatsapp.com/send?phone=" + clean + "&text=" + msg;
    // Pedir al service worker que reutilice la pestaña de WhatsApp si existe
    chrome.runtime.sendMessage({ type: "openWhatsApp", url: webUrl });
  }

  async function handleWhatsAppClick(selectedName) {
    const data = await chrome.storage.local.get("waContacts");
    const contacts = data.waContacts || [];
    const ns = normalize(selectedName);
    const contact = contacts.find(function (c) {
      const nc = normalize(c.name);
      return ns.includes(nc) || nc.includes(ns);
    });
    const tramite = getTramiteId();
    if (contact) {
      openWhatsApp(contact.phone, tramite);
    } else {
      showPhoneModal(selectedName, tramite);
    }
  }

  function injectModal() {
    if (document.getElementById("ext-phone-modal")) return;
    const modal = document.createElement("div");
    modal.id = "ext-phone-modal";
    modal.className = "ext-modal-overlay";
    modal.style.cssText =
      "display:none;position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.5);align-items:center;justify-content:center;";
    const phoneCardBaseStyle =
      "border-radius:8px;padding:24px;min-width:340px;box-shadow:0 4px 24px rgba(0,0,0,0.25);";
    modal.innerHTML =
      '<div class="ext-modal-card" data-base-style="' +
      phoneCardBaseStyle +
      '" style="' +
      phoneCardBaseStyle +
      '">' +
      '<h5 style="margin:0 0 8px;font-size:16px;">N\u00famero de WhatsApp</h5>' +
      '<p style="margin:0 0 12px;opacity:0.7;font-size:13px;">No hay tel\u00e9fono guardado para <strong id="ext-modal-name"></strong>.<br>Ingres\u00e1 el n\u00famero con c\u00f3digo de pa\u00eds (ej: 5493624123456).</p>' +
      '<input id="ext-modal-phone" type="tel" placeholder="5493624XXXXXX" style="width:100%;border:1px solid #ccc;border-radius:4px;padding:8px;font-size:14px;box-sizing:border-box;margin-bottom:14px;">' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;">' +
      '<button type="button" id="ext-modal-cancel" style="background:#6c757d;color:#fff;border:none;border-radius:4px;padding:6px 16px;cursor:pointer;">Cancelar</button>' +
      '<button type="button" id="ext-modal-confirm" style="background:#25d366;color:#fff;border:none;border-radius:4px;padding:6px 16px;font-weight:700;cursor:pointer;">Guardar y enviar</button>' +
      "</div></div>";
    document.body.appendChild(modal);
    refreshModalCardsTheme();

    document
      .getElementById("ext-modal-cancel")
      .addEventListener("click", function () {
        modal.style.display = "none";
      });
  }

  function showPhoneModal(name, tramite) {
    const modal = document.getElementById("ext-phone-modal");
    if (!modal) return;
    document.getElementById("ext-modal-name").textContent = name;
    document.getElementById("ext-modal-phone").value = "";
    modal.style.display = "flex";

    const confirmBtn = document.getElementById("ext-modal-confirm");
    const newConfirm = confirmBtn.cloneNode(true); // quita listeners anteriores
    confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);
    newConfirm.addEventListener("click", async function () {
      const phone = document.getElementById("ext-modal-phone").value.trim();
      if (!phone) return;
      const data = await chrome.storage.local.get("waContacts");
      const contacts = data.waContacts || [];
      contacts.push({ name: name, phone: phone });
      await chrome.storage.local.set({ waContacts: contacts });
      modal.style.display = "none";
      openWhatsApp(phone, tramite);
    });
  }

  function initReasignar() {
    // Guard: evitar inicializar si el botón ya fue inyectado en este DOM.
    if (document.getElementById("ext-wa-btn")) return;

    const chosen = document.getElementById("vAGENTEDEPENAGENTEID_chosen");
    if (!chosen) {
      // El chosen se puede inicializar tarde; reintentar
      setTimeout(initReasignar, 800);
      return;
    }

    injectModal();

    // Botón WhatsApp
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "ext-wa-btn";
    btn.textContent = "\uD83D\uDCF1 Notificar por WhatsApp";
    btn.style.cssText =
      "display:none;background:#25d366;color:#fff;border:none;border-radius:4px;" +
      "padding:6px 14px;font-weight:700;font-size:14px;cursor:pointer;margin-top:8px;";
    chosen.parentNode.insertBefore(btn, chosen.nextSibling);

    const selectedSpan = chosen.querySelector(".chosen-single span");

    // Nombre confirmado (última selección real, no texto del filtro)
    let confirmedName = "";

    function showButton(name) {
      confirmedName = name;
      if (!name || name === "Liberar el Tr\u00e1mite") {
        btn.style.display = "none";
        return;
      }
      btn.style.display = "inline-block";
      btn.onclick = function () {
        handleWhatsAppClick(confirmedName);
      };
    }

    // Usar delegación de eventos sobre el contenedor chosen (que no cambia),
    // evitando que re-renders del .chosen-results al filtrar rompan el listener.
    chosen.addEventListener("click", function (e) {
      const li = e.target.closest(".chosen-results li");
      if (!li) return;
      // Leer el texto del li (sin etiquetas <em> del resaltado de filtro)
      const name = li.textContent.trim();
      setTimeout(function () {
        showButton(name);
      }, 30);
    });

    // Fallback: also listen to change on the underlying select
    const select =
      document.querySelector("select[id='vAGENTEDEPENAGENTEID']") ||
      document.querySelector("select[name='vAGENTEDEPENAGENTEID']");
    if (select) {
      select.addEventListener("change", function () {
        setTimeout(function () {
          const name = selectedSpan ? selectedSpan.textContent.trim() : "";
          showButton(name);
        }, 80);
      });
    }
  }

  // ─── Favoritos en vertramites ─────────────────────────────────────────────────

  function initVertramites() {
    const titleEl = document.getElementById("TEXTBLOCKTITLE_MPAGE");
    if (!titleEl) return;
    // No almacenar `expediente` ni `aeNumber` en el closure: el DOM puede
    // cambiar cuando el usuario navega entre trámites y queremos que el
    // modal siempre refleje el expediente actual.
    function readExpedienteAndAe() {
      const raw = (titleEl.textContent || "").trim();
      const aeMatch = raw.match(/(\d+)\s*-\s*AE\b/i);
      return { expediente: raw, aeNumber: aeMatch ? aeMatch[1] : "" };
    }

    // Refleja en el bot\u00F3n si el expediente actualmente mostrado ya est\u00E1
    // guardado en favoritos, consultando storage cada vez porque el
    // usuario puede navegar entre tr\u00E1mites sin recargar la p\u00E1gina.
    function updateFavButtonState(btn) {
      const info = readExpedienteAndAe();
      chrome.storage.local.get("favorites", function (data) {
        const favs = data.favorites || [];
        const isFav = favs.some(function (f) {
          return f.expediente === info.expediente;
        });
        if (isFav) {
          btn.textContent = "\u2705 En favoritos";
          btn.style.background = "#28a745";
          btn.title = "Ya est\u00E1 en tus favoritos";
        } else {
          btn.textContent = "\u2B50 Favorito";
          btn.style.background = "#f0a500";
          btn.title = "Agregar a favoritos";
        }
      });
    }

    // Guard: si el bot\u00F3n ya fue inyectado (navegaci\u00F3n AJAX a otro tr\u00E1mite
    // dentro de la misma p\u00E1gina), s\u00F3lo refrescar su estado de favorito.
    const existingBtn = document.getElementById("ext-fav-btn");
    if (existingBtn) {
      updateFavButtonState(existingBtn);
      return;
    }

    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "ext-fav-btn";
    btn.style.cssText =
      "margin-left:12px;background:#f0a500;color:#fff;border:none;border-radius:4px;" +
      "padding:3px 10px;font-size:13px;font-weight:600;cursor:pointer;vertical-align:middle;";
    titleEl.parentNode.insertBefore(btn, titleEl.nextSibling);
    updateFavButtonState(btn);

    // Re-evaluar el estado del check cuando el t\u00EDtulo cambia (navegaci\u00F3n
    // AJAX entre tr\u00E1mites sin recarga completa de la p\u00E1gina).
    const titleObserver = new MutationObserver(function () {
      updateFavButtonState(btn);
    });
    titleObserver.observe(titleEl, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // Modal de observaciones
    const overlay = document.createElement("div");
    overlay.id = "ext-fav-overlay";
    overlay.className = "ext-modal-overlay";
    overlay.style.cssText =
      "display:none;position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.5);" +
      "align-items:center;justify-content:center;";
    const favCardBaseStyle =
      "border-radius:8px;padding:24px;min-width:340px;box-shadow:0 4px 24px rgba(0,0,0,0.25);";
    overlay.innerHTML =
      '<div class="ext-modal-card" data-base-style="' +
      favCardBaseStyle +
      '" style="' +
      favCardBaseStyle +
      '">' +
      '<h5 style="margin:0 0 8px;font-size:16px;">\u2B50 Agregar a favoritos</h5>' +
      '<p id="ext-fav-exp-line" style="margin:0 0 6px;font-size:13px;opacity:0.7;">Expediente: <strong id="ext-fav-exp"></strong></p>' +
      '<p id="ext-fav-ae-line" style="margin:0 0 8px;font-size:12px;opacity:0.6;display:none;">Nro AE: <strong id="ext-fav-ae"></strong></p>' +
      '<textarea id="ext-fav-obs" rows="3" placeholder="Observaciones (opcional)" style="width:100%;border:1px solid #ccc;border-radius:4px;padding:8px;font-size:13px;box-sizing:border-box;resize:vertical;margin-bottom:14px;"></textarea>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;">' +
      '<button type="button" id="ext-fav-cancel" style="background:#6c757d;color:#fff;border:none;border-radius:4px;padding:6px 16px;cursor:pointer;">Cancelar</button>' +
      '<button type="button" id="ext-fav-save" style="background:#f0a500;color:#fff;border:none;border-radius:4px;padding:6px 16px;font-weight:700;cursor:pointer;">Guardar</button>' +
      "</div></div>";
    document.body.appendChild(overlay);
    refreshModalCardsTheme();

    btn.addEventListener("click", function () {
      // Leer expediente y AE en el momento de abrir el modal para evitar
      // mostrar/guardar un trámite anterior.
      const info = readExpedienteAndAe();
      document.getElementById("ext-fav-exp").textContent = info.expediente;
      const aeLine = document.getElementById("ext-fav-ae-line");
      const aeEl = document.getElementById("ext-fav-ae");
      if (info.aeNumber) {
        aeEl.textContent = info.aeNumber;
        aeLine.style.display = "block";
      } else {
        aeLine.style.display = "none";
        aeEl.textContent = "";
      }
      document.getElementById("ext-fav-obs").value = "";
      overlay.style.display = "flex";
    });
    document
      .getElementById("ext-fav-cancel")
      .addEventListener("click", function () {
        overlay.style.display = "none";
      });
    document
      .getElementById("ext-fav-save")
      .addEventListener("click", async function () {
        // Leer expediente actual al guardar (no confiar en valores cerrados).
        const info = readExpedienteAndAe();
        const obs = document.getElementById("ext-fav-obs").value.trim();
        const data = await chrome.storage.local.get("favorites");
        const favs = data.favorites || [];
        // Evitar duplicados comparando con el expediente actual
        const exists = favs.some(function (f) {
          return f.expediente === info.expediente;
        });
        if (!exists) {
          favs.unshift({
            expediente: info.expediente,
            aeNumber: info.aeNumber,
            obs: obs,
          });
          await chrome.storage.local.set({ favorites: favs });
        }
        overlay.style.display = "none";
        updateFavButtonState(btn);
      });
  }

  // ─── Rellenar inputs de búsqueda desde favoritos ──────────────────────────────

  function fillSearchFromExpediente(expediente) {
    // Formato: "E 14-2025-3870-Ae"  → quitar prefijo letra+espacio, split por -
    const withoutPrefix = expediente.replace(/^[A-Z]\s+/i, "");
    const parts = withoutPrefix.split("-");
    if (parts.length < 4) return;
    const jur = parts[0].trim();
    const anio = parts[1].trim();
    const nro = parts[2].trim();
    const tipo = parts[3].trim();

    function setInput(id, value) {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }

    setInput("MPW0017vTRAMITEJURISDICCIONID", jur);
    setInput("MPW0017vTRAMITEANIO", anio);
    setInput("MPW0017vTRAMITENRO", nro);
    setInput("MPW0017vTIPOTRAMITECODIGO", tipo);

    setTimeout(function () {
      const searchBtn = document.getElementById("MPW0017ENTER");
      if (searchBtn) searchBtn.click();
    }, 200);
  }

  // Escuchar mensajes del service worker
  chrome.runtime.onMessage.addListener(
    function (request, sender, sendResponse) {
      if (request.type === "fillFavorite") {
        fillSearchFromExpediente(request.expediente);
      }
      // La alarma del SW pide el conteo actual cuando hay una pestaña abierta,
      // así se evita un fetch en background con posibles problemas de sesión.
      if (request.type === "queryPendingCount") {
        const linkEl = document.getElementById("3");
        if (linkEl) reportToServiceWorker(linkEl);
      }
      if (request.type === "queryPendingStatus") {
        sendResponse(getPendingStatus());
      }
    },
  );

  // Si se abrió la pestaña sin que hubiera una activa, revisar pendingFill
  chrome.storage.session.get("pendingFill", function (data) {
    if (data.pendingFill) {
      chrome.storage.session.remove("pendingFill");
      // Esperar que el DOM del buscador esté listo
      setTimeout(function () {
        fillSearchFromExpediente(data.pendingFill);
      }, 800);
    }
  });

  // ─── Bootstrap ───────────────────────────────────────────────────────────────

  // El botón de favoritos sólo debe existir en com.ecom.vertramites. Si la
  // app navega (AJAX, sin recarga completa) a otra pantalla, hay que
  // quitarlo: de lo contrario queda "pegado" en pantallas como
  // com.ecom.verpartedigital porque el content script no vuelve a correr.
  function removeVertramitesFavUI() {
    const btn = document.getElementById("ext-fav-btn");
    if (btn) btn.remove();
    const overlay = document.getElementById("ext-fav-overlay");
    if (overlay) overlay.remove();
  }

  function tryInitForCurrentUrl() {
    if (location.href.includes("com.ecom.reasignartramite")) {
      initReasignar();
    }
    const onVertramites =
      location.hostname === "app.chaco.gob.ar" &&
      location.pathname === "/tramites/servlet/com.ecom.vertramites";
    if (onVertramites) {
      initVertramites();
    } else {
      removeVertramitesFavUI();
    }
  }

  function init() {
    initActivityTracking();
    initPendientes();
    initEnGestionMonitor();
    replaceHeaderLogo();
    tryInitForCurrentUrl();
  }

  // Detectar navegación AJAX: cuando la app cambia la URL sin recargar la
  // página completa (pushState / replaceState), el content script no vuelve a
  // inicializarse. Observamos cambios en el DOM + comparamos location.href.
  let _lastUrl = location.href;
  const _navObserver = new MutationObserver(function () {
    replaceHeaderLogo();
    if (location.href !== _lastUrl) {
      _lastUrl = location.href;
      tryInitForCurrentUrl();
      initEnGestionMonitor();
    }
  });
  // Observar childList en body es suficiente para detectar reemplazos de
  // contenido principal sin ser tan costoso como subtree.
  function startNavObserver() {
    if (document.body) {
      _navObserver.observe(document.body, { childList: true, subtree: false });
    } else {
      document.addEventListener(
        "DOMContentLoaded",
        function () {
          _navObserver.observe(document.body, {
            childList: true,
            subtree: false,
          });
        },
        { once: true },
      );
    }
  }
  startNavObserver();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
