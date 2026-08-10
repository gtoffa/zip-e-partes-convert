// Traspaso del PDF generado entre el popup y preview.html vía IndexedDB.
// Se usa IndexedDB (en vez de chrome.storage.session, limitado a 10MB) porque
// el PDF final -sobre todo al unir varias e-partes- puede superar ese límite
// fácilmente, lo que hacía que la vista previa se quedara colgada sin avisar.
const PDF_TRANSFER_DB = "zep-pdf-transfer";
const PDF_TRANSFER_STORE = "files";

function openPdfTransferDb() {
  return new Promise(function (resolve, reject) {
    const req = indexedDB.open(PDF_TRANSFER_DB, 1);
    req.onupgradeneeded = function () {
      req.result.createObjectStore(PDF_TRANSFER_STORE);
    };
    req.onsuccess = function () {
      resolve(req.result);
    };
    req.onerror = function () {
      reject(req.error);
    };
  });
}

async function savePdfForPreview(bytes, filename) {
  const db = await openPdfTransferDb();
  const id = Date.now() + "-" + Math.random().toString(36).slice(2);
  await new Promise(function (resolve, reject) {
    const tx = db.transaction(PDF_TRANSFER_STORE, "readwrite");
    tx.objectStore(PDF_TRANSFER_STORE).put({ bytes: bytes, filename: filename }, id);
    tx.oncomplete = resolve;
    tx.onerror = function () {
      reject(tx.error);
    };
  });
  db.close();
  return id;
}

async function loadAndRemovePdfPreview(id) {
  const db = await openPdfTransferDb();
  const record = await new Promise(function (resolve, reject) {
    const tx = db.transaction(PDF_TRANSFER_STORE, "readwrite");
    const store = tx.objectStore(PDF_TRANSFER_STORE);
    const getReq = store.get(id);
    getReq.onsuccess = function () {
      resolve(getReq.result || null);
    };
    getReq.onerror = function () {
      reject(getReq.error);
    };
    store.delete(id);
  });
  db.close();
  return record;
}
