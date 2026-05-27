// Copyright (c) 2013 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// ─── Monitoreo de pendientes ─────────────────────────────────────────────────

const MONITOR_ALARM = "pendingMonitor";
const APP_BASE_URL = "https://app.chaco.gob.ar/tramites/servlet/";
const MAIN_PAGE_URL = APP_BASE_URL + "com.ecom.tramiteprincipal";
const SYNC_ERROR_NOTIFY_COOLDOWN_MS = 10 * 60 * 1000;

function extractPendingCount(text) {
  const match = (text || "").match(/\((\d+)\)/);
  return match ? parseInt(match[1], 10) : 0;
}

async function sendPendingNotification(count) {
  const msg =
    count === 1
      ? "1 trámite pendiente de recibir."
      : `${count} trámites pendientes de recibir.`;
  // Usar un ID único por notificación para que Chrome las muestre todas,
  // incluso si la anterior aún no fue descartada por el usuario.
  const notifId = "pending-" + Date.now();
  chrome.notifications.create(notifId, {
    type: "basic",
    iconUrl: "assets/img/icon128.png",
    title: "Trámites Pendientes de Recibir",
    message: msg,
    priority: 2,
  });
}

async function handlePendingCount(count) {
  const data = await chrome.storage.local.get("pendingCount");
  const prev = data.pendingCount !== undefined ? data.pendingCount : -1;

  // Si el conteo no cambió, no hay nada que hacer.
  if (count === prev) return;

  // Actualizar siempre (incluyendo decrementos) para que el próximo
  // incremento dispare la notificación desde la base correcta.
  await chrome.storage.local.set({ pendingCount: count });

  // Notificar cuando el conteo AUMENTÓ respecto al previo conocido.
  // Si prev === -1 (estado desconocido), notificar igual si count > 0,
  // porque significa que hay pendientes que el usuario aún no conoce.
  const subio = prev === -1 ? count > 0 : count > prev;
  if (subio) {
    await sendPendingNotification(count);
  }
}

async function handleInGestionCount(count) {
  const data = await chrome.storage.local.get("inGestionCount");
  const prev = data.inGestionCount !== undefined ? data.inGestionCount : -1;
  if (count === prev) return;
  await chrome.storage.local.set({ inGestionCount: count });
}

async function checkPendingFromBackground() {
  try {
    // Preferir la URL guardada (con token actual) y hacer fallback a la URL
    // base si el token ya venció o la respuesta no contiene el menú esperado.
    const stored = await chrome.storage.local.get("pendingUrl");
    const candidateUrl = stored.pendingUrl || MAIN_PAGE_URL;

    async function fetchHtml(url) {
      const resp = await fetch(url, { credentials: "include" });
      if (!resp.ok) return null;
      return await resp.text();
    }

    let html = await fetchHtml(candidateUrl);
    if (!html && candidateUrl !== MAIN_PAGE_URL) {
      html = await fetchHtml(MAIN_PAGE_URL);
    }
    if (!html) return false;

    // Guardia: si la respuesta no contiene la palabra "Pendiente" en ninguna
    // forma, probablemente es una redirección al login — no actualizar el conteo.
    if (!html.includes("Pendiente")) {
      if (candidateUrl !== MAIN_PAGE_URL) {
        html = await fetchHtml(MAIN_PAGE_URL);
        if (!html || !html.includes("Pendiente")) return false;
      } else {
        return false;
      }
    }

    // Actualizar la URL del enlace de pendientes si el servidor rotó el token.
    const hrefMatch =
      html.match(/id="3"[^>]*href="([^"]+)"/) ||
      html.match(/href="([^"]+)"[^>]*id="3"/);
    if (hrefMatch && hrefMatch[1]) {
      await chrome.storage.local.set({
        pendingUrl: APP_BASE_URL + hrefMatch[1],
      });
    }

    // Mantener también el token más nuevo que llegue desde el menú id="4".
    const inGestionHrefMatch =
      html.match(/id="4"[^>]*href="([^"]+)"/) ||
      html.match(/href="([^"]+)"[^>]*id="4"/);
    if (inGestionHrefMatch && inGestionHrefMatch[1]) {
      await chrome.storage.local.set({
        inGestionUrl: APP_BASE_URL + inGestionHrefMatch[1],
        pendingUrl: APP_BASE_URL + inGestionHrefMatch[1],
      });
    }

    // Cuando hay 0 pendientes el servidor muestra "Pendiente" sin paréntesis;
    // cuando hay N muestra "Pendientes (N)". Ambos casos se manejan aquí.
    const pendMatch = html.match(/Pendientes?\s*\((\d+)\)/i);
    const count = pendMatch ? parseInt(pendMatch[1], 10) : 0;
    await handlePendingCount(count);

    const inGestionMatch = html.match(/En\s*Gesti[oó]n\s*\((\d+)\)/i);
    const inGestionCount = inGestionMatch ? parseInt(inGestionMatch[1], 10) : 0;
    await handleInGestionCount(inGestionCount);

    // Sincronización exitosa
    await chrome.storage.local.set({ syncError: false });
    return true;
  } catch (e) {
    console.warn("[pendiente] Error al verificar en background:", e);
    await chrome.storage.local.set({ syncError: true });
    return false;
  }
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(response || null);
    });
  });
}

