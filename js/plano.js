/* ===========================================================================
 * plano.js — Archivo plano de recaudo para el banco (A15 y A25).
 *
 * Copia literal de la lógica de `generador_cupones_inmobiliaria.html`
 * (réplica del módulo Inmobiliaria de Axios: parser BCS, reglas de
 * consolidación, normalización de fechas y formato de salida).
 *
 * NO SE MODIFICA NADA DEL FORMATO NI DE LAS REGLAS DE NEGOCIO:
 *   - cabecera  01,nit,0,convenio,YYYYMMDD,total
 *   - líneas    02,nit,,fechaA,fechaB,valorA.00,valorB.00
 *   - saltos CRLF
 *   - regla 1: mismo NIT en varios locales -> se suman
 *   - regla 2: mismo NIT + mismo local con valores distintos -> conflicto
 *   - fechas normalizadas al valor más frecuente del lote
 *
 * ÚNICO CAMBIO respecto al original, en RE_NIT_ARRENDATARIO: se admite
 * espacio tras "NIT:". El original exigía el dígito pegado
 * (`/NIT:(\d...`), pero los cupones traen "NIT: 10432871" con espacio, y por
 * eso no reconocía ninguno: probado contra 8 cupones de agosto de 2026, los 8
 * fallaban con "sin NIT arrendatario". Con el espacio admitido, los mismos 8
 * se leen completos. Está marcado abajo con [CAMBIO].
 * =========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Plano = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ── Parser (réplica de parser_cupon.py) ────────────────────────────── */

  const MESES = {
    ENE: 1, FEB: 2, MAR: 3, ABR: 4, MAY: 5, JUN: 6, JUL: 7, AGO: 8,
    SEP: 9, SET: 9, SEPT: 9, OCT: 10, NOV: 11, DIC: 12,
  };

  function parsearFechaEs(s) {
    if (!s) return null;
    const m = /^\s*(\d{1,2})[-/]([A-Za-z]+)[-/](\d{4})\s*/.exec(s);
    if (!m) return null;
    const dia = parseInt(m[1], 10);
    const g2 = m[2];
    let mesStr = g2.length > 3 ? g2.toUpperCase().slice(0, 3) : g2.toUpperCase();
    const mesClave = (mesStr in MESES) ? mesStr : mesStr.slice(0, 3);
    const mes = MESES[mesClave];
    if (mes == null) return null;
    const anio = parseInt(m[3], 10);
    const d = new Date(Date.UTC(anio, mes - 1, dia));
    if (d.getUTCFullYear() !== anio || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) {
      return null;
    }
    return { y: anio, m: mes, d: dia };
  }

  const fechaKey = f => `${f.y}-${String(f.m).padStart(2, '0')}-${String(f.d).padStart(2, '0')}`;
  const fechaYMD = f => `${f.y}${String(f.m).padStart(2, '0')}${String(f.d).padStart(2, '0')}`;

  function limpiarValor(s) {
    if (!s) return null;
    const limpio = s.replace(/[^\d]/g, '');
    if (!limpio) return null;
    const n = parseInt(limpio, 10);
    return Number.isNaN(n) ? null : n;
  }

  const RE_NIT_INFORMANTE = /NIT:\s+(\d{6,12})-(\d)/g;
  //                                  ↓↓ [CAMBIO] admite el espacio de "NIT: 10432871"
  const RE_NIT_ARRENDATARIO = /NIT:\s*(\d[\d ]{5,14})(?:-(\d))?/g;
  const RE_NOMBRE = /ARRENDATARIO\s+CUPON\s+DE\s+PAGO\s*\n([^\n]+?)\s+NIT:/i;
  const RE_FV_OPORTUNO = /PAGUE\s+HASTA[:\s]*(\d{1,2}[-/]\w+[-/]\d{4})\s+VALOR[:\s]*\$?\s*([\d.,]+)/i;
  const RE_FV_15 = /(?<![\d(])(15[-/]\w+[-/]\d{4})\s+([\d.,]+)/;
  const RE_FV_25 = /(?<![\d(])(25[-/]\w+[-/]\d{4})\s+([\d.,]+)/;
  const RE_INMUEBLE_REF1 = /REF1\s+COD\s+INMUEBLE[:\s]*(\w+)/i;
  const RE_INMUEBLE_LOCAL = /LOCAL\s+(\w+)/i;

  function extraerNitArrendatario(texto) {
    const informante = new Set();
    let m;
    RE_NIT_INFORMANTE.lastIndex = 0;
    while ((m = RE_NIT_INFORMANTE.exec(texto)) !== null) {
      informante.add(m[1]);
      informante.add(`${m[1]}${m[2]}`);
    }
    RE_NIT_ARRENDATARIO.lastIndex = 0;
    while ((m = RE_NIT_ARRENDATARIO.exec(texto)) !== null) {
      const digitos = m[1].replace(/ /g, '');
      const dv = m[2];
      const candidato = dv ? `${digitos}${dv}` : digitos;
      if (informante.has(candidato) || informante.has(digitos)) continue;
      return candidato;
    }
    return null;
  }

  function extraerInmueble(texto) {
    let m = RE_INMUEBLE_REF1.exec(texto);
    if (m) return m[1].trim();
    m = RE_INMUEBLE_LOCAL.exec(texto);
    if (m) return m[1].trim();
    return null;
  }

  function parsearCupon(texto, archivoOrigen) {
    const nit = extraerNitArrendatario(texto);
    if (!nit) return { ok: false, archivo: archivoOrigen, motivo: 'sin NIT arrendatario' };
    const mN = RE_NOMBRE.exec(texto);
    const nombre = mN ? mN[1].trim() : '';

    const mOp = RE_FV_OPORTUNO.exec(texto);
    const valOp = mOp ? limpiarValor(mOp[2]) : null;
    const fOp = mOp ? parsearFechaEs(mOp[1]) : null;
    const m15 = RE_FV_15.exec(texto);
    const val15 = m15 ? limpiarValor(m15[2]) : null;
    const f15 = m15 ? parsearFechaEs(m15[1]) : null;
    const m25 = RE_FV_25.exec(texto);
    const val25 = m25 ? limpiarValor(m25[2]) : null;
    const f25 = m25 ? parsearFechaEs(m25[1]) : null;

    if (valOp == null || val15 == null || val25 == null || !fOp || !f15 || !f25) {
      return {
        ok: false, archivo: archivoOrigen,
        motivo: `campos faltantes (op=${valOp}/${fOp ? fechaKey(fOp) : null} `
          + `r15=${val15}/${f15 ? fechaKey(f15) : null} `
          + `r25=${val25}/${f25 ? fechaKey(f25) : null})`,
      };
    }
    return {
      ok: true,
      cupon: {
        nit_o_cedula: nit, nombre,
        valor_oportuno: valOp, valor_recargo_15: val15, valor_recargo_25: val25,
        fecha_oportuno: fOp, fecha_recargo_15: f15, fecha_recargo_25: f25,
        identificador_local: extraerInmueble(texto),
        archivo_origen: archivoOrigen,
      },
    };
  }

  /**
   * Texto del PDF reconstruido POR LÍNEAS, agrupando por coordenada Y.
   *
   * El parser de arriba depende de los saltos de línea (RE_NOMBRE busca el
   * nombre en el renglón siguiente a "ARRENDATARIO CUPON DE PAGO", y las
   * fechas de recargo van en su propio renglón junto al valor). Por eso no
   * sirve el texto de una sola línea que usa el renombrado.
   */
  async function textoPorLineas(pdf) {
    const partes = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      const items = tc.items
        .filter(it => it.str !== undefined)
        .map(it => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0 }));
      items.sort((a, b) => (b.y - a.y) || (a.x - b.x));
      const lineas = [];
      let cur = null, curY = null;
      for (const it of items) {
        if (curY === null || Math.abs(it.y - curY) > 2.2) {
          cur = []; lineas.push(cur); curY = it.y;
        }
        cur.push(it);
      }
      partes.push(lineas.map(linea => {
        linea.sort((a, b) => a.x - b.x);
        let s = ''; let prevEnd = null;
        for (const it of linea) {
          if (prevEnd !== null && (it.x - prevEnd) > 1.0) s += ' ';
          s += it.str;
          prevEnd = it.x + it.w;
        }
        return s;
      }).join('\n'));
    }
    return partes.join('\n');
  }

  /* ── Consolidación (réplica de agregador.py) ────────────────────────── */

  const localClave = loc => (loc != null && loc !== '') ? loc : 'SIN_LOCAL';

  function normalizarFechasAModo(cupones) {
    if (!cupones.length) return cupones;
    function modo(getter) {
      const cnt = new Map();
      for (const c of cupones) {
        const f = getter(c); const k = fechaKey(f);
        if (cnt.has(k)) cnt.get(k).count++;
        else cnt.set(k, { count: 1, val: f });
      }
      let best = null;
      for (const e of cnt.values()) { if (best === null || e.count > best.count) best = e; }
      return best.val;
    }
    const mOp = modo(c => c.fecha_oportuno);
    const m15 = modo(c => c.fecha_recargo_15);
    const m25 = modo(c => c.fecha_recargo_25);
    return cupones.map(c => Object.assign({}, c, {
      fecha_oportuno: mOp, fecha_recargo_15: m15, fecha_recargo_25: m25,
    }));
  }

  function consolidar(cupones) {
    const porNitLocal = new Map();
    for (const c of cupones) {
      const k = c.nit_o_cedula + ' ' + localClave(c.identificador_local);
      if (!porNitLocal.has(k)) porNitLocal.set(k, []);
      porNitLocal.get(k).push(c);
    }

    const conflictos = [];
    const porNit = new Map();
    for (const [k, grupo] of porNitLocal) {
      const nit = k.split(' ')[0];
      const local = k.split(' ')[1];
      const distintos = new Set(grupo.map(c =>
        `${c.valor_oportuno}|${c.valor_recargo_15}|${c.valor_recargo_25}`));
      if (distintos.size > 1) {
        conflictos.push({
          nit_o_cedula: nit,
          identificador_local: local === 'SIN_LOCAL' ? null : local,
          candidatos: grupo.map(c => ({
            archivo_origen: c.archivo_origen, nombre: c.nombre,
            valor_oportuno: c.valor_oportuno, valor_recargo_15: c.valor_recargo_15,
            valor_recargo_25: c.valor_recargo_25,
          })),
        });
        continue;
      }
      if (!porNit.has(nit)) porNit.set(nit, []);
      porNit.get(nit).push(grupo[0]);
    }

    const lineas = [];
    const multiLocal = [];
    for (const [nit, lista] of porNit) {
      if (lista.length === 1) {
        const c = lista[0];
        lineas.push({
          nit_o_cedula: nit,
          valor_oportuno: c.valor_oportuno, valor_recargo_15: c.valor_recargo_15,
          valor_recargo_25: c.valor_recargo_25,
          fecha_oportuno: c.fecha_oportuno, fecha_recargo_15: c.fecha_recargo_15,
          fecha_recargo_25: c.fecha_recargo_25,
          cupones_origen: [c.archivo_origen],
          locales_consolidados: c.identificador_local ? [c.identificador_local] : [],
        });
      } else {
        const primer = lista[0];
        const tOp = lista.reduce((s, c) => s + c.valor_oportuno, 0);
        const t15 = lista.reduce((s, c) => s + c.valor_recargo_15, 0);
        const t25 = lista.reduce((s, c) => s + c.valor_recargo_25, 0);
        const locales = lista.filter(c => c.identificador_local).map(c => c.identificador_local);
        lineas.push({
          nit_o_cedula: nit,
          valor_oportuno: tOp, valor_recargo_15: t15, valor_recargo_25: t25,
          fecha_oportuno: primer.fecha_oportuno, fecha_recargo_15: primer.fecha_recargo_15,
          fecha_recargo_25: primer.fecha_recargo_25,
          cupones_origen: lista.map(c => c.archivo_origen),
          locales_consolidados: locales,
        });
        multiLocal.push({ nit_o_cedula: nit, locales, cupones: lista.map(c => c.archivo_origen) });
      }
    }
    return { lineas, conflictos, multiLocal };
  }

  function aplicarResoluciones(cupones, resoluciones) {
    const descartar = new Set();
    const elegido = new Map();
    for (const claveStr of Object.keys(resoluciones)) {
      const idx = claveStr.indexOf('__');
      const nit = claveStr.slice(0, idx);
      const local = claveStr.slice(idx + 2);
      elegido.set(nit + ' ' + local, resoluciones[claveStr]);
      descartar.add(nit + ' ' + local);
    }
    const salida = [];
    for (const c of cupones) {
      const k = c.nit_o_cedula + ' ' + localClave(c.identificador_local);
      if (descartar.has(k)) {
        if (c.archivo_origen === elegido.get(k)) salida.push(c);
      } else {
        salida.push(c);
      }
    }
    return salida;
  }

  /* ── Generador TXT (réplica de generador_txt.py) ────────────────────── */

  const fmtValor = v => `${v}.00`;

  function construirCabecera(nitBenef, convenio, fechaCab, totalLineas) {
    return ['01', nitBenef, '0', convenio, fechaYMD(fechaCab), String(totalLineas)].join(',');
  }
  function construirLinea02(nit, fechaA, fechaB, valorA, valorB) {
    return ['02', nit, '', fechaYMD(fechaA), fechaYMD(fechaB), fmtValor(valorA), fmtValor(valorB)].join(',');
  }
  function generarTxtA15(lineas, nitBenef, convenio, fechaCab) {
    const out = [construirCabecera(nitBenef, convenio, fechaCab, lineas.length + 1)];
    for (const l of lineas) {
      out.push(construirLinea02(l.nit_o_cedula, l.fecha_oportuno, l.fecha_recargo_15,
        l.valor_oportuno, l.valor_recargo_15));
    }
    return out.join('\r\n') + '\r\n';
  }
  function generarTxtA25(lineas, nitBenef, convenio, fechaCab) {
    const out = [construirCabecera(nitBenef, convenio, fechaCab, lineas.length + 1)];
    for (const l of lineas) {
      out.push(construirLinea02(l.nit_o_cedula, l.fecha_recargo_25, l.fecha_recargo_25,
        l.valor_recargo_25, l.valor_recargo_25));
    }
    return out.join('\r\n') + '\r\n';
  }

  return {
    parsearFechaEs, fechaKey, fechaYMD, limpiarValor,
    extraerNitArrendatario, extraerInmueble, parsearCupon, textoPorLineas,
    localClave, normalizarFechasAModo, consolidar, aplicarResoluciones,
    construirCabecera, construirLinea02, generarTxtA15, generarTxtA25,
  };
});
