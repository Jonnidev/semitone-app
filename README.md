# Trama Serigráfica

App web gratuita para convertir cualquier imagen en fotolitos de semitono para serigrafía. Todo el procesamiento ocurre en el navegador: las imágenes no se suben a ningún servidor.

## Funciones

- **Formatos de entrada**: PNG, JPG, WebP, GIF, fotos HEIC de iPhone, SVG, PDF y AI de Illustrator con compatibilidad PDF (se rasterizan a 3000 px). Los PSD no se pueden abrir en el navegador.
- **Separación de color**: una tinta (por luminosidad o por parecido a un color), tintas planas y proceso simulado con detección automática de colores, y CMYK con reemplazo de gris (GCR).
- **Base blanca automática** para prendas oscuras, con intensidad y contracción.
- **Quitar fondo**
  - Por color: detecta fondos uniformes, cuentagotas, tolerancia, borde suave y limpieza del halo.
  - Con IA, en el equipo del usuario: MODNet para personas y BiRefNet lite para cualquier objeto. Usa la GPU (WebGPU) cuando está disponible.
  - Pincel para borrar o restaurar a mano, con deshacer.
- **Tramas**
  - AM: seis formas de punto (redondo, euclidiano, elíptico, cuadrado, diamante y línea), con lineatura y ángulo por placa.
  - FM estocástica: ruido azul con tamaño de grano en mm.
- **Parámetros de taller**: rango de LPI recomendado según la malla, punto mínimo y máximo, compensación de ganancia de punto e impresión en espejo.
- **Salida**
  - PNG de 1 bit con la resolución grabada, o PDF a tamaño real con una página por placa.
  - Marcas de registro y rótulo de placa.
  - ZIP con vista previa y ficha de trabajo.
  - Los fotolitos se generan en paralelo con Web Workers.
- **Proyectos guardados** en el navegador (IndexedDB) e **instalable como app**, que funciona sin conexión una vez cargada.

## Estructura

Sitio estático sin paso de compilación: se publica tal cual.

```
index.html             Interfaz
css/app.css            Estilos (tema claro y oscuro)
js/app.js              Interfaz, vista previa, separación y quitar fondo por color
js/core.js             Color, tramas, fotolitos, PNG, PDF y ZIP (compartido con los workers)
js/plate-worker.js     Genera fotolitos en segundo plano
js/ai-worker.js        Quitar fondo con IA (Transformers.js + ONNX Runtime Web)
js/projects.js         Proyectos guardados (IndexedDB)
js/loaders.js          Lectura de HEIC, SVG, PDF y AI
sw.js                  Modo sin conexión
manifest.webmanifest   Datos para instalar la app
_headers               Cabeceras para Cloudflare Pages
```

## Probar en tu computador

Los módulos y workers no funcionan abriendo el archivo directamente; hace falta un servidor local:

```bash
python3 -m http.server 8080
# luego abre http://localhost:8080
```

## Publicar en Cloudflare

El sitio está publicado con Cloudflare Workers conectado a este repositorio: cada cambio en `main` se publica solo. También funciona en Cloudflare Pages:

### Cloudflare Pages

1. Entra a [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → pestaña **Pages** → **Connect to Git**.
2. Elige el repositorio `semitone-app`.
3. Configuración de compilación:
   - **Framework preset**: None
   - **Build command**: déjalo vacío
   - **Build output directory**: `/`
4. **Save and Deploy**. Cada cambio que se suba a la rama `main` se publica solo.

Para usar un dominio propio: en el proyecto de Pages, **Custom domains** → **Set up a domain**.

Al publicar una versión nueva, sube el número de `VERSION` en `sw.js` para que quienes instalaron la app reciban los archivos nuevos.

## Licencias de terceros

- [pdf.js](https://github.com/mozilla/pdf.js) (Apache-2.0) y [heic2any](https://github.com/alexcorvi/heic2any) (MIT) se cargan desde jsDelivr solo al abrir PDF/AI o fotos HEIC.
- [Transformers.js](https://github.com/huggingface/transformers.js) (Apache-2.0) se carga desde jsDelivr solo cuando se usa el quitado de fondo con IA.
- Modelo [MODNet](https://huggingface.co/Xenova/modnet) (Apache-2.0) y modelo [BiRefNet lite](https://huggingface.co/onnx-community/BiRefNet_lite-ONNX) (MIT). Se descargan desde Hugging Face la primera vez y quedan guardados en el navegador.
- Fuentes Big Shoulders Display e IBM Plex (SIL Open Font License) desde Google Fonts.

## Licencia

MIT. Ver [LICENSE](LICENSE).
