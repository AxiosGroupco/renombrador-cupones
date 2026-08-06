# Renombrador de Cupones de Pago — versión web

Reemplaza a `RenombradorPDF.exe`. Lee los cupones con OCR y los renombra a
`CUPON DE PAGO {NOMBRE} {MES} {AÑO}.pdf`.

Todo corre **dentro del navegador**: los PDF no se suben a ningún servidor y no
hay nada que instalar en el computador (ni poppler ni Tesseract).

---

## Cómo usarlo

1. Abre la página.
2. Arrastra los PDF de los cupones.
3. Presiona **Procesar**. El anillo de la marca marca el avance.
4. Revisa la tabla y corrige lo que haga falta.
5. **Descargar ZIP** (o **Guardar en carpeta…** en Chrome/Edge, que escribe los
   archivos directamente donde elijas).

Con **un solo cupón** el botón dice **Descargar PDF** y baja el archivo ya
renombrado, sin comprimir: no tiene sentido obligar a descomprimir para sacar
uno. A partir de dos, se agrupan en ZIP junto con el reporte CSV.

La pantalla tiene dos momentos. Mientras no hay resultados manda la zona de
carga; en cuanto los hay, se encoge a una franja y la tabla pasa a ocupar el
espacio.

En la revisión, **los cuatro contadores son filtros**: con 110 cupones, lo único
que se necesita de verdad es saltar a los pocos que piden atención. Pulsa
**Revisar** o **Sin nombre** para ver solo esos; los contadores en cero no se
pueden pulsar. Cada fila lleva un filo de color a la izquierda con su estado, así
que se lee sin buscar la pastilla.

Los nombres se editan en la propia tabla, y **Enter salta al siguiente**: se
pueden corregir varios seguidos sin soltar el teclado.

### Cómo lee los PDF

Muchos PDF generados por computador ya traen el texto adentro. Cuando es así,
leerlo es instantáneo y exacto. Solo cuando no hay texto —un escaneo, por
ejemplo— hace falta reconocer la imagen, que es lento y se equivoca.

El `.exe` rasterizaba **todas** las páginas a 300 dpi y les pasaba OCR encima,
sin comprobar antes si había texto. De ahí salían los `90094.1454-2` y los
`REFA` en vez de `REF1` que ensucian su log.

Por defecto (**Texto del PDF, y OCR si no lo trae**) se intenta primero la vía
rápida y solo se cae al OCR archivo por archivo cuando hace falta. La columna
**Lectura** de la tabla dice cuál se usó en cada uno.

Si todos los cupones traen texto, el motor de reconocimiento **ni siquiera se
descarga**: se ahorran los ~9 MB y la espera de la primera carga. Cuando sí se
necesita, se baja una vez y queda en caché.

La opción **Solo OCR** fuerza el reconocimiento. Sirve si algún PDF trae una
capa de texto defectuosa —cosa que pasa con ciertos generadores— y conviene
ignorarla.

### Mes y año

Se toman **automáticamente del nombre de cada archivo**:

```
280_10432871_08_2026.pdf   →   agosto 2026
{consecutivo}_{cédula/NIT}_{MM}_{AAAA}.pdf
```

Los selectores de mes y año arriba solo se usan para archivos que no siguen ese
formato. Ya no hay que escribir el mes a mano para todo el lote, así que un error
de digitación no puede arruinar 110 archivos.

### Estados

| Estado | Qué significa |
|---|---|
| **Verificado** | La cédula/NIT que el OCR leyó del documento coincide con la del nombre del archivo. Prácticamente seguro. |
| **Revisar** | Se extrajo un nombre, pero no se pudo confirmar contra la cédula/NIT. Vale la pena mirarlo. |
| **Sin nombre** | No se pudo extraer. Escríbelo a mano en la tabla. |

Cualquier nombre se puede editar directamente en la tabla antes de descargar; el
ZIP usa lo que quede escrito ahí. La columna **OCR** muestra el texto crudo que
leyó el motor, útil para entender un caso raro.

---

## Publicado

Está publicado como Artifact en claude.ai:

**https://claude.ai/code/artifact/2de93bc5-f991-4bcd-a567-b7647b9a06b2**

Es **privado**: se abre desde cualquier dispositivo con tu sesión iniciada. Para
que lo use alguien más del equipo, hay que compartirlo desde el menú de compartir
de la propia página.

