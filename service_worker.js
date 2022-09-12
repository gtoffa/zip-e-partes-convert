// Copyright (c) 2013 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.


chrome.downloads.onChanged.addListener(function (delta) {



  chrome.downloads.search({ id: delta.id }, function (items) {


    if (items[0].url.includes('https://app.chaco.gob.ar/tramites/servlet/com.ecom.abajardeavariaspartes')) {


      var path = "assets/img/";
      if (delta.state) {

        if (delta.state.current == 'in_progress') {

          path += "inprogress.png";

        } else if (delta.state.current == 'complete') {
          path += "listo.png";
        } else {
          path += "icon19.png";
        }





      } else {
        path += "inprogress.png";
      }

      chrome.action.setIcon({ path: path })
    }


  });




});

