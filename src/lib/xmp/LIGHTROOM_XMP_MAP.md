# Mapeo de ajustes de revelado → etiquetas XMP de Lightroom / Camera Raw

Documento de referencia para `XmpPatchEngine`. Antes de parchear XMP reales generados
por Lightroom, aquí se identifica exactamente qué etiqueta del namespace `crs:`
(Camera Raw Settings) corresponde a cada ajuste de revelado, su tipo, rango y reglas
de parcheo. Validado contra la especificación oficial de Adobe (crs namespace) y
muestras reales de sidecar `.xmp` de Lightroom Classic.

## Namespace y estructura

- Namespace URI: `http://ns.adobe.com/camera-raw-settings/1.0/`
- Prefijo: `crs`
- Las etiquetas de revelado viven dentro de `<rdf:Description>` (igual que en los
  sidecars que Lightroom escribe hoy). Al parchear NO se regenera el archivo: se
  modifican únicamente los nodos `crs:` listados abajo y se conserva todo lo demás
  (metadatos EXIF, crop, presets locales, flags, etc.).

## Process Version (crítico)

- `crs:ProcessVersion` — p.ej. `"15.0"`, `"11.4"`, `"11.0"`. Los sliders `*2012`
  requieren PV 2012+. Si el XMP original usa un PV antiguo, **no bajarlo**; los tags
  `*2012` son los que Lightroom lee hoy. No escribir los tags legacy (ver abajo).

## WhiteBalance (crítico)

- `crs:WhiteBalance` — valores: `As Shot`, `Auto`, `Daylight`, `Cloudy`, `Shade`,
  `Tungsten`, `Fluorescent`, `Flash`, `Custom`.
- **Regla de parcheo:** si el recipe aporta `temperature` o `tint`, forzar
  `crs:WhiteBalance = "Custom"`. Mientras sea `As Shot`, Lightroom **ignora**
  `crs:Temperature` y `crs:Tint` y deriva el WB de la cámara. Pasar a `Custom` es lo
  que hace que la temperatura/tint manuales se respeten.

## Temperature y Tint (crítico — ventaja del parche)

- `crs:Temperature` — Integer, **Kelvin absoluto**, rango 2000–50000.
- `crs:Tint` — Integer, rango -150 a 150.
- El `SceneRecipe` guarda `temperature` como un **shift** (aprox. -100..100), NO como
  Kelvin absoluto. Por eso el parche es mejor que generar desde cero: **se lee el
  `crs:Temperature` ya presente en el XMP del fotógrafo y se le aplica el shift**,
  conservando el WB original como base (en vez de anclar a 5500K a ciegas).
- Fórmula de parcheo propuesta: `nuevoKelvin = clamp(kelvinOriginal + shift * 50, 2000, 50000)`.
  El factor 50 es una escala intermedia; afinar tras la primera prueba en Lightroom.
- `tint` del recipe se aplica directo (mismo rango que `crs:Tint`).

## Ajustes del SceneRecipe actual → etiqueta

| Ajuste (recipe)  | Etiqueta XMP        | Tipo    | Rango Lightroom | Notas |
|-----------------|---------------------|---------|-----------------|-------|
| exposure        | `crs:Exposure2012`  | Real    | -5.0 .. +5.0    | EV. El recipe usa -2..2; escribir tal cual. |
| contrast        | `crs:Contrast2012`  | Integer | -100 .. +100    | |
| highlights      | `crs:Highlights2012`| Integer | -100 .. +100    | |
| shadows         | `crs:Shadows2012`   | Integer | -100 .. +100    | |
| whites          | `crs:Whites2012`    | Integer | -100 .. +100    | |
| blacks          | `crs:Blacks2012`    | Integer | -100 .. +100    | |
| temperature     | `crs:Temperature`   | Integer | 2000 .. 50000   | Kelvin absoluto; ver sección Temperature. |
| tint            | `crs:Tint`          | Integer | -150 .. +150    | |
| vibrance        | `crs:Vibrance`      | Integer | -100 .. +100    | |
| saturation      | `crs:Saturation`    | Integer | -100 .. +100    | |
| sharpening       | `crs:Sharpness`     | Integer | 0 .. 100        | Solo el Amount; ver sub-etiquetas abajo. |

## Ajustes futuros / opcionales (no están en el recipe actual, pero se mapean igual)

