// Copyright (c) 2013 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

chrome.runtime.onMessage.addListener( // this is the message listener
  function (request, sender, sendResponse) {
    if (request.message === "seticon")
      chrome.action.setIcon({ path: 'assets/img/icon19.png' })

  }
);


chrome.downloads.onChanged.addListener(function (delta) {



  chrome.downloads.search({ id: delta.id }, function (items) {


    if (items[0].url.includes('https://app.chaco.gob.ar/tramites/servlet/com.ecom.abajardeavariaspartes')) {


      var path = "assets/img/";

      if (items[0].state) {

        if (items[0].state == 'in_progress') {

          path += "inprogress.png";

        } else if (items[0].state == 'complete') {
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

      chrome.action.setIcon({ path: path })
    }


  });




});

