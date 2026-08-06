/* ===========================================================================
 * app.js — Orquestación: PDF → imagen → OCR → nombre → ZIP.
 * Todo ocurre en el navegador; ningún archivo sale del computador.
 * =========================================================================== */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const E = window.Extract;

  // Tesseract arranca su worker desde un blob, así que las rutas tienen que
  // ser absolutas: una ruta relativa no se puede resolver desde ahí.
  const abs = p => new URL(p, location.href).href;

  /* --------------------------------------------------------------------- */
  /* Origen de los recursos                                                 */
  /*                                                                        */
  /* La app funciona de dos formas:                                         */
  /*  - carpeta normal: los .js y el modelo se cargan desde vendor/ y       */
  /*    tessdata/;                                                          */
  /*  - archivo único: todo viene empotrado en bloques <script              */
  /*    type="text/plain">, para poder publicarla como un solo HTML.        */
  /* --------------------------------------------------------------------- */

  const empotrado = id => {
    const n = document.getElementById(id);
    const t = n && n.textContent.trim();
    return t ? t : null;
  };
  const urlBlob = txt => URL.createObjectURL(new Blob([txt], { type: 'text/javascript' }));
  const desdeBase64 = b64 => {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  };

  const srcPdfWorker = empotrado('emp-pdf-worker');
  const srcTessWorker = empotrado('emp-tess-worker');
  const b64Spa = empotrado('emp-tess-spa');

  /* --------------------------------------------------------------------- */
  /* Workers: disponibles o no                                              */
  /*                                                                        */
  /* Abierta con doble clic (file://) la página queda en origen opaco y los  */
  /* navegadores bloquean los workers creados desde un blob. En vez de       */
  /* suponerlo, se comprueba al arrancar y la app se adapta.                 */
  /* --------------------------------------------------------------------- */

  let _hayWorkers = null;

  function hayWorkers() {
    if (_hayWorkers !== null) return _hayWorkers;
    _hayWorkers = new Promise(res => {
      // ?sinworkers=1 fuerza el modo degradado, para poder probarlo.
      if (/[?&]sinworkers=1/.test(location.search)) return res(false);
      let url = null;
      try {
        const b = new Blob(['self.onmessage=()=>self.postMessage(1)'], { type: 'text/javascript' });
        url = URL.createObjectURL(b);
        const w = new Worker(url);
        const cerrar = ok => {
          clearTimeout(t); try { w.terminate(); } catch (e) { /* nada */ }
          if (url) URL.revokeObjectURL(url);
          res(ok);
        };
        const t = setTimeout(() => cerrar(false), 4000);
        w.onmessage = () => cerrar(true);
        w.onerror = () => cerrar(false);
        w.postMessage(1);
      } catch (e) {
        if (url) URL.revokeObjectURL(url);
        res(false);
      }
    });
    return _hayWorkers;
  }

  /**
   * Prepara pdf.js. Sin workers no se rinde: si `globalThis.pdfjsWorker` ya
   * está definido, pdf.js ni intenta crear un Worker y usa ese manejador en
   * el hilo principal. Basta con evaluar aquí el código del worker —es un
   * UMD que se auto-registra, y solo se auto-arranca cuando no existe
   * `window`, así que en la página es inofensivo.
   */
  let _pdfListo = null;
  function prepararPdf() {
    if (_pdfListo) return _pdfListo;
    _pdfListo = (async () => {
      if (await hayWorkers()) {
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          srcPdfWorker ? urlBlob(srcPdfWorker) : abs('vendor/pdf.worker.min.js');
        return 'worker';
      }
      let fuente = srcPdfWorker;
      if (!fuente) {
        try { fuente = await (await fetch(abs('vendor/pdf.worker.min.js'))).text(); }
        catch (e) { fuente = null; }
      }
      if (fuente) {
        (0, eval)(fuente);                       // define globalThis.pdfjsWorker
        pdfjsLib.GlobalWorkerOptions.workerSrc = '';
        return 'hilo-principal';
      }
      pdfjsLib.GlobalWorkerOptions.workerSrc = abs('vendor/pdf.worker.min.js');
      return 'worker';
    })();
    return _pdfListo;
  }

  // En el archivo único, el núcleo WASM va concatenado dentro del worker, así
  // que Tesseract encuentra TesseractCore ya definido y no descarga nada.
  const OPCIONES_TESS = srcTessWorker
    ? { workerPath: urlBlob(srcTessWorker), corePath: '', gzip: true }
    : {
      workerPath: abs('vendor/worker.min.js'),
      corePath: abs('vendor'),
      langPath: abs('tessdata'),
      gzip: true,
    };

  // Tesseract v5 acepta el modelo como bytes, no solo como URL.
  const IDIOMA = b64Spa ? [{ code: 'spa', data: desdeBase64(b64Spa) }] : 'spa';

  /** Estado de la sesión actual. */
  const S = {
    archivos: [],      // File[]
    filas: [],         // resultados
    procesando: false,
    cancelado: false,
    scheduler: null,
    workers: [],
  };

  /* --------------------------------------------------------------------- */
  /* Capa de texto: la vía rápida                                           */
  /* --------------------------------------------------------------------- */

  /**
   * Devuelve el texto embebido de una página, si el PDF lo trae.
   *
   * El .exe rasterizaba cada página a 300 dpi y le pasaba OCR encima, sin
   * comprobar si el PDF ya tenía el texto adentro. Cuando lo tiene, leerlo
   * es unas doscientas veces más rápido y además exacto: se acaban los
   * "90094.1454-2" y los "REFA" que ensuciaban el log.
   *
   * pdf.js entrega fragmentos sueltos con su posición; hay que decidir dónde
   * van los espacios o "PONTON" se pega con lo que sigue.
   */
  async function leerCapaTexto(pdf, numPagina) {
    const pagina = await pdf.getPage(numPagina);
    const contenido = await pagina.getTextContent();
    let salida = '';
    let finPrevio = null, yPrevio = null;

    for (const it of contenido.items) {
      if (typeof it.str !== 'string') continue;
      const x = it.transform[4];
      const y = it.transform[5];
      const alto = Math.abs(it.transform[3]) || 10;

      if (yPrevio !== null) {
        if (Math.abs(y - yPrevio) > alto * 0.5) salida += ' ';        // otro renglón
        else if (x - finPrevio > alto * 0.22) salida += ' ';          // hueco entre palabras
      }
      salida += it.str;
      finPrevio = x + (it.width || 0);
      yPrevio = y;
      if (it.hasEOL) { salida += ' '; yPrevio = null; }
    }
    return salida;
  }

  /**
   * ¿Sirve la capa de texto? Un PDF escaneado suele traerla vacía, o con
   * cuatro caracteres sueltos de algún sello. Se exige algo de cuerpo y la
   * palabra sobre la que se ancla la extracción.
   */
  function capaUtil(t) {
    const n = E.normalizarTexto(t);
    return n.length >= 80 && n.indexOf('NIT') !== -1;
  }

  /* --------------------------------------------------------------------- */
  /* Imagen: render + preprocesado (respaldo por OCR)                       */
  /* --------------------------------------------------------------------- */

  /** Dibuja una página del PDF en un canvas a los dpi indicados. */
  async function renderizarPagina(pdf, numPagina, dpi) {
    const pagina = await pdf.getPage(numPagina);
    const viewport = pagina.getViewport({ scale: dpi / 72 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // intent 'print' hace que pdf.js encadene el render con promesas en lugar
    // de requestAnimationFrame. Sin esto el proceso se congela apenas el
    // usuario cambia de pestaña, porque rAF deja de dispararse en segundo plano.
    await pagina.render({ canvasContext: ctx, viewport, intent: 'print' }).promise;
    return canvas;
  }

  /**
   * Réplica del preprocesado del .exe original (PIL):
   * escala de grises → contraste 2.0 → filtro SHARPEN.
   * Se conserva igual porque la extracción está calibrada contra ese resultado.
   */
  function preprocesar(canvas) {
    const w = canvas.width, h = canvas.height, n = w * h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const imgData = ctx.getImageData(0, 0, w, h);
    const px = imgData.data;

    // 1. Gris con los mismos coeficientes que PIL convert("L").
    const gris = new Uint8ClampedArray(n);
    let suma = 0;
    for (let i = 0, j = 0; j < n; i += 4, j++) {
      const g = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
      gris[j] = g;
      suma += gris[j];
    }

    // 2. Contraste 2.0 alrededor de la media (ImageEnhance.Contrast).
    const media = Math.round(suma / n);
    for (let j = 0; j < n; j++) gris[j] = media + 2 * (gris[j] - media);

    // 3. SHARPEN de PIL: núcleo 3×3 [-2 … 32 … -2] / 16.
    const out = Uint8ClampedArray.from(gris);
    for (let y = 1; y < h - 1; y++) {
      const f = y * w;
      for (let x = 1; x < w - 1; x++) {
        const o = f + x;
        out[o] = (32 * gris[o]
          - 2 * (gris[o - w - 1] + gris[o - w] + gris[o - w + 1]
            + gris[o - 1] + gris[o + 1]
            + gris[o + w - 1] + gris[o + w] + gris[o + w + 1])) / 16;
      }
    }

    for (let i = 0, j = 0; j < n; i += 4, j++) {
      px[i] = px[i + 1] = px[i + 2] = out[j];
      px[i + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }

  /* --------------------------------------------------------------------- */
  /* Motor OCR                                                              */
  /* --------------------------------------------------------------------- */

  async function iniciarOcr(nHilos, alProgresar) {
    if (S.scheduler) return S.scheduler;
    alProgresar('Cargando el motor de reconocimiento (solo la primera vez)…');
    const scheduler = Tesseract.createScheduler();
    for (let i = 0; i < nHilos; i++) {
      const w = await Tesseract.createWorker(IDIOMA, 1, OPCIONES_TESS);
      await w.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK });
      scheduler.addWorker(w);
      S.workers.push(w);
      alProgresar(`Motor de reconocimiento listo (${i + 1}/${nHilos})…`);
    }
    S.scheduler = scheduler;
    return scheduler;
  }

  async function detenerOcr() {
    if (S.scheduler) { try { await S.scheduler.terminate(); } catch (e) { /* ignorar */ } }
    S.scheduler = null;
    S.workers = [];
  }

  /* --------------------------------------------------------------------- */
  /* Procesamiento de un archivo                                            */
  /* --------------------------------------------------------------------- */

  /**
   * @param obtenerScheduler función perezosa: el motor OCR solo se carga si
   *        algún archivo lo necesita de verdad. Si todos los cupones traen
   *        capa de texto, nunca se descargan los 9 MB del reconocedor.
   */
  async function procesarArchivo(file, cfg, obtenerScheduler) {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const maxPag = Math.min(pdf.numPages, 3);   // los cupones son de 1 página
    let ultimoTexto = '';
    let fuente = null;

    const armar = (texto, f) => {
      const r = E.procesar(texto, file.name, cfg.mes, cfg.anio);
      r.texto = texto;
      r.fuente = f;
      r.file = file;
      return r;
    };

    // 1. Capa de texto: instantánea y exacta cuando el PDF la trae.
    if (cfg.modo === 'auto') {
      for (let p = 1; p <= maxPag; p++) {
        const t = await leerCapaTexto(pdf, p);
        if (!capaUtil(t)) continue;
        ultimoTexto = t;
        fuente = 'texto';
        const r = armar(t, 'texto');
        if (r.nombre) return r;
      }
    }

    // 2. OCR sobre la página rasterizada. Requiere workers sí o sí: Tesseract
    //    no tiene modo de hilo principal.
    if (!(await hayWorkers())) {
      const r = armar(ultimoTexto, fuente);
      r.sinOcr = true;
      return r;
    }
    const scheduler = await obtenerScheduler();
    for (let p = 1; p <= maxPag; p++) {
      const canvas = preprocesar(await renderizarPagina(pdf, p, cfg.dpi));
      const { data } = await scheduler.addJob('recognize', canvas);
      canvas.width = canvas.height = 0;         // liberar memoria
      ultimoTexto = data.text || '';
      fuente = 'ocr';
      const r = armar(ultimoTexto, 'ocr');
      if (r.nombre) return r;
    }

    return armar(ultimoTexto, fuente);
  }

  /** Evita que dos cupones distintos terminen con el mismo nombre. */
  function resolverColisiones(filas) {
    const usados = new Map();
    for (const f of filas) {
      if (!f.nuevoNombre) continue;
      const clave = f.nuevoNombre.toLowerCase();
      if (!usados.has(clave)) { usados.set(clave, 1); continue; }
      const n = usados.get(clave);
      usados.set(clave, n + 1);
      f.nuevoNombre = f.nuevoNombre.replace(/\.pdf$/i, `_${n}.pdf`);
    }
  }

  /* --------------------------------------------------------------------- */
  /* Interfaz                                                               */
  /* --------------------------------------------------------------------- */

  function iniciarControles() {
    const selMes = $('mes');
    E.MESES.forEach((m, i) => {
      const o = document.createElement('option');
      o.value = m; o.textContent = m[0] + m.slice(1).toLowerCase();
      selMes.appendChild(o);
    });
    // Por defecto, el mes siguiente: es cuando se emiten los cupones.
    const hoy = new Date();
    const sig = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 1);
    selMes.value = E.MESES[sig.getMonth()];
    $('anio').value = String(sig.getFullYear());

    const selHilos = $('hilos');
    const sugerido = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    for (let i = 1; i <= 8; i++) {
      const o = document.createElement('option');
      o.value = String(i); o.textContent = String(i);
      selHilos.appendChild(o);
    }
    selHilos.value = String(sugerido);

    if (!('showDirectoryPicker' in window)) $('guardarCarpeta').classList.add('oculto');
    else $('guardarCarpeta').classList.remove('oculto');
  }

  function estado(msg) { $('estado').textContent = msg; }

  /**
   * Sin workers (típico al abrir el archivo con doble clic) la lectura de la
   * capa de texto funciona igual, pero el OCR no: Tesseract no puede correr
   * fuera de un worker. Conviene decirlo antes de que el usuario piense que
   * la herramienta falló.
   */
  function avisarSinWorkers() {
    if ($('sinWorkers')) return;
    const d = document.createElement('p');
    d.id = 'sinWorkers';
    d.className = 'aviso-degradado';
    d.textContent = 'Este navegador bloqueó el reconocimiento de imagen al abrir el '
      + 'archivo desde el disco. Los cupones que traen el texto adentro se procesan '
      + 'igual de bien; los que no, quedarán como «Sin nombre». Si necesitas el '
      + 'reconocimiento, prueba a abrir este mismo archivo con Firefox, que suele '
      + 'permitirlo.';
    $('estado').after(d);
  }

  /**
   * El avance se dibuja sobre el anillo de la marca: el círculo lleva
   * pathLength="100", así que el desfase del trazo es directamente el
   * porcentaje que falta.
   */
  function progreso(hechos, total) {
    const pct = total ? (100 * hechos / total) : 0;
    $('avance').style.strokeDashoffset = String(100 - pct);
  }

  function trabajando(si, titulo, sub) {
    $('zona').classList.toggle('trabajando', si);
    if (titulo !== undefined) $('zonaTitulo').textContent = titulo;
    if (sub !== undefined) $('zonaSub').textContent = sub;
  }

  function pintarResumen() {
    const c = { verificado: 0, revisar: 0, 'sin-nombre': 0 };
    S.filas.forEach(f => { c[f.estado] = (c[f.estado] || 0) + 1; });
    $('cTotal').textContent = S.filas.length;
    // El botón anuncia lo que realmente descarga.
    $('descargar').textContent = S.filas.length === 1 ? 'Descargar PDF' : 'Descargar ZIP';
    $('descargarCsv').classList.toggle('oculto', S.filas.length === 1);
    $('cVerif').textContent = c.verificado;
    $('cRevisar').textContent = c.revisar;
    $('cSin').textContent = c['sin-nombre'];
    // Un filtro sin resultados no se puede pulsar.
    $('f-verificado').disabled = !c.verificado;
    $('f-revisar').disabled = !c.revisar;
    $('f-sin-nombre').disabled = !c['sin-nombre'];
  }

  /* --------------------------------------------------------------------- */
  /* Filtros                                                                */
  /*                                                                        */
  /* Con 110 filas, lo único que hace falta de verdad es saltar a las pocas  */
  /* que piden atención. Por eso los contadores son los propios filtros.     */
  /* --------------------------------------------------------------------- */

  function aplicarFiltro(cual) {
    S.filtro = cual;
    for (const b of document.querySelectorAll('.filtro')) {
      b.setAttribute('aria-pressed', String(b.dataset.filtro === cual));
    }
    let visibles = 0;
    for (const tr of $('cuerpo').children) {
      if (tr.classList.contains('fila-ocr')) { tr.classList.add('oculta'); continue; }
      const ok = cual === 'todos' || tr.dataset.estado === cual;
      tr.classList.toggle('oculta', !ok);
      if (ok) visibles++;
    }
    $('vacio').classList.toggle('oculto', visibles > 0);
  }

  const ETIQUETA = {
    verificado: 'Verificado',
    revisar: 'Revisar',
    'sin-nombre': 'Sin nombre',
  };

  function pintarFila(f, idx) {
    const tr = document.createElement('tr');
    tr.dataset.idx = String(idx);
    tr.dataset.estado = f.estado;
    tr.className = 's-' + f.estado;

    const tdO = document.createElement('td');
    tdO.className = 'orig';
    tdO.textContent = f.original;

    const tdN = document.createElement('td');
    const inp = document.createElement('input');
    inp.type = 'text'; inp.className = 'nom';
    inp.value = f.nombre || '';
    inp.placeholder = 'Escribe el nombre…';
    inp.addEventListener('input', () => {
      const v = inp.value.trim();
      f.nombre = v || null;
      f.editado = true;
      f.nuevoNombre = (v && f.mes && f.anio) ? E.construirNombreArchivo(v, f.mes, f.anio) : null;
      f.estado = v ? (f.estadoOriginal === 'verificado' ? 'verificado' : 'revisar') : 'sin-nombre';
      resolverColisiones(S.filas);
      tr.dataset.estado = f.estado;
      tr.className = 's-' + f.estado;
      const et = tr.querySelector('.etq');
      et.className = 'etq e-' + f.estado;
      et.textContent = ETIQUETA[f.estado];
      pintarResumen();
    });
    // Enter salta al siguiente nombre visible: corregir varios seguidos sin
    // soltar el teclado.
    inp.addEventListener('keydown', ev => {
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      const campos = [...$('cuerpo').querySelectorAll('tr:not(.oculta) input.nom')];
      const i = campos.indexOf(inp);
      if (i > -1 && campos[i + 1]) { campos[i + 1].focus(); campos[i + 1].select(); }
      else inp.blur();
    });
    tdN.appendChild(inp);

    const tdP = document.createElement('td');
    tdP.textContent = f.mes ? `${f.mes[0]}${f.mes.slice(1).toLowerCase()} ${f.anio}` : '—';
    if (f.origenFecha === 'manual') tdP.title = 'Tomado de la configuración, no del nombre del archivo';

    const tdE = document.createElement('td');
    const etq = document.createElement('span');
    etq.className = 'etq e-' + f.estado;
    etq.textContent = ETIQUETA[f.estado];
    if (f.estado === 'verificado') etq.title = 'La cédula/NIT del documento coincide con la del nombre del archivo';
    if (f.estado === 'revisar') etq.title = 'No se pudo confirmar contra la cédula/NIT del nombre del archivo';
    tdE.appendChild(etq);

    const tdF = document.createElement('td');
    if (f.fuente) {
      const et = document.createElement('span');
      et.className = 'etq ' + (f.fuente === 'texto' ? 'e-texto' : 'e-ocr');
      et.textContent = f.fuente === 'texto' ? 'Texto' : 'OCR';
      et.title = f.fuente === 'texto'
        ? 'El PDF traía el texto adentro: lectura exacta, sin reconocimiento'
        : 'Sin capa de texto: se reconoció la imagen de la página';
      tdF.appendChild(et);
    } else {
      tdF.textContent = '—';
    }

    const tdV = document.createElement('td');
    const btn = document.createElement('button');
    btn.className = 'ver'; btn.textContent = 'ver';
    btn.addEventListener('click', () => {
      const sig = tr.nextElementSibling;
      if (sig && sig.classList.contains('fila-ocr')) { sig.remove(); return; }
      const trO = document.createElement('tr');
      trO.className = 'fila-ocr';
      const td = document.createElement('td');
      td.colSpan = 6; td.className = 'ocr';
      td.textContent = f.texto || '(sin texto)';
      trO.appendChild(td);
      tr.after(trO);
    });
    tdV.appendChild(btn);

    tr.append(tdO, tdN, tdP, tdE, tdF, tdV);
    return tr;
  }

  function pintarTabla() {
    const cuerpo = $('cuerpo');
    cuerpo.textContent = '';
    S.filas.forEach((f, i) => cuerpo.appendChild(pintarFila(f, i)));
    const hay = S.filas.length > 0;
    $('revision').classList.toggle('visible', hay);
    $('intake').classList.toggle('compacto', hay);
    aplicarFiltro(S.filtro || 'todos');
  }

  /* --------------------------------------------------------------------- */
  /* Flujo principal                                                        */
  /* --------------------------------------------------------------------- */

  async function procesarTodo() {
    if (S.procesando || !S.archivos.length) return;
    S.procesando = true; S.cancelado = false;
    $('procesar').disabled = true;
    $('cancelar').classList.remove('oculto');

    const cfg = {
      mes: $('mes').value,
      anio: $('anio').value.trim(),
      dpi: parseInt($('dpi').value, 10),
      modo: $('modo').value,
    };
    const nHilos = parseInt($('hilos').value, 10);

    S.filas = [];
    pintarTabla();
    pintarResumen();

    // El motor OCR se carga la primera vez que algún archivo lo pida. Si todos
    // traen capa de texto, no se descarga nunca.
    let promesaOcr = null;
    const obtenerScheduler = () => {
      if (!promesaOcr) promesaOcr = iniciarOcr(nHilos, estado);
      return promesaOcr;
    };

    const t0 = performance.now();
    try {
      const via = await prepararPdf();
      const conWorkers = await hayWorkers();
      if (!conWorkers) avisarSinWorkers();
      const total = S.archivos.length;
      let hechos = 0;

      progreso(0, total);
      trabajando(true, `Procesando ${total} cupones`, 'Puedes cambiar de pestaña sin que se detenga');
      estado(`Procesando 0 de ${total}…`);

      // Se lanzan de a nHilos para no agotar la memoria con canvases grandes.
      const cola = S.archivos.slice();
      const enCurso = new Set();

      const lanzar = () => {
        if (S.cancelado || !cola.length) return null;
        const file = cola.shift();
        const p = procesarArchivo(file, cfg, obtenerScheduler)
          .catch(err => ({
            original: file.name, nombre: null, metodo: null,
            mes: cfg.mes, anio: cfg.anio, estado: 'sin-nombre',
            origenFecha: 'manual', nuevoNombre: null, fuente: null,
            texto: 'Error: ' + (err && err.message ? err.message : err), file,
          }))
          .then(r => {
            enCurso.delete(p);
            r.estadoOriginal = r.estado;
            S.filas.push(r);
            hechos++;
            progreso(hechos, total);
            const seg = (performance.now() - t0) / 1000;
            const rest = hechos ? Math.round((seg / hechos) * (total - hechos)) : 0;
            estado(`Procesando ${hechos} de ${total}…  (quedan ~${rest}s)`);
            return r;
          });
        enCurso.add(p);
        return p;
      };

      for (let i = 0; i < nHilos; i++) lanzar();
      while (enCurso.size) {
        await Promise.race(enCurso);
        lanzar();
      }

      // Mantener el orden en que se seleccionaron los archivos.
      const orden = new Map(S.archivos.map((f, i) => [f.name, i]));
      S.filas.sort((a, b) => (orden.get(a.original) ?? 0) - (orden.get(b.original) ?? 0));
      resolverColisiones(S.filas);

      pintarTabla();
      pintarResumen();
      const seg = ((performance.now() - t0) / 1000).toFixed(0);
      const porTexto = S.filas.filter(f => f.fuente === 'texto').length;
      const porOcr = S.filas.filter(f => f.fuente === 'ocr').length;
      const desglose = porTexto && porOcr
        ? ` (${porTexto} por capa de texto, ${porOcr} por OCR)`
        : porTexto ? ' (todos por capa de texto, sin OCR)' : '';
      estado(S.cancelado
        ? `Cancelado. Se alcanzaron a procesar ${hechos} de ${total}.`
        : `Listo: ${total} archivos en ${seg}s${desglose}.`);
      trabajando(false,
        S.cancelado ? 'Proceso cancelado' : 'Listo — revisa los nombres abajo',
        'Arrastra otro lote para volver a empezar');
      if (!S.cancelado) $('revision').scrollIntoView({ block: 'start' });
    } catch (err) {
      estado('Error: ' + (err && err.message ? err.message : err));
      console.error(err);
    } finally {
      S.procesando = false;
      $('procesar').disabled = false;
      $('cancelar').classList.add('oculto');
      $('zona').classList.remove('trabajando');
      progreso(0, 0);
    }
  }

  /* --------------------------------------------------------------------- */
  /* Salidas: CSV, ZIP, carpeta                                             */
  /* --------------------------------------------------------------------- */

  function construirCsv() {
    const esc = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const filas = [['Archivo original', 'Nuevo nombre', 'Nombre detectado', 'Periodo',
      'Estado', 'Lectura', 'Metodo', 'Editado a mano', 'Documento en el archivo',
      'Documento leido']];
    for (const f of S.filas) {
      filas.push([
        f.original, f.nuevoNombre || '-', f.nombre || '-',
        f.mes ? `${f.mes} ${f.anio}` : '-',
        ETIQUETA[f.estado],
        f.fuente === 'texto' ? 'texto del PDF' : f.fuente === 'ocr' ? 'OCR' : '-',
        f.metodo || '-', f.editado ? 'si' : 'no',
        f.documentoArchivo || '-', (f.documentosTexto || []).join(' / ') || '-',
      ]);
    }
    return '﻿' + filas.map(r => r.map(esc).join(';')).join('\r\n');
  }

  function descargarBlob(blob, nombre) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nombre;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function sufijoPeriodo() {
    const f = S.filas.find(x => x.mes && x.anio);
    return f ? `${f.mes} ${f.anio}` : 'sin periodo';
  }

  /**
   * Con un único cupón, comprimir estorba: obliga a descomprimir para sacar un
   * solo archivo. Se descarga el PDF ya renombrado, tal cual.
   */
  async function descargar() {
    const listos = S.filas.filter(f => f.nuevoNombre && f.file);
    if (!listos.length) { estado('No hay ningún archivo con nombre para descargar.'); return; }

    if (S.filas.length === 1) {
      const f = listos[0];
      descargarBlob(f.file, f.nuevoNombre);
      estado(`Descargado: ${f.nuevoNombre}`);
      return;
    }

    const zip = new JSZip();
    for (const f of listos) zip.file(f.nuevoNombre, f.file);
    zip.file('reporte_renombrado.csv', construirCsv());
    estado('Comprimiendo…');
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    descargarBlob(blob, `Cupones renombrados ${sufijoPeriodo()}.zip`);
    estado(`ZIP generado con ${listos.length} archivos renombrados.`);
  }

  async function guardarEnCarpeta() {
    let dir;
    try {
      dir = await window.showDirectoryPicker({ mode: 'readwrite' });
    } catch (e) { return; }   // el usuario canceló
    let n = 0;
    for (const f of S.filas) {
      if (!f.nuevoNombre || !f.file) continue;
      const fh = await dir.getFileHandle(f.nuevoNombre, { create: true });
      const ws = await fh.createWritable();
      await ws.write(await f.file.arrayBuffer());
      await ws.close();
      n++;
      estado(`Guardando… ${n}`);
    }
    const fh = await dir.getFileHandle('reporte_renombrado.csv', { create: true });
    const ws = await fh.createWritable();
    await ws.write(construirCsv());
    await ws.close();
    estado(`Se guardaron ${n} archivos renombrados en la carpeta elegida.`);
  }

  /* --------------------------------------------------------------------- */
  /* Eventos                                                                */
  /* --------------------------------------------------------------------- */

  function aceptarArchivos(lista) {
    const pdfs = Array.from(lista).filter(f => /\.pdf$/i.test(f.name));
    if (!pdfs.length) { estado('No se encontraron archivos PDF.'); return; }
    S.archivos = pdfs;
    $('procesar').disabled = false;
    trabajando(false,
      `${pdfs.length} ${pdfs.length === 1 ? 'cupón listo' : 'cupones listos'}`,
      'Presiona Procesar, o arrastra otros para reemplazarlos');
    estado('');
  }

  function iniciarEventos() {
    const zona = $('zona'), entrada = $('entrada');

    // El input está dentro de la zona, así que su propio clic vuelve a burbujear
    // hasta aquí. Sin este filtro, entrada.click() se llama a sí mismo.
    zona.addEventListener('click', e => { if (e.target !== entrada) entrada.click(); });
    entrada.addEventListener('change', () => aceptarArchivos(entrada.files));

    ['dragenter', 'dragover'].forEach(ev => zona.addEventListener(ev, e => {
      e.preventDefault(); zona.classList.add('sobre');
    }));
    ['dragleave', 'drop'].forEach(ev => zona.addEventListener(ev, e => {
      e.preventDefault(); zona.classList.remove('sobre');
    }));
    zona.addEventListener('drop', e => {
      if (e.dataTransfer && e.dataTransfer.files) aceptarArchivos(e.dataTransfer.files);
    });

    $('procesar').addEventListener('click', procesarTodo);
    $('cancelar').addEventListener('click', () => {
      S.cancelado = true;
      estado('Cancelando… se terminarán los archivos en curso.');
    });
    $('descargar').addEventListener('click', descargar);
    $('descargarCsv').addEventListener('click',
      () => descargarBlob(new Blob([construirCsv()], { type: 'text/csv;charset=utf-8' }),
        `reporte_renombrado ${sufijoPeriodo()}.csv`));
    $('guardarCarpeta').addEventListener('click', guardarEnCarpeta);
    for (const b of document.querySelectorAll('.filtro')) {
      b.addEventListener('click', () => aplicarFiltro(b.dataset.filtro));
    }

    $('limpiar').addEventListener('click', () => {
      S.archivos = []; S.filas = []; S.filtro = 'todos';
      entrada.value = '';
      pintarTabla(); pintarResumen();
      $('procesar').disabled = true;
      trabajando(false, 'Arrastra aquí los cupones en PDF', 'o haz clic para seleccionarlos');
      estado('');
      window.scrollTo({ top: 0 });
    });

    window.addEventListener('beforeunload', e => {
      if (S.procesando) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  iniciarControles();
  iniciarEventos();
  window.__APP__ = S;
  window.__detenerOcr__ = detenerOcr;
})();