| Ajuste (futuro)   | Etiqueta XMP       | Tipo    | Rango            |
|-------------------|--------------------|---------|------------------|
| texture           | `crs:Texture`      | Integer | -100 .. +100    |
| clarity           | `crs:Clarity2012`  | Integer | -100 .. +100    | En XMP real es `Clarity2012`, no `Clarity`.
| dehaze            | `crs:Dehaze`       | Integer | -100 .. +100    |
| noise_reduction   | ver abajo          | —       | —               | Sub-etiquetas de luminancia/color.

## Sharpening (sub-etiquetas)

`crs:Sharpness` es solo el Amount. Lightroom escribe además:

| Sub-ajuste          | Etiqueta XMP              | Tipo    | Rango        |
|---------------------|---------------------------|---------|--------------|
| amount              | `crs:Sharpness`           | Integer | 0 .. 100    |
| radius              | `crs:SharpnessRadius`     | Real    | 0.5 .. 3.0   |
| detail              | `crs:SharpnessDetail`     | Integer | 0 .. 100    |
| masking             | `crs:SharpnessMasking`    | Integer | 0 .. 100    |

El recipe actual solo trae `sharpening` (amount). Al parchear se deja Radius/Detail/
Masking tal como estén en el XMP original.

## Noise Reduction (sub-etiquetas)

Lightroom Classic moderno escribe luminance/color noise reduction así:

| Sub-ajuste                  | Etiqueta XMP                          | Tipo    | Rango       |
|-----------------------------|---------------------------------------|---------|-------------|
| luminance noise reduction    | `crs:LuminanceNoiseReduction`         | Integer | 0 .. 100   |
| luminance detail             | `crs:LuminanceNoiseReductionDetail`   | Integer | 0 .. 100   |
| luminance contrast           | `crs:LuminanceNoiseReductionContrast` | Integer | 0 .. 100   |
| color noise reduction        | `crs:ColorNoiseReduction`             | Integer | 0 .. 100   |
| color detail                 | `crs:ColorNoiseReductionDetail`       | Integer | 0 .. 100   |
| color smoothness             | `crs:ColorNoiseReductionSmoothness`    | Integer | 0 .. 100   |

> Nota: la especificación crs original lista `crs:LuminanceSmoothing`, pero los
> sidecars actuales de Lightroom Classic usan `crs:LuminanceNoiseReduction`.
> Confirmar contra un XMP real del fotógrafo antes de escribir; si su archivo usa
> `LuminanceSmoothing`, parchear esa etiqueta en su lugar.

## Tags legacy que NO se deben escribir (PV 2012+)

Evitar escribir estos junto a los `*2012`, porque Lightroom los ignora con PV moderno
y pueden generar conflicto. Si existen en el XMP original, dejarlos intactos (no
borrarlos, no reescribirlos):

- `crs:Exposure` (legacy, -4..4) → usar `crs:Exposure2012`
- `crs:Contrast` (legacy, -50..100) → usar `crs:Contrast2012`
- `crs:Shadows` (legacy, 0..100) → usar `crs:Shadows2012`
- `crs:Brightness` (legacy, 0..150) → no usar
- `crs:AutoExposure`, `crs:AutoContrast`, `crs:AutoShadows`, `crs:AutoBrightness`

## Reglas de parcheo (resumen)

1. Leer el `.xmp` original del fotógrafo como texto.
2. Para cada ajuste del recipe, sustituir **solo** el contenido de la etiqueta
   correspondiente. Si la etiqueta no existe en el XMP, insertarla dentro del
   `<rdf:Description>` crs (junto a las demás `crs:`).
3. Si el recipe aporta `temperature` o `tint`: forzar `crs:WhiteBalance = "Custom"`,
   y calcular `crs:Temperature` a partir del Kelvin existente + shift (no desde cero).
4. Conservar el nombre exacto del RAW: `KRFC0056.CR3` → `KRFC0056.xmp`.
5. No tocar nada que no sea un parámetro de revelado de la tabla (crop, flags,
   metadatos EXIF, presets locales, ajustes locales, etc.).
6. Preservar `crs:ProcessVersion` y `crs:Version` originales.

## Pendiente de confirmar contra un XMP real del fotógrafo

- Si sus sidecars usan `crs:LuminanceSmoothing` o `crs:LuminanceNoiseReduction`.
- El factor de escala del shift de temperatura (propuesto `*50`) — afinar tras la
  primera prueba visual en Lightroom.
- Si el recipe futuro incorpora `texture`/`clarity`/`dehaze`/`noise_reduction`,
  añadir esas etiquetas con la misma mecánica de parcheo.