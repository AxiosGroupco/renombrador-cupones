#!/usr/bin/env python3
"""
Genera fixtures-anon.js a partir de fixtures.js.

fixtures.js sale del log real y trae nombres y cédulas de arrendatarios de
Grupo Andino: no puede ir a un repositorio público. Este script lo reemplaza
por datos inventados conservando todo lo que le da valor a la prueba:

  - la misma cantidad de palabras por nombre y la misma longitud de cada una
  - los puntos de las siglas ("S.A.S"), las palabras de una sola letra
    ("... CESAR S") y las eñes
  - el ruido del OCR (bloques desordenados, "Ñ : 12345 |", separadores)
  - la correspondencia entre la cédula del nombre de archivo y la del texto,
    que es lo que ejercita la verificación cruzada

La sustitución es determinista: la misma palabra real siempre da la misma
palabra falsa, así que un arrendatario que aparece en varios meses sigue
apareciendo como la misma persona.
"""
import hashlib
import json
import os
import re
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
ENTRADA = os.path.join(AQUI, 'fixtures.js')
SALIDA = os.path.join(AQUI, 'fixtures-anon.js')

# Vocabulario del membrete: no identifica a nadie y hay que conservarlo tal
# cual, porque las estrategias de extracción se apoyan en él.
PROTEGIDAS = {
    'BANCO', 'CAJA', 'SOCIAL', 'GRUPO', 'ANDINO', 'INMOBILIARIO', 'S.A.S',
    'SAS', 'SA', 'S.A', 'CALLE', 'BUCARAMANGA', 'NIT', 'ARRENDATARIO',
    'CUPON', 'CUPÓN', 'DE', 'PAGO', 'REF', 'REF1', 'REFA', 'INMUEBLE',
    'NUMERO', 'NÚMERO', 'TOTAL', 'VALOR', 'CLIENTE', 'NOMBRE', 'RAZON',
    'PDF', 'N', 'A', 'Y', 'EL', 'LA', 'DEL', 'LOS', 'LAS',
}

CONS = 'BCDFGLMNPRSTV'
VOC = 'AEIOU'


def semilla(txt):
    return int(hashlib.sha256(txt.encode('utf-8')).hexdigest()[:12], 16)


def palabra_falsa(real):
    """Inventa una palabra del mismo largo, conservando puntos y eñes."""
    s = semilla('w:' + real)
    out = []
    i = 0
    for ch in real:
        if ch == '.':
            out.append('.')
            continue
        if ch == 'Ñ':
            out.append('Ñ')
            i += 1
            continue
        # alterna consonante/vocal para que se lea como un nombre
        if i % 2 == 0:
            out.append(CONS[(s >> (i * 3)) % len(CONS)])
        else:
            out.append(VOC[(s >> (i * 3)) % len(VOC)])
        i += 1
    return ''.join(out)


def numero_falso(real):
    """Inventa un documento del mismo largo, que nunca empiece por cero."""
    s = semilla('n:' + real)
    d = [str((s >> (k * 4)) % 10) for k in range(len(real))]
    if d[0] == '0':
        d[0] = '7'
    return ''.join(d)


def main():
    if not os.path.exists(ENTRADA):
        sys.exit('No existe %s. Es el archivo con los datos reales; no se '
                 'versiona a propósito.' % ENTRADA)

    crudo = open(ENTRADA, encoding='utf-8').read()
    datos = json.loads(crudo[crudo.index('['):crudo.rindex(']') + 1])

    mapa_pal, mapa_num = {}, {}

    def sust_palabra(m):
        p = m.group(0)
        # El punto final (de ".pdf", o de fin de frase) no es parte del nombre:
        # si se incluyera, "SANTAMARIA" y "SANTAMARIA." darían falsos distintos.
        cola = ''
        while p.endswith('.'):
            p, cola = p[:-1], cola + '.'
        if not p or p in PROTEGIDAS or not re.search(r'[A-ZÁÉÍÓÚÑ]', p):
            return p + cola
        if p not in mapa_pal:
            mapa_pal[p] = palabra_falsa(p)
        return mapa_pal[p] + cola

    def sust_numero(m):
        n = m.group(0)
        if n not in mapa_num:
            mapa_num[n] = numero_falso(n)
        return mapa_num[n]

    def limpiar(t):
        if not t:
            return t
        t = re.sub(r'\d{6,}', sust_numero, t)
        return re.sub(r'[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ.]*', sust_palabra, t)

    salida = []
    for c in datos:
        salida.append({
            'archivo': limpiar(c['archivo']),
            'ocr': limpiar(c['ocr']),
            'viejo': limpiar(c.get('viejo')),
        })

    with open(SALIDA, 'w', encoding='utf-8') as f:
        f.write('// Datos INVENTADOS, derivados de fixtures.js conservando su\n'
                '// estructura. Generado por anonimizar.py — no editar a mano.\n')
        f.write('window.FIXTURES = ')
        json.dump(salida, f, ensure_ascii=False, indent=0)
        f.write(';\n')

    print('escrito %s' % SALIDA)
    print('  casos            : %d' % len(salida))
    print('  palabras mapeadas: %d' % len(mapa_pal))
    print('  documentos       : %d' % len(mapa_num))


if __name__ == '__main__':
    main()
