#!/usr/bin/env python3
"""
Empaqueta toda la aplicación en un solo archivo HTML autocontenido.

Uso:  python3 build.py [salida.html]

El resultado no pide nada a la red: lleva dentro pdf.js, tesseract.js, el
núcleo WASM y el modelo de español. Sirve para publicarlo donde solo se pueda
subir un archivo.
"""
import base64
import os
import re
import sys

RAIZ = os.path.dirname(os.path.abspath(__file__))
SALIDA = sys.argv[1] if len(sys.argv) > 1 else os.path.join(RAIZ, 'renombrador-cupones.html')


def leer(*partes):
    with open(os.path.join(RAIZ, *partes), encoding='utf-8') as f:
        return f.read()


def leer_bytes(*partes):
    with open(os.path.join(RAIZ, *partes), 'rb') as f:
        return f.read()


def revisar(nombre, texto):
    """Un bloque <script type="text/plain"> se rompe si trae estas secuencias."""
    for mala in ('</script', '<!--'):
        if mala in texto.lower():
            raise SystemExit('ERROR: %s contiene %r y no se puede empotrar tal cual.' % (nombre, mala))


html = leer('index.html')

# --- Scripts que se ejecutan en la página: se insertan en línea -------------
inline = {
    'vendor/pdf.min.js': leer('vendor', 'pdf.min.js'),
    'vendor/tesseract.min.js': leer('vendor', 'tesseract.min.js'),
    'vendor/jszip.min.js': leer('vendor', 'jszip.min.js'),
    'js/extract.js': leer('js', 'extract.js'),
    'js/app.js': leer('js', 'app.js'),
}
for ruta, contenido in inline.items():
    revisar(ruta, contenido)
    etiqueta = '<script src="%s"></script>' % ruta
    if etiqueta not in html:
        raise SystemExit('ERROR: no se encontró %s en index.html' % etiqueta)
    html = html.replace(etiqueta, '<script>\n%s\n</script>' % contenido)

# --- Recursos que deben existir como URL: van en bloques de texto ----------
pdf_worker = leer('vendor', 'pdf.worker.min.js')

# Parche a un bug de tesseract.js 5.1.1
# ------------------------------------
# El archivo único pasa el modelo como objeto {code:'spa', data:bytes} en vez
# de una URL. `loadLanguage` lo maneja bien (usa .code), pero `initialize`
# arma el código de idioma con `t.data` —los bytes— en lugar de `t.code`, así
# que TessBaseAPI.Init recibe basura y falla con "initialization failed".
# No se puede corregir desde fuera: el objeto pasa por postMessage y un
# subtipo de Uint8Array con toString() propio no sobrevive al clonado.
worker_js = leer('vendor', 'worker.min.js')
BUG = 'a.map((function(t){return"string"==typeof t?t:t.data})).join("+")'
ARREGLO = 'a.map((function(t){return"string"==typeof t?t:t.code})).join("+")'
if worker_js.count(BUG) != 1:
    raise SystemExit('ERROR: el parche de tesseract.js ya no aplica '
                     '(%d coincidencias). Revisar si la versión cambió.'
                     % worker_js.count(BUG))
worker_js = worker_js.replace(BUG, ARREGLO)

# El núcleo va primero: así el worker encuentra TesseractCore ya definido
# y se salta la descarga por importScripts.
tess_worker = leer('vendor', 'tesseract-core-simd-lstm.wasm.js') + '\n;\n' + worker_js
spa_b64 = base64.b64encode(leer_bytes('tessdata', 'spa.traineddata.gz')).decode('ascii')

revisar('pdf.worker.min.js', pdf_worker)
revisar('tesseract worker + core', tess_worker)

bloques = (
    '<script type="text/plain" id="emp-pdf-worker">%s</script>\n'
    '<script type="text/plain" id="emp-tess-worker">%s</script>\n'
    '<script type="text/plain" id="emp-tess-spa">%s</script>\n'
) % (pdf_worker, tess_worker, spa_b64)

# Los bloques van antes de los scripts para que app.js ya los encuentre.
marca = '<script>'
i = html.index(marca)
html = html[:i] + bloques + html[i:]

# Sin archivos sueltos, el aviso de servidor local ya no aplica.
html = html.replace(
    'Reconocimiento de texto con Tesseract (español) y pdf.js, ambos ejecutándose dentro del navegador.',
    'Reconocimiento de texto con Tesseract (español) y pdf.js, ambos ejecutándose dentro del navegador. '
    'Versión de archivo único: funciona sin conexión una vez cargada.'
)

with open(SALIDA, 'w', encoding='utf-8') as f:
    f.write(html)

mb = os.path.getsize(SALIDA) / 1024 / 1024
print('escrito %s  (%.1f MB)' % (SALIDA, mb))