Es el mismo `renombrador-cupones.html` que está en esta carpeta, generado con
`build.py`. Para actualizarlo después de cambiar el código:

```bash
python3 renombrador-web/build.py
```

y volver a publicar ese archivo sobre la misma URL.

## Archivo único

`build.py` empaqueta todo —pdf.js, tesseract.js, el núcleo WASM y el modelo de
español— en un solo HTML de 6,9 MB que no pide nada a la red. Sirve para
publicarlo donde solo se pueda subir un archivo, y funciona sin conexión una vez
cargado.

Dos detalles del empaquetado, por si hay que tocarlo:

- El núcleo WASM va concatenado **antes** del worker de Tesseract. Así el worker
  encuentra `TesseractCore` ya definido y se salta su `importScripts`, que no
  funcionaría desde un blob.
- El modelo se pasa como bytes (`{code:'spa', data:…}`) en lugar de una URL.
  Eso destapa un bug de tesseract.js 5.1.1: `initialize` arma el código de
  idioma con `t.data` —los bytes— en vez de `t.code`, y `Init` falla. `build.py`
  parchea esa línea y aborta si el patrón deja de coincidir, para que un cambio
  de versión no pase inadvertido.

## Publicarlo en otro lado

Es un sitio estático: no necesita servidor de aplicaciones ni base de datos.

