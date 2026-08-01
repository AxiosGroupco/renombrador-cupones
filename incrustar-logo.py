#!/usr/bin/env python3
"""
Incrusta el logo REAL en index.html, sin redibujarlo.

Uso:  python3 incrustar-logo.py ruta/al/logo.svg
      python3 incrustar-logo.py ruta/al/logo.png

- SVG: se inserta el vector tal cual (nítido a cualquier tamaño, pesa poco).
- PNG/JPG/WEBP: se incrusta como data URI en un <img>.

En ambos casos el archivo único de build.py sigue siendo autocontenido: no
queda ninguna referencia externa.

Se recomienda SVG. Si solo hay PNG, que sea de 256 px de lado o más.
"""
import base64
import mimetypes
import os
import re
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
INDEX = os.path.join(AQUI, 'index.html')

# La marca vive entre estas dos señales; todo lo de en medio se reemplaza.
INICIO = '<!-- LOGO:inicio -->'
FIN = '<!-- LOGO:fin -->'


def bloque_svg(texto_svg):
    """Limpia el SVG y lo deja listo para insertar en línea."""
    s = texto_svg
    s = re.sub(r'<\?xml[^>]*\?>', '', s)
    s = re.sub(r'<!DOCTYPE[^>]*>', '', s, flags=re.I)
    s = re.sub(r'<!--.*?-->', '', s, flags=re.S)
    # Los ids internos pueden chocar con otros del documento.
    for viejo in set(re.findall(r'id="([^"]+)"', s)):
        s = s.replace('id="%s"' % viejo, 'id="ga-%s"' % viejo)
        s = s.replace('url(#%s)' % viejo, 'url(#ga-%s)' % viejo)
        s = s.replace("url('#%s')" % viejo, "url('#ga-%s')" % viejo)
    s = s.strip()
    # Que herede el tamaño de la clase .marca en vez de traer el suyo.
    s = re.sub(r'<svg([^>]*?)\s(width|height)="[^"]*"', r'<svg\1', s)
    s = s.replace('<svg', '<svg class="marca" role="img" '
                          'aria-label="Grupo Andino Inmobiliario"', 1)
    if '</script' in s.lower():
        sys.exit('ERROR: el SVG trae <script>; no se incrusta por seguridad.')
    return s


def bloque_img(ruta):
    tipo = mimetypes.guess_type(ruta)[0] or 'image/png'
    with open(ruta, 'rb') as f:
        b64 = base64.b64encode(f.read()).decode('ascii')
    return ('<img class="marca" alt="Grupo Andino Inmobiliario" '
            'src="data:%s;base64,%s">' % (tipo, b64))


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    ruta = sys.argv[1]
    if not os.path.exists(ruta):
        sys.exit('No existe: %s' % ruta)

    if ruta.lower().endswith('.svg'):
        with open(ruta, encoding='utf-8') as f:
            marca = bloque_svg(f.read())
        clase = 'SVG en línea'
    else:
        marca = bloque_img(ruta)
        clase = 'imagen incrustada'

    html = open(INDEX, encoding='utf-8').read()
    if INICIO not in html or FIN not in html:
        sys.exit('ERROR: no encuentro las marcas %s / %s en index.html' % (INICIO, FIN))

    nuevo = re.sub(
        re.escape(INICIO) + r'.*?' + re.escape(FIN),
        INICIO + '\n      ' + marca + '\n      ' + FIN,
        html, flags=re.S)

    open(INDEX, 'w', encoding='utf-8').write(nuevo)
    kb = len(marca) / 1024
    print('Logo incrustado como %s (%.0f KB en el HTML).' % (clase, kb))
    print('Ahora: python3 build.py   para regenerar el archivo único.')


if __name__ == '__main__':
    main()
