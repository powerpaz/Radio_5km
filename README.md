# Geovisor · Área de influencia de hasta 5 km — U.E. Ángel Modesto Paredes

Geovisor web (HTML + CSS + JavaScript + Leaflet) que responde a la solicitud:

> *"...un gráfico diferenciado por sostenimiento de las Instituciones Educativas de la
> Dirección Distrital 17D06, que se encuentren en un radio de hasta 5 km de la Unidad
> Educativa Ángel Modesto Paredes, que contemplen barreras geográficas, transporte
> público, vías de acceso y distancias entre sí."*

Clon de la interfaz/lógica del Geovisor AMIE (MINEDEC) — mismos paneles, popups,
paleta y patrón de interacción — pero sin filtros (no aplican para este análisis puntual)
y con las capas propias del análisis de área de influencia.

## Capas

| Capa (panel) | Archivo fuente | Origen | Color / estilo |
|---|---|---|---|
| U.E. Ángel Modesto Paredes | `data/ue_angel_modesto_paredes.geojson` | `17H00553.geojson` | Marcador dorado (institución de referencia) |
| Radio de influencia (5 km) | `data/buffer_5km.geojson` | `Buffer 5k.geojson` | Círculo punteado morado |
| IE Fiscales | `data/ie_radio_5km.geojson` (`NOM_SOSTEN = FISCAL`) | `IE_Instituciones_dentro_radio_5km.geojson` | Punto rojo |
| IE Otros sostenimientos | `data/ie_radio_5km.geojson` (`NOM_SOSTEN ≠ FISCAL`) | ídem | Punto azul (Particular / Fiscomisional / Municipal) |
| Líneas de distancia | `data/lineas_distancia_5km.geojson` | `Lineas de distancias_5km.geojson` | Línea discontinua morada + etiqueta `DIST_KM` |
| Vías principales | `data/vias_principales.geojson` | `Vías pincipales.geojson` | Línea café/naranja |
| Modelo de elevación (relieve) | `data/elevacion_relieve.png` + `.json` | `Elevacion.tif` | Imagen con rampa hipsométrica (azul→verde→amarillo→naranja→rojo) |

Todas las capas vectoriales se reproyectaron de EPSG:32717 (UTM 17S) a EPSG:4326
(WGS84) para su publicación web (ver `scripts/reproject.js` si se requiere regenerar
los datos desde las fuentes originales). El modelo de elevación (`Elevacion.tif`, ya en
EPSG:4326) se pre-renderizó a una imagen PNG con la misma rampa de color para evitarle
al navegador procesar el GeoTIFF en tiempo real.

La institución de referencia (AMIE 17H00553) también aparece dentro de
`IE_Instituciones_dentro_radio_5km.geojson` con `dist_km = 0`; la aplicación la excluye
de las capas "IE Fiscales/Otros sostenimientos" y de las estadísticas para no duplicarla,
ya que se muestra por separado con su propio marcador.

## Interacción

- **Capas del Mapa** (panel izquierdo): cada capa tiene un checkbox de
  visibilidad y un botón de zoom (🔍) que ajusta el mapa a la extensión de esa capa
  — no hay filtros de búsqueda, ya que el análisis es sobre un único radio fijo.
- **Clic en cualquier elemento** (marcador, línea o polígono) abre un popup con su
  información (AMIE, sostenimiento, régimen, distrito, distancia, etc.), replicando el
  patrón de popups del Geovisor AMIE.
- **Etiquetas de distancia**: la capa de líneas muestra el valor `DIST_KM` como
  etiqueta permanente en el mapa a partir del zoom 14 (activable/desactivable desde el
  panel), para evitar saturar visualmente el radio completo de 5 km con ~360 etiquetas
  simultáneas. Por debajo de ese zoom las líneas siguen visibles y su distancia exacta
  está disponible al hacer clic.
- **Resumen Global**: totales, desglose por sostenimiento (`NOM_SOSTEN`) y por distrito
  (`DA_DIST`), calculados dinámicamente de los datos cargados.

## Nota técnica — variables no incorporadas

**Transporte público.** No se incorporó como capa porque no existe, a la fecha, una
fuente oficial descargable y validada. Se revisó el portal municipal *Base de
Información Quito — Transporte Urbano e Interparroquial*
(`www7.quito.gob.ec/BaseDeInformacionQuito/TRANSPORTE%20URBANO%20E%20INTERPARROQUIAL/`)
y no ofrece una capa geoespacial descargable en formato abierto (shapefile/GeoJSON/KML).
Se documenta esta limitación en el propio geovisor (panel "Nota Técnica").

**Distancias.** `lineas_distancia_5km.geojson` contiene distancia euclidiana
(línea recta) entre la U.E. Ángel Modesto Paredes y cada institución — es un indicador
referencial, no una distancia vial. Se complementa visualmente con la capa de vías
principales (accesibilidad) y el modelo de elevación (barreras geográficas / pendientes),
tal como pide la solicitud original, ante la ausencia de datos de transporte público.

**Cobertura administrativa.** El radio de 5 km cruza los límites del Distrito 17D06:
de las 361 instituciones vecinas, 251 pertenecen a 17D06, y el resto a distritos
colindantes (17D04, 17D07, 17D08) — se incluyen todas por estar dentro del radio
geográfico solicitado, independientemente del distrito administrativo.

## Ejecutar localmente

Es una aplicación estática (sin build ni backend). Cualquier servidor HTTP simple sirve:

```bash
npx http-server -p 8080
# o
python -m http.server 8080
```

Luego abrir `http://localhost:8080`.

## Publicar en GitHub Pages

1. Subir el contenido de esta carpeta a un repositorio de GitHub.
2. En **Settings → Pages**, seleccionar la rama (`main`) y carpeta raíz (`/`).
3. GitHub publicará la URL pública automáticamente (funciona igual que en local, ya
   que no requiere backend).

## Estructura

```
geovisor-5km-angel-modesto-paredes/
├── index.html
├── styles.css
├── app.js
├── logo.png
└── data/
    ├── ue_angel_modesto_paredes.geojson
    ├── buffer_5km.geojson
    ├── ie_radio_5km.geojson
    ├── lineas_distancia_5km.geojson
    ├── vias_principales.geojson
    ├── elevacion_relieve.png
    └── elevacion_relieve.json
```
