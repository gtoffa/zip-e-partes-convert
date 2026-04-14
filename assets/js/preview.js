(async function () {
  const data = await chrome.storage.session.get("pdfPreview");
  if (!data.pdfPreview) {
    document.getElementById("titulo").textContent =
      "Error: no se encontraron datos del PDF.";
    return;
  }

  const { base64, filename } = data.pdfPreview;
  await chrome.storage.session.remove("pdfPreview");

  const binStr = atob(base64);
  const arr = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) arr[i] = binStr.charCodeAt(i);
  const blob = new Blob([arr], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);

  const nameWithoutExt = filename.replace(/\.pdf$/i, "");
  document.getElementById("titulo").textContent = "Resultado " + nameWithoutExt;
  document.getElementById("btn-download").textContent =
    "\u2193 Descargar " + filename;
  document.getElementById("preview").src = url;

  const overlay = document.getElementById("loading-overlay");
  const loadingMsg = document.getElementById("loading-msg");
  const btnDownload = document.getElementById("btn-download");

  btnDownload.addEventListener("click", function () {
    btnDownload.disabled = true;
    overlay.classList.add("visible");
    loadingMsg.textContent = "Descargando " + filename + "...";

    chrome.downloads.download(
      { url: url, filename: filename, saveAs: false },
      function (downloadId) {
        if (chrome.runtime.lastError || downloadId === undefined) {
          overlay.classList.remove("visible");
          btnDownload.disabled = false;
          return;
        }
        chrome.downloads.onChanged.addListener(function listener(delta) {
          if (delta.id !== downloadId) return;
          if (delta.state && delta.state.current === "complete") {
            chrome.downloads.onChanged.removeListener(listener);
            loadingMsg.textContent = "Abriendo archivo...";
            chrome.downloads.open(downloadId);
            overlay.classList.remove("visible");
            btnDownload.disabled = false;
          } else if (delta.error) {
            chrome.downloads.onChanged.removeListener(listener);
            overlay.classList.remove("visible");
            btnDownload.disabled = false;
          }
        });
      },
    );
  });
})();
