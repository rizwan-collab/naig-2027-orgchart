(function(){
  'use strict';

  var NAIG_STATUS_COLORS = {
    'Confirmed': '#2ecc71',
    'Reserved': '#3498db',
    'Contract Review': '#3498db',
    'In Works': '#f39c12',
    'In Conversation': '#f39c12',
    'Identified': '#95a5a6',
    'Not Available': '#e74c3c',
    'Declined': '#e74c3c',
    'Not Selected': '#e74c3c',
    'Fallback': '#9b59b6'
  };

  function naigStatusColor(rowStatus){
    try {
      if (rowStatus && NAIG_STATUS_COLORS.hasOwnProperty(rowStatus)) return NAIG_STATUS_COLORS[rowStatus];
    } catch(eSc){}
    return '#95a5a6';
  }

  function naigNum(v){
    try {
      if (typeof v === 'number' && isFinite(v)) return v;
      if (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v))) return Number(v);
    } catch(eNum){}
    return null;
  }

  function naigEsc(s){
    try {
      var str = String(s);
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    } catch(eEsc){ return ''; }
  }

  function naigVal(v){
    if (v === null || v === undefined || v === '') return '—';
    return naigEsc(v);
  }

  function naigHaversineMiles(lat1, lon1, lat2, lon2){
    try {
      var radiusMiles = 3958.8;
      var toRad = function(deg){ return deg * Math.PI / 180; };
      var dLat = toRad(lat2 - lat1);
      var dLon = toRad(lon2 - lon1);
      var partA = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      var partC = 2 * Math.atan2(Math.sqrt(partA), Math.sqrt(1 - partA));
      return radiusMiles * partC;
    } catch(eHav){ return 0; }
  }

  var naigState = {
    map1: null,
    map2: null,
    activeTab: 'venues',
    venues: [],
    anchors: [],
    hotels: [],
    dataReady: false,
    leafletReady: false,
    hasHotels: false
  };

  function naigShowMessage(containerEl, msg){
    try {
      if (!containerEl) return;
      containerEl.innerHTML = '';
      var msgDiv = document.createElement('div');
      msgDiv.className = 'naigMsg';
      msgDiv.textContent = msg;
      containerEl.appendChild(msgDiv);
    } catch(eMsg){}
  }

  function naigDefaultAnchors(){
    return [
      { vName: 'DFW International Airport', lat: 32.896251, lng: -97.045339 },
      { vName: 'Dallas Love Field', lat: 32.845241, lng: -96.847322 }
    ];
  }

  function naigBuildVenueList(venuesVal){
    var out = [];
    try {
      if (venuesVal && typeof venuesVal === 'object'){
        var vKeys = Object.keys(venuesVal);
        for (var i = 0; i < vKeys.length; i++){
          var vId = vKeys[i];
          var vRec = venuesVal[vId];
          if (!vRec || typeof vRec !== 'object') continue;
          out.push({
            id: vId,
            vName: vRec.name,
            address: vRec.address,
            location: vRec.location,
            rowStatus: vRec.status,
            vType: vRec.type,
            sports: vRec.sports,
            cluster: vRec.cluster,
            indoorOutdoor: vRec.indoorOutdoor,
            fieldCount: vRec.fieldCount,
            capacity: vRec.capacity,
            primaryContact: vRec.primaryContact,
            lat: vRec.lat,
            lng: vRec.lng,
            geoApprox: vRec.geoApprox,
            geoSource: vRec.geoSource
          });
        }
      }
    } catch(eBv){}
    return out;
  }

  function naigBuildAnchorList(anchorsVal){
    var out = [];
    try {
      if (anchorsVal && typeof anchorsVal === 'object' && Object.keys(anchorsVal).length > 0){
        var aKeys = Object.keys(anchorsVal);
        for (var j = 0; j < aKeys.length; j++){
          var aRec = anchorsVal[aKeys[j]];
          if (!aRec || typeof aRec !== 'object') continue;
          var aLat = naigNum(aRec.lat);
          var aLng = naigNum(aRec.lng);
          if (aLat !== null && aLng !== null){
            out.push({ vName: aRec.name || aKeys[j], lat: aLat, lng: aLng });
          }
        }
      }
    } catch(eBa){}
    if (out.length === 0) return naigDefaultAnchors();
    return out;
  }

  function naigBuildHotelList(hotelsVal){
    var out = [];
    try {
      if (hotelsVal && typeof hotelsVal === 'object'){
        var hKeys = Object.keys(hotelsVal);
        for (var k = 0; k < hKeys.length; k++){
          var hRec = hotelsVal[hKeys[k]];
          if (!hRec || typeof hRec !== 'object') continue;
          var hLat = naigNum(hRec.lat);
          var hLng = naigNum(hRec.lng);
          if (hLat === null || hLng === null) continue;
          out.push({ vName: hRec.name || hKeys[k], lat: hLat, lng: hLng });
        }
      }
    } catch(eBh){}
    return out;
  }

  function naigInjectStyles(){
    try {
      if (document.getElementById('naigMapsStyle')) return;
      var lines = [];
      lines.push('#naigMaps { background:#0b1220; border:1px solid #22304d; border-radius:10px; padding:12px; margin:12px 0; color:#dbe4f5; font-family:inherit; box-sizing:border-box; }');
      lines.push('#naigMaps * { box-sizing:border-box; }');
      lines.push('#naigMaps .naigMapsHeader { display:flex; gap:8px; margin-bottom:10px; flex-wrap:wrap; }');
      lines.push('#naigMaps .naigMapsTabBtn { background:#141d33; color:#aebbdc; border:1px solid #263559; border-radius:6px; padding:6px 14px; cursor:pointer; font-size:13px; }');
      lines.push('#naigMaps .naigMapsTabBtnActive { background:#1f4fd1; color:#ffffff; border-color:#1f4fd1; }');
      lines.push('#naigMaps .naigMapsPane { display:none; }');
      lines.push('#naigMaps .naigMapsPaneActive { display:block; }');
      lines.push('#naigMaps .naigMapsNote { font-size:12px; color:#9db0d9; margin-bottom:6px; }');
      lines.push('#naigMaps .naigMapsLegend { display:flex; flex-wrap:wrap; gap:10px; font-size:12px; margin-bottom:6px; }');
      lines.push('#naigMaps .naigLegendRow { display:flex; align-items:center; gap:5px; }');
      lines.push('#naigMaps .naigLegendSwatch { width:11px; height:11px; border-radius:50%; display:inline-block; }');
      lines.push('#naigMaps .naigMapsChecks { display:flex; flex-wrap:wrap; gap:10px; font-size:12px; margin-bottom:8px; }');
      lines.push('#naigMaps .naigCheckRow { display:flex; align-items:center; gap:4px; cursor:pointer; color:#c8d4ee; }');
      lines.push('#naigMaps .naigMapsMapHost { height:420px; border-radius:8px; overflow:hidden; border:1px solid #22304d; background:#0e162a; position:relative; }');
      lines.push('#naigMaps .naigMapsMapInner { height:100%; width:100%; }');
      lines.push('#naigMaps .naigMsg { padding:20px; text-align:center; color:#8fa0c9; font-size:13px; }');
      lines.push('#naigMaps .naigPopup { font-size:12px; color:#1b2233; line-height:1.4; }');
      lines.push('#naigMaps .naigPopupTitle { font-weight:700; margin-bottom:3px; }');
      lines.push('#naigMaps .naigPopupApprox { color:#b35b00; font-style:italic; margin-bottom:3px; }');
      lines.push('#naigMaps .naigAirportBox { width:20px; height:20px; background:#1f4fd1; color:#fff; border-radius:4px; display:flex; align-items:center; justify-content:center; font-size:12px; border:1px solid #ffffff; }');
      lines.push('#naigMaps .naigHotelDiamond { width:12px; height:12px; background:#e67e22; border:2px solid #ffffff; transform:rotate(45deg); margin:2px auto; }');
      lines.push('#naigMaps .leaflet-container { background:#0e162a; }');
      lines.push('#naigMaps .leaflet-popup-content-wrapper { background:#f5f7fb; color:#1b2233; }');
      lines.push('#naigMaps .leaflet-popup-tip { background:#f5f7fb; }');
      lines.push('#naigMaps .leaflet-bar a { background:#141d33; color:#dbe4f5; border-color:#263559; }');
      lines.push('#naigMaps .leaflet-control-attribution { background:rgba(14,22,42,0.7); color:#8fa0c9; }');
      var styleEl = document.createElement('style');
      styleEl.id = 'naigMapsStyle';
      styleEl.textContent = lines.join('\n');
      document.head.appendChild(styleEl);
    } catch(eStyle){}
  }

  function naigEnsureLeaflet(cb){
    try {
      if (window.L) { cb(); return; }
      if (document.getElementById('naigLeafletJs')){
        var waitTries = 0;
        var waitIv = setInterval(function(){
          waitTries++;
          if (window.L){ clearInterval(waitIv); try { cb(); } catch(eCb1){} }
          else if (waitTries > 60){ clearInterval(waitIv); naigLeafletFailed(); }
        }, 300);
        return;
      }
      var linkEl = document.createElement('link');
      linkEl.id = 'naigLeafletCss';
      linkEl.rel = 'stylesheet';
      linkEl.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css';
      document.head.appendChild(linkEl);
      var scriptEl = document.createElement('script');
      scriptEl.id = 'naigLeafletJs';
      scriptEl.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js';
      scriptEl.onload = function(){ try { cb(); } catch(eCb2){} };
      scriptEl.onerror = function(){ naigLeafletFailed(); };
      document.head.appendChild(scriptEl);
    } catch(eEns){ naigLeafletFailed(); }
  }

  function naigLeafletFailed(){
    try {
      var host1 = document.getElementById('naigMapsMap1Host');
      var host2 = document.getElementById('naigMapsMap2Host');
      naigShowMessage(host1, 'Map library failed to load — maps unavailable.');
      naigShowMessage(host2, 'Map library failed to load — maps unavailable.');
    } catch(eFail){}
  }

  async function naigFetchData(){
    try {
      if (typeof _dbRef !== 'function') { return { failed: true }; }
      var mod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js');
      var venuesVal = null, anchorsVal = null, hotelsVal = null;
      try {
        var vSnap = await mod.get(_dbRef('naig2027/venues'));
        venuesVal = (vSnap && typeof vSnap.exists === 'function' && vSnap.exists()) ? vSnap.val() : null;
      } catch(eV){ venuesVal = null; }
      try {
        var aSnap = await mod.get(_dbRef('naig2027/geoAnchors'));
        anchorsVal = (aSnap && typeof aSnap.exists === 'function' && aSnap.exists()) ? aSnap.val() : null;
      } catch(eA){ anchorsVal = null; }
      try {
        var hSnap = await mod.get(_dbRef('naig2027/hotels'));
        hotelsVal = (hSnap && typeof hSnap.exists === 'function' && hSnap.exists()) ? hSnap.val() : null;
      } catch(eH){ hotelsVal = null; }
      return {
        failed: false,
        venues: naigBuildVenueList(venuesVal),
        anchors: naigBuildAnchorList(anchorsVal),
        hotels: naigBuildHotelList(hotelsVal)
      };
    } catch(eOuter){
      return { failed: true };
    }
  }

  function naigLoadAndRender(){
    try {
      naigFetchData().then(function(data){
        try {
          if (!data || data.failed){
            var target1 = document.getElementById('naigMapsMap1Host') || document.getElementById('naigMaps');
            naigShowMessage(target1, 'Maps unavailable: could not load NAIG location data.');
            return;
          }
          naigState.venues = data.venues;
          naigState.anchors = data.anchors;
          naigState.hotels = data.hotels;
          naigState.dataReady = true;
          naigEnsureLeaflet(function(){
            naigState.leafletReady = true;
            naigRenderMap1();
            if (naigState.activeTab === 'flow'){ naigRenderMap2(); }
          });
        } catch(eThen){}
      }).catch(function(){
        try {
          var target2 = document.getElementById('naigMapsMap1Host') || document.getElementById('naigMaps');
          naigShowMessage(target2, 'Maps unavailable: could not load NAIG location data.');
        } catch(eCatch2){}
      });
    } catch(eLoad){}
  }

  function naigAppendCheckbox(containerEl, labelText, layerRef, mapRef, defaultChecked){
    try {
      var rowLabel = document.createElement('label');
      rowLabel.className = 'naigCheckRow';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!defaultChecked;
      cb.addEventListener('change', function(){
        try {
          if (cb.checked) { mapRef.addLayer(layerRef); }
          else { mapRef.removeLayer(layerRef); }
        } catch(eToggle){}
      });
      rowLabel.appendChild(cb);
      var lblSpan = document.createElement('span');
      lblSpan.textContent = ' ' + labelText;
      rowLabel.appendChild(lblSpan);
      containerEl.appendChild(rowLabel);
    } catch(eAppend){}
  }

  function naigRenderMap1(){
    try {
      var host = document.getElementById('naigMapsMap1Host');
      var noteEl = document.getElementById('naigMapsVenuesNote');
      var legendEl = document.getElementById('naigMapsVenuesLegend');
      var checksEl = document.getElementById('naigMapsVenuesChecks');
      if (!host) return;
      host.innerHTML = '';
      if (legendEl) legendEl.innerHTML = '';
      if (checksEl) checksEl.innerHTML = '';
      if (!window.L){ naigShowMessage(host, 'Map library failed to load — map unavailable.'); return; }

      var venues = naigState.venues || [];
      var totalVenues = venues.length;
      var plotted = [];
      for (var i = 0; i < venues.length; i++){
        var venueRec = venues[i];
        var pLat = naigNum(venueRec.lat);
        var pLng = naigNum(venueRec.lng);
        if (pLat !== null && pLng !== null){
          venueRec._plat = pLat;
          venueRec._plng = pLng;
          plotted.push(venueRec);
        }
      }

      if (noteEl){
        var missingCount = totalVenues - plotted.length;
        var noteText = plotted.length + ' of ' + totalVenues + ' venues plotted';
        if (missingCount > 0){ noteText += ' — ' + missingCount + ' have no coordinates yet'; }
        noteEl.textContent = noteText;
      }

      if (plotted.length === 0){
        naigShowMessage(host, 'No venues have coordinates yet.');
        naigState.map1 = null;
        return;
      }

      var innerDiv = document.createElement('div');
      innerDiv.id = 'naigMapsMap1Inner';
      innerDiv.className = 'naigMapsMapInner';
      host.appendChild(innerDiv);

      var map1 = L.map(innerDiv, { scrollWheelZoom: true });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19
      }).addTo(map1);

      var statusCounts = {};
      var statusLayers = {};
      var boundsPts = [];

      for (var j = 0; j < plotted.length; j++){
        var v1 = plotted[j];
        var rowStatus = v1.rowStatus || 'Identified';
        var markerColor = naigStatusColor(rowStatus);
        var approx = !!v1.geoApprox;

        var circMarker = L.circleMarker([v1._plat, v1._plng], {
          radius: 7,
          color: approx ? '#ffffff' : markerColor,
          weight: approx ? 2 : 1,
          dashArray: approx ? '4,3' : null,
          fillColor: markerColor,
          fillOpacity: 0.85
        });

        var popupParts = [];
        popupParts.push('<div class="naigPopup">');
        popupParts.push('<div class="naigPopupTitle">' + naigVal(v1.vName) + '</div>');
        if (approx){ popupParts.push('<div class="naigPopupApprox">Approximate location</div>'); }
        popupParts.push('<div><strong>Address:</strong> ' + naigVal(v1.address || v1.location) + '</div>');
        popupParts.push('<div><strong>Status:</strong> ' + naigVal(rowStatus) + '</div>');
        popupParts.push('<div><strong>Type:</strong> ' + naigVal(v1.vType) + '</div>');
        popupParts.push('<div><strong>Sports:</strong> ' + naigVal(v1.sports) + '</div>');
        var fieldOrCap = null;
        if (v1.fieldCount !== undefined && v1.fieldCount !== null && v1.fieldCount !== ''){ fieldOrCap = v1.fieldCount; }
        else if (v1.capacity !== undefined && v1.capacity !== null && v1.capacity !== ''){ fieldOrCap = v1.capacity; }
        popupParts.push('<div><strong>Fields/Capacity:</strong> ' + naigVal(fieldOrCap) + '</div>');
        popupParts.push('</div>');
        circMarker.bindPopup(popupParts.join(''));

        if (!statusLayers[rowStatus]){
          statusLayers[rowStatus] = L.layerGroup().addTo(map1);
          statusCounts[rowStatus] = 0;
        }
        statusCounts[rowStatus] = statusCounts[rowStatus] + 1;
        circMarker.addTo(statusLayers[rowStatus]);
        boundsPts.push([v1._plat, v1._plng]);
      }

      if (boundsPts.length > 0){
        try { map1.fitBounds(boundsPts, { padding: [20, 20] }); }
        catch(eFit){ try { map1.setView(boundsPts[0], 6); } catch(eSet){} }
      }

      if (legendEl){
        var legendParts = [];
        var statusKeysA = Object.keys(statusCounts);
        for (var k = 0; k < statusKeysA.length; k++){
          var sKeyA = statusKeysA[k];
          legendParts.push('<div class="naigLegendRow"><span class="naigLegendSwatch" style="background:' +
            naigStatusColor(sKeyA) + '"></span>' + naigEsc(sKeyA) + ' (' + statusCounts[sKeyA] + ')</div>');
        }
        legendEl.innerHTML = legendParts.join('');
      }

      if (checksEl){
        var statusKeysB = Object.keys(statusLayers);
        for (var m = 0; m < statusKeysB.length; m++){
          var sKeyB = statusKeysB[m];
          naigAppendCheckbox(checksEl, sKeyB, statusLayers[sKeyB], map1, true);
        }
      }

      naigState.map1 = map1;
      setTimeout(function(){ try { map1.invalidateSize(); } catch(eInv){} }, 60);
    } catch(eOuter1){
      try { naigShowMessage(document.getElementById('naigMapsMap1Host'), 'Venue map failed to render.'); } catch(eMsg1){}
    }
  }

  function naigRenderMap2(){
    try {
      var host = document.getElementById('naigMapsMap2Host');
      var noteEl = document.getElementById('naigMapsFlowNote');
      var togglesEl = document.getElementById('naigMapsFlowToggles');
      if (!host) return;
      host.innerHTML = '';
      if (togglesEl) togglesEl.innerHTML = '';
      if (!window.L){ naigShowMessage(host, 'Map library failed to load — map unavailable.'); return; }

      var anchors = naigState.anchors || [];
      var hotels = naigState.hotels || [];
      var venues = naigState.venues || [];
      var plottedVenues = [];
      for (var i = 0; i < venues.length; i++){
        var vRec2 = venues[i];
        var pLat2 = naigNum(vRec2.lat);
        var pLng2 = naigNum(vRec2.lng);
        if (pLat2 !== null && pLng2 !== null){
          plottedVenues.push({ vName: vRec2.vName, lat: pLat2, lng: pLng2 });
        }
      }

      var hasHotels = hotels.length > 0;
      naigState.hasHotels = hasHotels;

      if (noteEl){
        noteEl.textContent = hasHotels ?
          'Airport to hotel to venue flow. Distances shown are straight-line, not drive time.' :
          'Direct airport-to-venue view — no hotel coordinates on file yet. Distances shown are straight-line, not drive time.';
      }

      var innerDiv2 = document.createElement('div');
      innerDiv2.id = 'naigMapsMap2Inner';
      innerDiv2.className = 'naigMapsMapInner';
      host.appendChild(innerDiv2);

      var map2 = L.map(innerDiv2, { scrollWheelZoom: true });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19
      }).addTo(map2);

      var boundsPts2 = [];
      var markerLayer = L.layerGroup().addTo(map2);

      for (var a = 0; a < anchors.length; a++){
        var anchorRec = anchors[a];
        var airportIcon = L.divIcon({ className: 'naigAirportIcon', html: '<div class="naigAirportBox">&#9992;</div>', iconSize: [22, 22] });
        var airportMarker = L.marker([anchorRec.lat, anchorRec.lng], { icon: airportIcon });
        airportMarker.bindPopup('<div class="naigPopup"><div class="naigPopupTitle">' + naigVal(anchorRec.vName) + '</div><div>Airport</div></div>');
        airportMarker.addTo(markerLayer);
        boundsPts2.push([anchorRec.lat, anchorRec.lng]);
      }

      for (var h = 0; h < hotels.length; h++){
        var hotelRec = hotels[h];
        var hotelIcon = L.divIcon({ className: 'naigHotelIcon', html: '<div class="naigHotelDiamond"></div>', iconSize: [16, 16] });
        var hotelMarker = L.marker([hotelRec.lat, hotelRec.lng], { icon: hotelIcon });
        hotelMarker.bindPopup('<div class="naigPopup"><div class="naigPopupTitle">' + naigVal(hotelRec.vName) + '</div><div>Hotel</div></div>');
        hotelMarker.addTo(markerLayer);
        boundsPts2.push([hotelRec.lat, hotelRec.lng]);
      }

      for (var v2 = 0; v2 < plottedVenues.length; v2++){
        var venueRec2 = plottedVenues[v2];
        var venueDot = L.circleMarker([venueRec2.lat, venueRec2.lng], {
          radius: 4, color: '#5dade2', weight: 1, fillColor: '#5dade2', fillOpacity: 0.9
        });
        venueDot.bindPopup('<div class="naigPopup"><div class="naigPopupTitle">' + naigVal(venueRec2.vName) + '</div><div>Venue</div></div>');
        venueDot.addTo(markerLayer);
        boundsPts2.push([venueRec2.lat, venueRec2.lng]);
      }

      var layerAirportHotel = L.layerGroup();
      var layerSecondHop = L.layerGroup();

      if (hasHotels){
        for (var ai = 0; ai < anchors.length; ai++){
          for (var hi = 0; hi < hotels.length; hi++){
            var distAH = naigHaversineMiles(anchors[ai].lat, anchors[ai].lng, hotels[hi].lat, hotels[hi].lng);
            var lineAH = L.polyline(
              [[anchors[ai].lat, anchors[ai].lng], [hotels[hi].lat, hotels[hi].lng]],
              { color: '#f1c40f', weight: 2, opacity: 0.8 }
            );
            lineAH.bindTooltip('Straight-line distance (not drive time): ' + distAH.toFixed(1) + ' mi', { sticky: true });
            lineAH.addTo(layerAirportHotel);
          }
        }
        for (var hi2 = 0; hi2 < hotels.length; hi2++){
          for (var vi = 0; vi < plottedVenues.length; vi++){
            var distHV = naigHaversineMiles(hotels[hi2].lat, hotels[hi2].lng, plottedVenues[vi].lat, plottedVenues[vi].lng);
            var lineHV = L.polyline(
              [[hotels[hi2].lat, hotels[hi2].lng], [plottedVenues[vi].lat, plottedVenues[vi].lng]],
              { color: '#5dade2', weight: 1, opacity: 0.55, dashArray: '3,4' }
            );
            lineHV.bindTooltip('Straight-line distance (not drive time): ' + distHV.toFixed(1) + ' mi', { sticky: true });
            lineHV.addTo(layerSecondHop);
          }
        }
      } else {
        for (var ai2 = 0; ai2 < anchors.length; ai2++){
          for (var vi2 = 0; vi2 < plottedVenues.length; vi2++){
            var distAV = naigHaversineMiles(anchors[ai2].lat, anchors[ai2].lng, plottedVenues[vi2].lat, plottedVenues[vi2].lng);
            var lineAV = L.polyline(
              [[anchors[ai2].lat, anchors[ai2].lng], [plottedVenues[vi2].lat, plottedVenues[vi2].lng]],
              { color: '#5dade2', weight: 1, opacity: 0.55, dashArray: '3,4' }
            );
            lineAV.bindTooltip('Straight-line distance (not drive time): ' + distAV.toFixed(1) + ' mi', { sticky: true });
            lineAV.addTo(layerSecondHop);
          }
        }
      }

      layerAirportHotel.addTo(map2);
      layerSecondHop.addTo(map2);

      if (boundsPts2.length > 0){
        try { map2.fitBounds(boundsPts2, { padding: [20, 20] }); }
        catch(eFit2){ try { map2.setView(boundsPts2[0], 6); } catch(eSet2){} }
      }

      if (togglesEl){
        if (hasHotels){
          naigAppendCheckbox(togglesEl, 'Airport to Hotel', layerAirportHotel, map2, true);
          naigAppendCheckbox(togglesEl, 'Hotel to Venue', layerSecondHop, map2, true);
        } else {
          naigAppendCheckbox(togglesEl, 'Airport to Venue', layerSecondHop, map2, true);
        }
      }

      naigState.map2 = map2;
      setTimeout(function(){ try { map2.invalidateSize(); } catch(eInv2){} }, 60);
    } catch(eOuter2){
      try { naigShowMessage(document.getElementById('naigMapsMap2Host'), 'Transportation map failed to render.'); } catch(eMsg2){}
    }
  }

  function naigSwitchTab(tabKey){
    try {
      naigState.activeTab = tabKey;
      var paneVenues = document.getElementById('naigMapsPaneVenues');
      var paneFlow = document.getElementById('naigMapsPaneFlow');
      var btnVenues = document.getElementById('naigMapsBtnVenues');
      var btnFlow = document.getElementById('naigMapsBtnFlow');

      if (tabKey === 'venues'){
        if (paneVenues) paneVenues.className = 'naigMapsPane naigMapsPaneActive';
        if (paneFlow) paneFlow.className = 'naigMapsPane';
        if (btnVenues) btnVenues.className = 'naigMapsTabBtn naigMapsTabBtnActive';
        if (btnFlow) btnFlow.className = 'naigMapsTabBtn';
        if (naigState.map1){
          setTimeout(function(){ try { naigState.map1.invalidateSize(); } catch(eInv3){} }, 30);
        } else if (naigState.leafletReady && naigState.dataReady){
          naigRenderMap1();
        }
      } else {
        if (paneFlow) paneFlow.className = 'naigMapsPane naigMapsPaneActive';
        if (paneVenues) paneVenues.className = 'naigMapsPane';
        if (btnFlow) btnFlow.className = 'naigMapsTabBtn naigMapsTabBtnActive';
        if (btnVenues) btnVenues.className = 'naigMapsTabBtn';
        if (naigState.map2){
          setTimeout(function(){ try { naigState.map2.invalidateSize(); } catch(eInv4){} }, 30);
        } else if (naigState.leafletReady && naigState.dataReady){
          naigRenderMap2();
        } else {
          naigShowMessage(document.getElementById('naigMapsMap2Host'), 'Loading transportation data...');
        }
      }
    } catch(eSwitch){}
  }

  function naigBuildPanel(hostTab){
    try {
      if (document.getElementById('naigMaps')) return;
      naigInjectStyles();

      var wrap = document.createElement('div');
      wrap.id = 'naigMaps';

      var htmlParts = [];
      htmlParts.push('<div class="naigMapsHeader">');
      htmlParts.push('<button type="button" id="naigMapsBtnVenues" class="naigMapsTabBtn naigMapsTabBtnActive">Venue Overview</button>');
      htmlParts.push('<button type="button" id="naigMapsBtnFlow" class="naigMapsTabBtn">Transportation Flow</button>');
      htmlParts.push('</div>');
      htmlParts.push('<div id="naigMapsPaneVenues" class="naigMapsPane naigMapsPaneActive">');
      htmlParts.push('<div id="naigMapsVenuesNote" class="naigMapsNote">Loading venue data...</div>');
      htmlParts.push('<div id="naigMapsVenuesLegend" class="naigMapsLegend"></div>');
      htmlParts.push('<div id="naigMapsVenuesChecks" class="naigMapsChecks"></div>');
      htmlParts.push('<div id="naigMapsMap1Host" class="naigMapsMapHost"></div>');
      htmlParts.push('</div>');
      htmlParts.push('<div id="naigMapsPaneFlow" class="naigMapsPane">');
      htmlParts.push('<div id="naigMapsFlowNote" class="naigMapsNote">Loading transportation data...</div>');
      htmlParts.push('<div id="naigMapsFlowToggles" class="naigMapsChecks"></div>');
      htmlParts.push('<div id="naigMapsMap2Host" class="naigMapsMapHost"></div>');
      htmlParts.push('</div>');

      wrap.innerHTML = htmlParts.join('');

      if (hostTab.firstChild) { hostTab.insertBefore(wrap, hostTab.firstChild); }
      else { hostTab.appendChild(wrap); }

      var btnVenuesEl = document.getElementById('naigMapsBtnVenues');
      var btnFlowEl = document.getElementById('naigMapsBtnFlow');
      if (btnVenuesEl) btnVenuesEl.addEventListener('click', function(){ naigSwitchTab('venues'); });
      if (btnFlowEl) btnFlowEl.addEventListener('click', function(){ naigSwitchTab('flow'); });

      naigLoadAndRender();
    } catch(eBuild){
      try {
        var fallbackHost = hostTab || document.body;
        var errDiv = document.createElement('div');
        errDiv.textContent = 'NAIG maps panel failed to load.';
        if (fallbackHost.firstChild) fallbackHost.insertBefore(errDiv, fallbackHost.firstChild);
        else fallbackHost.appendChild(errDiv);
      } catch(eBuild2){}
    }
  }

  window.__naigMapsRefresh = function(){
    try { naigLoadAndRender(); } catch(eRefresh){}
  };

  (function naigStartPoll(){
    try {
      var tries = 0;
      var pollIv = setInterval(function(){
        try {
          tries++;
          if (document.getElementById('naigMaps')){ clearInterval(pollIv); return; }
          var hostTab = document.getElementById('sectionTransport');
          if (hostTab){
            clearInterval(pollIv);
            naigBuildPanel(hostTab);
          } else if (tries >= 60){
            clearInterval(pollIv);
          }
        } catch(ePoll){ clearInterval(pollIv); }
      }, 900);
    } catch(eStart){}
  })();

})();
