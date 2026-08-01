#!/usr/bin/env python3
"""
Genera cupones de prueba con el mismo formato que los reales.

Los nombres y las cédulas son inventados. Lo que sí se conserva son los casos
que el .exe original no podía procesar, que es lo que estas pruebas verifican:

  1. nombre de persona corriente
  2. razón social con siglas y puntos ("S.A.S")
  3. razón social corta — el .exe exigía 8+ caracteres sin espacios
  4. nombre que termina en palabra de una sola letra
  5. eñe, y el bloque desordenado que el OCR produce en algunos cupones

Uso:  python3 generar-pdfs.py
"""
import os

SALIDA = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pdfs-prueba')

# (archivo, nombre, documento, desordenado)
CASOS = [
    ('6_1044820371_10_2025.pdf',  'RIVAS CARDONA MARTIN ELIAS',              '1044820371', False),
    ('240_903118742_01_2026.pdf', 'INVERSIONES DEL LLANO ORIENTAL S.A.S',    '903118742',  False),
    ('83_804552190_04_2026.pdf',  'VBM SAS',                                 '804552190',  False),
    ('16_902773415_12_2025.pdf',  'COMERCIALIZADORA PUERTO NUEVO DEL SUR S', '902773415',  False),
    ('130_94620518_11_2025.pdf',  'MUÑOZ CAÑAS WILDER',                      '94620518',   True),
]


def esc(s):
    return s.replace('\\', r'\\').replace('(', r'\(').replace(')', r'\)')


def a_latin1(s):
    out = []
    for ch in s:
        try:
            ch.encode('latin-1')
            out.append(ch)
        except UnicodeEncodeError:
            out.append('?')
    return ''.join(out)


def construir(nombre, documento, desordenado):
    # En algunos cupones el OCR devuelve el documento antes del nombre y
    # "NIT:" después; el caso 5 reproduce ese desorden.
    if desordenado:
        linea_nombre = 'CUPON DE PAGO N : %s | %s' % (documento, nombre)
        linea_nit = 'NIT: REFA : %s' % documento
    else:
        linea_nombre = 'CUPON DE PAGO %s' % nombre
        linea_nit = 'NIT: %s  |  REF1 : %s' % (documento, documento)

    lineas = [
        (60, 760, 13, 'BANCO CAJA SOCIAL'),
        (60, 742, 13, 'GRUPO ANDINO INMOBILIARIO S.A.S'),
        (60, 724, 13, 'CALLE 72 N 53 86 - BUCARAMANGA'),
        (60, 706, 13, 'NIT: 900941454-2'),
        (60, 676, 13, 'GRUPO ANDINO'),
        (60, 658, 13, 'ARRENDATARIO'),
        (60, 630, 14, linea_nombre),
        (60, 610, 13, linea_nit),
        (60, 586, 13, 'INMUEBLE NUMERO 101'),
        (60, 566, 13, 'VALOR TOTAL A PAGAR  1.850.000'),
    ]
    partes = ['BT /F1 12 Tf']
    for x, y, tam, txt in lineas:
        partes.append('/F1 %d Tf 1 0 0 1 %d %d Tm (%s) Tj'
                      % (tam, x, y, esc(a_latin1(txt))))
    partes.append('ET')
    return '\n'.join(partes)


def pdf_bytes(contenido):
    objs = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] '
        '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
        '<< /Length %d >>\nstream\n%s\nendstream'
        % (len(contenido.encode('latin-1', 'replace')), contenido),
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold '
        '/Encoding /WinAnsiEncoding >>',
    ]
    salida = bytearray(b'%PDF-1.4\n')
    offsets = []
    for i, o in enumerate(objs, start=1):
        offsets.append(len(salida))
        salida += ('%d 0 obj\n%s\nendobj\n' % (i, o)).encode('latin-1', 'replace')
    xref = len(salida)
    salida += ('xref\n0 %d\n' % (len(objs) + 1)).encode()
    salida += b'0000000000 65535 f \n'
    for off in offsets:
        salida += ('%010d 00000 n \n' % off).encode()
    salida += ('trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n'
               % (len(objs) + 1, xref)).encode()
    return bytes(salida)


os.makedirs(SALIDA, exist_ok=True)
for archivo, nombre, doc, desordenado in CASOS:
    with open(os.path.join(SALIDA, archivo), 'wb') as f:
        f.write(pdf_bytes(construir(nombre, doc, desordenado)))
    print('%-32s -> %s' % (archivo, nombre))
