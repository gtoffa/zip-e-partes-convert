


async function convertpdf(filename, basename) {
    document.getElementById('items').style.display = 'none';
    document.getElementById('convertp').style.display = '';



    let chormeTab
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

        JSZip.loadAsync(data).then(function (zip) {

            let files = [];
            let relativePathList = [];


            zip.forEach(function (relativePath, zipEntry) {
                relativePathList.push(relativePath);
            });
            reads();
            async function reads() {


                for (const r in relativePathList) {


                    document.getElementById('status').innerText = "Descomprimiendo " + r + " e-partes";
                    const contents = await zip.files[relativePathList[r]].async('arraybuffer');
                    files.push(contents);
                }

                mergeAllPDFs(files, basename);

            }


        }, function (e) {
            document.getElementById('items').style.display = '';
            document.getElementById('convertp').style.display = 'none';
        });

    });
}


async function mergeAllPDFs(files, filename) {
    try {



        const pdfDoc = await PDFLib.PDFDocument.create();
        const numDocs = files.length;
        document.getElementById('status').innerText = "Uniendo PDF";
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
        document.getElementById('status').innerText = "Preparando la vista previa";



        const blob = base64ToBlob(await pdfDoc.saveAsBase64(), 'application/pdf');
        const url = URL.createObjectURL(blob);
        const pdfWindow = window.open("");

        try {
            filename = filename.split('.')[0];
        } catch (error) {

        }

        pdfWindow.document.write('<body style="margin:0px;padding:0px;overflow:hidden">' +
            '<h1  style="margin-top: 10px;float: left;margin-left: 10px;"> Resultado ' + filename + ' </h1>' +
            '<label  style="    color: #117dbd;text-decoration: none;font-weight: 600;font-size: 20px;margin-right: 20px;float: right;margin-top: 15px;}" >Zip e-partes convert </label>' +
            '<iframe src="' + url + '" frameborder="0" style="overflow:hidden;height:100%;width:100%" height="100%" width="100%"></iframe>' +
            '</body>');


        function base64ToBlob(base64, type = "application/octet-stream") {
            const binStr = atob(base64);
            const len = binStr.length;
            const arr = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                arr[i] = binStr.charCodeAt(i);
            }
            return new Blob([arr], { type: type });
        }


    } catch (error) {
    }



    console.log('listo');






}