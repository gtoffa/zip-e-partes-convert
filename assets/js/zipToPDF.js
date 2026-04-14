async function convertpdf(filename, basename) {
  document.getElementById("items").style.display = "none";
  document.getElementById("convertp").style.display = "";

  let chormeTab;
  /*
    chrome.tabs.create({
        url: chrome.extension.getURL('popup.html'),
        selected: true,
    }, function (tab) {
        chormeTab = tab;
    });
*/
  JSZipUtils.getBinaryContent("file:///" + filename, function (err, data) {
    if (err) {
      throw err; // or handle err
    }

    JSZip.loadAsync(data).then(
      function (zip) {
        let files = [];
        let relativePathList = [];

        zip.forEach(function (relativePath, zipEntry) {
          relativePathList.push(relativePath);
        });
        reads();
        async function reads() {
          for (const r in relativePathList) {
            document.getElementById("status").innerText =
              "Descomprimiendo " + r + " e-partes";
            const contents =
              await zip.files[relativePathList[r]].async("arraybuffer");
            files.push(contents);
          }

          mergeAllPDFs(files, basename);
        }
      },
      function (e) {
        document.getElementById("items").style.display = "";
        document.getElementById("convertp").style.display = "none";
      },
    );
  });
}

async function mergeAllPDFs(files, filename) {
  try {
    const pdfDoc = await PDFLib.PDFDocument.create();
    const numDocs = files.length;
    document.getElementById("status").innerText = "Uniendo PDF";
    for (var i = 0; i < numDocs; i++) {
      const donorPdfBytes = files[i];
      const donorPdfDoc = await PDFLib.PDFDocument.load(donorPdfBytes);
      const docLength = donorPdfDoc.getPageCount();
      for (var k = 0; k < docLength; k++) {
        const [donorPage] = await pdfDoc.copyPages(donorPdfDoc, [k]);
        //console.log("Doc " + i+ ", page " + k);
        pdfDoc.addPage(donorPage);
      }
    }
    document.getElementById("status").innerText = "Preparando la vista previa";

    const base64 = await pdfDoc.saveAsBase64();

    try {
      filename = filename.split(".")[0];
    } catch (error) {}

    const pdfFilename = filename + ".pdf";

    // Guardar en storage de sesión y abrir preview.html como pestaña de la extensión.
    // De esta forma el blob se crea en el contexto correcto y no hay restricciones de origen.
    await chrome.storage.session.set({
      pdfPreview: { base64: base64, filename: pdfFilename },
    });
    chrome.tabs.create({ url: chrome.runtime.getURL("preview.html") });
  } catch (error) {}

  console.log("listo");
}