**Netlify** (lo más simple): entra a [app.netlify.com/drop](https://app.netlify.com/drop)
y arrastra la carpeta `renombrador-web`. Queda con URL pública en un minuto.

**GitHub Pages**: sube la carpeta a un repo y activa Pages sobre la rama.

**Red interna / carpeta compartida**: también funciona servido por IIS, Apache o
cualquier servidor de archivos estáticos.

> Una limitación: la página **debe servirse por HTTP(S)**, no abrirse con doble
> clic desde el disco (`file://`). Los navegadores bloquean los web workers en
> `file://`. Para probar en local:
>
> ```bash
> python3 renombrador-web/serve.py 8787
> ```
>
> y abrir `http://localhost:8787`.

Si se publica en internet, conviene ponerlo detrás de alguna autenticación: la
herramienta en sí no expone datos (todo es local al navegador), pero no hay razón
para dejarla abierta al público.

---

## Sobre el aspecto

La herramienta es **blanca siempre**. No sigue la preferencia de tema del
sistema ni el conmutador del visor: es una decisión, no un olvido. Los tokens
de color viven en `:root` y las variantes `data-theme` apuntan a los mismos
valores, con `color-scheme: light` para que el navegador tampoco oscurezca sus
propios controles.

Sobre blanco la estructura no viene de bloques rellenos sino de filetes de un
píxel y de la tipografía. Los tres colores del logo —muestreados del archivo,
no estimados— se reparten papeles distintos:

| Color | | Para qué |
|---|---|---|
| Bosque | `#00683f` | lo que se pulsa: botones y foco |
| Lima | `#8ed716` | lo que salió bien: verificado y el avance |
| Petróleo | `#00687d` | lo que pide una mirada: «revisar» |

El único color ajeno a la marca es el rojo de «sin nombre»: un error debe
distinguirse de un aviso a simple vista.

El logo va incrustado como data URI desde el archivo original. Lo único que se
le hizo fue recortar el margen transparente sobrante y reescalarlo; el dibujo
no se toca. Para cambiarlo: `python3 incrustar-logo.py ruta/al/logo.svg`.

---

## Estructura

```
index.html                 Interfaz
js/extract.js              Lógica de extracción del nombre (sin dependencias)
js/app.js                  PDF → imagen → OCR → nombre → ZIP
vendor/                    pdf.js, tesseract.js, jszip (locales, sin CDN)
tessdata/spa.traineddata.gz Modelo de español
test/test.html             Pruebas contra 933 textos OCR reales
test/pdfs-prueba/          5 cupones sintéticos para probar de punta a punta
serve.py                   Servidor local para desarrollo
```

`js/extract.js` no depende de nada y se puede probar por separado. Ahí está toda
la lógica que vale la pena mantener.

---

## Qué cambió respecto al `.exe`

Estos son los defectos que se encontraron revisando el ejecutable y su log de
1.373 archivos procesados entre octubre de 2025 y julio de 2026.

**Ya no depende de nada instalado.** El `.exe` traía las rutas
`C:\poppler-25.07.0\Library\bin` y `C:\Program Files\Tesseract-OCR` quemadas en
el código. En la corrida del 31 de julio de 2026 eso hizo fallar **256 de 256
archivos**, y el 2 de octubre de 2025 otros 107.

**Prefijo duplicado corregido.** El `.exe` producía nombres como
`CUPON DE PAGO DE PAGO RIVAS CARDONA MARTIN ENERO 2026.pdf`: **146 de los 985
archivos renombrados (15 %)** salieron así. Solo limpiaba el prefijo cuando
empezaba exactamente por `PAGO `, y no cubría `DE PAGO ` ni `CUPON DE PAGO `.

**Extracción anclada a la estructura del cupón.** El `.exe` buscaba «hasta 5
palabras en mayúscula antes de NIT», lo que se tragaba el encabezado y fallaba
con nombres que terminan en sigla. Ahora se toma lo que está entre
`CUPON DE PAGO` y `NIT`, que es donde el documento siempre pone el nombre.

**Casos que el `.exe` nunca pudo procesar y ahora sí:**

| Nombre | Por qué fallaba antes |
|---|---|
| `VBM SAS` | el filtro exigía 8+ caracteres sin espacios; tiene 6 |
| `INVERSIONES DEL LLANO ORIENTAL S.A.S` | la expresión regular no aceptaba puntos |
| `COMERCIALIZADORA PUERTO NUEVO DEL SUR S` | no aceptaba palabras de una sola letra |
| `MUÑOZ CAÑAS WILDER` | el OCR desordena el bloque en estos cupones |

**Verificación cruzada por cédula/NIT.** Nueva. El nombre del archivo original
trae el documento del arrendatario, y el OCR lo lee del cupón; si coinciden, la
extracción queda marcada como verificada. En las pruebas, el 94 % quedó
verificado automáticamente.

**Revisión antes de escribir.** El `.exe` renombraba de una y movía el original
con `os.rename` — sin vuelta atrás y sin que nadie viera los 146 nombres malos.
Ahora se revisa y corrige en pantalla, y **los originales nunca se tocan**: se
descarga una copia renombrada.

**Otras correcciones menores:** `all()` ya implicaba `any()` en el filtro de
palabras genéricas (la condición no hacía nada); la carpeta destino se calculaba
solo a partir del primer archivo seleccionado; y no se saneaban los caracteres
que Windows prohíbe en un nombre de archivo.

---

## Pruebas

**`test/test.html`** — corre la extracción contra los 933 textos OCR reales
sacados de `renombrado_log.log` y compara contra lo que produjo el `.exe`.

Resultado actual:

```
Casos evaluados        : 933
Extraídos por el .exe  : 921  (98,7 %)
Extraídos por el nuevo : 933  (100 %)

Recuperados (el .exe fallaba) : 12
Regresiones                   : 0
Prefijo basura corregido      : 146
Nombres más completos         : 10
```

Los 10 «más completos» son casos donde el `.exe` truncaba el nombre:
`VIAJES DEL LLANO SAS` → `GRUPO VIAJES DEL LLANO SAS`,
`DEL ORIENTE ANDINO SA` → `SEGUROS DEL ORIENTE ANDINO SA`.

**`test/pdfs-prueba/`** — cinco cupones sintéticos con el formato real, para
probar el flujo completo (render, OCR, extracción, ZIP). Incluyen a propósito los
cuatro casos que el `.exe` no podía procesar.

---

## Rendimiento

Medido sobre el log real: ~110 cupones por corrida, una página por PDF, 2,1 s por
archivo en el `.exe` nativo.

| Vía | Por archivo | Lote de 110 | Motor OCR |
|---|---|---|---|
| Capa de texto | ~0,2 s | **menos de medio minuto** | no se descarga |
| OCR, 4 procesos a 300 dpi | ~3 s | ~3 minutos | ~9 MB la primera vez |

Cuál aplica depende de si los cupones traen texto embebido. **Esto está sin
confirmar contra los cupones reales**: los PDF de prueba de este repositorio sí
lo traen, pero se generaron aquí. La primera corrida con archivos de verdad lo
resuelve — la columna **Lectura** lo dice archivo por archivo.

Si toca ir por OCR y hace falta más velocidad, bajar a 220 dpi en **Resolución
del OCR** ayuda bastante; conviene revisar que la calidad se mantenga antes de
dejarlo fijo. El número de procesos en paralelo se sugiere según el computador;
subirlo mucho en una máquina modesta puede ser contraproducente.
