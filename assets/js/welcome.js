(function () {
  "use strict";

  var manifest = chrome.runtime.getManifest();
  var badge = document.getElementById("version-badge");
  if (badge) {
    badge.textContent = "versión " + manifest.version;
  }

  var closeBtn = document.getElementById("btn-close");
  if (closeBtn) {
    closeBtn.addEventListener("click", function () {
      window.close();
    });
  }

  // ─── Permiso de acceso a archivos locales (file:///) ───────────────────────
  // Chrome nunca concede este permiso automáticamente, aunque esté declarado
  // en el manifest: el usuario tiene que habilitarlo a mano una vez, desde la
  // página de detalles de la extensión. Lo detectamos y lo señalamos acá para
  // que no se entere recién cuando falle la conversión a PDF.

  var alertBox = document.getElementById("perm-alert");
  var okBox = document.getElementById("perm-ok");

  function refreshFileAccessStatus() {
    if (!alertBox || !okBox) return;
    chrome.permissions.contains({ origins: ["file://*"] }, function (granted) {
      alertBox.style.display = granted ? "none" : "flex";
      okBox.style.display = granted ? "flex" : "none";
    });
  }

  refreshFileAccessStatus();

  var btnEnableFileAccess = document.getElementById("btn-enable-file-access");
  if (btnEnableFileAccess) {
    btnEnableFileAccess.addEventListener("click", function () {
      chrome.tabs.create({
        url: "chrome://extensions/?id=" + chrome.runtime.id,
      });
    });
  }

  // Si el usuario habilita el permiso en la otra pestaña y vuelve a esta,
  // refrescar el estado sin que tenga que recargar la página.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") refreshFileAccessStatus();
  });
})();