async function sendSyncErrorNotification() {
  const notifId = "sync-error-" + Date.now();
  chrome.notifications.create(notifId, {
    type: "basic",
    iconUrl: "assets/img/icon128.png",
    title: "Error de Sincronización",
    message: "Inicia sesión en SGT para verificar pendientes",
    priority: 2,
  });
}

async function markSyncSuccess() {
  await chrome.storage.local.set({
    syncError: false,
    syncFailureCount: 0,
  });
}

async function markSyncFailure() {
  const now = Date.now();
  const data = await chrome.storage.local.get([
    "syncFailureCount",
    "lastSyncErrorNotificationAt",
  ]);
  const syncFailureCount = Number(data.syncFailureCount || 0) + 1;
  const lastNotifAt = Number(data.lastSyncErrorNotificationAt || 0);
  const shouldNotify =
    syncFailureCount === 1 ||
    now - lastNotifAt >= SYNC_ERROR_NOTIFY_COOLDOWN_MS;

  const payload = {
    syncError: true,
    syncFailureCount,
  };

  if (shouldNotify) {
    await sendSyncErrorNotification();
    payload.lastSyncErrorNotificationAt = now;
  }

  await chrome.storage.local.set(payload);
}

async function syncMonitorAlarm() {
  const data = await chrome.storage.local.get("notifyPending");
  if (data.notifyPending) {
    const existing = await chrome.alarms.get(MONITOR_ALARM);
    if (!existing) {
      chrome.alarms.create(MONITOR_ALARM, {
        delayInMinutes: 0.1,
        periodInMinutes: 1,
      });
    }
  } else {
    chrome.alarms.clear(MONITOR_ALARM);
  }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== MONITOR_ALARM) return;
  const data = await chrome.storage.local.get("notifyPending");
  if (!data.notifyPending) return;

  // Verificar cada minuto el estado del menú en vivo (id=3 e id=4) sin recargar.
  // Si no hay pestañas, usar fetch en background.
  const servletTabs = await chrome.tabs.query({
    url: "https://app.chaco.gob.ar/tramites/servlet/*",
  });
  if (servletTabs.length > 0) {
    const tab = servletTabs[0];
    const status = await sendTabMessage(tab.id, { type: "queryPendingStatus" });

    if (status) {
      if (typeof status.count === "number") {
        await handlePendingCount(status.count);
      }
      if (typeof status.inGestionCount === "number") {
        await handleInGestionCount(status.inGestionCount);
      }
      if (status.href) {
        await chrome.storage.local.set({
          pendingUrl: APP_BASE_URL + status.href,
        });
      }
      if (status.inGestionHref) {
        await chrome.storage.local.set({
          inGestionUrl: APP_BASE_URL + status.inGestionHref,
          pendingUrl: APP_BASE_URL + status.inGestionHref,
        });
      }
      await markSyncSuccess();
    } else {
      // Fallback: content script no disponible.
      const success = await checkPendingFromBackground();
      if (success) {
        await markSyncSuccess();
      } else {
        await markSyncFailure();
      }
    }
  } else {
    const success = await checkPendingFromBackground();
    if (success) {
      await markSyncSuccess();
    } else {
      await markSyncFailure();
    }
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "notifyPending" in changes) {
    syncMonitorAlarm();
  }
});

