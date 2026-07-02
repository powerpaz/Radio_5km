// Renderiza Elevacion.tif (EPSG:4326) a una imagen PNG con rampa hipsométrica,
// más un JSON con su bbox, para usarse como L.imageOverlay en el geovisor.
// Uso: node scripts/render_elevation.js
// Requiere: npm install geotiff pngjs  (en esta misma carpeta scripts/)

const fs = require('fs');
const path = require('path');
const { fromArrayBuffer } = require('geotiff');
const { PNG } = require('pngjs');

const SOURCE_DIR = path.resolve(__dirname, '..', '..'); // carpeta con Elevacion.tif
const SRC = path.join(SOURCE_DIR, 'Elevacion.tif');
const OUT_DIR = path.resolve(__dirname, '..', 'data');
const OUT_PNG = path.join(OUT_DIR, 'elevacion_relieve.png');
const OUT_META = path.join(OUT_DIR, 'elevacion_relieve.json');

// Rampa hipsométrica de alto contraste (azul-verde-amarillo-naranja-rojo),
// elegida para distinguirse de los tonos verdes/beige propios del basemap OSM.
const HYPSO_STOPS = [
  [0.00, [43, 131, 186]],
  [0.25, [171, 221, 164]],
  [0.50, [255, 255, 191]],
  [0.75, [253, 174, 97]],
  [1.00, [215, 25, 28]]
];

function hypsometricColor(t) {
  for (let i = 0; i < HYPSO_STOPS.length - 1; i++) {
    const [t0, c0] = HYPSO_STOPS[i];
    const [t1, c1] = HYPSO_STOPS[i + 1];
    if (t >= t0 && t <= t1) {
      const f = (t - t0) / (t1 - t0 || 1);
      return [
        Math.round(c0[0] + f * (c1[0] - c0[0])),
        Math.round(c0[1] + f * (c1[1] - c0[1])),
        Math.round(c0[2] + f * (c1[2] - c0[2]))
      ];
    }
  }
  return HYPSO_STOPS[HYPSO_STOPS.length - 1][1];
}

(async () => {
  const buf = fs.readFileSync(SRC);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const tiff = await fromArrayBuffer(ab);
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  const bbox = image.getBoundingBox(); // [xmin, ymin, xmax, ymax] en EPSG:4326
  const rasters = await image.readRasters();
  const band = rasters[0];
  const noData = image.getGDALNoData();

  let min = Infinity, max = -Infinity;
  for (let i = 0; i < band.length; i++) {
    const v = band[i];
    if (v === noData) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = (max - min) || 1;

  const png = new PNG({ width, height });
  for (let i = 0; i < band.length; i++) {
    const v = band[i];
    const idx = i << 2;
    if (v === noData) {
      png.data[idx + 3] = 0;
      continue;
    }
    const t = Math.max(0, Math.min(1, (v - min) / range));
    const [r, g, b] = hypsometricColor(t);
    png.data[idx] = r;
    png.data[idx + 1] = g;
    png.data[idx + 2] = b;
    png.data[idx + 3] = 255;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_PNG, PNG.sync.write(png));
  fs.writeFileSync(OUT_META, JSON.stringify({
    bbox: { west: bbox[0], south: bbox[1], east: bbox[2], north: bbox[3] },
    min, max, width, height
  }, null, 2));

  console.log('PNG escrito:', OUT_PNG, `${width}x${height}`);
  console.log('bbox:', bbox, 'min/max elevación:', min, max);
})();
