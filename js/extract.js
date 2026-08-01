/* ===========================================================================
 * extract.js — Lógica de extracción del nombre del arrendatario.
 * Portada desde RenombradorPDF.exe, con las correcciones de la revisión.
 * Sin dependencias. Funciona en navegador y en Node (para las pruebas).
 * =========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Extract = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Palabras del membrete del cupón. Nunca forman parte del nombre por sí solas.
  const STOPWORDS = new Set([
    'CUPON', 'CUPÓN', 'DE', 'PAGO', 'GRUPO', 'ANDINO', 'INMOBILIARIO',
    'SAS', 'SA', 'BANCO', 'CAJA', 'SOCIAL', 'ARRENDATARIO', 'CLIENTE',
    'NOMBRE', 'RAZON', 'RAZÓN', 'REF', 'REF1', 'BUCARAMANGA', 'CALLE',
    'NIT', 'INMUEBLE', 'NUMERO', 'NÚMERO', 'TOTAL', 'VALOR',
  ]);

  const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO',
    'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];

  const LETRA = 'A-ZÁÉÍÓÚÜÑ';

  /* --------------------------------------------------------------------- */
  /* Normalización                                                          */
  /* --------------------------------------------------------------------- */

  /** Condensa los espacios y pasa todo a una sola línea en mayúsculas. */
  function normalizarTexto(t) {
    if (!t) return '';
    return t.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
  }

  /* --------------------------------------------------------------------- */
  /* Limpieza y validación de candidatos                                    */
  /* --------------------------------------------------------------------- */

  /**
   * Quita del candidato la basura que el OCR arrastra: signos sueltos,
   * números de referencia y el encabezado "CUPON DE PAGO".
   *
   * Corrige el bug que dejó 146 archivos como
   * "CUPON DE PAGO DE PAGO RIVAS CARDONA MARTIN ...": el .exe solo
   * quitaba el prefijo cuando empezaba exactamente por "PAGO ".
   */
  function limpiarCandidato(cad) {
    if (!cad) return '';
    let s = cad.replace(/\s+/g, ' ').trim();

    // A veces el OCR intercala el documento y separadores dentro del bloque,
    // p. ej. "Ñ : 94620518 | MUÑOZ CAÑAS WILDER" o ": 804552190 VBM SAS".
    // Nos quedamos con el último segmento que tenga al menos dos palabras.
    const reLetra = new RegExp('[' + LETRA + ']');
    const segs = s.replace(/\d{5,}/g, '|').split('|')
      .map(p => p.trim()).filter(Boolean);
    for (let i = segs.length - 1; i >= 0; i--) {
      const palabras = segs[i].split(/\s+/).filter(w => reLetra.test(w));
      if (palabras.length >= 2) { s = segs[i]; break; }
    }

    // Basura al inicio: ":", "|", números de referencia sueltos.
    s = s.replace(new RegExp('^[^' + LETRA + ']+'), '');

    // Números largos y separadores al final.
    s = s.replace(/[\s|:,;.-]*\d{4,}[\s|:,;.-]*$/, '');
    s = s.replace(new RegExp('[^' + LETRA + '.]+$'), '');

    // Encabezado del cupón. Solo se quita la secuencia que termina en PAGO,
    // para no mutilar apellidos que empiezan por "DE" (ej. "DE LA CRUZ").
    s = s.replace(/^(?:CUP[OÓ]N\s+DE\s+PAGO|DE\s+PAGO|PAGO)\s+/, '');

    return s.trim();
  }

  /**
   * Descarta candidatos que son solo palabras genéricas del documento.
   *
   * Cambios respecto al .exe:
   *  - El original tenía `any(...) and all(...)`, donde `all` ya implica `any`.
   *  - El mínimo de 8 caracteres descartaba empresas reales como "VBM SAS"
   *    (6 caracteres). Bajado a 5.
   */
  function esNombreValido(cad) {
    if (!cad) return false;
    const tokens = cad.split(/\s+/).filter(Boolean);
    if (tokens.length < 2) return false;
    if (tokens.every(t => STOPWORDS.has(t.replace(/\./g, '')))) return false;
    return cad.replace(/\s/g, '').length >= 5;
  }

  /* --------------------------------------------------------------------- */
  /* Estrategias de extracción, de más a menos confiable                    */
  /* --------------------------------------------------------------------- */

  /**
   * 1. Anclada a la estructura del cupón.
   *
   * El documento siempre dice:
   *   ... ARRENDATARIO CUPON DE PAGO <NOMBRE> NIT: <documento> | REF1 ...
   *
   * Tomar lo que hay entre esos dos anclajes es mucho más fiable que el
   * "hasta 5 palabras antes de NIT" del original, y resuelve los casos que
   * el .exe nunca pudo: nombres que terminan en sigla ("... CESAR S",
   * "... DEL LLANO ORIENTAL S.A.S").
   */
  function porAnclaje(texto) {
    const m = texto.match(/CUP[OÓ]N\s+DE\s+PAGO\s*(.{2,90}?)\s*NIT\b/);
    if (!m) return null;
    const cand = limpiarCandidato(m[1]);
    return esNombreValido(cand) ? cand : null;
  }

  /**
   * 2. Lookahead (la del .exe), con los tokens siguientes relajados a 1+
   *    caracteres y admitiendo puntos, para no cortar en "S.A.S".
   */
  function porLookahead(texto) {
    const re = new RegExp(
      '([' + LETRA + ']{2,}(?:\\s+[' + LETRA + '.]+){1,5})\\s*(?:\\d{6,}\\s*)?(?=NIT\\b)'
    );
    const m = texto.match(re);
    if (!m) return null;
    const cand = limpiarCandidato(m[1]);
    return esNombreValido(cand) ? cand : null;
  }

  /** 3. Última secuencia de palabras en mayúsculas antes del primer NIT. */
  function porRetroceso(texto) {
    const idx = texto.indexOf('NIT');
    if (idx === -1) return null;
    const izq = texto.slice(0, idx).trim();
    const re = new RegExp('([' + LETRA + ']{2,}(?:\\s+[' + LETRA + '.]+){1,5})', 'g');
    const todos = izq.match(re);
    if (!todos || !todos.length) return null;
    const cand = limpiarCandidato(todos[todos.length - 1]);
    return esNombreValido(cand) ? cand : null;
  }

  /** 4. Heurística: el candidato válido más cercano por delante de un NIT. */
  function porHeuristica(texto) {
    const nitIdx = texto.indexOf('NIT');
    if (nitIdx === -1) return null;
    const re = new RegExp('\\b([' + LETRA + ']{2,}(?:\\s+[' + LETRA + '.]+){1,5})\\b', 'g');
    const candidatos = [];
    let m;
    while ((m = re.exec(texto)) !== null) {
      const cand = limpiarCandidato(m[1]);
      if (!esNombreValido(cand)) continue;
      const dist = nitIdx - (m.index + m[0].length);
      if (dist > 0 && dist < 120) candidatos.push([dist, cand]);
    }
    if (!candidatos.length) return null;
    candidatos.sort((a, b) => a[0] - b[0]);
    return candidatos[0][1];
  }

  const ESTRATEGIAS = [
    ['anclaje', porAnclaje],
    ['lookahead', porLookahead],
    ['retroceso', porRetroceso],
    ['heuristica', porHeuristica],
  ];

  /**
   * Extrae el nombre del arrendatario del texto OCR de un cupón.
   * @returns {{nombre: string, metodo: string}|null}
   */
  function extraerNombre(textoCrudo) {
    const texto = normalizarTexto(textoCrudo);
    if (!texto) return null;
    for (const [metodo, fn] of ESTRATEGIAS) {
      const nombre = fn(texto);
      if (nombre) return { nombre, metodo };
    }
    return null;
  }

  /* --------------------------------------------------------------------- */
  /* Verificación cruzada por documento (cédula / NIT)                      */
  /* --------------------------------------------------------------------- */

  /** Todos los números de 6+ dígitos que aparecen tras un "NIT" en el texto. */
  function documentosEnTexto(textoCrudo) {
    const texto = normalizarTexto(textoCrudo);
    const out = [];
    const re = /NIT[^0-9]{0,12}(\d[\d.\s-]{5,20})/g;
    let m;
    while ((m = re.exec(texto)) !== null) {
      const limpio = m[1].replace(/[^0-9]/g, '');
      if (limpio.length >= 6) out.push(limpio);
    }
    return out;
  }

  /**
   * Metadatos que vienen en el nombre del archivo original.
   * Formato observado en el 99,3 % de los casos:
   *   {consecutivo}_{documento}_{MM}_{YYYY}.pdf   ej. 280_10432871_08_2026.pdf
   */
  function metadatosDeNombre(nombreArchivo) {
    const base = nombreArchivo.replace(/\.[Pp][Dd][Ff]$/, '');
    const m = base.match(/^(\d+)[_\s]+([\d\s]+?)[_\s]+(\d{2})[_\s]+(\d{4})$/);
    if (!m) return null;
    const mesNum = parseInt(m[3], 10);
    if (mesNum < 1 || mesNum > 12) return null;
    return {
      consecutivo: m[1],
      documento: m[2].replace(/\s/g, ''),
      mes: MESES[mesNum - 1],
      anio: m[4],
    };
  }

  /* --------------------------------------------------------------------- */
  /* Nombre de archivo final                                                */
  /* --------------------------------------------------------------------- */

  /** Quita los caracteres que Windows no admite en un nombre de archivo. */
  function sanitizarNombreArchivo(s) {
    return s
      .replace(/[\\/:*?"<>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[.\s]+|[.\s]+$/g, '')
      .trim();
  }

  function construirNombreArchivo(nombre, mes, anio) {
    return sanitizarNombreArchivo(`CUPON DE PAGO ${nombre} ${mes} ${anio}`) + '.pdf';
  }

  /**
   * Procesa el texto OCR de un cupón junto con su nombre de archivo original.
   *
   * estado:
   *   'verificado'  el documento leído por OCR coincide con el del nombre
   *   'revisar'     hay nombre, pero no se pudo confirmar contra el documento
   *   'sin-nombre'  no se pudo extraer nada
   */
  function procesar(textoOcr, nombreArchivoOriginal, mesManual, anioManual) {
    const meta = metadatosDeNombre(nombreArchivoOriginal);
    const res = extraerNombre(textoOcr);
    const docsTexto = documentosEnTexto(textoOcr);

    const mes = (meta && meta.mes) || mesManual || null;
    const anio = (meta && meta.anio) || anioManual || null;

    if (!res) {
      return {
        original: nombreArchivoOriginal, nombre: null, metodo: null,
        mes, anio, estado: 'sin-nombre', origenFecha: meta ? 'archivo' : 'manual',
        documentoArchivo: meta ? meta.documento : null, documentosTexto: docsTexto,
        nuevoNombre: null,
      };
    }

    const verificado = !!(meta && meta.documento && docsTexto.includes(meta.documento));

    return {
      original: nombreArchivoOriginal,
      nombre: res.nombre,
      metodo: res.metodo,
      mes, anio,
      estado: verificado ? 'verificado' : 'revisar',
      origenFecha: meta ? 'archivo' : 'manual',
      documentoArchivo: meta ? meta.documento : null,
      documentosTexto: docsTexto,
      nuevoNombre: (mes && anio) ? construirNombreArchivo(res.nombre, mes, anio) : null,
    };
  }

  return {
    STOPWORDS, MESES,
    normalizarTexto, limpiarCandidato, esNombreValido,
    porAnclaje, porLookahead, porRetroceso, porHeuristica,
    extraerNombre, documentosEnTexto, metadatosDeNombre,
    sanitizarNombreArchivo, construirNombreArchivo, procesar,
  };
});
