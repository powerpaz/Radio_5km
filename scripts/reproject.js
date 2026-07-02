// Reproyecta las capas fuente (EPSG:32717 / UTM 17S) a EPSG:4326 (WGS84) para uso en Leaflet.
// Uso: node scripts/reproject.js
// Requiere: npm install proj4  (en esta misma carpeta scripts/)
//
// Espera que los GeoJSON originales del análisis (17H00553.geojson, "Buffer 5k.geojson",
// IE_Instituciones_dentro_radio_5km.geojson, "Lineas de distancias_5km.geojson",
// "Vías pincipales.geojson") estén en la carpeta indicada por SOURCE_DIR.

const fs = require('fs');
const path = require('path');
const proj4 = require('proj4');

const SRC_EPSG = 'EPSG:32717';
proj4.defs(SRC_EPSG, '+proj=utm +zone=17 +south +datum=WGS84 +units=m +no_defs');

const SOURCE_DIR = path.resolve(__dirname, '..', '..'); // carpeta con los GeoJSON originales
const OUT_DIR = path.resolve(__dirname, '..', 'data');

function reprojectCoords(coords, fromCrs) {
  if (typeof coords[0] === 'number') {
    const [x, y] = coords;
    const [lng, lat] = proj4(fromCrs, 'EPSG:4326', [x, y]);
    return [lng, lat];
  }
  return coords.map(c => reprojectCoords(c, fromCrs));
}

function processFile(inFile, outFile) {
  const raw = fs.readFileSync(path.join(SOURCE_DIR, inFile), 'utf8');
  const gj = JSON.parse(raw);
  const crsName = gj.crs && gj.crs.properties && gj.crs.properties.name;
  const isUtm = crsName && crsName.includes('32717');

  if (isUtm) {
    gj.features.forEach(f => {
      f.geometry.coordinates = reprojectCoords(f.geometry.coordinates, SRC_EPSG);
    });
    delete gj.crs;
  }
  fs.writeFileSync(path.join(OUT_DIR, outFile), JSON.stringify(gj));
  console.log(`${inFile} -> ${outFile} (${gj.features.length} features, reproyectado: ${isUtm})`);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

processFile('17H00553.geojson', 'ue_angel_modesto_paredes.geojson');
processFile('Buffer 5k.geojson', 'buffer_5km.geojson');
processFile('IE_Instituciones_dentro_radio_5km.geojson', 'ie_radio_5km.geojson');
processFile('Lineas de distancias_5km.geojson', 'lineas_distancia_5km.geojson');
processFile('Vías pincipales.geojson', 'vias_principales.geojson');

console.log('Listo.');