chrome.runtime.onStartup.addListener(async () => {
  // Al abrir Chrome: sincronizar pendientes y alertar si falla
  const data = await chrome.storage.local.get("notifyPending");
  if (data.notifyPending) {
    const success = await checkPendingFromBackground();
    if (success) {
      await markSyncSuccess();
    } else {
      await markSyncFailure();
    }
    // Reiniciar alarma de monitoreo
    await syncMonitorAlarm();
  }
});

chrome.runtime.onInstalled.addListener(syncMonitorAlarm);

// ─── Mensajes ─────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (request.message === "seticon") {
    chrome.action.setIcon({ path: "assets/img/icon19.png" });
  }
  if (request.type === "pendingCount") {
    // Actualizar también la URL con token cuando el content script la reporta
    if (request.href) {
      chrome.storage.local.set({ pendingUrl: APP_BASE_URL + request.href });
    }
    handlePendingCount(request.count);
  }
  if (request.type === "inGestionCount") {
    if (request.href) {
      chrome.storage.local.set({
        inGestionUrl: APP_BASE_URL + request.href,
        pendingUrl: APP_BASE_URL + request.href,
      });
    }
    handleInGestionCount(request.count);
  }
  if (request.type === "openWhatsApp") {
    chrome.tabs.query({ url: "https://web.whatsapp.com/*" }, function (tabs) {
      if (tabs.length > 0) {
        const tab = tabs[0];
        chrome.tabs.update(tab.id, { active: true, url: request.url });
        chrome.windows.update(tab.windowId, { focused: true });
      } else {
        chrome.tabs.create({ url: request.url });
      }
    });
  }
  if (request.type === "fillFavorite") {
    // Buscar pestaña abierta del sitio y enviarle el mensaje para rellenar inputs
    chrome.tabs.query(
      { url: "https://app.chaco.gob.ar/tramites/servlet/*" },
      function (tabs) {
        if (tabs.length > 0) {
          const tab = tabs[0];
          chrome.tabs.update(tab.id, { active: true });
          chrome.windows.update(tab.windowId, { focused: true });
          // Pequeña espera para que la pestaña sea visible antes de enviar el mensaje
          setTimeout(function () {
            chrome.tabs.sendMessage(tab.id, {
              type: "fillFavorite",
              expediente: request.expediente,
            });
          }, 300);
        } else {
          // No hay pestaña abierta: abrir el sitio. El content script rellenará cuando cargue.
          chrome.storage.session.set({ pendingFill: request.expediente });
          chrome.tabs.create({
            url: "https://app.chaco.gob.ar/tramites/servlet/com.ecom.tramiteprincipal",
          });
        }
      },
    );
  }
});

// ─── Click en notificación → abrir/enfocar tramiteprincipal ──────────────────

chrome.notifications.onClicked.addListener(async (notificationId) => {
  if (!notificationId.startsWith("pending-")) return;
  // Usar la URL guardada con token o la base como fallback
  const stored = await chrome.storage.local.get("pendingUrl");
  const targetUrl = stored.pendingUrl || MAIN_PAGE_URL;
  const tabs = await chrome.tabs.query({ url: APP_BASE_URL + "*" });
  if (tabs.length > 0) {
    chrome.tabs.update(tabs[0].id, { active: true });
    chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    chrome.tabs.create({ url: targetUrl });
  }
});

chrome.downloads.onChanged.addListener(function (delta) {
  chrome.downloads.search({ id: delta.id }, function (items) {
    if (
      items[0].url.includes(
        "https://app.chaco.gob.ar/tramites/servlet/com.ecom.abajardeavariaspartes",
      )
    ) {
      var path = "assets/img/";

      if (items[0].state) {
        if (items[0].state == "in_progress") {
          path += "inprogress.png";
        } else if (items[0].state == "complete") {
          if (items[0].exists) {
            path += "listo.png";
          } else {
            path += "icon19.png";
          }
        } else {
          path += "icon19.png";
        }
      } else {
        path += "icon19.png";
      }

      chrome.action.setIcon({ path: path });
    }
  });
});
