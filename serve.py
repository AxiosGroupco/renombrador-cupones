#!/usr/bin/env python3
"""Servidor local para desarrollo y pruebas.  python3 serve.py [puerto]"""
import os
import sys
import http.server
import socketserver

RAIZ = os.path.dirname(os.path.abspath(__file__))
PUERTO = int(sys.argv[1]) if len(sys.argv) > 1 else 8787


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=RAIZ, **kw)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s\n" % (fmt % args))


socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("127.0.0.1", PUERTO), Handler) as httpd:
    sys.stderr.write("Sirviendo %s en http://127.0.0.1:%d\n" % (RAIZ, PUERTO))
    httpd.serve_forever()
