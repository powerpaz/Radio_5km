// ===============================================
// Geovisor - Área de influencia de hasta 5 km
// U.E. Ángel Modesto Paredes (AMIE 17H00553) - Distrito 17D06
// Clonado del sistema visual/interacción del Geovisor AMIE (MINEDEC)
// ===============================================

(function () {
  'use strict';

  const REF_AMIE = '17H00553';

  const CONFIG = {
    mapZoom: 13,
    maxZoom: 19,
    minZoom: 11,
    labelZoomThreshold: 14,
    dataUrls: {
      ref: 'data/ue_angel_modesto_paredes.geojson',
      buffer: 'data/buffer_5km.geojson',
      ie: 'data/ie_radio_5km.geojson',
      lineas: 'data/lineas_distancia_5km.geojson',
      vias: 'data/vias_principales.geojson',
      relieveImg: 'data/elevacion_relieve.png',
      relieveMeta: 'data/elevacion_relieve.json'
    },
    colors: {
      fiscal: '#e63946',
      otros: '#1d4ed8',
      ref: '#f4a300',
      lineas: '#6b21a8',
      vias: '#b45309',
      buffer: '#572364',
      transito: '#22c55e'
    },
    transito: {
      maxVehiculos: 22,
      minTramoM: 250, // descarta tramos muy cortos (poco realistas para animar)
      speedMinMs: 9, // ~32 km/h
      speedMaxMs: 15 // ~54 km/h
    }
  };

  let map;
  const layers = {}; // key -> L.LayerGroup / L.GeoJSON
  const ieByAmie = {}; // AMIE -> feature.properties (for line popups)
  let ieRowsForExport = []; // instituciones vecinas (excluye la de referencia), para "Descargar base"

  // Estado de la animación de tránsito simulado (ver buildTransitoLayer)
  let transitoState = [];
  let transitoRAF = null;
  let transitoLastTs = null;

  document.addEventListener('DOMContentLoaded', initApp);

  function initApp() {
    initMap();
    setupLayerControls();
    loadAllData();
  }

  function initMap() {
    map = L.map('map', {
      center: [-0.2408, -78.535],
      zoom: CONFIG.mapZoom,
      zoomControl: true,
      attributionControl: true
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors | Análisis de área de influencia 5 km',
      maxZoom: CONFIG.maxZoom,
      minZoom: CONFIG.minZoom
    }).addTo(map);

    map.on('zoomend', updateDistanceLabels);
  }

  function updateStatus(message) {
    const el = document.getElementById('status');
    if (el) el.textContent = message;
    console.log(message);
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function popupRow(label, value) {
    return `
      <div class="popup-row">
        <span class="popup-label">${escapeHtml(label)}:</span>
        <span class="popup-value">${escapeHtml(value || value === 0 ? value : 'N/A')}</span>
      </div>`;
  }

  function fmtKm(value) {
    const n = Number(value);
    return Number.isFinite(n) ? `${n.toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km` : 'N/A';
  }

  // -------------------------------------------------
  // Data loading
  // -------------------------------------------------
  function loadAllData() {
    updateStatus('Cargando capas...');

    const jsonFetch = url => fetch(url).then(r => {
      if (!r.ok) throw new Error(`No se pudo cargar ${url}`);
      return r.json();
    });

    Promise.all([
      jsonFetch(CONFIG.dataUrls.ref),
      jsonFetch(CONFIG.dataUrls.buffer),
      jsonFetch(CONFIG.dataUrls.ie),
      jsonFetch(CONFIG.dataUrls.lineas),
      jsonFetch(CONFIG.dataUrls.vias)
    ]).then(([refData, bufferData, ieData, lineasData, viasData]) => {
      buildRefLayer(refData);
      buildBufferLayer(bufferData);
      buildIeLayers(ieData);
      buildLineasLayer(lineasData);
      buildViasLayer(viasData);
      buildTransitoLayer(viasData);
      buildRelieveLayer();

      applyInitialVisibility();
      fitInitialView();
      updateStatistics(ieData);
      updateStatus('Listo: capas de área de influencia cargadas');
    }).catch(err => {
      console.error(err);
      updateStatus('Error al cargar las capas geoespaciales');
    });
  }

  // -------------------------------------------------
  // Layer builders
  // -------------------------------------------------
  function refIcon() {
    const c = CONFIG.colors.ref;
    return L.divIcon({
      className: 'ref-marker',
      html: `<svg width="34" height="34" viewBox="0 0 34 34">
        <path d="M17 2c-7.2 0-12 5.4-12 12 0 9 12 18 12 18s12-9 12-18c0-6.6-4.8-12-12-12z" fill="${c}" stroke="#7a4a00" stroke-width="1.5"/>
        <circle cx="17" cy="14" r="5.5" fill="#fff"/>
        <path d="M17 10.5l1.2 2.6 2.8.3-2.1 1.9.6 2.8-2.5-1.4-2.5 1.4.6-2.8-2.1-1.9 2.8-.3z" fill="${c}"/>
      </svg>`,
      iconSize: [34, 34],
      iconAnchor: [17, 32],
      popupAnchor: [0, -30]
    });
  }

  function pulseIcon() {
    // Alinea el pulso con el círculo visible del pin (refIcon: cx=17,cy=14 dentro de un
    // icono de 34x34 anclado en [17,32]), es decir 18px arriba del punto geográfico.
    return L.divIcon({
      className: 'pulse-marker',
      html: '<span class="pulse-ring"></span><span class="pulse-ring"></span><span class="pulse-ring"></span>',
      iconSize: [1, 1],
      iconAnchor: [0, 18]
    });
  }

  function buildRefLayer(geo) {
    const layer = L.geoJSON(geo, {
      pointToLayer: (feature, latlng) => L.marker(latlng, { icon: refIcon(), title: feature.properties.NOM_INSTIT })
    });
    layer.eachLayer(m => {
      const p = m.feature.properties;
      m.bindPopup(`
        <div class="popup-wrapper">
          <div class="popup-header ref">
            <h3 class="popup-title">${escapeHtml(p.NOM_INSTIT)}</h3>
            <p class="popup-subtitle">AMIE: ${escapeHtml(p.AMIE)} · Institución de referencia</p>
          </div>
          <div class="popup-content">
            ${popupRow('Sostenimiento', p.NOM_SOSTEN)}
            ${popupRow('Régimen', p.REGIMEN)}
            ${popupRow('Oferta', p.OFERTA_1)}
            ${popupRow('Estado', p.NOM_ESTADO)}
            ${popupRow('Distrito', `${p.DA_DIST} - ${p.NOM_DISTRI}`)}
            ${popupRow('Parroquia', p.DPA_DESPAR)}
            ${popupRow('Cantón', p.DPA_DESCAN)}
            ${popupRow('Provincia', p.DPA_DESPRO)}
          </div>
        </div>`, { maxWidth: 380, className: 'custom-popup' });
    });

    // Pulso tipo radar (estilo Uber/Waze) bajo el marcador de referencia, para dar dinamismo
    const refCoords = geo.features[0] && geo.features[0].geometry && geo.features[0].geometry.coordinates;
    const pulseLayers = [layer];
    if (refCoords) {
      const [lng, lat] = refCoords;
      pulseLayers.push(L.marker([lat, lng], { icon: pulseIcon(), interactive: false, keyboard: false, zIndexOffset: -1000 }));
    }
    layers.ref = L.layerGroup(pulseLayers);
  }

  function buildBufferLayer(geo) {
    const layer = L.geoJSON(geo, {
      style: { color: CONFIG.colors.buffer, weight: 2.5, dashArray: '8 6', fillColor: CONFIG.colors.buffer, fillOpacity: 0.06 }
    });
    layer.eachLayer(l => {
      const p = l.feature.properties;
      l.bindPopup(`
        <div class="popup-wrapper">
          <div class="popup-header buffer">
            <h3 class="popup-title">Radio de influencia</h3>
            <p class="popup-subtitle">${escapeHtml(p.nombre)}</p>
          </div>
          <div class="popup-content">
            ${popupRow('AMIE origen', p.AMIE)}
            ${popupRow('Radio', `${p.radio_km} km (${p.radio_m} m)`)}
          </div>
        </div>`, { className: 'custom-popup' });
    });
    layers.buffer = layer;
  }

  function isFiscal(sost) { return String(sost || '').trim().toUpperCase() === 'FISCAL'; }

  function ieMarkerStyle(color) {
    return { radius: 7, weight: 2, color: '#ffffff', fillColor: color, fillOpacity: 0.9 };
  }

  function ieMarkerPopup(p) {
    const headerClass = isFiscal(p.NOM_SOSTEN) ? 'fiscal' : 'otros';
    return `
      <div class="popup-wrapper">
        <div class="popup-header ${headerClass}">
          <h3 class="popup-title">${escapeHtml(p.NOM_INSTIT)}</h3>
          <p class="popup-subtitle">AMIE: ${escapeHtml(p.AMIE)}</p>
        </div>
        <div class="popup-content">
          ${popupRow('Sostenimiento', p.NOM_SOSTEN)}
          ${popupRow('Régimen', p.REGIMEN)}
          ${popupRow('Oferta', p.OFERTA_1)}
          ${popupRow('Estado', p.NOM_ESTADO)}
          ${popupRow('Distrito', `${p.DA_DIST} - ${p.NOM_DISTRI}`)}
          ${popupRow('Parroquia', p.DPA_DESPAR)}
          ${popupRow('Cantón', p.DPA_DESCAN)}
          ${popupRow('Distancia a UE Ángel Modesto Paredes', fmtKm(p.dist_km))}
        </div>
      </div>`;
  }

  function buildIeLayers(geo) {
    const fiscalLayer = L.layerGroup();
    const otrosLayer = L.layerGroup();

    geo.features.forEach(f => {
      const p = f.properties;
      ieByAmie[p.AMIE] = p;
      if (p.AMIE === REF_AMIE) return; // la institución de referencia se muestra en su propia capa

      const [lng, lat] = f.geometry.coordinates;
      const fiscal = isFiscal(p.NOM_SOSTEN);
      const marker = L.circleMarker([lat, lng], ieMarkerStyle(fiscal ? CONFIG.colors.fiscal : CONFIG.colors.otros));
      marker.bindPopup(ieMarkerPopup(p), { maxWidth: 380, className: 'custom-popup' });
      (fiscal ? fiscalLayer : otrosLayer).addLayer(marker);
    });

    layers.fiscal = fiscalLayer;
    layers.otros = otrosLayer;
  }

  function buildLineasLayer(geo) {
    const group = L.layerGroup();
    geo.features.forEach(f => {
      const p = f.properties;
      if (p.AMIE_DEST === REF_AMIE || Number(p.DIST_KM) === 0) return; // omite la línea degenerada hacia sí misma

      const line = L.geoJSON(f, {
        style: { color: CONFIG.colors.lineas, weight: 1.5, opacity: 0.55, dashArray: '4 4' }
      });

      line.eachLayer(l => {
        l._distLabel = fmtKm(p.DIST_KM); // usado por updateDistanceLabels() para el tooltip permanente

        const destino = ieByAmie[p.AMIE_DEST];
        l.bindPopup(`
          <div class="popup-wrapper">
            <div class="popup-header ref">
              <h3 class="popup-title">Distancia euclidiana</h3>
              <p class="popup-subtitle">${escapeHtml(p.AMIE_ORIG)} → ${escapeHtml(p.AMIE_DEST)}</p>
            </div>
            <div class="popup-content">
              ${popupRow('Institución destino', destino ? destino.NOM_INSTIT : 'N/A')}
              ${popupRow('Distancia', fmtKm(p.DIST_KM))}
              ${popupRow('Tipo de distancia', p.TIPO_DIST)}
              ${popupRow('Observación', p.OBS)}
            </div>
          </div>`, { maxWidth: 380, className: 'custom-popup' });

        group.addLayer(l);
      });
    });
    layers.lineas = group;
  }

  function viasWeight(clase) {
    const v = String(clase || '').toUpperCase();
    if (v.includes('PRINCIPAL')) return 3;
    if (v.includes('SECUNDARIA')) return 2;
    return 1.2;
  }

  function buildViasLayer(geo) {
    const layer = L.geoJSON(geo, {
      style: f => ({
        color: CONFIG.colors.vias,
        weight: viasWeight(f.properties.CLASE_VIA),
        opacity: 0.75,
        className: 'via-flow'
      })
    });
    layer.eachLayer(l => {
      const p = l.feature.properties;
      l.bindPopup(`
        <div class="popup-wrapper">
          <div class="popup-header vias">
            <h3 class="popup-title">${escapeHtml(p.name || p.name_es || 'Vía sin nombre')}</h3>
            <p class="popup-subtitle">${escapeHtml(p.CLASE_VIA || p.highway || '')}</p>
          </div>
          <div class="popup-content">
            ${popupRow('Clase de vía', p.CLASE_VIA)}
            ${popupRow('Tipo (OSM)', p.highway)}
            ${popupRow('Superficie', p.surface)}
            ${popupRow('Carriles', p.lanes)}
          </div>
        </div>`, { className: 'custom-popup' });
    });
    layers.vias = layer;
  }

  // -------------------------------------------------
  // Tránsito animado (simulación ilustrativa, ver panel "Nota Técnica")
  // Marcadores que recorren de ida y vuelta una muestra de vías principales,
  // dando dinamismo visual al mapa (estilo Waze/Uber). No usa ni implica datos
  // reales de transporte público, ya que esa fuente no está disponible.
  // -------------------------------------------------
  function transitoIcon() {
    return L.divIcon({
      className: 'transito-marker',
      html: '<div class="transito-dot"><svg viewBox="0 0 16 16"><path d="M8 0 L14.5 14 L8 10.5 L1.5 14 Z" fill="currentColor"/></svg></div>',
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });
  }

  function bearingBetween(a, b) {
    const toRad = d => (d * Math.PI) / 180;
    const toDeg = r => (r * 180) / Math.PI;
    const lat1 = toRad(a[0]), lat2 = toRad(b[0]), dLng = toRad(b[1] - a[1]);
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  function positionOnRoute(route, progress) {
    const { latlngs, cum, total } = route;
    if (progress <= 0) return { latlng: latlngs[0], bearing: bearingBetween(latlngs[0], latlngs[1]) };
    if (progress >= total) {
      const n = latlngs.length;
      return { latlng: latlngs[n - 1], bearing: bearingBetween(latlngs[n - 2], latlngs[n - 1]) };
    }
    let i = 1;
    while (cum[i] < progress) i++;
    const segStart = cum[i - 1], segEnd = cum[i];
    const t = segEnd > segStart ? (progress - segStart) / (segEnd - segStart) : 0;
    const a = latlngs[i - 1], b = latlngs[i];
    return {
      latlng: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
      bearing: bearingBetween(a, b)
    };
  }

  function buildTransitoLayer(geo) {
    const group = L.layerGroup();
    const candidates = [];

    geo.features.forEach(f => {
      const coordSets = f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [f.geometry.coordinates];
      coordSets.forEach(coords => {
        if (!coords || coords.length < 2) return;
        const latlngs = coords.map(([lng, lat]) => [lat, lng]);
        const cum = [0];
        let total = 0;
        for (let i = 1; i < latlngs.length; i++) {
          total += L.latLng(latlngs[i - 1]).distanceTo(latlngs[i]);
          cum.push(total);
        }
        if (total >= CONFIG.transito.minTramoM) candidates.push({ latlngs, cum, total });
      });
    });

    // Muestreo espaciado (no solo los más largos) para repartir los vehículos por todo el mapa
    candidates.sort((a, b) => b.total - a.total);
    const maxV = CONFIG.transito.maxVehiculos;
    const step = Math.max(1, Math.floor(candidates.length / maxV));
    const chosen = candidates.filter((_, i) => i % step === 0).slice(0, maxV);

    transitoState = chosen.map(route => {
      const speed = CONFIG.transito.speedMinMs + Math.random() * (CONFIG.transito.speedMaxMs - CONFIG.transito.speedMinMs);
      const marker = L.marker(route.latlngs[0], { icon: transitoIcon(), keyboard: false });
      marker.bindPopup(`
        <div class="popup-wrapper">
          <div class="popup-header transito">
            <h3 class="popup-title">Tránsito simulado</h3>
            <p class="popup-subtitle">Animación ilustrativa de dinamismo vial</p>
          </div>
          <div class="popup-content">
            ${popupRow('Nota', 'No representa datos reales de transporte público (ver panel Nota Técnica)')}
          </div>
        </div>`, { className: 'custom-popup' });
      group.addLayer(marker);
      return {
        latlngs: route.latlngs,
        cum: route.cum,
        total: route.total,
        speed,
        progress: Math.random() * route.total,
        dir: Math.random() < 0.5 ? 1 : -1,
        marker
      };
    });

    layers.transito = group;
  }

  function stepTransito(ts) {
    if (transitoLastTs == null) transitoLastTs = ts;
    const dt = Math.min((ts - transitoLastTs) / 1000, 0.25);
    transitoLastTs = ts;

    transitoState.forEach(route => {
      route.progress += route.dir * route.speed * dt;
      if (route.progress >= route.total) { route.progress = route.total; route.dir = -1; }
      else if (route.progress <= 0) { route.progress = 0; route.dir = 1; }

      const { latlng, bearing } = positionOnRoute(route, route.progress);
      route.marker.setLatLng(latlng);
      const el = route.marker.getElement();
      const dot = el && el.querySelector('.transito-dot');
      if (dot) dot.style.transform = `rotate(${bearing}deg)`;
    });

    transitoRAF = requestAnimationFrame(stepTransito);
  }

  function startTransitoAnim() {
    if (transitoRAF || !transitoState.length) return;
    transitoLastTs = null;
    transitoRAF = requestAnimationFrame(stepTransito);
  }

  function stopTransitoAnim() {
    if (transitoRAF) cancelAnimationFrame(transitoRAF);
    transitoRAF = null;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopTransitoAnim();
    else if (layers.transito && map.hasLayer(layers.transito)) startTransitoAnim();
  });

  // El modelo de elevación se sirve como una imagen PNG pre-renderizada (rampa hipsométrica
  // azul-verde-amarillo-naranja-rojo) a partir de Elevacion.tif, georreferenciada por su bbox.
  // Se evita renderizar el GeoTIFF en el cliente para no depender de librerías raster externas.
  function buildRelieveLayer() {
    fetch(CONFIG.dataUrls.relieveMeta)
      .then(r => r.json())
      .then(meta => {
        const bounds = L.latLngBounds(
          [meta.bbox.south, meta.bbox.west],
          [meta.bbox.north, meta.bbox.east]
        );
        layers.relieve = L.imageOverlay(CONFIG.dataUrls.relieveImg, bounds, { opacity: 0.65 });
        const checkbox = document.getElementById('lyrRelieve');
        if (checkbox && checkbox.checked) map.addLayer(layers.relieve);
      })
      .catch(err => console.warn('No se pudo cargar el modelo de elevación:', err));
  }

  // -------------------------------------------------
  // Layer control panel
  // -------------------------------------------------
  function setupLayerControls() {
    const checkboxes = [
      ['lyrRef', 'ref'],
      ['lyrBuffer', 'buffer'],
      ['lyrFiscal', 'fiscal'],
      ['lyrOtros', 'otros'],
      ['lyrLineas', 'lineas'],
      ['lyrVias', 'vias'],
      ['lyrTransito', 'transito'],
      ['lyrRelieve', 'relieve']
    ];

    checkboxes.forEach(([id, key]) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', () => toggleLayer(key, el.checked));
    });

    const etiquetas = document.getElementById('lyrEtiquetas');
    if (etiquetas) etiquetas.addEventListener('change', updateDistanceLabels);

    const viasFlow = document.getElementById('lyrViasFlow');
    const mapEl = document.getElementById('map');
    if (viasFlow && mapEl) {
      const syncFlow = () => mapEl.classList.toggle('flow-active', viasFlow.checked);
      viasFlow.addEventListener('change', syncFlow);
      syncFlow();
    }

    document.querySelectorAll('.btn-zoom').forEach(btn => {
      btn.addEventListener('click', () => zoomToLayer(btn.dataset.zoom));
    });

    const btnReset = document.getElementById('btnResetView');
    if (btnReset) btnReset.addEventListener('click', fitInitialView);

    const btnDescargar = document.getElementById('btnDescargarBase');
    if (btnDescargar) btnDescargar.addEventListener('click', downloadBase);
  }

  // -------------------------------------------------
  // Descarga de la base (CSV) de instituciones en el radio de 5 km
  // -------------------------------------------------
  const EXPORT_COLUMNS = [
    ['AMIE', 'AMIE'],
    ['NOM_INSTIT', 'Institución'],
    ['NOM_SOSTEN', 'Sostenimiento'],
    ['REGIMEN', 'Régimen'],
    ['OFERTA_1', 'Oferta'],
    ['NOM_ESTADO', 'Estado'],
    ['DA_DIST', 'Distrito'],
    ['NOM_DISTRI', 'Nombre distrito'],
    ['DPA_DESPAR', 'Parroquia'],
    ['DPA_DESCAN', 'Cantón'],
    ['DPA_DESPRO', 'Provincia'],
    ['dist_km', 'Distancia a UE Ángel Modesto Paredes (km)'],
    ['LONGITUD', 'Longitud'],
    ['LATITUD', 'Latitud']
  ];

  function csvEscape(value) {
    const s = value === null || value === undefined ? '' : String(value);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function downloadBase() {
    if (!ieRowsForExport.length) return;

    const header = EXPORT_COLUMNS.map(([, label]) => csvEscape(label)).join(';');
    const lines = ieRowsForExport.map(row => EXPORT_COLUMNS.map(([key]) => csvEscape(row[key])).join(';'));
    const csv = '﻿' + [header, ...lines].join('\r\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Base de instituciones en radio de 5km.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function toggleLayer(key, visible) {
    const layer = layers[key];
    if (!layer) return; // aún no ha terminado de cargar (p. ej. relieve)
    if (visible) {
      map.addLayer(layer);
      if (key === 'vias' || key === 'relieve') layer.bringToBack && layer.bringToBack();
      if (key === 'transito') startTransitoAnim();
    } else {
      map.removeLayer(layer);
      if (key === 'transito') stopTransitoAnim();
    }
    if (key === 'lineas') updateDistanceLabels();
  }

  function zoomToLayer(key) {
    const layer = layers[key];
    if (!layer) return;
    try {
      const bounds = layer.getBounds ? layer.getBounds() : null;
      if (bounds && bounds.isValid && bounds.isValid()) {
        map.fitBounds(bounds, { maxZoom: 16, padding: [30, 30] });
        return;
      }
    } catch (e) { /* layerGroup sin getBounds propio */ }

    // Fallback para L.layerGroup: calcular bounds manualmente
    const b = L.latLngBounds([]);
    layer.eachLayer && layer.eachLayer(l => {
      if (l.getBounds) b.extend(l.getBounds());
      else if (l.getLatLng) b.extend(l.getLatLng());
    });
    if (b.isValid()) map.fitBounds(b, { maxZoom: 16, padding: [30, 30] });
  }

  function fitInitialView() {
    if (layers.buffer) {
      try {
        map.fitBounds(layers.buffer.getBounds(), { padding: [20, 20] });
        return;
      } catch (e) { /* ignore */ }
    }
    map.setView([-0.2408, -78.535], CONFIG.mapZoom);
  }

  function updateDistanceLabels() {
    if (!layers.lineas) return;
    const checkbox = document.getElementById('lyrEtiquetas');
    const show = checkbox && checkbox.checked && map.hasLayer(layers.lineas) && map.getZoom() >= CONFIG.labelZoomThreshold;
    layers.lineas.eachLayer(l => {
      if (show && !l.getTooltip()) {
        l.bindTooltip(l._distLabel, { permanent: true, direction: 'center', className: 'dist-tooltip' }).openTooltip();
      } else if (!show && l.getTooltip()) {
        l.unbindTooltip();
      }
    });
  }

  // -------------------------------------------------
  // Layer initial visibility (después de cargar datos)
  // -------------------------------------------------
  function applyInitialVisibility() {
    [['lyrRef', 'ref'], ['lyrBuffer', 'buffer'], ['lyrFiscal', 'fiscal'], ['lyrOtros', 'otros'],
      ['lyrLineas', 'lineas'], ['lyrVias', 'vias'], ['lyrTransito', 'transito'], ['lyrRelieve', 'relieve']].forEach(([id, key]) => {
      const el = document.getElementById(id);
      const layer = layers[key];
      if (!el || !layer) return;
      if (el.checked) {
        map.addLayer(layer);
        if (key === 'transito') startTransitoAnim();
      }
    });
    updateDistanceLabels();
  }

  // -------------------------------------------------
  // Statistics
  // -------------------------------------------------
  function updateStatistics(ieGeo) {
    const rows = ieGeo.features.map(f => f.properties).filter(p => p.AMIE !== REF_AMIE);
    ieRowsForExport = rows;

    const total = rows.length;
    const avgDist = rows.length ? rows.reduce((s, p) => s + (Number(p.dist_km) || 0), 0) / rows.length : 0;

    document.getElementById('statTotal').textContent = total.toLocaleString('es-EC');
    document.getElementById('statAvgDist').textContent = fmtKm(avgDist);
    document.getElementById('totalCell').textContent = total.toLocaleString('es-EC');

    const bySosten = {};
    rows.forEach(p => { bySosten[p.NOM_SOSTEN] = (bySosten[p.NOM_SOSTEN] || 0) + 1; });
    const sostenBody = document.querySelector('#rubrosTable tbody');
    if (sostenBody) {
      sostenBody.innerHTML = Object.keys(bySosten).sort((a, b) => bySosten[b] - bySosten[a])
        .map(k => `<tr><td>${escapeHtml(k)}</td><td>${bySosten[k].toLocaleString('es-EC')}</td></tr>`).join('');
    }

    const byDist = {};
    rows.forEach(p => { byDist[p.DA_DIST] = (byDist[p.DA_DIST] || 0) + 1; });
    const distBody = document.querySelector('#distritoTable tbody');
    if (distBody) {
      distBody.innerHTML = Object.keys(byDist).sort((a, b) => byDist[b] - byDist[a])
        .map(k => `<tr><td>${escapeHtml(k)}</td><td>${byDist[k].toLocaleString('es-EC')}</td></tr>`).join('');
    }
  }

  window.addEventListener('error', event => {
    console.error('Error:', event.error);
    updateStatus('Error en la aplicación');
  });
})();
