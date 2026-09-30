(function () {
  'use strict';

  var DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  var DIAS_C = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  var DIAS_UP = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'];
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var MESES_C = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var BASE_EDU = 'https://americano.educalinks.com.ec/';
  /* Base de la API: vacía cuando el backend sirve este frontend;
     URL absoluta cuando el frontend vive en Netlify (ver js/api-config.js). */
  var API = window.API_BASE || '';

  /* fetch hacia la API: en modo hibrido (Netlify + API externa) hay que
     incluir credentials para que viaje la cookie de sesion cross-site. */
  function apiFetch(url, opts) {
    opts = opts || {};
    if (!opts.headers) opts.headers = { 'Accept': 'application/json' };
    if (API) opts.credentials = 'include';
    return fetch(API + url, opts);
  }

  var LS = 'agenda_cfg';
  var LS_CACHE = 'agenda_cache';
  var LS_HECHAS = 'agenda_hechas';
  var LS_NP = 'agenda_np';
  var LS_REC = 'agenda_rec';
  var LS_LEIDOS = 'agenda_leidos';
  var LS_FAV = 'agenda_favoritos';
  var LS_NOTIF = 'agenda_notificados';

  function $(s, c) { return (c || document).querySelector(s); }
  function $$(s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function marcar(texto, term) {
    var t = esc(texto);
    if (!term) return t;
    var q = esc(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!q) return t;
    return t.replace(new RegExp('(' + q + ')', 'gi'), '<mark>$1</mark>');
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fechaISO(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseLocal(s) {
    s = String(s || '').trim();
    if (!s) return new Date(NaN);
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    var d = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2}))?/);
    if (d) return new Date(+d[3], +d[2] - 1, +d[1], +(d[4] || 0), +(d[5] || 0));
    return new Date(s);
  }
  function esExamen(t) { return /examen|evaluaci|composici|prueba|quiz|quíz/i.test(t || ''); }
  function esCal(s) { var n = parseFloat(String(s).replace(',', '.')); return isNaN(n) ? null : n; }
  function fmtNum(x, dec) { return (x == null) ? '—' : Number(x).toFixed(dec == null ? 2 : dec); }
  function aMin(h) {
    if (!h) return null;
    var p = String(h).split(':');
    return (+p[0]) * 60 + (+(p[1] || 0));
  }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function iniSemana(d) { var x = new Date(d); var k = (x.getDay() + 6) % 7; x.setDate(x.getDate() - k); return x; }
  function numSemana(d) {
    var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var dayn = (t.getUTCDay() + 6) % 7;
    t.setUTCDate(t.getUTCDate() - dayn + 3);
    var firstThursday = t.valueOf();
    t.setUTCMonth(0, 1);
    if (t.getUTCDay() !== 4) t.setUTCMonth(0, 1 + ((4 - t.getUTCDay()) + 7) % 7);
    return 1 + Math.ceil((firstThursday - t) / (7 * 24 * 3600 * 1000));
  }
  function fmtCorta(d) { return (d.getDate()) + ' ' + MESES_C[d.getMonth()]; }
  function fmtDia(d) { return DIAS[d.getDay()] + ', ' + d.getDate() + ' de ' + MESES[d.getMonth()]; }
  function diffDias(a, b) { var x = new Date(a.getFullYear(), a.getMonth(), a.getDate()); var y = new Date(b.getFullYear(), b.getMonth(), b.getDate()); return Math.round((x - y) / 86400000); }
  function absoluto(u) { return /^https?:\/\//i.test(u || '') ? u : BASE_EDU + String(u || '').replace(/^\.{1,2}\//, '').replace(/^\//, ''); }

  var DEFAULTS = {
    tema: 22,
    dark: null,
    meta: 9,
    riesgo: 6,
    ordenNotas: 'promedio',
    agrupar: 'dia',
    ordenSem: 'hora',
    ocultarHechas: true,
    calVista: 'grilla',
    horarioVista: 'tabla',
    modoSem: 'semana',
    densidad: 'comoda',
    fuente: 'auto',
    contraste: false,
    metaSemanal: 10,
    pomoFocus: 25,
    pomoPause: 5,
    digest: true
  };
  var cfg = Object.assign({}, DEFAULTS);

  function guardarLS(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function leerLS(k, def) { try { var v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } }
  function cargarCfg() { try { var r = JSON.parse(localStorage.getItem(LS) || '{}'); cfg = Object.assign({}, DEFAULTS, r); } catch (e) { cfg = Object.assign({}, DEFAULTS); } }
  function guardarCfg() { guardarLS(LS, cfg); }

  var HECHAS = leerLS(LS_HECHAS, {});
  var HECHAS_TS = leerLS('agenda_hechas_ts', {});
  var NP = leerLS(LS_NP, {});
  var REC = leerLS(LS_REC, {});
  var LEIDOS = leerLS(LS_LEIDOS, []);
  var FAV = leerLS(LS_FAV, {});
  var NOTIFICADOS = leerLS(LS_NOTIF, {});

  function esLeido(clave) { return LEIDOS.indexOf(clave) >= 0; }
  function marcarLeido(clave) { if (!esLeido(clave)) { LEIDOS.push(clave); guardarLS(LS_LEIDOS, LEIDOS); } }

  var state = {
    datos: null,
    vista: 'inicio',
    semana: 0,
    mes: 0,
    histMes: 0,
    activo: false,
    fragil: false,
    ultCarga: 0,
    perfil: 'alumno'
  };

  var timers = { vivo: null, rec: null, nov: null, pomo: null };
  var notaActual = null;
  var notaNueva = false;
  var recActual = null;
  var diaActual = null;
  var campanaAbierta = false;
  var busquedaAbierta = false;
  var materiaActual = null;
  var examenActual = null;
  var flashCola = [];
  var flashActual = null;
  var flashGirada = false;

  /* badge de la PWA con pendientes urgentes (mañana + atrasadas) */
  function actualizarBadge() {
    if (!navigator.setAppBadge || !state.datos) return;
    var pend = pendientesActivos();
    var n = pend.filter(function (e) { var d = diasRestantes(e); return d === 1 || (d != null && d < 0); }).length;
    try {
      if (n) navigator.setAppBadge(n);
      else navigator.clearAppBadge();
    } catch (e) {}
  }

  function toast(msj, tipo) {
    var c = document.createElement('div');
    c.className = 'toast' + (tipo === 'err' ? ' err' : '');
    c.textContent = msj;
    $('#toasts').appendChild(c);
    setTimeout(function () { c.classList.add('salir'); }, 2600);
    setTimeout(function () { if (c.parentNode) c.parentNode.removeChild(c); }, 3100);
  }

  function notificacionPermitida() {
    return ('Notification' in window) && Notification.permission === 'granted';
  }
  function pedirPermiso() {
    if (!('Notification' in window)) { toast('Tu navegador no soporta notificaciones.'); return; }
    if (Notification.permission === 'denied') { toast('Notificaciones bloqueadas en el navegador.', 'err'); return; }
    Notification.requestPermission().then(function (p) {
      if (p === 'granted') toast('Notificaciones activadas 🔔');
      else toast('Sin permiso de notificaciones.');
    });
  }

  function hexAHsl(hex) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    var r = parseInt(m[1], 16) / 255, g = parseInt(m[2], 16) / 255, b = parseInt(m[3], 16) / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    var h = 0, s = 0, l = (mx + mn) / 2;
    if (d) {
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
  }

  var PRESETS_ACENTO = [
    { n: 'Naranja', h: 22, s: 100, l: 50 },
    { n: 'Ámbar', h: 38, s: 100, l: 48 },
    { n: 'Lima', h: 82, s: 70, l: 42 },
    { n: 'Verde', h: 158, s: 80, l: 40 },
    { n: 'Teal', h: 178, s: 85, l: 38 },
    { n: 'Cian', h: 195, s: 100, l: 45 },
    { n: 'Azul', h: 215, s: 100, l: 50 },
    { n: 'Indigo', h: 245, s: 85, l: 55 },
    { n: 'Morado', h: 268, s: 80, l: 55 },
    { n: 'Rosa', h: 330, s: 90, l: 52 },
    { n: 'Rojo', h: 8, s: 90, l: 52 },
    { n: 'Slate', h: 222, s: 35, l: 45 }
  ];

  function aplicarVisuales() {
    var r = document.documentElement;
    if (cfg.temaModo === 'claro') cfg.dark = false;
    else if (cfg.temaModo === 'oscuro') cfg.dark = true;
    else if (cfg.dark === null) {
      cfg.dark = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
    if (cfg.accentLibre) {
      var hsl = hexAHsl(cfg.accentLibre);
      if (hsl) {
        r.style.setProperty('--a-h', hsl.h);
        r.style.setProperty('--a-s', Math.max(60, hsl.s) + '%');
        r.style.setProperty('--a-l', Math.max(38, Math.min(62, hsl.l)) + '%');
      }
    } else if (cfg.temaS && cfg.temaL) {
      r.style.setProperty('--a-h', cfg.tema);
      r.style.setProperty('--a-s', cfg.temaS + '%');
      r.style.setProperty('--a-l', cfg.temaL + '%');
    } else {
      r.style.setProperty('--a-h', cfg.tema);
      r.style.setProperty('--a-s', '100%');
      r.style.setProperty('--a-l', '50%');
    }
    r.classList.toggle('oscuro', !!cfg.dark);
    aplicarVisualesExtra();
  }

  function eventoPorId(id) {
    if (!state.datos) return null;
    var todo = agendaTodo();
    for (var i = 0; i < todo.length; i++) {
      if (String(todo[i].id) === String(id)) return todo[i];
    }
    return null;
  }
  function eventosDia(d) {
    if (!state.datos) return [];
    var iso = fechaISO(d);
    return agendaTodo().filter(function (e) { return String(e.fecha_inicio || '') === iso; });
  }
  function sisColor(n) {
    var nota = esCal(n);
    if (nota == null) return '';
    if (nota >= cfg.meta) return 'verde';
    if (nota >= cfg.meta - 1) return 'ambar';
    return 'rojo';
  }
  function colorNota(n) {
    var s = sisColor(n);
    return s === 'verde' ? 'var(--verde)' : s === 'ambar' ? 'var(--ambar)' : s === 'rojo' ? 'var(--rojo)' : 'var(--acento)';
  }
  function badgeNota(n) {
    var nota = esCal(n);
    if (nota == null) return '';
    return '<span class="badge nota ' + sisColor(nota) + '">' + esc(n) + '</span>';
  }

  function accionesEvento(id, compacta, esPersonal) {
    var h = HECHAS[id] === true;
    var tieneNp = !!NP[id];
    var tieneRec = REC[id] ? Number(REC[id]) || REC[id] : 0;
    var star = FAV['e:' + id];
    var subtn = (SUBT[id] || []).length;
    var icoDet = compacta ? '<span class="np-mark"></span>' : '';
    if (compacta) {
      /* cards compactas (bloques de Inicio, Semana): solo lo esencial */
      return '<span class="acc">' +
        '<button class="acc-btn ' + (h ? 'on' : '') + '" data-accion="hecha" data-id="' + esc(id) + '" title="' + (h ? 'Quitar hecha' : 'Hecha') + '">✓</button>' +
        (esPersonal ? '' :
          '<button class="acc-btn ' + (star ? 'on' : '') + '" data-accion="ev-star" data-id="' + esc(id) + '" title="Marcar como importante">⭐</button>' +
          '<button class="acc-btn ' + (tieneRec ? 'on' : '') + '" data-accion="rec" data-id="' + esc(id) + '" title="Recordatorio">⏰</button>') +
        '</span>';
    }
    return '<span class="acc">' +
      '<button class="acc-btn ' + (h ? 'on' : '') + '" data-accion="hecha" data-id="' + esc(id) + '" title="' + (h ? 'Quitar hecha' : 'Hecha') + '">✓</button>' +
      (esPersonal ?
        '<button class="acc-btn" data-accion="pt-del" data-id="' + esc(id) + '" title="Eliminar">🗑️</button>' :
        '<button class="acc-btn share" data-accion="ev-share" data-id="' + esc(id) + '" title="Compartir">🔗</button>' +
        '<button class="acc-btn" data-accion="ev-ics" data-id="' + esc(id) + '" title="Agregar a mi calendario">📅</button>') +
      '<button class="acc-btn ' + (star ? 'on' : '') + '" data-accion="ev-star" data-id="' + esc(id) + '" title="Marcar como importante">⭐</button>' +
      '<button class="acc-btn" data-accion="subt-open" data-id="' + esc(id) + '" title="Sub-tareas (checklist)">☑' + (subtn ? '<span class="subt-prog" style="margin-left:.15rem">' + subtn + '</span>' : '') + '</button>' +
      (esPersonal ? '' :
        '<button class="acc-btn ' + (tieneNp ? 'on' : '') + '" data-accion="np" data-id="' + esc(id) + '" title="Nota personal">✎</button>' +
        '<button class="acc-btn ' + (tieneRec ? 'on' : '') + '" data-accion="rec" data-id="' + esc(id) + '" title="Recordatorio">⏰</button>') +
      icoDet + '</span>';
  }

  /* ================= PRIORIDADES (jerarquía AHORA→MAÑANA→SEMANA→PRÓXIMO) ===== */
  function diasRestantes(ev) {
    if (!ev || !ev.fecha_inicio) return null;
    var d = parseLocal(ev.fecha_inicio);
    if (isNaN(d.getTime())) return null;
    var hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    d.setHours(0, 0, 0, 0);
    return diffDias(d, hoy);
  }
  function prioridadDe(ev) {
    var n = diasRestantes(ev);
    if (n == null) return 'proximo';
    if (n < 0) return 'ahora';       // atrasada: atención inmediata
    if (n === 0) return 'ahora';     // hoy
    if (n === 1) return 'manana';   // mañana
    if (n <= 7) return 'semana';    // esta semana
    return 'proximo';
  }
  function prioClase(ev) { return 'pr-' + prioridadDe(ev); }
  function prioCuenta(ev) {
    var n = diasRestantes(ev);
    if (n == null) return '';
    if (n < 0) return '<span class="cuenta-viva atras" data-cd="' + esc(ev.fecha_inicio) + '">⚠ ' + Math.abs(n) + 'd atrasada</span>';
    return '<span class="cuenta-viva u' + (n === 0 ? 0 : n === 1 ? 1 : n <= 7 ? 2 : 2) + '" data-cd="' + esc(ev.fecha_inicio) + '">' + esc(faltaTexto(ev)) + '</span>';
  }

  /* cuenta regresiva viva: "HOY · 5 h", "en 2d 3h", "atrasada 3d" */
  function faltaTexto(ev) {
    var n = diasRestantes(ev);
    if (n == null) return '';
    if (n < 0) return '⚠ ' + Math.abs(n) + 'd atrasada';
    if (n === 0) {
      var d = parseLocal(ev.fecha_inicio);
      if (!isNaN(d.getTime())) return 'HOY';
      return 'HOY';
    }
    if (n === 1) return 'mañana';
    if (n <= 7) return 'en ' + n + ' días';
    return fmtCorta(parseLocal(ev.fecha_inicio));
  }
  function faltaPreciso(ev) {
    var d = parseLocal(ev.fecha_inicio);
    if (isNaN(d.getTime())) return '';
    var ms = d.getTime() - Date.now();
    if (ms >= 0) {
      var dias = Math.floor(ms / 86400000);
      var horas = Math.floor((ms % 86400000) / 3600000);
      if (dias >= 1) return (dias + 'd ' + horas + 'h');
      var mins = Math.floor((ms % 3600000) / 60000);
      return horas + 'h ' + (mins < 10 ? '0' : '') + mins + 'm';
    }
    return '⚠ ' + Math.abs(Math.floor(ms / 86400000)) + 'd';
  }
  var cdUltimo = 0;
  function refrescarCuentas() {
    var ahora = Date.now();
    if (ahora - cdUltimo < 30000) return;
    cdUltimo = ahora;
    $$('.cuenta-viva[data-cd]').forEach(function (el) {
      var ev = { fecha_inicio: el.dataset.cd };
      var d = parseLocal(el.dataset.cd);
      if (!isNaN(d.getTime())) {
        var ms = d.getTime() - Date.now();
        var n = diasRestantes(ev);
        if (n != null && n >= 0 && n <= 1) {
          el.textContent = (n === 0 ? 'HOY · ' : 'en ') + faltaPreciso(ev);
        }
      }
    });
  }

  /* ---------- compartir actividades (Web Share API) ---------- */
  function detallePanelPorId(id) {
    var panel = (state.datos && state.datos.panel) || {};
    var listas = ['por_vencer', 'atrasadas', 'por_iniciar', 'calificadas'];
    for (var i = 0; i < listas.length; i++) {
      var arr = panel[listas[i]] || [];
      for (var j = 0; j < arr.length; j++) {
        if (String(arr[j].id) === String(id)) return arr[j];
      }
    }
    return null;
  }
  function textoEvento(ev, conDetalle) {
    var d = parseLocal(ev.fecha_inicio);
    var t = '📘 ' + (ev.materia || 'Actividad') + ' — ' + ev.titulo +
      '\n📅 ' + (isNaN(d.getTime()) ? (ev.fecha_inicio || 'sin fecha') : fmtDia(d));
    if (ev.calificacion != null && String(ev.calificacion).trim() !== '') t += '\n📊 Nota: ' + ev.calificacion;
    if (conDetalle) {
      var det = detallePanelPorId(ev.id);
      if (det && det.detalle) t += '\n📝 ' + det.detalle;
    }
    t += '\n— compartido desde EducaFix ⚡';
    return t;
  }
  function compartirEvento(id) {
    var ev = eventoPorId(id);
    if (!ev) { toast('No se encontró la actividad.', 'err'); return; }
    var texto = textoEvento(ev, true);
    if (navigator.share) {
      navigator.share({ title: ev.titulo, text: texto }).then(function () {
        toast('✓ Compartido');
      }).catch(function () {});
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(texto).then(function () {
        toast('📋 Actividad copiada: pégala en WhatsApp, correo, etc.');
      }).catch(function () { toast('No se pudo copiar.', 'err'); });
    } else {
      toast('Tu navegador no soporta compartir.', 'err');
    }
  }
  function compartirDia(iso) {
    var evs = eventosDia(parseLocal(iso));
    if (!evs.length) { toast('Nada que compartir ese día.'); return; }
    var texto = '📅 ' + fmtDia(parseLocal(iso)) + ' — mi día en EducaFix ⚡\n\n' +
      evs.slice(0, 10).map(function (e) { return '• ' + (e.materia || '') + ': ' + e.titulo; }).join('\n') +
      (evs.length > 10 ? '\n… y ' + (evs.length - 10) + ' más' : '');
    if (navigator.share) navigator.share({ title: 'Mi día', text: texto }).catch(function () {});
    else if (navigator.clipboard) navigator.clipboard.writeText(texto).then(function () { toast('📋 Resumen del día copiado'); });
  }
  function compartirMateria(nombre) {
    if (!state.datos) return;
    var res = ((state.datos.resumen || {}).materias || []).filter(function (m) { return clavesIguales(m.materia, nombre); })[0];
    var pend = pendientesActivos().filter(function (e) { return clavesIguales(e.materia, nombre); });
    var det = notasDetMateria(nombre);
    var texto = '📚 ' + nombre + ' — mi resumen en EducaFix ⚡\n';
    if (res && res.promedio != null) texto += '📊 Promedio actual: ' + res.promedio + '\n';
    if (det.length) texto += '🏆 Último periodo oficial: ' + det[det.length - 1].m.total + '\n';
    var doc = docenteDe(nombre);
    if (doc) texto += '👨‍🏫 Docente: ' + doc + '\n';
    if (pend.length) texto += '📝 Pendientes (' + pend.length + '):\n' + pend.slice(0, 5).map(function (e) { return '  • ' + e.titulo + (e.fecha_inicio ? ' (' + e.fecha_inicio + ')' : ''); }).join('\n') + '\n';
    if (navigator.share) navigator.share({ title: nombre, text: texto }).catch(function () {});
    else if (navigator.clipboard) navigator.clipboard.writeText(texto).then(function () { toast('📋 Resumen de la materia copiado'); });
  }

  function icsActividad(id) {
    var ev = eventoPorId(id);
    if (!ev || !ev.fecha_inicio) { toast('La actividad no tiene fecha.', 'err'); return; }
    var ini = parseLocal(ev.fecha_inicio);
    var fin = parseLocal(ev.fecha_fin || ev.fecha_inicio);
    var finExcl = addDays(fin, 1);
    function f(d) { return fechaISO(d).replace(/-/g, ''); }
    var ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//EducaFix//ES\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\n' +
      'BEGIN:VEVENT\r\nUID:' + ev.id + '@educafix\r\n' +
      'DTSTAMP:' + f(new Date()) + 'T000000Z\r\n' +
      'DTSTART;VALUE=DATE:' + f(ini) + '\r\nDTEND;VALUE=DATE:' + f(finExcl) + '\r\n' +
      'SUMMARY:' + icsEsc(ev.materia + ': ' + ev.titulo) + '\r\n' +
      'DESCRIPTION:' + icsEsc('Desde EducaFix') + '\r\n' +
      'BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT16H\r\nDESCRIPTION:' + icsEsc(ev.titulo) + '\r\nEND:VALARM\r\n' +
      'END:VEVENT\r\nEND:VCALENDAR\r\n';
    descargar('actividad_' + fechaISO(new Date()) + '.ics', ics, 'text/calendar');
    toast('📅 Evento .ics descargado — ábrelo para añadirlo a tu calendario');
  }

  function cardEvento(ev, opts) {
    opts = opts || {};
    var id = ev.id;
    var hecha = HECHAS[id] === true;
    var enProg = HECHAS[id] === 'progreso';
    var colBorde = ev.personal ? 'var(--ambar)' : (opts.color || colorMateria(ev.materia));
    var priCls = opts.prioridades ? ' ' + prioClase(ev) : '';
    return '<div class="card' + (hecha ? ' hecha' : '') + (enProg ? ' progreso' : '') + (ev.personal ? ' personal' : '') + (opts.compacta ? ' compacta' : '') +
      (opts.favorita ? ' resaltada' : '') + priCls + '" style="border-left-color:' + colBorde + '">' +
      '<div class="info">' +
      '<div class="materia">' +
      (ev.personal ?
        '✏️ MIS PENDIENTES' + (ev.materia && ev.materia !== 'Personal' ? ' · ' + esc(ev.materia) : '') :
        chipMateria(ev.materia) + esc(ev.materia || 'General')) +
      (esExamen(ev.titulo) ? ' · <span style="color:var(--rojo)">EXAMEN</span>' : '') +
      (esImportante(id) ? ' · ⭐' : '') + '</div>' +
      '<div class="titulo">' + (opts.q ? marcar(ev.titulo, opts.q) : esc(ev.titulo)) + '</div>' +
      '<div class="fecha-min">' + (opts.extra || '') + esc(ev.fecha_inicio || 'Sin fecha') +
      (ev.periodo_codi ? ' · ' + esc(ev.periodo_codi) : '') + '</div>' +
      '</div>' +
      '<span class="chips-der">' + (opts.prioridades ? prioCuenta(ev) : '') + badgeNota(ev.calificacion) +
      (opts.detalle ? '' : accionesEvento(id, opts.compacta, !!ev.personal)) +
      '</span>' +
      '</div>';
  }

  function separar(events) {
    var pend = []; var gin = []; var hoy = new Date();
    events.forEach(function (e) {
      if (e.calificacion == null || String(e.calificacion).trim() === '') { pend.push(e); }
      else {
        var d = parseLocal(e.fecha_inicio);
        if (isNaN(d.getTime())) gin.push(e);
        else if (diffDias(d, hoy) < 0) gin.push(e);
        else pend.push(e);
      }
    });
    return { pendientes: pend, gradeados: gin };
  }

  function ordenarEventos(lista) {
    var mezcla = lista.slice(0).sort(function (a, b) {
      var ca = esCal(a.calificacion), cb = esCal(b.calificacion);
      if (cfg.ordenSem === 'materia') {
        var m = String(a.materia || '').localeCompare(String(b.materia || ''));
        if (m !== 0) return m;
      }
      if ((ca == null) !== (cb == null)) return ca == null ? -1 : 1;
      return String(a.titulo || '').localeCompare(String(b.titulo || ''));
    });
    return mezcla;
  }

  function skeleton() {
    return '<div class="skel" style="height:76px"></div>'.repeat(3) +
      '<div class="skel" style="height:120px"></div>';
  }

  function renderEn(idEl, html) { var el = document.getElementById(idEl); if (el) el.innerHTML = html; }

  function autoActivas() {
    $$('.tab, .bnav-btn').forEach(function (b) {
      b.classList.toggle('activa', b.dataset.tab === state.vista);
    });
    $$('.vista').forEach(function (v) { v.classList.toggle('activa', v.id === 'vista-' + state.vista); });
  }

  function cambiarTab(tab) {
    if (state.perfil === 'docente' && tab === 'inicio') tab = 'dinicio';
    if (tab === 'calendario') {         /* compatibilidad: calendario vive en Semana→Mes */
      cfg.modoSem = 'mes'; guardarCfg();
      tab = 'semana';
    }
    state.vista = tab;
    cerrarBusqueda();
    cerrarCampana();
    cerrarAcentos();
    autoActivas();
    renderVistaActual();
  }

  function renderVistaActual() {
    if (!state.activo) return;
    try {
      if (state.perfil === 'docente') {
        if (state.vista === 'inicio' || state.vista === 'dinicio') renderDInicio();
        else if (state.vista === 'dclases') renderDClases();
        else if (state.vista === 'dhorario') renderDHorario();
        else if (state.vista === 'comunicados') renderComunicados();
        else if (state.vista === 'mas') renderDMas();
      } else if (state.vista === 'inicio') renderInicio();
      else if (state.vista === 'semana') renderSemana();
      else if (state.vista === 'materias') renderMaterias();
      else if (state.vista === 'pendientes') renderPendientes();
      else if (state.vista === 'rendimiento') renderRendimiento();
      else if (state.vista === 'mas') renderMas();
      else if (state.vista === 'calendario') renderCalendario();
      else if (state.vista === 'evaluaciones') renderEvaluaciones();
      else if (state.vista === 'comunicados') renderComunicados();
      else if (state.vista === 'documentos') renderDocumentos();
      else if (state.vista === 'estudio') renderEstudio();
    } catch (e) {
      console.error('Error pintando la vista', e);
      var cont = document.getElementById('contenido-' + state.vista);
      if (cont) cont.innerHTML = '<div class="vacio err" style="text-align:left"><strong>Algo salio mal al mostrar esta vista.</strong><br>' +
        '<small style="white-space:pre-wrap;word-break:break-all">' + esc(String(e && e.stack || e)) + '</small>' +
        '<div style="margin-top:.6rem"><button class="btn" data-accion="reintentar">↻ Reintentar</button> ' +
        '<button class="btn ghost" data-accion="limpiar-cache">🗑️ Borrar datos guardados</button></div></div>';
      var f = $('#franja');
      f.classList.add('err');
      f.innerHTML = '⚠ Error en la vista: ' + esc(String(e && e.message || e));
    }
  }

  var retryTimer = null;

  function scheduleRetry(activo) {
    if (!state.activo) activo = false;
    if (retryTimer && !activo) { clearInterval(retryTimer); retryTimer = null; return; }
    if (!retryTimer && activo) {
      retryTimer = setInterval(function () { cargar({ silencioso: true }); }, 20000);
    }
  }

  function aplicarDatos(datos, estado, o) {
    o = o || {};
    state.datos = datos;
    state.ultCarga = Date.now();
    var banner = $('#banner-offline');
    var franja = $('#franja');
    var detalle = state.errores && Object.keys(state.errores).length
      ? ' — ' + state.errores[Object.keys(state.errores)[0]]
      : '';
    if (estado === 'ok') {
      state.fragil = false;
      guardarLS(LS_CACHE, datos);
      banner.classList.add('oculto');
      franja.classList.remove('err');
      franja.innerHTML = '✓ Datos actualizados';
      scheduleRetry(false);
      actualizarBadge();
    } else if (estado === 'parcial') {
      state.fragil = true;
      banner.classList.remove('oculto');
      banner.textContent = '⚠ Algunas secciones no se pudieron actualizar. Reintentando… · ✅ Reintentar';
      franja.classList.add('err');
      franja.innerHTML = '⚠ Datos parciales';
      scheduleRetry(true);
    } else if (estado === 'offline') {
      state.fragil = true;
      banner.classList.remove('oculto');
      banner.textContent = '📴 Sin conexión con la app o con Educalinks — mostrando datos guardados. Reintentando… · ✅ Reintentar' + detalle;
      franja.classList.add('err');
      franja.innerHTML = '✗ Sin conexión' + detalle;
      scheduleRetry(true);
    } else if (estado === 'fallo') {
      state.fragil = true;
      banner.classList.add('oculto');
      franja.classList.add('err');
      franja.innerHTML = '✗ No se pudo cargar. Pulsa R o toca el aviso.' + detalle;
      scheduleRetry(!o.silencioso);
    }
    if (state.activo) { autoActivas(); renderVistaActual(); }
  }

  function cargar(opciones) {
    var o = opciones || {};
    var franja = $('#franja');
    if (franja && franja.lastChild && franja.lastChild.classList && franja.lastChild.classList.contains('spi')) {
      franja.innerHTML = '<span class="spi"></span> Cargando…';
    }
    var cache = leerLS(LS_CACHE, null);
    var ok = {};
    state.errores = {};

    function uno(nombre, url, extraer) {
      return apiFetch(url, { headers: { 'Accept': 'application/json' } })
        .then(function (r) {
          if (r.status === 401) { var e = new Error('sesion'); e.status = 401; throw e; }
          if (!r.ok) { var e2 = new Error('HTTP ' + r.status); e2.status = r.status; throw e2; }
          return r.json();
        })
        .then(function (j) { ok[nombre] = extraer ? extraer(j) : j; })
        .catch(function (err) {
          if (err.status === 401) throw err;
          state.errores[nombre] = url + ' → ' + (err.message || 'error');
          console.warn('No se pudo cargar', nombre, err);
          if (cache && cache[nombre] != null) ok[nombre] = cache[nombre];
        });
    }

    var NOMBRES = ['agenda', 'horario', 'mensajes', 'circulares', 'resumen', 'panel', 'faltas'];

    return Promise.all([
      uno('agenda', 'api/agenda?todas=true', function (j) { return j.eventos || []; }),
      uno('horario', 'api/horario', function (j) { return j.bloques || []; }),
      uno('mensajes', 'api/mensajes', function (j) { return j.mensajes || []; }),
      uno('circulares', 'api/circulares', function (j) { return j.circulares || []; }),
      uno('resumen', 'api/resumen', null),
      uno('panel', 'api/panel', null),
      uno('faltas', 'api/asistencia', null)
    ]).then(function () {
      var faltasVacio = { disponible: false, eventos: [], resumen: {} };
      var faltan = NOMBRES.filter(function (n) { return ok[n] == null; });
      if (faltan.length) {
        if (cache) return aplicarDatos({
          agenda: ok.agenda || cache.agenda || [],
          horario: ok.horario || cache.horario || [],
          mensajes: ok.mensajes || cache.mensajes || [],
          circulares: ok.circulares || cache.circulares || [],
          resumen: ok.resumen || cache.resumen || { general: {}, materias: [] },
          panel: ok.panel || cache.panel || null,
          faltas: ok.faltas || cache.faltas || faltasVacio,
          ts: Date.now()
        }, 'parcial', o), 'parcial';
        franja.classList.add('err');
        franja.innerHTML = '✗ No se pudo cargar. Revisa tu conexión.';
        return 'fallo';
      }
      return aplicarDatos({
        agenda: ok.agenda,
        horario: ok.horario,
        mensajes: ok.mensajes,
        circulares: ok.circulares,
        resumen: ok.resumen,
        panel: ok.panel,
        faltas: ok.faltas,
        ts: Date.now()
      }, 'ok', o), 'ok';
    }).catch(function (err) {
      if (err.status === 401) {
        scheduleRetry(false);
        window.Login.mostrar('Tu sesión venció. Ingresa de nuevo.');
        return '401';
      }
      aplicarDatos({
        agenda: (cache && cache.agenda) || [],
        horario: (cache && cache.horario) || [],
        mensajes: (cache && cache.mensajes) || [],
        circulares: (cache && cache.circulares) || [],
        resumen: (cache && cache.resumen) || { general: {}, materias: [] },
        panel: (cache && cache.panel) || null,
        faltas: (cache && cache.faltas) || { disponible: false, eventos: [], resumen: {} },
        ts: Date.now()
      }, cache ? 'offline' : 'fallo', o);
      return cache ? 'offline' : 'fallo';
    });
  }

  function recargar() {
    cargar({ silencioso: false }).then(function () {
      cargarNovedades(true);
      if (!state.fragil) toast('Datos actualizados ✓');
    });
  }

  function actualizarFranja() {
    var f = $('#franja');
    if (state.fragil) return;
    if (state.datos) {
      if (state.perfil === 'docente') {
        var mods = ((state.datos.panel || {}).modulos || []).length;
        f.innerHTML = '✓ Portal docente sincronizado · ' + mods + ' módulos · 🕐 ' + edadSync();
        f.className = 'franja ok';
        return;
      }
      var dias = (state.datos.agenda || []).length + PT.length;
      var pend = 0;
      for (var i = 0; i < state.datos.agenda.length; i++) {
        if (esCal(state.datos.agenda[i].calificacion) == null) pend++;
      }
      pend += PT.length;
      f.innerHTML = '✓ ' + dias + ' actividades' + (PT.length ? ' (' + PT.length + ' tuyas)' : '') +
        ' · ' + pend + ' por calificar · 🕐 ' + edadSync();
      f.className = 'franja ok';
    }
  }

  /* ================= INICIO ================= */
  function pendientesActivos() {
    if (!state.datos) return [];
    return agendaTodo().filter(function (e) {
      if (HECHAS[e.id] === true) return false;
      if (esCal(e.calificacion) != null) return false;
      if (!e.fecha_inicio) return false;
      return true;
    }).sort(function (a, b) {
      var na = diasRestantes(a), nb = diasRestantes(b);
      if (na == null) return 1; if (nb == null) return -1;
      return na - nb;
    });
  }
  function colapsado(bloque) {
    var cols = leerLS('agenda_colapsados', {});
    return cols[bloque] === true;
  }

  function renderInicio() {
    if (!state.datos) { renderEn('contenido-inicio', skeleton()); return; }
    actualizarFranja();
    var d = new Date();
    var res = state.datos.resumen || {};
    var gen = res.general || {};
    var pro = esCal(gen.promedio);
    var frase = frases[new Date().getDate() % frases.length];
    var clasesHoy = claseActual();
    var nov = state.campanaRes || null;

    var htmlWidgets = {};
    htmlWidgets.saludo =
      '<div class="tarjeta saludo saludo-mini">' +
      '<div class="saludo-fila"><div><h2 style="font-size:1.12rem">' + esc(saludoHoy()) + '</h2>' +
      '<div class="fecha" style="font-size:.72rem">' + fmtDia(d) + ' · Semana ' + numSemana(d) + '</div></div>' +
      '<div style="flex:1"></div>' +
      '<button class="btn ghost mini" data-accion="inicio-personalizar" title="Personalizar inicio">🎨</button></div>' +
      '<span class="frase" style="font-size:.78rem">' + esc(frase) + '</span></div>';

    /* ---- alertas compactas (atrasadas + semana crítica) ---- */
    var alertas = '';
    var atras = pendientesActivos().filter(function (e) { return diasRestantes(e) < 0; });
    var crit = semanaCritica();
    if (atras.length || crit) {
      alertas = '<div class="alertas-fila">' +
        (atras.length ? '<button class="chip alerta-chip" data-accion="ir-pend">⚠️ ' + atras.length + ' ' + (atras.length === 1 ? 'atrasada' : 'atrasadas') + ' →</button>' : '') +
        (crit ? '<span class="chip alerta-chip" role="status">🔥 ' + crit.n + ' evaluaciones entre ' + fmtCorta(crit.desde) + ' y ' + fmtCorta(crit.hasta) + '</span>' : '') +
        '</div>';
    }
    htmlWidgets.alertas = alertas;

    /* ---- ⭐ IMPORTANTES (actividades marcadas con estrella) ---- */
    var impor = pendientesActivos().filter(function (e) { return esImportante(e.id); });
    htmlWidgets.importantes = impor.length ?
      '<div class="prio-cab manana"><span class="punto" aria-hidden="true"></span> ⭐ IMPORTANTES <span class="n">' + impor.length + '</span></div>' +
      '<div class="tarjeta">' + impor.slice(0, 4).map(function (e) { return cardEvento(e, { compacta: true, prioridades: true }); }).join('') + '</div>' : '';

    /* ---- HOY compacto ---- */
    var hoyPend = pendientesActivos().filter(function (e) { return diasRestantes(e) === 0; });
    var hueco = proximoHueco();
    var hoyHtml = '<div class="prio-cab ahora"><span class="punto" aria-hidden="true"></span> HOY' +
      '<span class="n">' + (hoyPend.length + (clasesHoy.hoy ? clasesHoy.hoy.length : 0)) + '</span></div>';
    if (clasesHoy.hoy) {
      hoyHtml += '<div class="tarjeta" style="padding:.55rem .8rem"><div id="clase-ahora">' + bloqueClaseAhora(clasesHoy) + '</div></div>';
    }
    if (hueco && hueco.libreYa) {
      hoyHtml += '<div class="hueco-libre" role="status">☕ ¡Día de clases terminado! Tiempo libre para adelantar</div>';
    } else if (hueco && hueco.desde) {
      hoyHtml += '<div class="hueco-libre" role="status">☕ Próximo hueco libre: ' + hueco.desde + ' (' + minAMm(hueco.mins) + ' para adelantar)</div>';
    }
    hoyHtml += (hoyPend.length ?
      '<div class="tarjeta">' + hoyPend.slice(0, 3).map(function (e) { return cardEvento(e, { compacta: true, prioridades: true }); }).join('') +
      (hoyPend.length > 3 ? '<button class="btn ghost mini" style="margin-top:.3rem" data-accion="ir-pend">Ver todas (' + hoyPend.length + ') →</button>' : '') + '</div>'
      : '<div class="vacio" style="padding:.7rem;font-size:.82rem">Sin pendientes para hoy 🎉</div>');
    htmlWidgets.hoy = hoyHtml;

    /* ---- bloques colapsables ---- */
    function bloquePrio(id, cls, titulo, extra, items) {
      var col = colapsado(id);
      var cab = '<div class="prio-cab ' + cls + '"><span class="punto" aria-hidden="true"></span> ' + titulo +
        (extra || '') + '<span class="n">' + items.length + '</span>' +
        '<button class="chev" data-accion="prio-colapsar" data-bloque="' + id + '" aria-label="' + (col ? 'Expandir' : 'Colapsar') + '">' + (col ? '▸' : '▾') + '</button></div>';
      if (col) return cab;
      var cuerpo = items.length ?
        '<div class="tarjeta">' + items.slice(0, 3).map(function (e) { return cardEvento(e, { compacta: true, prioridades: true }); }).join('') +
        (items.length > 3 ? '<button class="btn ghost mini" style="margin-top:.3rem" data-accion="see-semana">Ver todas (' + items.length + ') →</button>' : '') + '</div>'
        : '<div class="vacio" style="padding:.7rem;font-size:.82rem">' + (cls === 'manana' ? 'Nada para mañana todavía.' : 'Despejado por ahora.') + '</div>';
      return cab + cuerpo;
    }

    var manana = pendientesActivos().filter(function (e) { return diasRestantes(e) === 1; });
    htmlWidgets.manana = bloquePrio('manana', 'manana', 'MAÑANA · ' + fmtCorta(addDays(new Date(), 1)),
      '', manana);

    var semanaEv = pendientesActivos().filter(function (e) { var n = diasRestantes(e); return n >= 2 && n <= 7; });
    htmlWidgets.semana = bloquePrio('semana', 'semana', 'ESTA SEMANA',
      '<button class="ver" data-accion="see-semana">Ver semana →</button>', semanaEv);

    var prox = pendientesActivos().filter(function (e) { var n = diasRestantes(e); return n != null && n > 7 && n <= 30; });
    htmlWidgets.proximo = prox.length ? bloquePrio('proximo', 'proximo', 'PRÓXIMAMENTE', '', prox) : '';

    /* ---- rendimiento mini: una sola tarjeta ---- */
    var tendencia = tendenciaGeneral();
    htmlWidgets.rendimiento =
      '<div class="prio-cab proximo"><span class="punto" aria-hidden="true"></span> MI RENDIMIENTO' +
      '<button class="ver" data-accion="ir:rendimiento">Ver todo →</button></div>' +
      '<button class="tarjeta rend-mini" data-accion="ir:rendimiento" style="width:100%;text-align:left;cursor:pointer;display:flex;align-items:center;gap:1rem;flex-wrap:wrap;padding:.7rem .9rem">' +
      '<span class="k-num ' + sisColor(pro) + '" style="font-size:1.6rem">' + fmtNum(pro, 2) + '</span>' +
      '<span style="text-align:left"><span class="k-lbl" style="display:block">Promedio general</span>' +
      '<span class="sub">' + (gen.total_calificadas || 0) + ' calificadas · meta ' + fmtNum(cfg.meta, 1) + '</span></span>' +
      '<span style="flex:1"></span>' +
      '<span class="tend ' + tendencia.cls + '" style="font-size:.8rem;font-weight:800">' + tendencia.txt + '</span>' +
      '</button>';

    htmlWidgets.racha = estadoRacha();

    htmlWidgets.novedades = (nov && nov.novedades && nov.novedades.length) ?
      '<div class="prio-cab proximo"><span class="punto" aria-hidden="true"></span> NOVEDADES' +
      '<button class="ver" data-accion="camp-bell">Ver todas →</button></div><div class="tarjeta" style="padding:.6rem .8rem">' +
      nov.novedades.slice(0, 2).map(function (n) {
        return '<div class="nov" style="border-bottom:none;padding:.3rem 0"><span class="tipo">' + tipoIco(n.tipo) + '</span>' +
          '<div class="txt" style="font-size:.82rem">' + esc(n.texto) + '</div></div>';
      }).join('') + '</div>' : '';

    var orden = widgetsOrden();
    var out = orden.map(function (id) { return widgetVisible(id) ? (htmlWidgets[id] || '') : ''; }).join('');
    renderEn('contenido-inicio', out);
  }

  function tendenciaGeneral() {
    if (!state.datos) return { cls: 'igual', txt: '—' };
    var ns = [];
    state.datos.agenda.forEach(function (e) {
      var n = esCal(e.calificacion);
      if (n != null) ns.push(n);
    });
    if (ns.length < 4) return { cls: 'igual', txt: '·' };
    var mitad = Math.floor(ns.length / 2);
    var ant = ns.slice(0, mitad), ult = ns.slice(mitad);
    var pa = ant.reduce(function (a, b) { return a + b; }, 0) / ant.length;
    var pu = ult.reduce(function (a, b) { return a + b; }, 0) / ult.length;
    var dif = Math.round((pu - pa) * 10) / 10;
    if (dif > 0.15) return { cls: 'sube', txt: '▲ +' + dif };
    if (dif < -0.15) return { cls: 'baja', txt: '▼ ' + dif };
    return { cls: 'igual', txt: '= estable' };
  }

  /* Detecta si en los próximos 14 días hay una ventana de 5 días con >= 3 evaluaciones */
  function semanaCritica() {
    if (!state.datos) return null;
    var hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    var evals = agendaTodo().filter(function (e) {
      return e.fecha_inicio && !HECHAS[e.id] && (esExamen(e.titulo) || /entrega|presentaci|proyecto/i.test(e.titulo || ''));
    });
    for (var inicio = 0; inicio <= 9; inicio++) {
      var desde = addDays(hoy, inicio);
      var hasta = addDays(desde, 4);
      var n = 0;
      evals.forEach(function (e) {
        var d = parseLocal(e.fecha_inicio);
        if (!isNaN(d.getTime()) && d >= desde && d <= hasta) n++;
      });
      if (n >= 3) return { desde: desde, hasta: hasta, n: n };
    }
    return null;
  }

  function saludoHoy() {
    var h = new Date().getHours();
    if (h < 6) return '🌙 ¡Buenas noches!';
    if (h < 12) return '🌅 ¡Buenos días!';
    if (h < 19) return '☀️ ¡Buenas tardes!';
    return '🌇 ¡Buenas tardes!';
  }

  function estadoRacha() {
    if (!state.datos) return '';
    var hoyMid = new Date(); hoyMid.setHours(23, 59, 59, 999);
    var ultimoPendiente = 9999;
    var racha = 0;
    for (var n = 0; n < 60; n++) {
      var dd = addDays(new Date(), -n);
      var pend = eventosDia(dd).filter(function (e) {
        if (HECHAS[e.id]) return false;
        if (esCal(e.calificacion) != null) return false;
        if (!e.fecha_inicio) return false;
        return diffDias(dd, new Date()) < 0;
      }).length === 0;
      if (!pend) { ultimoPendiente = n - 1; break; }
      racha++;
    }
    var gen = ((state.datos.resumen || {}).general || {});
    var pro = esCal(gen.promedio);
    var meta = cfg.meta;
    var fillPct = pro != null ? Math.min(100, Math.round((pro / 10) * 100)) : 0;
    var metaPct = Math.round((meta / 10) * 100);
    var porEncima = pro != null && pro >= meta;
    /* meta semanal: pendientes completados esta semana */
    var comp = completadasSemana();
    var metaSem = cfg.metaSemanal || 10;
    var pctSem = Math.min(100, Math.round(comp / Math.max(1, metaSem) * 100));
    return '<div class="tarjeta racha">' +
      '<div class="racha-fila"><span class="racha-flama">🔥</span><div><div class="racha-num">' + Math.min(racha, ultimoPendiente < 0 ? 0 : racha) + '</div>' +
      '<div class="racha-sub">' + (racha === 1 ? 'día' : 'días') + ' sin pendientes atrasados</div></div>' +
      '<div style="flex:1"></div>' +
      '<div style="text-align:right"><div class="racha-num" style="font-size:1.5rem">' + comp + '<span style="font-size:.8rem;color:var(--texto2)">/' + metaSem + '</span></div>' +
      '<div class="racha-sub">pendientes esta semana</div></div></div>' +
      '<div class="pend-barra"><div class="pb-track"><div class="pb-fill" style="width:' + pctSem + '%"></div></div>' +
      '<span class="pb-lbl" aria-live="polite">' + pctSem + '%</span></div>' +
      '<div class="meta-p" style="display:flex;align-items:center;gap:.8rem;flex-wrap:wrap;margin-top:.6rem;background:var(--bg-subtle);border:1px solid var(--border-subtle);border-radius:var(--radio-s);padding:.55rem .75rem">' +
      '<span style="font-size:.82rem"><strong>Meta del periodo:</strong> <span class="mono" style="font-weight:800">' + fmtNum(meta, 1) + '</span></span>' +
      '<span style="flex:1"></span>' +
      '<span class="' + (pro != null ? sisColor(pro) : '') + ' mono" style="font-weight:800;font-size:1.05rem">' + fmtNum(pro, 2) + '</span>' +
      '</div>' +
      '<div class="meta-track" style="margin-top:.5rem"><div class="meta-llen" style="width:' + fillPct + '%"></div>' +
      '<div class="meta-needle" style="left:' + metaPct + '%"></div></div>' +
      (porEncima ? '<div class="sub" style="color:var(--verde);font-weight:700;margin-top:.3rem">🎉 Por encima de tu meta.</div>' : '') +
      '</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:.6rem">' +
      '<button class="btn ghost mini" data-accion="ajustes">✏️ Editar</button>' +
      '<button class="btn ghost mini" data-accion="ir:pendientes">Ir a pendientes →</button></div>' +
      '</div>';
  }

  function widgetToggle(wid) {
    if (!WIDGETS_VISIBLES) WIDGETS_VISIBLES = {};
    WIDGETS_VISIBLES[wid] = !widgetVisible(wid);
    guardarWidgets();
    renderAjustes();
    if (state.vista === 'inicio' && state.datos) renderInicio();
  }
  function widgetMover(wid, delta) {
    var orden = widgetsOrden();
    var i = orden.indexOf(wid);
    if (i < 0) return;
    var j = i + delta;
    if (j < 0 || j >= orden.length) return;
    var a = orden[i]; orden[i] = orden[j]; orden[j] = a;
    WIDGETS_ORDEN = orden;
    guardarWidgets();
    renderAjustes();
    if (state.vista === 'inicio' && state.datos) renderInicio();
  }

  var frases = [
    'Un pequeño paso cada día.',
    'Hoy es un buen día para aprender.',
    'La constancia vence lo que el talento no alcanza.',
    'Organízate, estudia, disfruta.',
    'Cada nota cuenta, pero tú vales más.',
    'Empieza con lo difícil, lo demás fluye.',
    'Tu futuro se construye hoy.',
    'Pequeños esfuerzos, grandes resultados.',
    'Tú puedes, como siempre.',
    'La mejor versión de ti llega con hábito.',
    'No dejes para mañana lo que puedes hoy.',
    'Aprender también es divertirse.'
  ];
  function tipoIco(t) {
    var s = String(t || '').toLowerCase();
    if (s.indexOf('nota') >= 0) return '📝';
    if (s.indexOf('fecha') >= 0) return '🔄';
    if (s.indexOf('examen') >= 0 || s.indexOf('evaluaci') >= 0) return '📌';
    if (s.indexOf('mensaje') >= 0) return '✉️';
    if (s.indexOf('circular') >= 0) return '📄';
    return '🔔';
  }
  var NOV_GRUPOS = [
    { id: 'accion', ico: '🔴', nombre: 'Requiere acción', tipos: ['tarea_nueva', 'fecha_cambiada'] },
    { id: 'info', ico: '📢', nombre: 'Información', tipos: ['mensaje_nuevo', 'circular_nueva', 'horario_cambiado'] },
    { id: 'act', ico: '✅', nombre: 'Actualizaciones', tipos: ['nota_nueva', 'nota_cambiada'] }
  ];
  function novGrupoDe(tipo) {
    for (var i = 0; i < NOV_GRUPOS.length; i++) {
      if (NOV_GRUPOS[i].tipos.indexOf(tipo) >= 0) return NOV_GRUPOS[i];
    }
    return NOV_GRUPOS[2];
  }
  function kpi(ico, num, lbl, color) {
    return '<div class="kpi pp"><span class="k-ico">' + ico + '</span><span class="k-num ' + (color || '') + '">' + esc(num != null ? num : '—') + '</span><span class="k-lbl">' + esc(lbl) + '</span></div>';
  }
  function claseActual() {
    if (!state.datos || !state.datos.horario) return { actual: null, siguiente: null, hoy: null, bloquesDia: [] };
    var ahora = new Date();
    var hoyIdx = ahora.getDay();
    var nombre = DIAS_UP[hoyIdx];
    var mins = ahora.getHours() * 60 + ahora.getMinutes();
    var bloquesDia = state.datos.horario.filter(function (b) {
      return String(b.dia || '').trim().toUpperCase() === nombre;
    });
    var actual = null, siguiente = null, siguienteIni = null;
    bloquesDia.forEach(function (b) {
      var i = aMin(b.hora_inicio); var f = aMin(b.hora_fin) || (i == null ? null : i + 45);
      if (i != null && mins >= i && (f == null || mins < f)) actual = b;
      else if (i != null && i > mins && (siguienteIni == null || i < siguienteIni)) { siguiente = b; siguienteIni = i; }
    });
    return { actual: actual, siguiente: siguiente, hoy: bloquesDia.length ? bloquesDia : null, bloquesDia: bloquesDia, mins: mins };
  }
  function bloqueClaseAhora(c) {
    if (c.actual) {
      var i = aMin(c.actual.hora_inicio) || 0; var f = aMin(c.actual.hora_fin) || (i + 45);
      var frac = Math.max(0, Math.min(1, (c.mins - i) / Math.max(1, (f - i))));
      var resta = f - c.mins;
      return '<div class="cd" style="border-left-color:var(--verde);margin-top:0">' +
        '<div class="cd-txt">' + esc(c.actual.materia) + '</div>' +
        '<div class="sub" id="clase-ahora-detalle">En curso · restan ' + minAMm(resta) + '</div></div>';
    }
    if (c.siguiente) {
      var ri = aMin(c.siguiente.hora_inicio) || 0;
      return '<div class="cd" style="border-left-color:var(--acento);margin-top:0">' +
        '<div class="cd-txt">Próxima: ' + esc(c.siguiente.materia) + '</div>' +
        '<div class="sub" id="clase-ahora-detalle">Empieza en ' + minAMm(ri - c.mins) + ' · ' + c.siguiente.hora_inicio + '–' + (c.siguiente.hora_fin || '') + '</div></div>';
    }
    return '<div class="cd" style="border-left-color:var(--borde);margin-top:0"><div class="cd-txt">Sin clases ahora</div>' +
      '<div class="sub">Tiempo libre, aprovecha para adelantar 😉</div></div>';
  }
  function minAMm(m) {
    if (m < 60) return m + ' min';
    var hh = Math.floor(m / 60); var mm = m % 60;
    return mm ? hh + ' h ' + mm + ' min' : hh + ' h';
  }
  function listaClasesHoy(c) {
    var ahora = new Date();
    var mins = ahora.getHours() * 60 + ahora.getMinutes();
    return c.hoy.map(function (b) {
      var i = aMin(b.hora_inicio) || 0; var f = aMin(b.hora_fin) || (i + 45);
      var chip = '';
      if (mins >= i && (f == null || mins < f)) chip = '<span class="chip-ahora">AHORA</span>';
      else if (mins < i) chip = '<span class="chip-falta">FALTA ' + minAMm(i - mins) + '</span>';
      else chip = '<span class="chip-ya">TERMINÓ</span>';
      return '<div class="clase-hoy"><span class="stat-chip" style="min-width:3.4rem">' + b.periodo + '</span>' +
        '<div style="flex:1"><strong>' + esc(b.materia) + '</strong><div class="sub">' +
        (b.hora_inicio || '') + (b.hora_inicio && b.hora_fin ? ' – ' : '') + (b.hora_fin || '') + '</div></div>' + chip + '</div>';
    }).join('');
  }
  function proximoExamen() {
    if (!state.datos) return { dias: null };
    var hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    var prox = null; var minD = 9999;
    agendaTodo().forEach(function (e) {
      if (!esExamen(e.titulo) || !e.fecha_inicio) return;
      var d = parseLocal(e.fecha_inicio); d.setHours(0, 0, 0, 0);
      if (isNaN(d.getTime())) return;
      var dias = diffDias(d, hoy);
      if (dias >= 0 && dias < minD) { minD = dias; prox = { dias: dias, fecha: d, titulo: e.titulo, materia: e.materia }; }
    });
    return prox || { dias: null };
  }
  function strip7(d) {
    var dias = [];
    for (var i = 0; i < 7; i++) dias.push(addDays(d, i));
    var html = '<h2 class="seccion">Próximos 7 días</h2><div class="strip7">';
    dias.forEach(function (dd) {
      var evs = eventosDia(dd).filter(function (e) { return !(cfg.ocultarHechas && HECHAS[e.id]); });
      var hoyF = diffDias(dd, new Date()) === 0;
      var dots = evs.slice(0, 4).map(function (e) {
        return '<span class="dot" style="background:' + (esExamen(e.titulo) ? 'var(--rojo)' : colorNota(esCal(e.calificacion))) + '"></span>';
      }).join('');
      if (evs.length > 4) dots += '<span class="mas">+' + (evs.length - 4) + '</span>';
      html += '<div class="s7' + (hoyF ? ' hoy' : '') + '" data-accion="dia-iso" data-fecha="' + fechaISO(dd) + '">' +
        '<span class="s7-d">' + DIAS_C[dd.getDay()] + '</span><span class="s7-n">' + dd.getDate() + '</span>' +
        '<span class="dots">' + (dots || '·') + '</span></div>';
    });
    return html + '</div>';
  }
  function barrasMaterias(materias) {
    var orden = materias.slice(0).sort(function (a, b) { return (esCal(b.promedio) || 0) - (esCal(a.promedio) || 0); });
    var html = '<h2 class="seccion">Rendimiento por materia</h2><div class="tarjeta">';
    orden.forEach(function (m) {
      var p = esCal(m.promedio);
      var porc = p == null ? 0 : Math.round(p * 10);
      html += '<div class="barra-p"><span class="b-lbl" title="' + esc(m.materia) + '">' + esc(m.materia) + '</span>' +
        '<span class="b-track"><span class="b-fill ' + (p != null ? sisColor(p) : '') + '" style="width:' + porc + '%"></span></span>' +
        '<span class="b-val ' + (p != null ? sisColor(p) : '') + '">' + fmtNum(p, 2) + '</span></div>';
    });
    return html + '</div>';
  }

  /* ================= SEMANA (Semana · Histórico · Mes · Horario) ================= */
  function renderSemana() {
    if (!state.datos) { renderEn('contenido-semana', skeleton()); return; }
    var modo = cfg.modoSem || 'semana';
    var seg = '<div class="seg seg-rend" style="margin:.2rem 0 .55rem" role="tablist" aria-label="Modos de semana">' +
      [['semana', 'Semana'], ['historico', 'Histórico'], ['mes', '🗓️ Mes'], ['horario', '🕒 Horario']].map(function (m) {
        return '<button class="seg-btn' + (modo === m[0] ? ' activa' : '') + '" data-accion="modo-sem" data-modo="' + m[0] + '" role="tab" aria-selected="' + (modo === m[0]) + '">' + m[1] + '</button>';
      }).join('') + '</div>';

    if (modo === 'historico') {
      var hm = addDays(new Date(), state.histMes * 30.5 | 0);
      var rango = MESES[hm.getMonth()] + ' ' + hm.getFullYear();
      renderEn('rango-semana', rango);
      var htmlH = seg +
        '<div class="hist-mes"><button class="btn-nav" data-accion="hist-prev" aria-label="Mes anterior">‹</button><strong>' + rango + '</strong><button class="btn-nav" data-accion="hist-next" aria-label="Mes siguiente">›</button>' +
        '<button class="hoy-chip" data-accion="hist-hoy">Hoy</button></div>' +
        '<input type="search" id="hist-buscar" class="hist-buscar" placeholder="🔎 Buscar en el histórico…" autocomplete="off">' +
        '<div id="hist-lista">' + renderHistLista(fechaISO(hm)) + '</div>';
      renderEn('contenido-semana', htmlH);
      setTimeout(function () {
        var el = $('#hist-buscar'); if (el) el.addEventListener('input', function () { renderHistLista(null); });
      }, 0);
      return;
    }

    if (modo === 'mes') {
      var d = addDays(new Date(), state.mes * 32 | 0);
      renderEn('rango-semana', MESES_C[d.getMonth()].toUpperCase() + ' ' + d.getFullYear());
      var segMes = '<div style="display:flex;gap:.45rem;flex-wrap:wrap;align-items:center;margin:.1rem 0 .45rem">' +
        '<div class="seg"><button class="seg-btn' + (cfg.calVista !== 'agenda' ? ' activa' : '') + '" data-accion="cal-vista" data-modo="grilla">Grilla</button>' +
        '<button class="seg-btn' + (cfg.calVista === 'agenda' ? ' activa' : '') + '" data-accion="cal-vista" data-modo="agenda">Agenda</button></div>' +
        '<div class="seg">' + [['', 'Todo'], ['tareas', '📝 Tareas'], ['examenes', '📌 Exámenes']].map(function (t) {
          return '<button class="seg-btn' + (agg.calTipo === t[0] ? ' activa' : '') + '" data-accion="cal-tipo" data-t="' + t[0] + '">' + t[1] + '</button>';
        }).join('') + '</div></div>';
      var htmlM = seg +
        '<div class="cal-head"><button class="btn-nav" data-accion="cal-prev" aria-label="Mes anterior">‹</button>' +
        '<span class="tit">' + MESES_C[d.getMonth()].toUpperCase() + ' ' + d.getFullYear() + '</span>' +
        '<button class="btn-nav" data-accion="cal-next" aria-label="Mes siguiente">›</button><button class="hoy-chip" data-accion="cal-hoy">Hoy</button></div>' + segMes;
      var materias = materiasUnicas();
      if (materias.length > 1) {
        htmlM += '<div class="chips scroll" id="chip-filtro">' + materias.map(function (m) {
          return '<button class="chip' + (agg.calFiltro === m ? ' activa' : '') + '" data-accion="cal-filtro" data-materia="' + esc(m) + '">' + esc(m) + '</button>';
        }).join('') + '</div>';
      }
      htmlM += (cfg.calVista === 'agenda' ? listaMes(d) : grillaMes(d)) +
        '<p class="sub" style="margin-top:.5rem">🔴 número en rojo = examen · haz clic en un día para ver su detalle</p>';
      renderEn('contenido-semana', htmlM);
      return;
    }

    if (modo === 'horario') {
      renderEn('rango-semana', 'Horario semanal');
      renderEn('contenido-semana', seg + tablaHorarioSemana());
      return;
    }

    var ini = addDays(iniSemana(new Date()), state.semana * 7);
    renderEn('rango-semana', 'Semana ' + numSemana(ini) + ' · ' + fmtCorta(ini) + ' – ' + fmtCorta(addDays(ini, 6)));
    var html = seg +
      '<div class="toolbar-semana"><span style="font-size:.8rem;color:var(--texto2)">Agrupar</span>' +
      '<div class="seg"><button class="seg-btn' + (cfg.agrupar === 'dia' ? ' activa' : '') + '" data-accion="agrupar-sem" data-modo="dia">Por día</button>' +
      '<button class="seg-btn' + (cfg.agrupar === 'materia' ? ' activa' : '') + '" data-accion="agrupar-sem" data-modo="materia">Por materia</button></div>' +
      (cfg.agrupar === 'dia' ?
        '<div class="seg"><button class="seg-btn' + (cfg.ordenSem === 'hora' ? ' activa' : '') + '" data-accion="orden-sem" data-modo="hora">Hora</button>' +
        '<button class="seg-btn' + (cfg.ordenSem === 'materia' ? ' activa' : '') + '" data-accion="orden-sem" data-modo="materia">Materia</button></div>' : '') +
      '<button class="btn ghost mini" data-accion="sem-share">🔗 Compartir semana</button>' +
      '</div>' +
      (cfg.agrupar === 'dia' ? semanaAgrupada(ini) : materiasAgrupada(ini));
    renderEn('contenido-semana', html);
  }

  function semanaAgrupada(ini) {
    var hoy = new Date();
    var html = '';
    for (var i = 0; i < 7; i++) {
      var dd = addDays(ini, i);
      var evs = eventosDia(dd).filter(function (e) { return !(cfg.ocultarHechas && HECHAS[e.id]); });
      var esHoy = diffDias(dd, hoy) === 0;
      html += '<div class="dia-seccion"><div class="dia-tit' + (esHoy ? ' dia-hoy' : '') + '">' +
        DIAS[dd.getDay()] + ' ' + dd.getDate() + ' ' + MESES_C[dd.getMonth()] + (esHoy ? ' · HOY' : '') +
        '<span style="flex:1"></span><span>' + evs.length + '</span></div>' +
        (evs.length ? '<div class="tarjeta">' + ordenarEventos(evs).map(function (e) { return cardEvento(e, { compacta: true }); }).join('') + '</div>'
          : '<div class="vacio" style="padding:1rem;font-size:.8rem">Libre</div>') + '</div>';
    }
    return html;
  }
  function materiasAgrupada(ini) {
    var evs = [];
    for (var i = 0; i < 7; i++) {
      eventosDia(addDays(ini, i)).forEach(function (e) { evs.push(e); });
    }
    if (cfg.ocultarHechas) evs = evs.filter(function (e) { return !HECHAS[e.id]; });
    var por = {};
    evs.forEach(function (e) { (por[e.materia || 'General'] = por[e.materia || 'General'] || []).push(e); });
    var html = '';
    Object.keys(por).sort().forEach(function (m) {
      html += '<div class="dia-seccion"><div class="dia-tit">' + esc(m) + '<span style="flex:1"></span><span>' + por[m].length + '</span></div>' +
        '<div class="tarjeta">' + por[m].slice(0).sort(function (a, b) { return String(a.fecha_inicio || '').localeCompare(String(b.fecha_inicio || '')); })
          .map(function (e) { return cardEvento(e, { compacta: true }); }).join('') + '</div></div>';
    });
    return html || '<div class="vacio">Nada en esta semana con tu filtro.</div>';
  }

  function renderHistLista(histISO) {
    var q = ($('#hist-buscar') ? $('#hist-buscar').value : '').trim();
    if (!histISO) {
      var hm = addDays(new Date(), state.histMes * 30.5 | 0);
      histISO = fechaISO(hm);
    }
    var eventos = agendaTodo().filter(function (e) {
      var okMes = !e.fecha_inicio || String(e.fecha_inicio).slice(0, 7) === histISO.slice(0, 7);
      if (!q) return okMes;
      if (!okMes) return false;
      var t = (e.titulo + ' ' + e.materia).toLowerCase();
      return t.indexOf(q.toLowerCase()) >= 0;
    });
    var sep = separar(eventos);
    var html = '';
    if (q) {
      var coincidencias = eventos;
      html = coincidencias.length ? '<div class="tarjeta">' + coincidencias.slice(0, 60).map(function (e) {
        return cardEvento(e, { compacta: true, q: q, extra: '📌 ' });
      }).join('') + '</div>' : '<div class="vacio">Sin resultados para «' + esc(q) + '»</div>';
    } else {
      html = '<div class="dia-seccion"><div class="dia-tit">Pendientes / en curso</div>' +
        (sep.pendientes.length ? '<div class="tarjeta">' + sep.pendientes.slice(0, 40).map(function (e) { return cardEvento(e, { compacta: true }); }).join('') + '</div>'
          : '<div class="vacio" style="padding:.8rem">Sin pendientes</div>') + '</div>' +
        '<div class="dia-seccion"><div class="dia-tit">Calificadas</div>' +
        (sep.gradeados.length ? '<div class="tarjeta">' + sep.gradeados.slice(0, 40).map(function (e) { return cardEvento(e, { compacta: true }); }).join('') + '</div>'
          : '<div class="vacio" style="padding:.8rem">Nada aún</div>') + '</div>';
    }
    var lista = $('#hist-lista');
    if (lista) lista.innerHTML = html;
    return html;
  }

  /* ================= CALENDARIO (integrado en Semana → Mes) ================= */
  function renderCalendario() {
    /* El calendario vive dentro de Semana ("Mes"); redirigimos allí. */
    cfg.modoSem = 'mes';
    guardarCfg();
    cambiarTab('semana');
  }

  function tablaHorarioSemana() {
    if (!state.datos || !state.datos.horario) return '<div class="vacio">Sin horario.</div>';
    var porDia = {};
    state.datos.horario.forEach(function (b) {
      var d = String(b.dia || '').trim().toUpperCase();
      if (!porDia[d]) porDia[d] = [];
      porDia[d].push(b);
    });
    var dias = ['LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES'];
    var html = '<div class="contenedor-tabla"><table class="horario"><thead><tr><th>#</th>';
    dias.forEach(function (d) { html += '<th>' + d + '</th>'; });
    html += '</tr></thead><tbody>';
    for (var p = 1; p <= 9; p++) {
      var fila = '<tr><td class="per">' + p + '</td>';
      dias.forEach(function (dd) {
        var lista = porDia[dd] || [];
        var b = null;
        for (var i = 0; i < lista.length; i++) { if (parseInt(lista[i].periodo, 10) === p) { b = lista[i]; break; } }
        if (b) {
          fila += '<td class="hor-cel"><span class="dot" style="background:' + colorMateria(b.materia) + ';vertical-align:middle;display:inline-block;margin-right:4px"></span>' +
            '<span class="mat">' + esc(b.materia) + '</span><span class="hor">' + (b.hora_inicio || '') + (b.hora_fin ? ' – ' + esc(b.hora_fin) : '') + '</span></td>';
        } else fila += '<td class="libre">·</td>';
      });
      html += fila + '</tr>';
    }
    html += '</tbody></table></div>' +
      '<div style="margin-top:.5rem;text-align:right"><button class="btn ghost mini" data-accion="print-semana">🖨️ Imprimir horario semanal</button></div>';
    return html;
  }

  function materiasUnicas() {
    if (!state.datos) return [];
    var s = {}; agendaTodo().forEach(function (e) { if (e.materia) s[e.materia] = 1; });
    return Object.keys(s).sort();
  }

  function filtroCal(e) {
    return !agg.calFiltro || e.materia === agg.calFiltro;
  }

  function eventosMes(d) {
    var mes = d.getMonth(); var anio = d.getFullYear();
    return agendaTodo().filter(function (e) {
      if (!e.fecha_inicio) return false;
      var p = parseLocal(e.fecha_inicio);
      if (isNaN(p.getTime())) return false;
      return p.getMonth() === mes && p.getFullYear() === anio && filtroCal(e);
    });
  }

  function filtroCalTipo(e) {
    var t = agg.calTipo || '';
    if (!t) return true;
    var esEx = esExamen(e.titulo);
    return t === 'examenes' ? esEx : (t === 'tareas' ? !esEx : true);
  }

  function grillaMes(d) {
    var primero = new Date(d.getFullYear(), d.getMonth(), 1);
    var ini = iniSemana(primero);
    var html = '<div class="cal-dow">' + ['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(function (x) { return '<span>' + x + '</span>'; }).join('') + '</div>';
    var celdas = '';
    for (var i = 0; i < 42; i++) {
      var dd = addDays(ini, i);
      var fuera = dd.getMonth() !== d.getMonth();
      var evs = eventosDia(dd).filter(filtroCal).filter(filtroCalTipo);
      var exam = evs.some(function (e) { return esExamen(e.titulo); });
      var hoyF = diffDias(dd, new Date()) === 0;
      var dots = evs.slice(0, 3).map(function (e) {
        var color = esExamen(e.titulo) ? 'var(--rojo)' : colorNota(esCal(e.calificacion));
        return '<span class="dot" style="background:' + color + '"></span>';
      }).join('');
      if (evs.length > 3) dots += '<span class="mas">+</span>';
      celdas += '<button class="dia-cel' + (fuera ? ' fuera' : '') + (hoyF ? ' hoy' : '') + (exam ? ' examen' : '') +
        '" data-accion="dia-iso" data-fecha="' + fechaISO(dd) + '">' +
        '<span class="n">' + dd.getDate() + '</span><span class="dots">' + (dots || '') + '</span></button>';
    }
    return '<div class="cal-grid">' + celdas + '</div>' +
      '<p class="sub" style="margin-top:.5rem">🔴 número en rojo = examen · haz clic en un día para ver detalle</p>';
  }

  function listaMes(d) {
    var evs = eventosMes(d);
    var porDia = {};
    evs.forEach(function (e) { (porDia[e.fecha_inicio] = porDia[e.fecha_inicio] || []).push(e); });
    if (!Object.keys(porDia).length) return '<div class="vacio">Nada en este mes.</div>';
    var html = '';
    Object.keys(porDia).sort().forEach(function (iso) {
      var dd = parseLocal(iso);
      var lista = porDia[iso];
      html += '<div class="dia-seccion"><div class="dia-tit">' + fmtDia(dd) + ' <span style="flex:1"></span><span>' + lista.length + '</span></div>' +
        '<div class="tarjeta">' + lista.map(function (e) { return cardEvento(e, { compacta: true, extra: '🕛 ' }); }).join('') + '</div></div>';
    });
    return html;
  }

  /* ================= RENDIMIENTO (sub-vistas con segments) ================= */
  var evoW = 320, evoH = 90;
  function renderRendimiento() {
    if (!state.datos) { renderEn('contenido-rendimiento', skeleton()); return; }
    var res = state.datos.resumen || {};
    var gen = res.general || {};
    var materias = res.materias || [];
    var pro = esCal(gen.promedio);
    var seg = agg.rendSeg || 'resumen';
    var segBtns = [['resumen', 'Resumen'], ['objetivos', '🎯 Objetivos'], ['prediccion', '🔮 Predicción'], ['historial', '📚 Historial'], ['simulador', '🧮 Simulador']];
    var html = '<div class="seg seg-rend" style="margin:.2rem 0 .7rem" role="tablist" aria-label="Secciones de rendimiento">' +
      segBtns.map(function (s) {
        return '<button class="seg-btn' + (seg === s[0] ? ' activa' : '') + '" data-accion="rend-seg" data-seg="' + s[0] + '" role="tab" aria-selected="' + (seg === s[0]) + '">' + s[1] + '</button>';
      }).join('') + '</div>';

    if (seg === 'resumen') {
      html += '<div class="caja-prom">' +
        '<div class="pp"><span class="pp-val ' + sisColor(pro) + '">' + fmtNum(pro, 2) + '</span><span class="pp-lbl">Promedio general</span></div>' +
        '<div class="pp"><span class="pp-val">' + gen.total_calificadas + '</span><span class="pp-lbl">Calificadas</span></div>' +
        '<div class="pp"><span class="pp-val">' + (gen.total_pendientes || 0) + '</span><span class="pp-lbl">Pendientes</span></div>' +
        '</div>' +
        '<div class="tarjeta"><h2 class="seccion" style="margin-top:0">Evolución general</h2>' + evoSvg() + '</div>';

      html += '<div class="seg" style="margin:.2rem 0 .5rem"><button class="seg-btn' + (cfg.vistaLista ? ' activa' : '') + '" data-accion="notas-vista" data-modo="tabla">Tabla</button>' +
        '<button class="seg-btn' + (cfg.vistaLista ? '' : ' activa') + '" data-accion="notas-vista" data-modo="grafico">Gráfico</button></div>';

      var orden = materias.slice(0).sort(function (a, b) {
        if (cfg.ordenNotas === 'materia') return String(a.materia).localeCompare(String(b.materia));
        return (esCal(b.promedio) || 0) - (esCal(a.promedio) || 0);
      });
      agg.matOrden = orden;

      if (cfg.vistaLista) {
        html += '<div class="tarjeta" style="padding:0;overflow:hidden"><table class="tabla-notas">' +
          '<thead><tr><th>Materia</th><th>Promedio</th><th>Min</th><th>Max</th><th>Act.</th><th><span class="tend">Tend.</span></th></tr></thead><tbody>';
        orden.forEach(function (m, idx) {
          html += '<tr data-accion="mat-detalle" data-idx="' + idx + '">' +
            '<td><strong>' + esc(m.materia) + '</strong></td>' +
            '<td><span class="badge nota ' + sisColor(esCal(m.promedio)) + '">' + fmtNum(esCal(m.promedio), 2) + '</span></td>' +
            '<td>' + fmtNum(m.minima, 2) + '</td><td>' + fmtNum(m.maxima, 2) + '</td>' +
            '<td>' + m.actividades + '</td>' + tendencia(m) + '</tr>';
        });
        var sinNotas = materiasUnicas().filter(function (m) { return !materias.some(function (x) { return x.materia === m; }); });
        if (sinNotas.length) {
          html += '<tr><td><strong>' + sinNotas.map(esc).join(', ') + '</strong></td><td colspan="5" class="sub">Sin notas aún</td></tr>';
        }
        html += '</tbody></table>' + riesgoCard(materias) + '</div>';
      } else {
        html += '<div class="doble">' + destacados(orden) + '</div>' + histograma(materias) + riesgoCard(materias);
      }
      html += '<div class="tip" style="font-size:.75rem">💡 Haz clic en una materia para ver el detalle y el impacto de la próxima actividad.</div>';
    }

    if (seg === 'objetivos') html += objetivosHtml(materias);
    if (seg === 'prediccion') html += prediccionesHtml(materias);
    if (seg === 'historial') {
      html += '<div style="display:flex;gap:.4rem;flex-wrap:wrap;margin:.2rem 0 .6rem">' +
        '<button class="btn ghost mini" data-accion="notas-oficiales-csv">📊 CSV notas oficiales</button>' +
        (state.datos ? ((state.datos && libretasLista()).map(function (l) {
          return '<button class="btn ghost mini" data-accion="libreta-pdf" data-peri="' + esc(l.peri_dist_codi) + '">📄 ' + esc(truncNombre(l.periodo, 22)) + '</button>';
        }).join('')) : '') +
        '</div>';
      html += periodosHistorial(materias);
      if (!NOTAS_DET && !notasDetCargando) {
        html += '<div class="tarjeta"><div class="sub">⏳ Cargando desglose oficial de las libretas…</div></div>';
        cargarNotasDetalle().then(function () { if (state.vista === 'rendimiento') renderRendimiento(); });
      } else if (NOTAS_DET && NOTAS_DET.disponible) {
        (NOTAS_DET.periodos || []).forEach(function (p) {
          html += '<div class="tarjeta" style="padding:.6rem .8rem;margin-bottom:.6rem"><h2 class="seccion" style="margin:.1rem 0 .4rem;font-size:.85rem">' + esc(p.periodo) + '</h2>' +
            (p.materias || []).map(function (m) {
              return '<div class="fila-per" style="font-size:.78rem"><span>' + esc(truncNombre(m.materia, 24)) + '</span>' +
                '<span class="badge nota ' + sisColor(m.total) + '">' + fmtNum(m.total, 2) + '</span></div>';
            }).join('') + '</div>';
        });
      }
    }
    if (seg === 'simulador') {
      var orden2 = materias.slice(0).sort(function (a, b) {
        return (esCal(b.promedio) || 0) - (esCal(a.promedio) || 0);
      });
      agg.matOrden = orden2;
      html += simuladorHtml(orden2) + estadisticasHtml();
    }

    renderEn('contenido-rendimiento', html);
    if (seg === 'simulador') calcSim();
    return html;
  }

  /* Objetivos personales por materia */
  function objetivosHtml(materias) {
    if (!materias.length) return '';
    var conNotas = materias.filter(function (m) { return esCal(m.promedio) != null; });
    if (!conNotas.length) return '';
    var html = '<div class="tarjeta"><h2 class="seccion" style="margin-top:0">🎯 Mis objetivos</h2>' +
      '<p class="sub" style="margin-bottom:.5rem">Define la nota que quieres alcanzar en cada materia. Se guarda en este dispositivo.</p>';
    conNotas.forEach(function (m) {
      var p = esCal(m.promedio);
      var meta = cfg.objMateria && cfg.objMateria[m.materia] != null ? cfg.objMateria[m.materia] : cfg.meta;
      var pct = Math.min(100, Math.round(p / Math.max(0.1, meta) * 100));
      var ok = p >= meta;
      html += '<div class="obj-item">' +
        '<span class="dot" style="background:' + colorMateria(m.materia) + ';width:.6rem;height:.6rem;flex-shrink:0"></span>' +
        '<div class="o-materia"><b>' + esc(m.materia) + '</b>' +
        '<span class="o-meta">meta ≥ <input type="number" min="1" max="10" step="0.5" value="' + meta + '" data-obj-materia="' + esc(m.materia) + '" style="width:3.4rem" aria-label="Meta para ' + esc(m.materia) + '"> · actual ' + fmtNum(p, 2) + '</span></div>' +
        '<div class="o-barra" aria-hidden="true"><div class="o-fill ' + (ok ? 'ok' : 'no') + '" style="width:' + pct + '%"></div></div>' +
        '<span class="badge nota ' + sisColor(p) + '">' + (ok ? '✅' : '⏳') + '</span>' +
        '</div>';
    });
    return html + '</div>';
  }

  /* Predicción: qué necesitas en lo que queda del periodo */
  function prediccionesHtml(materias) {
    var htmls = [];
    materias.forEach(function (m) {
      var p = esCal(m.promedio);
      if (p == null) return;
      var n = m.actividades;
      var r = pendientesActivos().filter(function (e) {
        return e.materia === m.materia && !e.personal;
      }).length;
      if (!r) return;
      var meta = (cfg.objMateria && cfg.objMateria[m.materia] != null) ? cfg.objMateria[m.materia] : cfg.meta;
      var necesario = (meta * (n + r) - p * n) / r;
      if (necesario <= 0) {
        htmls.push('<div class="fila-per"><span><strong>' + esc(m.materia) + '</strong> <span class="sub">(' + r + ' pendientes)</span></span><span class="verde">🎯 meta asegurada</span></div>');
      } else if (necesario > 10) {
        htmls.push('<div class="fila-per"><span><strong>' + esc(m.materia) + '</strong> <span class="sub">(' + r + ' pendientes)</span></span><span class="rojo"> imposible con ' + r + ' restantes</span></div>');
      } else {
        var cls = necesario > meta ? 'ambar' : 'verde';
        htmls.push('<div class="fila-per"><span><strong>' + esc(m.materia) + '</strong> <span class="sub">(' + r + ' pendientes)</span></span>' +
          '<span class="' + cls + ' mono" style="font-weight:800">necesitas ' + fmtNum(necesario, 1) + ' de promedio</span></div>');
      }
    });
    if (!htmls.length) return '';
    return '<div class="tarjeta"><h2 class="seccion" style="margin-top:0">🔮 Predicción del periodo</h2>' +
      '<p class="sub" style="margin-bottom:.5rem">Con tus ' + fmtNum(cfg.meta, 1) + ' de meta (o la que definiste por materia):</p>' +
      htmls.join('') + '</div>';
  }

  /* Historial general: promedio de promedios por periodo */
  function periodosHistorial(materias) {
    var porPeriodo = {};
    materias.forEach(function (m) {
      (m.periodos || []).forEach(function (p) {
        var v = esCal(p.promedio);
        if (v == null) return;
        var k = p.nombre || ('Periodo ' + p.codi);
        (porPeriodo[k] = porPeriodo[k] || []).push(v);
      });
    });
    var claves = Object.keys(porPeriodo).sort();
    if (claves.length < 1) return '';
    var html = '<div class="tarjeta"><h2 class="seccion" style="margin-top:0">📚 Historial por periodo</h2>';
    var prev = null;
    claves.forEach(function (k) {
      var vals = porPeriodo[k];
      var prom = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
      var flecha = prev == null ? '' :
        prom > prev ? '<span class="tend sube">▲ +' + fmtNum(prom - prev, 1) + '</span>' :
          prom < prev ? '<span class="tend baja">▼ −' + fmtNum(prev - prom, 1) + '</span>' : '<span class="tend igual">=</span>';
      html += '<div class="fila-per"><span><strong>' + esc(k) + '</strong> <span class="sub">(' + vals.length + ' materias)</span></span>' +
        '<span><span class="mono ' + sisColor(prom) + '" style="font-weight:800">' + fmtNum(prom, 2) + '</span> ' + flecha + '</span></div>' +
        '<div class="barra-p" style="margin:.25rem 0"><span class="b-track"><span class="b-fill ' + sisColor(prom) + '" style="width:' + Math.round(prom * 10) + '%"></span></span></div>';
      prev = prom;
    });
    return html + '</div>';
  }

  function simuladorHtml(orden) {
    if (!orden.length) return '';
    return '<h2 class="seccion">Simulador</h2><div class="tarjeta sim">' +
      '<div class="sim-grid">' +
      '<label>Materia<select id="sim-materia">' +
      orden.map(function (m) { return '<option value="' + esc(m.materia) + '">' + esc(m.materia) + ' (' + fmtNum(esCal(m.promedio), 2) + ')</option>'; }).join('') +
      '</select></label>' +
      '<label>Nota que quieres alcanzar<input type="number" id="sim-meta" min="1" max="10" step="0.1" value="' + cfg.meta + '"></label>' +
      '<label>Actividades al 10<input type="number" id="sim-k" min="0" max="30" step="1" value="3"></label>' +
      '</div><div class="sim-res" id="sim-res"></div></div>';
  }
  function calcSim() {
    var sel = document.getElementById('sim-materia');
    if (!sel) return;
    var meta = parseFloat($('#sim-meta').value) || 9;
    var k = parseInt($('#sim-k').value || '0', 10);
    var orden = agg.matOrden || [];
    var m = null;
    for (var i = 0; i < orden.length; i++) if (orden[i].materia === sel.value) m = orden[i];
    var out = $('#sim-res'); if (!out) return;
    if (!m || esCal(m.promedio) == null) { out.textContent = 'Elige una materia con notas.'; return; }
    var p = esCal(m.promedio); var n = m.actividades;
    var nuev = Math.round(((p * n + 10 * k) / Math.max(1, n + k)) * 100) / 100;
    var restante = p >= meta ? 0 : Math.max(1, Math.ceil(n * (meta - p) / Math.max(0.1, 10 - meta)));
    var necesidad = p >= meta ? 0 : Math.max(0, Math.min(10, Math.round((meta * (n + 1) - p * n) * 100) / 100));
    out.innerHTML = 'Con <strong>' + k + '</strong> actividad(es) de 10 en <strong>' + esc(m.materia) + '</strong>, tu promedio pasaría de ' +
      '<span class="badge nota ' + sisColor(p) + '">' + fmtNum(p, 2) + '</span> a ' +
      '<span class="badge nota ' + sisColor(nuev) + '">' + fmtNum(nuev, 2) + '</span>. ' +
      (restante === 0 ? '🎯 Ya alcanzas tu meta de ' + fmtNum(meta, 1) + '.' :
        'Para llegar a <strong>' + fmtNum(meta, 1) + '</strong> necesitas aprox. <strong>' + restante + '</strong> nota(s) de 10 más. ' +
        'En tu <strong>próxima evaluación</strong> necesitarías al menos <strong>' + fmtNum(necesidad, 1) + '</strong>.');
  }

  function estadisticasHtml() {
    if (!state.datos) return '';
    var hoyD = new Date(); var hoyIso = fechaISO(hoyD);
    var done = 0, evs = agendaTodo();
    for (var i = 0; i < evs.length; i++) { if (HECHAS[evs[i].id]) done++; }
    var activos = 0;
    for (var n = 0; n < 60; n++) {
      var dd = addDays(hoyD, -n);
      if (eventosDia(dd).length) activos++;
    }
    var cargaPorDow = [0, 0, 0, 0, 0, 0, 0];
    var cntPorDow = [0, 0, 0, 0, 0, 0, 0];
    evs.forEach(function (e) {
      if (!e.fecha_inicio) return;
      var d = parseLocal(e.fecha_inicio);
      if (!isNaN(d.getTime())) { cargaPorDow[d.getDay()]++; cntPorDow[d.getDay()]++; }
    });
    var dowHtml = '';
    for (var k = 1; k <= 6; k++) {
      var dowVal = cargaPorDow[k];
      var pct = Math.min(100, Math.round(dowVal / Math.max.apply(null, cargaPorDow) * 100));
      if (dowVal > 0) dowHtml += '<div class="stat"><div class="s-t"><b>' + esc(DIAS[k].slice(0, 3)) + '</b><span>' + dowVal + '</span></div><div class="s-b"><div class="s-f" style="width:' + pct + '%"></div></div></div>';
    }
    return (done || activos ? '<div class="tarjeta"><h2 class="seccion" style="margin-top:0">📈 Estadísticas</h2>' +
      '<div class="stat"><div class="s-t"><b>Pendientes que completaste</b><span>' + done + ' ✅</span></div></div>' +
      '<div class="stat"><div class="s-t"><b>Días con actividad (últimos 60)</b><span>' + activos + '</span></div></div>' + dowHtml + '</div>' : '');
  }

  function riesgoCard(materias) {
    var riesgo = materias.filter(function (m) { return esCal(m.promedio) != null && esCal(m.promedio) < cfg.riesgo; });
    if (!riesgo.length) return '';
    return '<div class="riesgo-card">⚠️ Materias en riesgo (promedio &lt; ' + cfg.riesgo + '): ' +
      riesgo.map(function (m) { return '<span class="badge nota rojo">' + esc(m.materia) + ' · ' + fmtNum(m.promedio, 1) + '</span>'; }).join(' ') +
      '<span class="sub">Considera repasar antes del próximo parcial.</span></div>';
  }
  function destacados(orden) {
    var mejor = orden[0], peor = orden[orden.length - 1];
    if (!mejor) return '<div class="vacio" style="padding:1.2rem">Sin datos.</div>';
    return '<div class="dest-col"><h4>🏆 Mejor</h4>' +
      '<div class="dest-item">' + esc(mejor.materia) + '<span class="sub">' + fmtNum(mejor.promedio, 2) + ' de promedio sobre ' + mejor.actividades + ' actividades</span></div></div>' +
      '<div class="dest-col"><h4>📉 A reforzar</h4>' +
      '<div class="dest-item">' + esc(peor.materia) + '<span class="sub">' + fmtNum(peor.promedio, 2) + ' de promedio</span></div></div>';
  }
  function histograma(materias) {
    var bins = [0, 0, 0, 0, 0];
    materias.forEach(function (m) {
      var p = esCal(m.promedio);
      if (p == null) return;
      var b = Math.max(0, Math.min(4, Math.floor(p / 2)));
      bins[b]++;
    });
    var max = Math.max.apply(null, bins) || 1;
    var html = '<div class="tarjeta"><h2 class="seccion" style="margin-top:0">Distribución de promedios</h2>' +
      '<div class="barra-p" style="margin-top:.8rem"><span class="b-lbl">&lt;2</span><span class="b-track"><span class="b-fill rojo" style="width:' + (bins[0] / max * 100) + '%"></span></span><span class="b-val">' + bins[0] + '</span></div>' +
      '<div class="barra-p"><span class="b-lbl">2–4</span><span class="b-track"><span class="b-fill rojo" style="width:' + (bins[1] / max * 100) + '%"></span></span><span class="b-val">' + bins[1] + '</span></div>' +
      '<div class="barra-p"><span class="b-lbl">4–6</span><span class="b-track"><span class="b-fill ambar" style="width:' + (bins[2] / max * 100) + '%"></span></span><span class="b-val">' + bins[2] + '</span></div>' +
      '<div class="barra-p"><span class="b-lbl">6–8</span><span class="b-track"><span class="b-fill" style="width:' + (bins[3] / max * 100) + '%"></span></span><span class="b-val">' + bins[3] + '</span></div>' +
      '<div class="barra-p"><span class="b-lbl">8–10</span><span class="b-track"><span class="b-fill verde" style="width:' + (bins[4] / max * 100) + '%"></span></span><span class="b-val">' + bins[4] + '</span></div>' +
      '</div>';
    return html;
  }

  function tendencia(m) {
    if (!state.datos) return '<td><span class="tend igual">·</span></td>';
    var ns = [];
    state.datos.agenda.forEach(function (e) {
      if (e.materia !== m.materia) return;
      var n = esCal(e.calificacion);
      if (n != null) ns.push(n);
    });
    if (ns.length < 2) return '<td><span class="tend igual">·</span></td>';
    var ult = ns[ns.length - 1], ant = ns[ns.length - 2];
    if (ult > ant) return '<td><span class="tend sube">▲ +' + Math.round((ult - ant) * 100) / 100 + '</span></td>';
    if (ult < ant) return '<td><span class="tend baja">▼ −' + Math.round((ant - ult) * 100) / 100 + '</span></td>';
    return '<td><span class="tend igual">=</span></td>';
  }

  function evoSvg() {
    if (!state.datos) return '';
    var ns = [];
    state.datos.agenda.forEach(function (e) {
      var n = esCal(e.calificacion);
      if (n != null) ns.push(n);
    });
    if (!ns.length) return '<div class="sub">Sin notas para graficar.</div>';
    var max = Math.ceil(Math.max.apply(null, ns));
    var minTF = Math.max(0, Math.floor(Math.min.apply(null, ns)));
    var prev = null; var pts = ''; var line = ''; var np = ns.length;
    ns.forEach(function (n, i) {
      var x = Math.round(6 + i * ((evoW - 12) / Math.max(1, np - 1)));
      var y = Math.round(evoH - 8 - ((n - minTF) / Math.max(1, max - minTF)) * (evoH - 20));
      pts += '<circle cx="' + x + '" cy="' + y + '" r="2.6" fill="var(--acento)"/>';
      if (prev != null) line += 'L' + x + ' ' + y + ' '; else line += 'M' + x + ' ' + y + ' ';
      prev = true;
    });
    return '<svg class="evo" viewBox="0 0 ' + evoW + ' ' + evoH + '" preserveAspectRatio="none">' +
      '<line x1="6" y1="' + (evoH - 14) + '" x2="' + (evoW - 6) + '" y2="' + (evoH - 14) + '" stroke="var(--borde)" stroke-width="1"/>' +
      '<path d="' + line.trim() + '" fill="none" stroke="var(--acento)" stroke-width="2.2" stroke-linejoin="round"/>' + pts +
      '</svg>';
  }

  function matDetalle(idx) {
    var m = agg.matOrden[idx]; if (!m) return;
    var p = esCal(m.promedio);
    var n = m.actividades;
    var pendM = pendientesActivos().filter(function (e) { return e.materia === m.materia && !e.personal; });
    var impacto = (p != null && (n + pendM.length) > 0) ? Math.round(100 / (n + pendM.length) * 10) / 10 : null;
    var doc = docenteDe(m.materia);
    return {
      materia: m.materia,
      html: '<div class="fila-detalle"><div class="tarjeta">' +
        '<h2 class="seccion" style="margin-top:0">' + esc(m.materia) + '</h2>' +
        (doc ? '<div class="sub" style="margin-bottom:.4rem">👨‍🏫 Docente: <strong>' + esc(doc) + '</strong></div>' : '') +
        '<div class="caja-prom">' +
        '<div class="pp"><span class="pp-val ' + sisColor(m.promedio) + '">' + fmtNum(m.promedio, 2) + '</span><span class="pp-lbl">Promedio</span></div>' +
        '<div class="pp"><span class="pp-val">' + m.actividades + '</span><span class="pp-lbl">Actividades</span></div>' +
        '<div class="pp"><span class="pp-val">' + fmtNum(m.minima, 1) + '</span><span class="pp-lbl">Mínima</span></div>' +
        '</div>' +
        (impacto != null ? '<div class="fila-per" style="margin-top:.5rem"><span>📌 Impacto de cada próxima actividad</span>' +
          '<span class="mono" style="font-weight:800">~' + impacto + '% del promedio</span></div>' : '') +
        (pendM.length ? '<h2 class="seccion">Pendientes (' + pendM.length + ')</h2>' +
          pendM.slice(0, 4).map(function (e) { return cardEvento(e, { compacta: true, prioridades: true }); }).join('') : '') +
        (m.periodos && m.periodos.length ? '<h2 class="seccion">Por periodo</h2>' +
          m.periodos.map(function (p2) {
            var pp = esCal(p2.promedio);
            var porc = pp == null ? 0 : Math.round(pp * 10);
            return '<div class="fila-per"><span><strong>' + esc(p2.nombre) + '</strong> <span class="sub">(' + p2.actividades + ' act.)</span></span>' +
              '<span class="mono ' + (pp != null ? sisColor(pp) : '') + '">' + fmtNum(pp, 2) + '</span></div>' +
              '<div class="barra-p"><span class="b-track"><span class="b-fill ' + (pp != null ? sisColor(pp) : '') + '" style="width:' + porc + '%"></span></span></div>';
          }).join('') : '') +
        '<div style="margin-top:.7rem;display:flex;gap:.5rem;flex-wrap:wrap">' +
        '<button class="btn ghost mini" data-accion="mat-abrir" data-materia="' + esc(m.materia) + '">📚 Ver materia completa</button>' +
        '<button class="btn ghost mini" data-accion="flash-nueva" data-materia="' + esc(m.materia) + '">🃏 Nueva flashcard</button></div>' +
        '</div></div>'
    };
  }

  /* ================= COMUNICADOS ================= */
  function renderComunicados() {
    if (!state.datos) { renderEn('contenido-comunicados', skeleton()); return; }
    var html = '<div class="chips scroll" style="margin-bottom:.3rem"><button class="chip activa" data-accion="com-tab" data-tab="todos">Todos</button>' +
      '<button class="chip" data-accion="com-tab" data-tab="mensajes">✉️ Mensajes</button>' +
      '<button class="chip" data-accion="com-tab" data-tab="circulares">📄 Circulares</button></div>' +
      '<input type="search" id="com-buscar" class="com-buscar" placeholder="🔎 Buscar en mensajes y circulares…" autocomplete="off">' +
      '<div id="com-lista">' + comListaHtml() + '</div>';
    renderEn('contenido-comunicados', html);
    setTimeout(function () {
      var el = $('#com-buscar'); if (el) el.addEventListener('input', function () { var l = $('#com-lista'); if (l) l.innerHTML = comListaHtml(); });
    }, 0);
  }

  function comListaHtml() {
    var q = ($('#com-buscar') ? $('#com-buscar').value : '').trim();
    if (!state.datos) return '';
    var html = '';
    var mensajes = state.datos.mensajes || [];
    var circulares = state.datos.circulares || [];
    if (agg.comTab === 'circulares') {
      html += '<h2 class="seccion">Circulares</h2>' + (circulares.length ? circulares.map(function (c, i) { return comCircular(c, i, q); }).join('') : '<div class="vacio">Sin circulares.</div>');
    } else if (agg.comTab === 'mensajes') {
      html += '<h2 class="seccion">Mensajes</h2>' + (mensajes.length ? mensajes.map(function (m, i) { return comMensaje(m, i, q); }).join('') : '<div class="vacio">Sin mensajes.</div>');
    } else {
      html += '<h2 class="seccion">Mensajes</h2>' + (mensajes.length ? mensajes.map(function (m, i) { return comMensaje(m, i, q); }).join('') : '<div class="vacio">Sin mensajes.</div>') +
        '<h2 class="seccion">Circulares</h2>' + (circulares.length ? circulares.map(function (c, i) { return comCircular(c, i, q); }).join('') : '<div class="vacio">Sin circulares.</div>');
    }
    return html;
  }
  function claveMsg(id) { return 'm' + id; }
  function claveCirc(c) { return 'c' + c.titulo + '|' + (c.fecha || ''); }
  function comMensaje(m, idx, q) {
    var cl = claveMsg(m.id);
    var leido = esLeido(cl);
    return '<div class="com-card que" data-clave="' + esc(cl) + '">' +
      '<div style="display:flex;gap:.6rem"><div class="com-ico">✉️</div><div style="flex:1;min-width:0">' +
      '<div class="c-tit">' + marcar(m.asunto, q) + '</div>' +
      '<div class="c-sub">' + esc(m.remitente || 'Remitente') + (m.fecha ? ' · ' + esc(m.fecha) : '') + '</div></div></div>' +
      '<div class="com-meta"><span>' + (leido ? '✓ Leído' : '<strong style="color:var(--acento)">Nuevo</strong>') + '</span>' +
      '<span class="acc"><button class="acc-btn ' + (leido ? 'on' : '') + '" data-accion="leido" data-clave="' + esc(cl) + '" title="Marcar leído">✓</button>' +
      '<button class="acc-btn ' + (FAV[cl] ? 'on' : '') + '" data-accion="fav" data-clave="' + esc(cl) + '" title="Favorito">★</button></span></div></div>';
  }
  function comCircular(c, idx, q) {
    var cl = claveCirc(c);
    var leido = esLeido(cl);
    return '<div class="com-card"><div style="display:flex;gap:.6rem"><div class="com-ico">📄</div><div style="flex:1;min-width:0">' +
      '<div class="c-tit">' + marcar(c.titulo, q) + '</div>' +
      '<div class="c-sub">' + marcar(c.descripcion || 'Circular', q) + (c.fecha ? ' · ' + esc(c.fecha) : '') + '</div></div></div>' +
      '<div class="com-meta"><span>' + (leido ? '✓ Leído' : '<strong style="color:var(--acento)">Nuevo</strong>') + '</span>' +
      '<span class="acc"><button class="acc-btn ' + (leido ? 'on' : '') + '" data-accion="leido" data-clave="' + esc(cl) + '" title="Leído">✓</button>' +
      '<button class="acc-btn ' + (FAV[cl] ? 'on' : '') + '" data-accion="fav" data-clave="' + esc(cl) + '" title="Favorito">★</button>' +
      (c.url ? '<button class="btn mini" data-accion="pdf-circ" data-url="' + esc(c.url) + '">📥 PDF</button>' : '') +
      '</span></div></div>';
  }

  /* ================= OVERLAYS ================= */
  function openOverlay(id) { document.getElementById(id).classList.add('abierto'); }
  function closeOverlay(id) { document.getElementById(id).classList.remove('abierto'); if (id === 'overlay-nota') { notaNueva = false; } }
  function cerrarPaneles() {
    closeOverlay('overlay-ajustes'); closeOverlay('overlay-dia'); closeOverlay('overlay-nota');
    closeOverlay('overlay-rec'); closeOverlay('overlay-tarea'); closeOverlay('overlay-palette');
    closeOverlay('overlay-enfoque');
    closeOverlay('overlay-materia'); closeOverlay('overlay-examen');
    closeOverlay('overlay-flash'); closeOverlay('overlay-nuevaflash');
    closeOverlay('overlay-info');
    cerrarCampana(); cerrarBusqueda();
  }

  function renderDiaOverlay(iso) {
    diaActual = iso;
    var dd = parseLocal(iso);
    $('#dia-titulo').innerHTML = DIAS[dd.getDay()] + ', ' + dd.getDate() + ' de ' + MESES[dd.getMonth()] +
      ' <span style="margin-left:auto"></span><button class="x" data-accion="dia-cerrar">✕</button>';
    var evs = eventosDia(dd);
    var html = evs.map(function (e) {
      return '<div class="card' + (HECHAS[e.id] === true ? ' hecha' : '') + (e.personal ? ' personal' : '') +
        '" style="border-left-color:' + (esExamen(e.titulo) ? 'var(--rojo)' : colorMateria(e.materia)) + '">' +
        '<div class="info"><div class="materia">' + (e.personal ? '✏️ MIS PENDIENTES · ' : '') +
        esc(e.materia || 'General') + (esExamen(e.titulo) ? ' · <span style="color:var(--rojo)">EXAMEN</span>' : '') + '</div>' +
        '<div class="titulo">' + esc(e.titulo) + '</div>' +
        '<div class="fecha-min">' + (e.periodo_codi ? esc(e.periodo_codi) + ' · ' : '') + esc(e.fecha_inicio || '') + '</div></div>' +
        '<span class="chips-der">' + badgeNota(e.calificacion) + accionesEvento(e.id, false, !!e.personal) + '</span></div>';
    }).join('');
    if (evs.length) {
      var mats = {};
      evs.forEach(function (e) {
        if (!e.personal && e.materia) {
          (mats[e.materia] = mats[e.materia] || { items: materialesMateria(e.materia) });
        }
      });
      var sec = Object.keys(mats).filter(function (m) { return mats[m].items.length; });
      if (!MATER && !materialesCargando) {
        mats.__nota = 1;
      }
      if (sec.length) {
        html += '<div class="mat-seccion"><div class="mat-h">📎 Material del aula virtual</div>';
        sec.forEach(function (nom) {
          html += '<div class="mat-item"><div class="mi"><span class="mi-strong">' + esc(nom) + '</span></div>';
          html += '<div class="ax" style="flex:1">';
          mats[nom].items.slice(0, 4).forEach(function (it) {
            html += '<div style="display:flex;justify-content:space-between;gap:.5rem;align-items:center;padding:.35rem 0;font-size:.83rem;border-bottom:1px dashed var(--borde)">' +
              '<span style="flex:1;min-width:0;font-weight:600">' + esc(it.titulo) + (it.publicado_en ? ' <span class=\'sub\' style=\'font-weight:400\'>' + esc(it.publicado_en) + '</span>' : '') + '</span>';
            var archivoBtn = (it.archivos || []).map(function (a) {
              return '<a class="acc-btn" href="' + API + 'api/descargar?url=' + encodeURIComponent(a.url) + '&nombre=' + encodeURIComponent(a.nombre) +
                '" target="_blank" title="Descargar ' + esc(a.nombre) + '">⤓</a>';
            }).join('');
            if (archivoBtn) html += '<span style="display:inline-flex;gap:.3rem;flex-shrink:0">' + archivoBtn + '</span>';
            html += '</div>';
          }).join('');
          if (mats[nom].items.length > 4) html += '<div class="sub" style="margin-top:.2rem">+' + (mats[nom].items.length - 4) + ' más en el aula virtual</div>';
          html += '</div></div>';
        });
        html += '</div>';
      } else if (!MATER) {
        html += '<div class="mat-seccion" style="margin-top:.4rem"><div class="mat-h">📎 Material</div>' +
          '<div class="sub">' + (materialesCargando ? 'Cargando materiales del aula…' : 'Se cargarán al entrar a ' + esc(state.vista) + ' y se guardarán localmente.') + '</div></div>';
      }
    }
    if (diaActual === fechaISO(new Date())) {
      html += '<div style="text-align:right;margin-top:.4rem;display:flex;gap:.4rem;justify-content:flex-end;flex-wrap:wrap">' +
        '<button class="btn ghost mini" data-accion="pt-add" data-fecha="' + diaActual + '">＋ Añadir pendiente hoy</button>' +
        '<button class="btn ghost mini" data-accion="copiar-dia" data-fecha="' + diaActual + '">📋 Copiar pendientes</button>' +
        '<button class="btn ghost mini" data-accion="dia-share" data-fecha="' + diaActual + '">🔗 Compartir día</button></div>';
    } else if (evs.length) {
      html += '<div style="text-align:right;margin-top:.4rem;display:flex;gap:.4rem;justify-content:flex-end;flex-wrap:wrap">' +
        '<button class="btn ghost mini" data-accion="copiar-dia" data-fecha="' + diaActual + '">📋 Copiar pendientes</button>' +
        '<button class="btn ghost mini" data-accion="dia-share" data-fecha="' + diaActual + '">🔗 Compartir día</button></div>';
    }
    $('#dia-lista').innerHTML = evs.length || html.includes('mat-seccion') ? html : '<div class="vacio">Sin actividades este día.</div>';
    openOverlay('overlay-dia');
  }

  function renderTareaOverlay(fechaSugerida) {
    var el = $('#dl-mats');
    if (el) {
      el.innerHTML = materiasUnicas().map(function (m) { return '<option value="' + esc(m) + '">'; }).join('');
    }
    $('#pt-fecha').value = fechaSugerida || '';
    $('#pt-titulo').value = '';
    $('#pt-materia').value = '';
    openOverlay('overlay-tarea');
    setTimeout(function () { var t = $('#pt-titulo'); if (t) t.focus(); }, 60);
  }
  function guardarTarea() {
    var titulo = ($('#pt-titulo').value || '').trim();
    if (!titulo) { toast('Escribe el título de la tarea.', 'err'); return; }
    var p = { id: 'pap' + Date.now(), titulo: titulo, fecha: $('#pt-fecha').value || fechaISO(new Date()), materia: $('#pt-materia').value.trim() || '' };
    if (p.fecha === fechaISO(new Date()) && !$('#pt-fecha').value) p.fecha = fechaISO(new Date());
    PT.push(p);
    guardarPT();
    closeOverlay('overlay-tarea');
    toast('✏️ Pendiente guardado');
    renderVistaActual();
  }
  function borrarTarea(id) {
    var clave = id.replace(/^pt-/, '');
    PT = PT.filter(function (p) { return p.id !== clave; });
    guardarPT();
    toast('🗑️ Pendiente eliminado');
    renderVistaActual();
  }

  /* ================= COMODIDAD / TAREAS-FORM YA INCLUIDAS ARRIBA ================= */

  /* ================= COMMAND PALETTE ================= */
  var COMANDOS = [
    { ico: '🏠', tit: 'Ir a Inicio', cmd: 'ir:inicio', g: 'Vistas' },
    { ico: '📅', tit: 'Ir a Semana', cmd: 'ir:semana', g: 'Vistas' },
    { ico: '📚', tit: 'Ir a Materias', cmd: 'ir:materias', g: 'Vistas' },
    { ico: '📝', tit: 'Ir a Pendientes', cmd: 'ir:pendientes', g: 'Vistas' },
    { ico: '📊', tit: 'Ir a Rendimiento', cmd: 'ir:rendimiento', g: 'Vistas' },
    { ico: '🗓️', tit: 'Calendario del mes (en Semana)', cmd: 'ir:calendario', g: 'Vistas' },
    { ico: '📌', tit: 'Ir a Evaluaciones', cmd: 'ir:evaluaciones', g: 'Vistas' },
    { ico: '📣', tit: 'Ir a Comunicados', cmd: 'ir:comunicados', g: 'Vistas' },
    { ico: '📂', tit: 'Ir a Documentos', cmd: 'ir:documentos', g: 'Vistas' },
    { ico: '🧠', tit: 'Ir a Estudio', cmd: 'ir:estudio', g: 'Vistas' },
    { ico: '⋯', tit: 'Ir a Más', cmd: 'ir:mas', g: 'Vistas' },
    { ico: '🔭', tit: 'Modo enfoque', cmd: 'do:enfoque', g: 'Modos' },
    { ico: '🃏', tit: 'Repasar flashcards', cmd: 'do:flash', g: 'Acciones' },
    { ico: '🍅', tit: 'Ir a Pomodoro', cmd: 'do:estudio', g: 'Acciones' },
    { ico: '✏️', tit: 'Nuevo pendiente personal', cmd: 'do:pt:add', g: 'Acciones' },
    { ico: '🌙', tit: 'Alternar modo oscuro', cmd: 'do:dark', g: 'Modos' },
    { ico: '↻', tit: 'Recargar datos', cmd: 'do:refresh', g: 'Acciones' },
    { ico: '🖨️', tit: 'Imprimir semana', cmd: 'do:print', g: 'Acciones' },
    { ico: '📥', tit: 'Exportar notas CSV', cmd: 'do:csv', g: 'Exportar' },
    { ico: '🗓️', tit: 'Exportar agenda .ics', cmd: 'do:ics-agenda', g: 'Exportar' },
    { ico: '🗂️', tit: 'Exportar expediente JSON', cmd: 'do:exp', g: 'Exportar' },
    { ico: '⚙️', tit: 'Abrir ajustes', cmd: 'do:ajustes', g: 'Modos' }
  ];
  var PAL_ITEMS = [];
  var PAL_SEL = -1;
  function abrirPalette(precarga) {
    var inp = $('#pal-input');
    if (inp) inp.value = precarga || '';
    openOverlay('overlay-palette');
    renderPalette(precarga || '');
    setTimeout(function () { var i = $('#pal-input'); if (i) { i.focus(); if (precarga) i.select(); } }, 55);
  }
  function renderPalette(q) {
    q = String(q || '').toLowerCase().trim();
    var items = [];
    COMANDOS.forEach(function (c) {
      if (!q || c.tit.toLowerCase().indexOf(q) >= 0 || (c.g || '').toLowerCase().indexOf(q) >= 0) {
        items.push({ ico: c.ico, tit: c.tit, sub: c.g || 'Comando', accion: 'pal-cmd', dato: c.cmd, tipo: 'comando' });
      }
    });
    if (q && state.datos) {
      var lista = agendaTodo();
      for (var i = 0; i < 60 && items.length < 16; i++) {
        if (i >= lista.length) break;
        var e = lista[i];
        var t = (e.titulo + ' ' + (e.materia || '')).toLowerCase();
        if (t.indexOf(q) >= 0) items.push({ ico: e.personal ? '✏️' : (esExamen(e.titulo) ? '📌' : '🗂️'), tit: e.titulo, sub: (e.materia || 'General') + ' · ' + (e.fecha_inicio || 'sin fecha'), accion: 'dia-iso', dato: e.fecha_inicio, tipo: 'actividad' });
      }
      (state.datos.mensajes || []).forEach(function (m) {
        if (items.length >= 16) return;
        if (String(m.asunto || '').toLowerCase().indexOf(q) >= 0) items.push({ ico: '✉️', tit: m.asunto, sub: 'Mensaje', accion: 'pal-com', dato: 'mensajes', tipo: 'mensaje' });
      });
      (state.datos.circulares || []).forEach(function (c) {
        if (items.length >= 16) return;
        if ((c.titulo + ' ' + (c.descripcion || '')).toLowerCase().indexOf(q) >= 0) items.push({ ico: '📄', tit: c.titulo, sub: 'Circular', accion: 'pal-com', dato: 'circulares', tipo: 'circular' });
      });
      ((state.datos.resumen || {}).materias || []).forEach(function (m) {
        if (items.length >= 16) return;
        if (String(m.materia || '').toLowerCase().indexOf(q) >= 0) items.push({ ico: '📊', tit: m.materia, sub: 'Promedio ' + fmtNum(m.promedio, 2), accion: 'ir:notas', dato: m.materia, tipo: 'materia' });
      });
      (PLAN || []).forEach(function (p) {
        if (items.length >= 16 || !p.docente) return;
        if (String(p.docente).toLowerCase().indexOf(q) >= 0 || String(p.materia).toLowerCase().indexOf(q) >= 0) {
          items.push({ ico: '👨‍🏫', tit: p.docente, sub: 'Docente de ' + p.materia, accion: 'pal-docente', dato: p.materia, tipo: 'docente' });
        }
      });
      PT.forEach(function (p) {
        if (items.length >= 16) return;
        if (String(p.titulo || '').toLowerCase().indexOf(q) >= 0) {
          items.push({ ico: '✏️', tit: p.titulo, sub: 'Pendiente personal' + (p.fecha ? ' · ' + p.fecha : ''), accion: 'ir:pendientes', dato: null, tipo: 'personal' });
        }
      });
      FLASH.forEach(function (c) {
        if (items.length >= 16) return;
        if (String(c.f + ' ' + c.r).toLowerCase().indexOf(q) >= 0) {
          items.push({ ico: '🃏', tit: truncNombre(c.f, 40), sub: 'Flashcard' + (c.m ? ' · ' + c.m : ''), accion: 'ir:estudio', dato: null, tipo: 'flashcard' });
        }
      });
      (MATER || []).forEach(function (mt) {
        if (items.length >= 16) return;
        (mt.items || []).slice(0, 4).forEach(function (it) {
          if (items.length >= 16) return;
            if (String(it.titulo || '').toLowerCase().indexOf(q) >= 0 && it.archivos && it.archivos.length) {
            items.push({ ico: '📎', tit: it.titulo, sub: mt.materia + ' · ' + it.publicado_en, accion: 'pal-mat', dato: it.archivos[0].url, dato2: it.archivos[0].nombre, tipo: 'material' });
          }
        });
      });
      items.sort(function (a, b) { return (a.tipo === 'comando' ? 0 : 1) - (b.tipo === 'comando' ? 0 : 1); });
    }
    PAL_ITEMS = items;
    PAL_SEL = items.length ? 0 : -1;
    var out = PAL_ITEMS.map(function (it, i) {
      var esSel = i === PAL_SEL;
      return '<div class="pal-item' + (esSel ? ' seleccionado' : '') + '" data-pidx="' + i + '" data-accion="pal-exec">' +
        '<span class="ico">' + it.ico + '</span><span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(it.tit) + '</span>' +
        (it.sub ? '<span class="sub">' + esc(String(it.sub)).slice(0, 60) + '</span>' : '') + '</div>';
    }).join('');
    $('#pal-lista').innerHTML = out || '<div class="vacio">Sin resultados para «' + esc(q) + '».</div>';
  }
  function palCerrar() { closeOverlay('overlay-palette'); }
  function palEjecutar(i) {
    var it = PAL_ITEMS[i]; if (!it) return;
    palCerrar();
    if (it.accion === 'pal-cmd') { ejecutarComando(it.dato); return; }
    if (it.accion === 'dia-iso') { cambiarTab('calendario'); renderDiaOverlay(it.dato); return; }
    if (it.accion === 'pal-com') { agg.comTab = it.dato; cambiarTab('comunicados'); return; }
    if (it.accion === 'pal-mat') { window.open(API + 'api/descargar?url=' + encodeURIComponent(it.dato) + (it.dato2 ? '&nombre=' + encodeURIComponent(it.dato2) : ''), '_blank'); return; }
    if (it.accion === 'pal-docente') { cambiarTab('materias'); setTimeout(function () { abrirMateria(it.dato); }, 60); return; }
    if (String(it.accion).indexOf('ir:') === 0) cambiarTab(it.accion.split(':')[1]);
  }
  function ejecutarComando(cmd) {
    if (cmd.indexOf('ir:') === 0) { cambiarTab(cmd.slice(3)); return; }
    var acc = cmd.slice(3);
    if (acc === 'enfoque') abrirEnfoque();
    else if (acc === 'pt:add') renderTareaOverlay();
    else if (acc === 'dark') { cfg.dark = !cfg.dark; guardarCfg(); aplicarVisuales(); }
    else if (acc === 'flash') { cambiarTab('estudio'); abrirFlashRepaso(); }
    else if (acc === 'estudio') cambiarTab('estudio');
    else if (acc === 'refresh') recargar();
    else if (acc === 'print') { cambiarTab('semana'); setTimeout(function () { window.print(); }, 200); }
    else if (acc === 'csv') exportarCSV();
    else if (acc === 'ics') exportarHorario();
    else if (acc === 'ics-agenda') window.open(API + 'api/calendario.ics', '_blank');
    else if (acc === 'exp') exportarExpediente();
    else if (acc === 'ajustes') { openOverlay('overlay-ajustes'); renderAjustes(); }
  }

  /* ================= MODO ENFOQUE ================= */
  function abrirEnfoque() {
    cerrarBusqueda();
    openOverlay('overlay-enfoque');
    renderEnfoque();
  }
  function renderEnfoque() {
    var cont = $('#enfoque-contenido');
    if (!cont) return;
    var c = claseActual();
    var hoy = eventosDia(new Date()).filter(function (e) {
      return !(cfg.ocultarHechas && HECHAS[e.id]) && esCal(e.calificacion) == null;
    });
    hoy = hoy.slice(0, 4);
    var prog = 0, txt = '—', nm = 'Sin clase ahora', sub = 'Día en curso';
    var CIRC = 2 * Math.PI * 100;
    if (c.actual) {
      var i0 = aMin(c.actual.hora_inicio) || 0, i1 = aMin(c.actual.hora_fin) || (i0 + 45);
      prog = Math.max(0, Math.min(1, (c.mins - i0) / Math.max(1, (i1 - i0))));
      txt = minAMm(Math.round(i1 - c.mins)) + ' restantes';
      nm = c.actual.materia; sub = c.actual.hora_inicio + ' – ' + c.actual.hora_fin;
    } else if (c.siguiente) {
      var ir = aMin(c.siguiente.hora_inicio) || 0;
      prog = 0;
      txt = 'Empieza en ' + minAMm(ir - c.mins);
      nm = c.siguiente.materia; sub = 'Próxima: ' + c.siguiente.hora_inicio;
    } else {
      prog = Math.max(0, Math.min(1, c.mins / 1440));
      txt = 'Tiempo libre';
      nm = '☀️ Sin clases por ahora'; sub = 'Holgura';
    }
    var pct = Math.round(prog * 100);
    var off = (CIRC * (1 - prog)).toFixed(1);
    var html = '<button class="x enf-hide" data-accion="enfoque-cerrar">✕</button>' +
      '<div class="enf-card">' +
      '<h2 class="enf-tit">' + esc(nm) + '</h2><div class="enf-sub">' + esc(sub) + '</div>' +
      '<div class="ring-wrap"><svg viewBox="0 0 220 220">' +
      '<defs><linearGradient id="gAcento" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--acento)"/><stop offset="1" stop-color="var(--acento-2)"/></linearGradient></defs>' +
      '<circle class="ring-track" cx="110" cy="110" r="100" stroke-width="14"/>' +
      '<circle class="ring-prog" id="enf-prog" cx="110" cy="110" r="100" stroke-width="14" stroke-dasharray="' + CIRC.toFixed(1) + '" stroke-dashoffset="' + off + '"/></svg>' +
      '<div class="ring-center"><span class="tiempo" id="enf-tiempo">' + txt + '</span><span class="ymater">' + esc(nm) + '</span>' +
      '<span class="sub" style="font-size:.68rem">' + pct + '%</span></div></div>' +
      (hoy.length
        ? '<div class="enf-lista">' + hoy.map(function (e) {
          return '<div class="enf-item"><span class="fas">▸</span><div style="flex:1"><strong>' + esc(e.titulo) + '</strong><div class="sub">' + esc(e.materia || 'General') + '</div></div>' +
            (HECHAS[e.id] ? '<span title="Hecha">✅</span>' : '') + '</div>';
        }).join('') + '</div>'
        : '') +
      '<div style="display:flex;gap:.5rem;flex-wrap:wrap;justify-content:center">' +
      '<button class="btn ghost" data-accion="enfoque-cerrar">← Volver</button>' +
      '<button class="btn ghost" data-accion="ia-completar" style="font-size:1rem">☑ Marca lo listo</button></div>' +
      '<div class="enf-by">Propósito: enfocarte en lo que toca ahora.</div>' +
      '</div>';
    cont.innerHTML = html;
  }
  function enfTick() {
    var o = $('#overlay-enfoque');
    if (!o || !o.classList.contains('abierto')) return;
    var c = claseActual();
    var pct = 0, txt = '—';
    if (c.actual) {
      var i0 = aMin(c.actual.hora_inicio) || 0, i1 = aMin(c.actual.hora_fin) || (i0 + 45);
      pct = Math.max(0, Math.min(1, (c.mins - i0) / Math.max(1, (i1 - i0))));
      txt = minAMm(Math.round(i1 - c.mins)) + ' restantes';
    } else if (c.siguiente) {
      var ir = aMin(c.siguiente.hora_inicio) || 0;
      txt = 'Empieza en ' + minAMm(ir - c.mins);
    } else {
      pct = Math.max(0, Math.min(1, c.mins / 1440));
      txt = 'Tiempo libre';
    }
    var CIRC = 2 * Math.PI * 100;
    var el = $('#enf-prog'); if (el) el.style.strokeDashoffset = (CIRC * (1 - pct)).toFixed(1);
    var tm = $('#enf-tiempo'); if (tm) tm.textContent = txt;
    if (Math.random() < 0.04) renderEnfoque(); /* recarga lista cada ~25s promedio */
  }


  function renderNotaOverlay() {
    var ev = eventoPorId(notaActual);
    if (!ev) { toast('No se encontró la actividad.', 'err'); return; }
    $('#nota-contexto').textContent = ev.materia + ' · ' + ev.titulo;
    $('#nota-texto').value = NP[notaActual] || '';
    notaNueva = true;
    openOverlay('overlay-nota');
  }
  function guardarNota() {
    if (!notaActual) return;
    var txt = $('#nota-texto').value.trim();
    if (txt) { NP[notaActual] = txt; guardarLS(LS_NP, NP); toast('📝 Nota guardada'); }
    else { delete NP[notaActual]; guardarLS(LS_NP, NP); toast('Nota eliminada'); }
    closeOverlay('overlay-nota');
    renderVistaActual();
  }
  function eliminarNota() {
    delete NP[notaActual]; guardarLS(LS_NP, NP);
    closeOverlay('overlay-nota');
    toast('🗑️ Nota eliminada');
    renderVistaActual();
  }

  function renderRecOverlay() {
    var ev = eventoPorId(recActual);
    if (!ev) { toast('Actividad no encontrada.', 'err'); return; }
    $('#rec-contexto').textContent = ev.materia + ' · ' + ev.titulo + ' · ' + (ev.fecha_inicio || 'sin fecha');
    openOverlay('overlay-rec');
  }
  function setRec(min) {
    if (!recActual) return;
    if (min > 0) {
      if (!notificacionPermitida()) {
        pedirPermiso();
        if (Notification.permission !== 'granted') { toast('Las notificaciones están bloqueadas.', 'err'); closeOverlay('overlay-rec'); return; }
      }
      REC[recActual] = min;
      guardarLS(LS_REC, REC);
      toast('⏰ Recordatorio en ' + (min >= 1440 ? '1 día' : min >= 60 ? (min / 60) + ' h' : min + ' min'));
    } else {
      delete REC[recActual];
      guardarLS(LS_REC, REC);
      toast('⏰ Recordatorio quitado');
    }
    closeOverlay('overlay-rec');
    renderVistaActual();
  }

  function renderAjustes() {
    var html = '';
    html += '<div class="aj-sec">🎨 Personalización</div>' +
      '<div class="aj-row"><span>Color de acento</span></div><div class="swatches">' +
      PRESETS_ACENTO.map(function (p) {
        return '<button class="sw' + (cfg.tema === p.h && !cfg.accentLibre && (cfg.temaS == null || cfg.temaS === p.s) ? ' activa' : '') +
          '" data-accion="tema-sw" data-h="' + p.h + '" data-s="' + p.s + '" data-l="' + p.l + '" title="' + p.n + '" aria-label="Tema ' + p.n + '" style="background:hsl(' + p.h + ',' + p.s + '%,' + p.l + '%)"></button>';
      }).join('') +
      '<label class="sw libre" style="position:relative;overflow:hidden;' + (cfg.accentLibre ? 'box-shadow:0 0 0 3px var(--acento-suave-2)' : '') + '" title="Color libre" aria-label="Color libre">' +
      '<input type="color" data-cfg="accentLibre" value="' + (cfg.accentLibre || '#ff6a00') + '" style="position:absolute;inset:-40%;width:180%;height:180%;border:none;padding:0;cursor:pointer;background:none">' +
      '<span style="pointer-events:none;font-size:1rem">🎨</span></label></div>' +
      '<div class="aj-row"><span>Estilo de tarjetas</span><div class="seg">' +
      '<button class="seg-btn' + (cfg.cardStyle !== 'solido' ? ' activa' : '') + '" data-accion="cfg-seg" data-set="cardStyle" data-v="glass">Glass</button>' +
      '<button class="seg-btn' + (cfg.cardStyle === 'solido' ? ' activa' : '') + '" data-accion="cfg-seg" data-set="cardStyle" data-v="solido">Sólidas</button></div></div>' +
      '<div class="aj-row"><span>🌙 Modo oscuro</span><span class="sw"><input type="checkbox" data-cfg="dark" ' + (cfg.dark ? 'checked' : '') + '></span></div>' +
      '<div class="aj-sec">🎯 Metas</div>' +
      '<div class="aj-row"><span>Meta de nota</span><span class="aj-val mono" data-cfg-val="meta">' + cfg.meta + '</span></div>' +
      '<input type="range" min="5" max="10" step="0.5" value="' + cfg.meta + '" data-cfg="meta" style="width:100%" aria-label="Meta de nota">' +
      '<div class="aj-row"><span>Meta semanal (pendientes)</span><input type="number" min="1" max="50" value="' + (cfg.metaSemanal || 10) + '" data-cfg="metaSemanal" class="field-num" aria-label="Meta semanal"></div>' +
      '<div class="aj-row"><span>⚠️ Umbral de riesgo</span><span class="aj-val mono" data-cfg-val="riesgo">' + cfg.riesgo + '</span></div>' +
      '<input type="range" min="4" max="9" step="1" value="' + cfg.riesgo + '" data-cfg="riesgo" style="width:100%" aria-label="Umbral de riesgo">' +
      '<div class="aj-sec">🧠 Estudio y avisos</div>' +
      '<div class="aj-row"><span>🍅 Pomodoro: minutos de enfoque</span><input type="number" min="10" max="60" value="' + (cfg.pomoFocus || 25) + '" data-cfg="pomoFocus" class="field-num" aria-label="Minutos de enfoque"></div>' +
      '<div class="aj-row"><span>☕ Minutos de descanso</span><input type="number" min="1" max="20" value="' + (cfg.pomoPause || 5) + '" data-cfg="pomoPause" class="field-num" aria-label="Minutos de descanso"></div>' +
      '<div class="aj-row"><span>🛋️ Descanso largo (tras 4 ciclos)</span><input type="number" min="5" max="40" value="' + (cfg.pomoLargo || 15) + '" data-cfg="pomoLargo" class="field-num" aria-label="Descanso largo"></div>' +
      '<div class="aj-row"><span>☀️ Resumen diario (mañana y noche)</span><span class="switch"><input type="checkbox" data-cfg="digest" ' + (cfg.digest !== false ? 'checked' : '') + '><span class="knob"></span></span></div>' +
      '<div class="aj-sec">Vistas</div>' +
      '<div class="aj-row"><span>Semana</span><div class="seg"><button class="seg-btn' + (cfg.agrupar === 'dia' ? ' activa' : '') + '" data-accion="cfg-seg" data-set="agrupar" data-v="dia">Por día</button>' +
      '<button class="seg-btn' + (cfg.agrupar === 'materia' ? ' activa' : '') + '" data-accion="cfg-seg" data-set="agrupar" data-v="materia">Por materia</button></div></div>' +
      '<div class="aj-row"><span>Ordenar semana</span><div class="seg"><button class="seg-btn' + (cfg.ordenSem === 'hora' ? ' activa' : '') + '" data-accion="cfg-seg" data-set="ordenSem" data-v="hora">Hora</button>' +
      '<button class="seg-btn' + (cfg.ordenSem === 'materia' ? ' activa' : '') + '" data-accion="cfg-seg" data-set="ordenSem" data-v="materia">Materia</button></div></div>' +
      '<div class="aj-row"><span>Notas: ordenar por</span><div class="seg"><button class="seg-btn' + (cfg.ordenNotas === 'promedio' ? ' activa' : '') + '" data-accion="cfg-seg" data-set="ordenNotas" data-v="promedio">Promedio</button>' +
      '<button class="seg-btn' + (cfg.ordenNotas === 'materia' ? ' activa' : '') + '" data-accion="cfg-seg" data-set="ordenNotas" data-v="materia">Abecedario</button></div></div>' +
      '<div class="aj-row"><span>Materias: ordenar por</span><div class="seg">' +
      '<button class="seg-btn' + (cfg.ordenMaterias === 'promedio' ? ' activa' : '') + '" data-accion="cfg-seg" data-set="ordenMaterias" data-v="promedio">Promedio</button>' +
      '<button class="seg-btn' + (cfg.ordenMaterias === 'pendientes' ? ' activa' : '') + '" data-accion="cfg-seg" data-set="ordenMaterias" data-v="pendientes">Pendientes</button>' +
      '<button class="seg-btn' + (cfg.ordenMaterias !== 'promedio' && cfg.ordenMaterias !== 'pendientes' ? ' activa' : '') + '" data-accion="cfg-seg" data-set="ordenMaterias" data-v="abc">A-Z</button></div></div>' +
      '<div class="aj-row"><span>Calendario</span><div class="seg"><button class="seg-btn' + (cfg.calVista === 'grilla' ? ' activa' : '') + '" data-accion="cfg-seg" data-set="calVista" data-v="grilla">Grilla</button>' +
      '<button class="seg-btn' + (cfg.calVista === 'agenda' ? ' activa' : '') + '" data-accion="cfg-seg" data-set="calVista" data-v="agenda">Agenda</button></div></div>' +
      '<div class="aj-row"><span>Ocultar tareas hechas</span><span><input type="checkbox" data-cfg="ocultarHechas" ' + (cfg.ocultarHechas ? 'checked' : '') + '></span></div>' +
      '<div class="aj-sec">📤 Exportar</div>' +
      '<div style="display:grid;gap:.5rem;grid-template-columns:1fr 1fr">' +
      '<button class="btn ghost" data-accion="ics-horario">📅 Horario (.ics)</button>' +
      '<button class="btn ghost" data-accion="csv-notas">📊 Notas (.csv)</button>' +
      '<button class="btn ghost" data-accion="print-semana">🖨️ Semana (imprimir)</button>' +
      '<button class="btn ghost" data-accion="exp-json">🗂️ Expediente (.json)</button>' +
      '<button class="btn ghost" data-accion="mat-explorar">📎 Buscar materiales del aula</button>' +
      '<button class="btn ghost" data-accion="ics-agenda">🗓️ Agenda (.ics)</button>' +
      '</div>' +
      '<div class="aj-sec">🔎 Comodidad</div>' +
      '<div class="aj-row"><span>Densidad</span><div class="seg">' +
      '<button class="seg-btn' + (cfg.densidad === 'compacta' ? ' activa' : '') + '" data-accion="cfg-seg" data-set="densidad" data-v="compacta">Compacta</button>' +
      '<button class="seg-btn' + (cfg.densidad !== 'espaciosa' && cfg.densidad !== 'compacta' ? ' activa' : '') + '" data-accion="cfg-seg" data-set="densidad" data-v="comoda">Cómoda</button>' +
      '<button class="seg-btn' + (cfg.densidad === 'espaciosa' ? ' activa' : '') + '" data-accion="cfg-seg" data-set="densidad" data-v="espaciosa">Espaciosa</button></div></div>' +
      '<div class="aj-row"><span>Tamaño de letra</span><div class="seg">' +
      '<button class="seg-btn' + (cfg.fuente === 's' ? ' activa' : '') + '" data-accion="cfg-seg" data-set="fuente" data-v="s">S</button>' +
      '<button class="seg-btn' + (cfg.fuente === 'auto' || !cfg.fuente ? ' activa' : '') + '" data-accion="cfg-seg" data-set="fuente" data-v="auto">Normal</button>' +
      '<button class="seg-btn' + (cfg.fuente === 'l' ? ' activa' : '') + '" data-accion="cfg-seg" data-set="fuente" data-v="l">Grande</button>' +
      '<button class="seg-btn' + (cfg.fuente === 'accesible' ? ' activa' : '') + '" data-accion="cfg-seg" data-set="fuente" data-v="accesible">XL</button></div></div>' +
      '<div class="aj-row"><span>Alto contraste</span><span class="switch"><input type="checkbox" data-cfg="contraste" ' + (cfg.contraste ? 'checked' : '') + '><span class="knob"></span></span></div>' +

      materiasAjusteColores() +

      iconosAjusteMaterias() +

      '<div class="aj-sec" id="aj-widgets">🏠 Inicio: bloques y orden</div>' +
      renderWidgetsEditor() +

      '<div class="tip">💡 Atajos: <span class="kbd">1</span>–<span class="kbd">6</span> vistas · <span class="kbd">/</span> o <span class="kbd">Ctrl + K</span> búsqueda global · <span class="kbd">R</span> recargar · <span class="kbd">F</span> enfoque · <span class="kbd">C</span> calendario del mes · <span class="kbd">D</span> modo oscuro · <span class="kbd">?</span> ayuda · <span class="kbd">Esc</span> cerrar.</div>';
    $('#cuerpo-ajustes').innerHTML = html;
  }

  function cerrarCampana() { $('#panel-campana').classList.remove('abierto'); campanaAbierta = false; }
  function cerrarPalette() { $('#overlay-palette').classList.remove('abierto'); }

  function renderWidgetsEditor() {
    var orden = widgetsOrden();
    return WIDGETS_DEF.map(function (w, idx) {
      return '<div class="home-item" draggable="false">' +
        '<span style="display:inline-flex;flex-direction:column;line-height:1;user-select:none">' +
        '<button class="acc-btn" style="border:none;background:none" data-accion="wid-up" data-wid="' + w.id + '"' + (idx === 0 ? ' disabled' : '') + ' title="Subir">▲</button>' +
        '<button class="acc-btn" style="border:none;background:none" data-accion="wid-down" data-wid="' + w.id + '"' + (idx === orden.length - 1 ? ' disabled' : '') + ' title="Bajar">▼</button></span>' +
        '<span class="arr">☰</span><span class="nom">' + w.icon + ' ' + esc(w.nombre) + '</span>' +
        '<span class="mini-switch"><span class="switch"><input type="checkbox" data-wid-toggle="' + w.id + '" ' + (widgetVisible(w.id) ? 'checked' : '') + '><span class="knob"></span></span></span>' +
        '</div>';
    }).join('');
  }

  function materiasAjusteColores() {
    if (!state.datos) return '';
    var mats = materiasUnicas();
    if (!mats.length) return '';
    return '<div class="aj-sec">Colores por materia</div>' +
      '<div class="seg" style="flex-wrap:wrap;gap:.4rem">' +
      mats.map(function (m) {
        return '<label style="display:inline-flex;align-items:center;gap:.4rem;background:var(--card-solid);border:1.5px solid var(--borde);border-radius:2rem;padding:.35rem .65rem .35rem .45rem;cursor:pointer" title="Color para ' + esc(m) + '">' +
          '<input type="color" value="' + colorMateria(m) + '" data-color-materia="' + esc(m) + '" style="width:1.4rem;height:1.4rem;border:none;padding:0;background:none;cursor:pointer">' +
          '<span style="font-size:.78rem;font-weight:700">' + esc(truncNombre(m, 15)) + '</span></label>';
      }).join('') + '</div>';
  }
  function truncNombre(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function cerrarBusqueda() { $('#resultados').classList.remove('visible'); busquedaAbierta = false; }

  function iconosAjusteMaterias() {
    if (!state.datos) return '';
    var mats = materiasUnicas();
    if (!mats.length) return '';
    return '<div class="aj-sec">🎨 Iconos por materia</div>' +
      '<div class="seg" style="flex-wrap:wrap;gap:.4rem">' +
      mats.map(function (m) {
        return '<label style="display:inline-flex;align-items:center;gap:.35rem;background:var(--card-solid);border:1.5px solid var(--borde);border-radius:2rem;padding:.3rem .6rem;cursor:pointer" title="Emoji para ' + esc(m) + '">' +
          '<input type="text" value="' + esc(iconoMateria(m)) + '" data-ico-materia="' + esc(m) + '" maxlength="4" style="width:2.2rem;border:none;background:none;text-align:center;font-size:1rem" aria-label="Icono para ' + esc(m) + '">' +
          '<span style="font-size:.75rem;font-weight:700">' + esc(truncNombre(m, 14)) + '</span></label>';
      }).join('') + '</div>' +
      '<p class="sub" style="margin-top:.35rem">💡 Pon el emoji que quieras (ej. 🔬, 📐, 🇬🇧). Aparece en la lista de materias y en sus tarjetas.</p>';
  }

  /* ================= NOVEDADES / CAMPANA ================= */
  function cargarNovedades(silencioso) {
    if (!state.activo) return Promise.resolve();
    return apiFetch('api/novedades', { headers: { 'Accept': 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (data) {
        state.campanaRes = data;
        var badge = $('#badge-novedades');
        if (badge) {
          if (data.no_leidas > 0) { badge.style.display = 'flex'; badge.textContent = data.no_leidas > 9 ? '9+' : data.no_leidas; }
          else badge.style.display = 'none';
        }
        if (campanaAbierta) renderCampana();
        if (state.vista === 'inicio' && state.datos) renderInicio();
        return data;
      })
      .catch(function () { return null; });
  }
  function renderCampana() {
    var data = state.campanaRes;
    if (!data || !data.novedades || !data.novedades.length) {
      $('#campana-lista').innerHTML = '<div class="vacio">Sin novedades por ahora.</div>';
      return;
    }
    var items = data.novedades.slice(0).sort(function (a, b) { return (a.leida ? 1 : 0) - (b.leida ? 1 : 0); });
    var fil = agg.camFiltro || '';
    var hayDelGrupo = NOV_GRUPOS.some(function (g) {
      return items.some(function (n) { return novGrupoDe(n.tipo).id === g.id; });
    });
    var html = hayDelGrupo ?
      '<div class="campana-filtros">' + NOV_GRUPOS.map(function (g) {
        return '<button class="chip' + (fil === g.id ? ' activa' : '') + '" data-accion="cam-filtro" data-g="' + g.id + '">' + g.ico + ' ' + g.nombre + '</button>';
      }).join('') + (fil ? '<button class="chip" data-accion="cam-filtro" data-g="">Ver todo</button>' : '') + '</div>' : '';
    NOV_GRUPOS.forEach(function (g) {
      if (fil && fil !== g.id) return;
      var delGrupo = items.filter(function (n) { return novGrupoDe(n.tipo).id === g.id; });
      if (!delGrupo.length) return;
      var pend = delGrupo.filter(function (n) { return !n.leida; }).length;
      html += '<div class="nov-grupo"><span class="g-ico" aria-hidden="true">' + g.ico + '</span> ' + g.nombre +
        (pend ? ' <span class="m-chip alerta">' + pend + '</span>' : '') + '</div>';
      html += delGrupo.map(function (n) {
        var esNew = !n.leida;
        return '<div class="nov' + (esNew ? ' noLeida' : '') + '">' +
          '<span class="tipo">' + tipoIco(n.tipo) + '</span>' +
          '<div class="txt">' + esc(n.texto) +
          '<div class="sub">' + esc(n.ts) + '</div></div>' +
          (esNew ? '<button class="leer" data-accion="nov-leer" data-ids="' + n.id + '" aria-label="Marcar leída">✓</button>' : '') + '</div>';
      }).join('');
    });
    $('#campana-lista').innerHTML = html || '<div class="vacio">Sin novedades en este grupo.</div>';
  }

  /* ================= EXPORTAR ================= */
  function descargar(nombre, contenido, tipo) {
    var blob = new Blob([contenido], { type: tipo });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); if (a.parentNode) a.parentNode.removeChild(a); }, 400);
  }
  function exportarCSV() {
    if (!state.datos) { toast('Espera a que carguen los datos.', 'err'); return; }
    var filas = [['Materia', 'Titulo', 'Periodo', 'Nota', 'Fecha inicio', 'Fecha fin', 'Estado']];
    state.datos.agenda.forEach(function (e) {
      filas.push([e.materia || '', e.titulo || '', e.periodo_codi || '', e.calificacion == null ? '' : e.calificacion, e.fecha_inicio || '', e.fecha_fin || '', e.estado || '']);
    });
    var csv = filas.map(function (f) { return f.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(';'); }).join('\r\n');
    descargar('notas_agenda_' + fechaISO(new Date()) + '.csv', '\ufeff' + csv, 'text/csv;charset=utf-8');
    toast('📊 CSV exportado');
  }
  function icsEsc(t) { return String(t || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n'); }
  function exportarHorario() {
    if (!state.datos || !state.datos.horario) { toast('Sin datos de horario.', 'err'); return; }
    var hoy = new Date();
    var hoyIdx = hoy.getDay();
    var ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//EducaFix//ES\r\nCALSCALE:GREGORIAN\r\n';
    state.datos.horario.forEach(function (b, i) {
      var di = DIAS_UP.indexOf(String(b.dia || '').trim().toUpperCase());
      if (di < 0) return;
      var fecha = addDays(hoy, (di - hoyIdx + 7) % 7);
      var ini = fechaISO(fecha).replace(/-/g, '') + 'T' + (b.hora_inicio || '0000').replace(':', '') + '00';
      var fin = fechaISO(fecha).replace(/-/g, '') + 'T' + (b.hora_fin || '0000').replace(':', '') + '00';
      ics += 'BEGIN:VEVENT\r\nUID:hor-' + i + '-' + di + '@miagenda\r\nDTSTAMP:' + fechaISO(hoy).replace(/-/g, '') + 'T000000Z\r\n' +
        'DTSTART:' + ini + '\r\nDTEND:' + fin + '\r\n' +
        'SUMMARY:' + icsEsc(b.materia + ' (Periodo ' + b.periodo + ')') + '\r\n' +
        'RRULE:FREQ=WEEKLY;COUNT=20\r\nEND:VEVENT\r\n';
    });
    ics += 'END:VCALENDAR\r\n';
    descargar('horario_clases_' + fechaISO(new Date()) + '.ics', ics, 'text/calendar');
    toast('📅 Horario exportado');
  }

  /* ================= BUSQUEDA GLOBAL ================= */
  function buscarGlobal() {
    var q = $('#buscador').value.trim().toLowerCase();
    if (!q) { cerrarBusqueda(); return; }
    if (!state.datos) return;
    var res = [];
    agendaTodo().forEach(function (e) {
      var t = (e.titulo + ' ' + (e.materia || '')).toLowerCase();
      if (t.indexOf(q) >= 0) res.push({ tab: 'semana', ico: esExamen(e.titulo) ? '📌' : (e.personal ? '✏️' : '🗂️'), lbl: e.titulo, sub: e.materia + ' · ' + (e.fecha_inicio || 'sin fecha'), accion: 'res-dia', dato: e.fecha_inicio, q: q });
    });
    (state.datos.mensajes || []).forEach(function (m) {
      if (String(m.asunto || '').toLowerCase().indexOf(q) >= 0) res.push({ tab: 'comunicados', ico: '✉️', lbl: m.asunto, sub: 'Mensaje', accion: 'res-com', dato: 'mensajes', q: q });
    });
    (state.datos.circulares || []).forEach(function (c) {
      if ((String(c.titulo || '') + ' ' + String(c.descripcion || '')).toLowerCase().indexOf(q) >= 0) res.push({ tab: 'comunicados', ico: '📄', lbl: c.titulo, sub: 'Circular', accion: 'res-com', dato: 'circulares', q: q });
    });
    ((state.datos.resumen || {}).materias || []).slice(0, 5).forEach(function (m) {
      if (String(m.materia || '').toLowerCase().indexOf(q) >= 0) res.push({ tab: 'notas', ico: '📊', lbl: m.materia, sub: 'Promedio ' + fmtNum(m.promedio, 2), accion: 'res-notas', dato: null, q: q });
    });
    var box = $('#resultados');
    if (!res.length) { box.innerHTML = '<div class="res-item" style="cursor:default"><span class="ri-ico">🔍</span><div class="ri-txt"><div class="ri-lbl">Sin resultados</div></div></div>'; }
    else {
      box.innerHTML = res.slice(0, 20).map(function (r) {
        return '<div class="res-item" data-tab="' + r.tab + '" data-accion="' + r.accion + '" data-dato="' + esc(r.dato || '') + '" data-q="' + esc(r.q) + '">' +
          '<span class="ri-ico">' + r.ico + '</span><div class="ri-txt"><div class="ri-lbl">' + marcar(r.lbl, r.q) + '</div>' +
          '<div class="ri-sub">' + esc(r.sub) + '</div></div><span class="ri-tab">' + r.tab + '</span></div>';
      }).join('');
    }
    box.classList.add('visible');
    busquedaAbierta = true;
  }

  /* ================= ACCIONES ================= */
  function ligarAcciones() {
    document.addEventListener('click', function (ev) {
      var tabEl = ev.target.closest('.tab, .bnav-btn');
      if (tabEl && tabEl.dataset.tab) { cambiarTab(tabEl.dataset.tab); return; }
      var t = ev.target.closest('[data-accion]');
      if (!t) return;
      var acc = t.dataset.accion;
      var id = t.dataset.id;
      var clave = t.dataset.clave;
      var vista = state.vista;
      switch (acc) {
        case 'tab':
        case 'bnav':
          cambiarTab(t.dataset.tab);
          break;
        case 'sem-prev': state.semana--; renderSemana(); break;
        case 'sem-next': state.semana++; renderSemana(); break;
        case 'sem-hoy': state.semana = 0; renderSemana(); break;
        case 'cal-prev': state.mes--; renderCalendario(); break;
        case 'cal-next': state.mes++; renderCalendario(); break;
        case 'cal-hoy': state.mes = 0; renderCalendario(); break;
        case 'hist-prev': state.histMes--; renderSemana(); break;
        case 'hist-next': state.histMes++; renderSemana(); break;
        case 'hist-hoy': state.histMes = 0; renderSemana(); break;
        case 'modo-sem': cfg.modoSem = t.dataset.modo; guardarCfg(); renderSemana(); break;
        case 'agrupar-sem': cfg.agrupar = t.dataset.modo; guardarCfg(); renderSemana(); break;
        case 'orden-sem': cfg.ordenSem = t.dataset.modo; guardarCfg(); renderSemana(); break;
        case 'cal-vista': cfg.calVista = t.dataset.modo; guardarCfg(); renderCalendario(); break;
        case 'notas-vista': cfg.vistaLista = t.dataset.modo === 'tabla'; guardarCfg(); renderRendimiento(); break;
        case 'rend-seg': agg.rendSeg = t.dataset.seg; renderRendimiento(); break;
        case 'cfg-seg': cfg[t.dataset.set] = t.dataset.v; guardarCfg(); aplicarVisuales(); renderAjustes(); renderVistaActual(); break;
        case 'com-tab': agg.comTab = t.dataset.tab; renderComunicados(); break;
        case 'dia-iso': renderDiaOverlay(t.dataset.fecha); break;
        case 'res-dia': var bq = $('#buscador'); if (bq) bq.value = ''; cambiarTab('calendario'); renderDiaOverlay(t.dataset.dato); break;
        case 'res-com': agg.comTab = t.dataset.dato; cambiarTab('comunicados'); break;
        case 'res-notas': cambiarTab('notas'); break;
        case 'dia-cerrar': closeOverlay('overlay-dia'); break;
        case 'detalle': renderDiaOverlay(eventoPorId(id).fecha_inicio); break;
        case 'mat-detalle': toggleMatDetalle(t); break;
        case 'hecha': toggleHecha(id); break;
        case 'np': notaActual = id; renderNotaOverlay(); break;
        case 'nota-guardar': guardarNota(); break;
        case 'nota-eliminar': eliminarNota(); break;
        case 'nota-cerrar': closeOverlay('overlay-nota'); break;
        case 'rec': recActual = id; renderRecOverlay(); break;
        case 'rec-set': setRec(parseInt(t.dataset.min || '0', 10)); break;
        case 'rec-cerrar': closeOverlay('overlay-rec'); break;
        case 'ajustes': openOverlay('overlay-ajustes'); renderAjustes(); break;
        case 'ajustes-cerrar': closeOverlay('overlay-ajustes'); break;
        case 'camp-bell': toggleCampana(); break;
        case 'camp-cerrar': cerrarCampana(); break;
        case 'cam-filtro': agg.camFiltro = t.dataset.g; renderCampana(); break;
        case 'nov-leer': marcarNovedad(t.dataset.ids); break;
        case 'leido': toggleLeido(clave); break;
        case 'fav': toggleFav(clave); break;
        case 'tema-sw':
          cfg.tema = parseInt(t.dataset.h, 10);
          cfg.temaS = t.dataset.s ? parseInt(t.dataset.s, 10) : null;
          cfg.temaL = t.dataset.l ? parseInt(t.dataset.l, 10) : null;
          cfg.accentLibre = '';
          guardarCfg(); aplicarVisuales(); renderAjustes(); renderAcentosPop();
          break;
        case 'ics-horario': exportarHorario(); break;
        case 'csv-notas': exportarCSV(); break;
        case 'pdf-circ': descargarCircular(t.dataset.url); break;
        case 'cal-filtro':
          agg.calFiltro = agg.calFiltro === t.dataset.materia ? null : t.dataset.materia;
          renderSemana();
          break;
        case 'cal-tipo': agg.calTipo = t.dataset.t; renderSemana(); break;
        case 'invitado': loginInvitado(); break;
        case 'salir': cerrarSesion(); break;
        case 'reintentar': recargar(); break;
        case 'refresh-manual': recargar(); break;
        case 'limpiar-cache':
          try { localStorage.removeItem(LS_CACHE); localStorage.removeItem('agenda_materiales'); } catch (e) {}
          state.datos = null; MATER = null;
          toast('💾 Datos guardados borrados; recargando…');
          recargar();
          break;
        case 'enfoque': abrirEnfoque(); break;
        case 'pal-open': abrirPalette(''); break;
        case 'pal-cerrar': closeOverlay('overlay-palette'); break;
        case 'pt-add': renderTareaOverlay(t.dataset.fecha || diaActual || null); break;
        case 'tarea-cerrar': closeOverlay('overlay-tarea'); break;
        case 'pt-guardar': guardarTarea(); break;
        case 'pt-del': borrarTarea(t.dataset.id); break;
        case 'wid-up': widgetMover(t.dataset.wid, -1); break;
        case 'wid-down': widgetMover(t.dataset.wid, 1); break;
        case 'pal-exec': palEjecutar(parseInt(t.dataset.pidx || '-1', 10)); break;
        case 'ia-completar': renderDiaOverlay(fechaISO(new Date())); break;
        case 'pal-cerrar': palCerrar(); closeOverlay('overlay-tarea'); break;
        case 'enfoque-cerrar': closeOverlay('overlay-enfoque'); break;
        case 'wid-toggle': widgetToggle(t.dataset.wid); break;
        case 'mat-explorar': cargarMateriales().then(function () { renderVistaActual(); toast('Materiales actualizados'); }); toast('Buscando materiales del aula virtual…'); break;
        case 'print-semana': cambiarTab('semana'); setTimeout(function () { window.print(); }, 300); break;
        case 'calcom': cambiarTab('calendario'); break;
        case 'see-semana': cambiarTab('semana'); break;
        case 'ir-mas': cambiarTab('mas'); break;
        case 'ir-pend': cambiarTab('pendientes'); break;
        case 'estado-3p': setEstado(t.dataset.id, t.dataset.estado); break;
        case 'pend-filtro': agg.pendFiltro = t.dataset.f; renderPendientes(); break;
        case 'mat-abrir': abrirMateria(t.dataset.materia); break;
        case 'materia-cerrar': closeOverlay('overlay-materia'); break;
        case 'eval-abrir': abrirExamen(t.dataset.id); break;
        case 'examen-cerrar': closeOverlay('overlay-examen'); break;
        case 'exam-addpaso': examAddPaso(); break;
        case 'doc-toggle':
          agg.docAbiertos = agg.docAbiertos || {};
          agg.docAbiertos[t.dataset.grupo] = !(agg.docAbiertos[t.dataset.grupo] !== false);
          renderDocumentos();
          break;
        case 'fav-doc':
          FAV[t.dataset.key] = !FAV[t.dataset.key];
          guardarLS(LS_FAV, FAV);
          renderDocumentos();
          break;
        case 'flash-open': cerrarPaneles(); abrirFlashRepaso(); break;
        case 'flash-nueva': cerrarPaneles(); abrirNuevaFlash(t.dataset.materia || ''); break;
        case 'flash-cerrar':
          closeOverlay('overlay-flash'); closeOverlay('overlay-nuevaflash');
          if (state.vista === 'estudio') renderEstudio();
          break;
        case 'flash-guardar': guardarFlashcard(); break;
        case 'flash-girar': flashGirada = true; renderFlashCard(); break;
        case 'flash-resp': flashComprobar(); break;
        case 'flash-modo':
          agg.flashModo = agg.flashModo === 'escribir' ? '' : 'escribir';
          renderEstudio();
          break;
        case 'flash-rate': flashRate(t.dataset.r); break;
        case 'pomo-toggle': pomoToggle(); break;
        case 'pomo-reset': pomoReset(); break;
        case 'pomo-para-examen':
          POMO.materia = t.dataset.materia || '';
          closeOverlay('overlay-examen');
          cambiarTab('estudio');
          toast('🍅 Elige el pendiente y dale a Empezar');
          break;
        case 'exp-json': exportarExpediente(); break;
        case 'asistencia-ver': abrirInfoAsistencia(); break;
        case 'pagos-ver': abrirInfoPagos(); break;
        case 'info-cerrar': closeOverlay('overlay-info'); break;
        case 'mat-tab': agg.matTab = t.dataset.tab; renderMateriaOverlay(); break;
        case 'mat-full': agg.matFull = !agg.matFull; renderMateriaOverlay(); break;
        case 'mat-share': compartirMateria(t.dataset.materia); break;
        case 'materias-vista': cfg.materiasVista = t.dataset.v; guardarCfg(); renderMaterias(); break;
        case 'ev-share': compartirEvento(t.dataset.id); break;
        case 'ev-ics': icsActividad(t.dataset.id); break;
        case 'ev-star': toggleStar(t.dataset.id); break;
        case 'subt-open': abrirSubtareas(t.dataset.id); break;
        case 'subt-cerrar': closeOverlay('overlay-subt'); break;
        case 'subt-add': subtAdd(); break;
        case 'subt-del': subtDel(parseInt(t.dataset.idx || '0', 10)); break;
        case 'libreta-abrir': cerrarPaneles(); abrirLibreta(); break;
        case 'libreta-cerrar': closeOverlay('overlay-libreta'); break;
        case 'libreta-guardar': guardarLibreta(); break;
        case 'libreta-copiar':
          if (navigator.clipboard) navigator.clipboard.writeText($('#libreta-texto').value).then(function () { toast('📋 Libreta copiada'); });
          break;
        case 'libreta-limpiar':
          $('#libreta-texto').value = '';
          guardarLibreta();
          $('#libreta-texto').value = LIBRETA || '';
          toast('🗑️ Libreta vaciada');
          break;
        case 'rec-set-custom': setRecCustom(); break;
        case 'flash-lote': abrirImportarFlash(); break;
        case 'flash-lote-guardar': guardarLoteFlash(); break;
        case 'flash-csv': exportarFlashCSV(); break;
        case 'flash-importar':
          var inp = document.createElement('input');
          inp.type = 'file'; inp.accept = '.csv,text/csv';
          inp.onchange = function () {
            var f = inp.files && inp.files[0];
            if (!f) return;
            var fr = new FileReader();
            fr.onload = function () { importarFlashCSV(String(fr.result || '')); };
            fr.readAsText(f, 'utf-8');
          };
          inp.click();
          break;
        case 'logros-ver': abrirLogros(); break;
        case 'ayuda-ver': abrirAyuda(); break;
        case 'copiar-dia': copiarDia(t.dataset.fecha || diaActual || fechaISO(new Date())); break;
        case 'sem-share': compartirSemana(iniSemana(addDays(iniSemana(new Date()), state.semana * 7))); break;
        case 'volver-arriba': window.scrollTo({ top: 0, behavior: 'smooth' }); break;
        case 'notas-oficiales-csv': exportarNotasOficialesCSV(); break;
        case 'libreta-pdf': descargarLibretaPDF(t.dataset.peri); break;
        case 'dia-share': compartirDia(t.dataset.fecha); break;
        case 'acento-pop': toggleAcentos(); break;
        case 'acento-cerrar': cerrarAcentos(); break;
        case 'acento-ajustes': cerrarAcentos(); openOverlay('overlay-ajustes'); renderAjustes(); break;
        case 'tema-modo': setTemaModo(t.dataset.modo); break;
        case 'ics-agenda': window.open(API + 'api/calendario.ics', '_blank'); toast('📅 Abriendo agenda .ics — guárdala o suscríbete'); break;
        case 'prio-colapsar': toggleColapso(t.dataset.bloque); break;
        case 'inicio-personalizar': openOverlay('overlay-ajustes'); renderAjustes(); setTimeout(function () { var el = document.getElementById('aj-widgets'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 80); break;
        default:
          if (acc && acc.indexOf('ir:') === 0) { cambiarTab(acc.slice(3)); }
          break;
      }
    });
  }

  function examAddPaso() {
    if (!examenActual) return;
    var el = $('#exam-nuevo-paso');
    var txt = el ? el.value.trim() : '';
    if (!txt) { toast('Escribe el paso primero.', 'err'); return; }
    var PLANES = leerLS('agenda_exam_plan', {});
    var plan = PLANES[examenActual.id];
    if (!plan) { plan = { pasos: [] }; PLANES[examenActual.id] = plan; }
    plan.pasos.push({ t: txt, done: false });
    guardarLS('agenda_exam_plan', PLANES);
    abrirExamen(examenActual.id);
  }

  function toggleColapso(bloque) {
    var cols = leerLS('agenda_colapsados', {});
    cols[bloque] = !cols[bloque];
    guardarLS('agenda_colapsados', cols);
    renderInicio();
  }

  function toggleMatDetalle(tr) {
    var idx = tr.dataset.idx;
    var existente = tr.parentNode.querySelector('tr.fila-detalle[data-mat-idx="' + idx + '"]');
    tr.parentNode.querySelectorAll('tr.fila-detalle').forEach(function (r) { r.parentNode.removeChild(r); });
    if (existente) return;
    var det = matDetalle(parseInt(idx, 10));
    if (!det) return;
    var fila = document.createElement('tr');
    fila.className = 'fila-detalle';
    fila.setAttribute('data-mat-idx', idx);
    fila.innerHTML = '<td colspan="6">' + det.html + '</td>';
    tr.parentNode.insertBefore(fila, tr.nextSibling);
  }

  function toggleHecha(id) {
    var hecha = HECHAS[id] !== true;
    HECHAS[id] = hecha || undefined;
    if (hecha) {
      HECHAS_TS[id] = fechaISO(new Date());
    } else {
      delete HECHAS_TS[id];
    }
    guardarLS(LS_HECHAS, HECHAS);
    guardarLS('agenda_hechas_ts', HECHAS_TS);
    toast(hecha ? '✓ Marcada como hecha' : 'Reabierta');
    renderVistaActual();
  }
  function setEstado(id, estado) {
    if (estado === 'hecha') {
      HECHAS[id] = true;
      HECHAS_TS[id] = fechaISO(new Date());
      toast('✓ Completada');
    } else if (estado === 'progreso') {
      HECHAS[id] = 'progreso';
      delete HECHAS_TS[id];
      toast('🔄 En progreso');
    } else {
      delete HECHAS[id];
      delete HECHAS_TS[id];
      toast('↩ Pendiente');
    }
    guardarLS(LS_HECHAS, HECHAS);
    guardarLS('agenda_hechas_ts', HECHAS_TS);
    renderVistaActual();
  }
  function toggleLeido(clave) {
    var i = LEIDOS.indexOf(clave);
    if (i >= 0) LEIDOS.splice(i, 1); else LEIDOS.push(clave);
    guardarLS(LS_LEIDOS, LEIDOS);
    repintarCom();
  }
  function toggleFav(clave) {
    FAV[clave] = !FAV[clave];
    guardarLS(LS_FAV, FAV);
    repintarCom();
  }
  function repintarCom() {
    if (state.vista === 'comunicados' && state.datos) { var l = $('#com-lista'); if (l) l.innerHTML = comListaHtml(); }
  }
  function marcarNovedad(ids) {
    apiFetch('api/novedades/leer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: String(ids).split(',').map(Number) })
    }).then(function (r) { return r.ok; }).then(renderFresh).catch(function () { toast('No se pudo actualizar.', 'err'); });
  }
  function renderFresh() { cargarNovedades(true); }

  function descargarCircular(url) {
    var u = absoluto(url);
    toast('Descargando…');
    apiFetch('api/descargar?url=' + encodeURIComponent(u))
      .then(function (r) {
        if (r.status === 400) throw new Error('URL no permitida');
        if (!r.ok) throw new Error('Error ' + r.status);
        return r.blob();
      })
      .then(function (b) {
        var nombre = u.split('?')[0].split('/').pop() || 'circular.pdf';
        descargar(nombre, b, 'application/octet-stream');
      })
      .catch(function (e) { toast(e.message, 'err'); });
  }

  function toggleCampana() {
    campanaAbierta = !campanaAbierta;
    $('#panel-campana').classList.toggle('abierto', campanaAbierta);
    if (campanaAbierta) { renderCampana(); if (state.campanaRes) marcarTodoLeidoVisual(); }
  }
  function marcarTodoLeidoVisual() {
    if (!state.campanaRes) return;
    var pend = state.campanaRes.novedades.filter(function (n) { return !n.leida; });
    if (!pend.length) return;
    apiFetch('api/novedades/leer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    }).then(function (r) { return r.ok; }).then(function () { cargarNovedades(true); });
  }

  /* ================= VIVO / RECORDATORIOS ================= */
  function actualizarVivo() {
    if (!state.activo || !state.datos || state.vista !== 'inicio') return;
    var c = claseActual();
    var bloque = $('#clase-ahora');
    var lbl = $('#barra-dia-lbl');
    var fill = $('#barra-dia-fill');
    if (bloque) bloque.innerHTML = bloqueClaseAhora(c);
    if (lbl && fill) {
      var dia = new Date();
      var mins = dia.getHours() * 60 + dia.getMinutes();
      if (c.hoy) {
        var ini = aMin(c.hoy[0] ? c.hoy[0].hora_inicio : '07:00') || 420;
        var fin = aMin(c.hoy[c.hoy.length - 1] ? c.hoy[c.hoy.length - 1].hora_fin : '14:00') || 840;
        var p = Math.max(0, Math.min(1, (mins - ini) / Math.max(1, fin - ini)));
        lbl.textContent = 'Progreso del día: ' + Math.round(p * 100) + '%';
        fill.style.width = (p * 100) + '%';
      } else {
        var p2 = Math.max(0, Math.min(1, mins / 1440));
        lbl.textContent = 'Día: ' + Math.round(p2 * 100) + '%';
        fill.style.width = (p2 * 100) + '%';
      }
    }
    var ch = $('#clases-hoy');
    if (ch && c.hoy) ch.innerHTML = listaClasesHoy(c);
  }

  function tickRec() {
    if (!state.activo || !notificacionPermitida()) return;
    var ahora = Date.now();
    var hay = false;
    Object.keys(REC).forEach(function (id) {
      var ev = eventoPorId(id);
      if (!ev) return;
      var due = venceEn(ev);
      if (due == null || isNaN(due)) return;
      if (NOTIFICADOS[id]) return;
      if (ahora >= due && ahora - due < 120000) {
        NOTIFICADOS[id] = true;
        guardarLS(LS_NOTIF, NOTIFICADOS);
        var extra = (typeof REC[id] === 'string' && REC[id].indexOf('T') >= 0) ? ' (recordatorio tuyo)' : '';
        new Notification(ev.titulo, { body: ev.materia + ' · ' + fmtCorta(parseLocal(ev.fecha_inicio)) + extra, tag: String(id), icon: 'img/icon-192.png' });
      }
      hay = true;
    });
    if (!hay) guardarLS(LS_NOTIF, NOTIFICADOS);
    tickDigest();
  }

  /* ================= TECLADO ================= */
  function ligarTeclado() {
    document.addEventListener('keydown', function (ev) {
      var tag = (ev.target.tagName || '').toLowerCase();
      var escribiendo = tag === 'input' || tag === 'textarea' || tag === 'select';
      var palAbierto = document.getElementById('overlay-palette').classList.contains('abierto');

      if (ev.ctrlKey && (ev.key === 'k' || ev.key === 'K')) { ev.preventDefault(); palAbierto ? palCerrar() : abrirPalette(''); return; }

      if (palAbierto) {
        if (ev.key === 'Escape') { palCerrar(); return; }
        if (ev.key === 'ArrowDown') {
          ev.preventDefault();
          if (PAL_ITEMS.length) PAL_SEL = Math.min(PAL_SEL + 1, PAL_ITEMS.length - 1);
          marcarSel();
          return;
        }
        if (ev.key === 'ArrowUp') { ev.preventDefault(); if (PAL_SEL > 0) PAL_SEL--; marcarSel(); return; }
        if (ev.key === 'Enter') { ev.preventDefault(); if (PAL_SEL >= 0) palEjecutar(PAL_SEL); return; }
      }
      if (escribiendo) {
        if (ev.key === 'Escape') { if (ev.target.id === 'buscador') ev.target.blur(); cerrarPaneles(); }
        return;
      }
      if (ev.key === '/' && !palAbierto) { ev.preventDefault(); abrirPalette(''); return; }

      if (ev.key === 'Escape') { cerrarPaneles(); return; }
      if (ev.key === '?' || (ev.shiftKey && ev.key === '/')) { ev.preventDefault(); abrirAyuda(); return; }
      if (ev.key === 'R' || ev.key === 'r') { recargar(); return; }
      if (ev.key === 'F' || ev.key === 'f') { abrirEnfoque(); return; }
      if (ev.key === 'C' || ev.key === 'c') { cfg.modoSem = 'mes'; guardarCfg(); cambiarTab('semana'); return; }
      if (ev.key === 'D' || ev.key === 'd') {
        cfg.dark = !cfg.dark;
        cfg.temaModo = cfg.dark ? 'oscuro' : 'claro';
        guardarCfg(); aplicarVisuales(); return;
      }
      if (ev.key >= '1' && ev.key <= '6') {
        var tabs = state.perfil === 'docente'
          ? ['dinicio', 'dclases', 'dhorario', 'comunicados', 'mas']
          : ['inicio', 'semana', 'materias', 'pendientes', 'rendimiento', 'mas'];
        if (state.perfil === 'docente' && +ev.key > 5) return;
        cambiarTab(tabs[+ev.key - 1]);
      }
    });
  }

  function marcarSel() {
    var lista = document.querySelectorAll('.pal-item');
    for (var i = 0; i < lista.length; i++) {
      lista[i].style.outline = (i === PAL_SEL) ? '2.5px solid var(--acento-suave-2)' : '';
      lista[i].style.background = (i === PAL_SEL) ? 'var(--acento-suave)' : '';
    }
    var activa = lista[PAL_SEL];
    if (activa && activa.scrollIntoView) activa.scrollIntoView({ block: 'nearest' });
  }

  /* ================= PULL TO REFRESH ================= */
  function ligarPull() {
    var startY = 0; var pulling = false;
    document.addEventListener('touchstart', function (ev) {
      if (ev.touches.length !== 1) return;
      if (window.scrollY > 0) { startY = -1; return; }
      if (ev.target.closest('input,textarea,select,.bottom-nav,.tabs')) { startY = -1; return; }
      startY = ev.touches[0].clientY;
      pulling = false;
    }, { passive: true });
    document.addEventListener('touchmove', function (ev) {
      if (startY < 0) return;
      var dy = ev.touches[0].clientY - startY;
      if (dy > 30) {
        pulling = true;
        var p = Math.min(1, (dy - 30) / 80);
        $('#ptr').style.opacity = p;
      }
    }, { passive: true });
    document.addEventListener('touchend', function () {
      if (pulling) {
        $('#ptr').style.opacity = 0;
        recargar();
      }
      startY = 0; pulling = false;
    });
  }

  /* ================= VIDA / CONEXION ================= */
  function iniciar(perfil) {
    if (state.activo) return;
    state.activo = true;
    state.perfil = perfil || window.__efPerfil || 'alumno';
    document.documentElement.setAttribute('data-perfil', state.perfil);
    $('#app').classList.remove('oculto');
    $('#pantalla-login').classList.add('oculto');
    aplicarVisuales();
    if (state.perfil === 'docente') construirTabsDocente();
    autoActivas();
    /* atajos de la PWA (manifest shortcuts via #hash) */
    var hash = (location.hash || '').replace('#', '');
    if (['pendientes', 'evaluaciones', 'estudio', 'inicio', 'semana', 'materias', 'rendimiento', 'mas'].indexOf(hash) >= 0) {
      state.vista = hash;
    }
    if (state.perfil === 'docente' && state.vista === 'inicio') state.vista = 'dinicio';
    timers.vivo = setInterval(actualizarVivoWrap, 1000);
    timers.rec = setInterval(tickRec, 30000);
    timers.nov = setInterval(function () { cargarNovedades(true); }, 300000);
    cargarNovedades(true);
    if (state.perfil === 'docente') {
      cargarDocente({ silencioso: false });
    } else {
      cargar({ silencioso: false });
    }
    setTimeout(pedirPermisoAuto, 4000);
    setTimeout(function () { if (!MATER) cargarMateriales().then(renderVistaActual); }, 3500);
    setTimeout(onboarding, 300);
    /* FAB "volver arriba" */
    window.addEventListener('scroll', function () {
      var fab = document.getElementById('fab-top');
      if (fab) fab.classList.toggle('visible', window.scrollY > 500);
    }, { passive: true });
  }

  /* ------------------ MODO DOCENTE ------------------ */
  function construirTabsDocente() {
    var tabs = [
      ['dinicio', '🏠 Inicio'],
      ['dclases', '🗂️ Clases'],
      ['dhorario', '🕒 Horario'],
      ['comunicados', '📣 Comunicados'],
      ['mas', '⋯ Más']
    ];
    document.querySelector('nav.tabs').innerHTML = tabs.map(function (t, i) {
      return '<button class="tab' + (i === 0 ? ' activa' : '') + '" data-tab="' + t[0] + '">' + t[1] + '</button>';
    }).join('');
    document.querySelector('nav.bottom-nav').innerHTML = tabs.map(function (t, i) {
      return '<button class="bnav-btn' + (i === 0 ? ' activa' : '') + '" data-tab="' + t[0] + '"><span class="bi">' + t[1].split(' ')[0] + '</span>' + t[1].split(' ')[1] + '</button>';
    }).join('');
    state.vista = 'dinicio';
  }

  function cargarDocente(o) {
    o = o || {};
    var f = $('#franja');
    if (f) f.innerHTML = '<span class="spi"></span> Cargando portal docente…';
    var cache = leerLS('doc_cache', null);
    var ok = {};
    function unoDoc(nombre, url) {
      return apiFetch(url, { headers: { 'Accept': 'application/json' } })
        .then(function (r) { if (r.status === 401) { var e = new Error('sesion'); e.status = 401; throw e; } return r.json(); })
        .then(function (j) { ok[nombre] = j; })
        .catch(function (err) {
          if (err.status === 401) throw err;
          if (cache && cache[nombre] != null) ok[nombre] = cache[nombre];
        });
    }
    Promise.all([
      unoDoc('panel', 'api/docentes/panel'),
      unoDoc('dhorario', 'api/docentes/horario'),
      unoDoc('dagenda', 'api/docentes/agenda'),
      unoDoc('dmensajes', 'api/docentes/mensajes'),
      unoDoc('dcirculares', 'api/docentes/circulares')
    ]).then(function () {
      state.datos = {
        doc: true,
        panel: ok.panel || null,
        dhorario: ok.dhorario || null,
        dagenda: ok.dagenda || null,
        dmensajes: ok.dmensajes || null,
        dcirculares: ok.dcirculares || null,
        horario: (ok.dhorario && ok.dhorario.bloques) || [],
        mensajes: (ok.dmensajes && ok.dmensajes.mensajes) || [],
        circulares: (ok.dcirculares && ok.dcirculares.circulares) || [],
        agenda: [],
        resumen: { general: {}, materias: [] },
        faltas: null,
        mensajesOK: !!(ok.dmensajes && ok.dmensajes.disponible)
      };
      state.ultCarga = Date.now();
      state.fragil = !ok.panel;
      guardarLS('doc_cache', state.datos);
      var fr = $('#franja');
      if (fr) {
        if (ok.panel) { fr.classList.remove('err'); fr.innerHTML = '✓ Portal docente sincronizado'; }
        else { fr.classList.add('err'); fr.innerHTML = '⚠ Algunos módulos del portal docente no se pudieron leer'; }
      }
      if (state.activo) { autoActivas(); renderVistaActual(); }
    }).catch(function (err) {
      if (err.status === 401) {
        scheduleRetry(false);
        window.Login.mostrar('Tu sesión venció. Ingresa de nuevo.');
        return;
      }
      if (cache) { state.datos = cache; state.ultCarga = 0; renderVistaActual(); }
    });
  }

  function renderDInicio() {
    if (!state.datos) { renderEn('contenido-dinicio', skeleton()); return; }
    actualizarFranja();
    var panel = state.datos.panel || {};
    var mods = panel.modulos || [];
    var c = claseActual();
    var hoy = new Date();
    var hHora = hoy.getHours();
    var saludoProfe = hHora < 6 ? '¡Buenas noches, profe!' : hHora < 12 ? '¡Buenos días, profe!' : hHora < 19 ? '¡Buenas tardes, profe!' : '¡Buenas noches, profe!';
    var html =
      '<div class="tarjeta saludo saludo-mini"><div class="saludo-fila"><div>' +
      '<h2 style="font-size:1.12rem">' + esc(saludoProfe) + '</h2>' +
      '<div class="fecha" style="font-size:.72rem">' + fmtDia(hoy) + '</div></div>' +
      '<div style="flex:1"></div>' +
      '<button class="btn ghost mini" data-accion="refresh-manual" title="Actualizar">↻</button></div>' +
      '<span class="chip" style="display:inline-block;margin-top:.4rem;background:var(--acento-suave);color:var(--text-brand);font-weight:700;font-size:.68rem">🧪 Modo docente experimental</span></div>';

    if (c.hoy) {
      html += '<div class="prio-cab ahora"><span class="punto" aria-hidden="true"></span> CLASES DE HOY <span class="n">' + c.hoy.length + '</span></div>' +
        '<div class="tarjeta" style="padding:.55rem .8rem"><div id="clase-ahora">' + bloqueClaseAhora(c) + '</div></div>';
    } else if (state.datos.horario.length) {
      html += '<div class="hueco-libre" role="status">☕ Hoy no tienes clases registradas en el portal</div>';
    }

    if (panel.disponible === false) {
      html += '<div class="critica-card" role="status">⚠️ No se pudo leer el menú del portal docente: ' + esc(panel.razon || 'razón desconocida') + '. Verifica que tu cuenta tenga acceso al perfil Docentes.</div>';
    } else if (mods.length) {
      html += '<div class="prio-cab proximo"><span class="punto" aria-hidden="true"></span> TU PORTAL <span class="n">' + mods.length + ' módulos</span></div>' +
        '<div class="menu-grupo">' + mods.map(function (m) {
          return '<span class="menu-row" style="cursor:default">' +
            '<span class="mr-ico" aria-hidden="true">📘</span>' +
            '<span class="mr-main"><span class="mr-tit">' + esc(m.nombre) + '</span>' +
            '<span class="mr-sub">' + esc(m.ruta) + '</span></span></span>';
        }).join('') + '</div>';
    }

    var mens = state.datos.mensajes || [];
    if (mens.length) {
      html += '<div class="prio-cab proximo"><span class="punto" aria-hidden="true"></span> MENSAJES RECIENTES <span class="n">' + mens.length + '</span></div>' +
        '<div class="tarjeta" style="padding:.6rem .8rem">' + mens.slice(0, 4).map(function (m) {
          return '<div class="fila-per"><span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(m.asunto) + '</span><span class="sub">' + esc(m.remitente || '') + '</span></div>';
        }).join('') +
        '<button class="btn ghost mini" style="margin-top:.4rem" data-accion="ir:comunicados">Ver todos →</button></div>';
    }
    renderEn('contenido-dinicio', html);
  }

  function renderDClases() {
    if (!state.datos) { renderEn('contenido-dclases', skeleton()); return; }
    var ag = state.datos.dagenda || {};
    var html = '<div class="critica-card" role="status">🧪 La agenda del portal docente se muestra tal como la expone Educalinks. Con acceso de un docente real afinaremos las columnas y acciones.</div>';
    if (ag.disponible && (ag.filas || []).length) {
      html += '<div class="contenedor-tabla"><table class="tabla-notas"><thead><tr>' +
        (ag.columnas || []).map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') +
        '</tr></thead><tbody>' +
        ag.filas.map(function (f) {
          return '<tr>' + f.map(function (v) { return '<td>' + esc(truncNombre(v, 60)) + '</td>'; }).join('') + '</tr>';
        }).join('') + '</tbody></table></div>';
    } else {
      html += '<div class="vacio">📂 No se detectó la tabla de tareas/agenda del portal docente.<br><small>' + esc(ag.razon || 'El módulo aún no está mapeado; al conectar credenciales de docente se afinará automáticamente.') + '</small></div>';
    }
    renderEn('contenido-dclases', html);
  }

  function renderDHorario() {
    if (!state.datos) { renderEn('contenido-dhorario', skeleton()); return; }
    var h = state.datos.dhorario || {};
    if (h.disponible && (h.bloques || []).length) {
      renderEn('contenido-dhorario',
        '<div style="text-align:right;margin-bottom:.4rem"><button class="btn ghost mini" data-accion="print-semana">🖨️ Imprimir horario</button></div>' +
        tablaHorarioSemana());
    } else {
      renderEn('contenido-dhorario', '<div class="vacio">🕒 El portal docente no expone la tabla de horario.<br><small>' + esc(h.razon || 'Pendiente de mapeo.') + '</small></div>');
    }
  }

  function renderDMas() {
    if (!state.datos) { renderEn('contenido-mas', skeleton()); return; }
    var panel = state.datos.panel || {};
    var mods = panel.modulos || [];
    var dOK = [];
    [['dhorario', '🕒 Horario'], ['dagenda', '🗂️ Agenda/tareas'], ['dmensajes', '✉️ Mensajes'], ['dcirculares', '📄 Circulares']].forEach(function (par) {
      var d = state.datos[par[0]] || {};
      dOK.push({ ico: par[1].split(' ')[0], n: par[1].split(' ')[1], ok: d.disponible !== false });
    });
    function menuRowDoc(ico, tit, sub, accion) {
      return '<button class="menu-row" data-accion="' + accion + '">' +
        '<span class="mr-ico" aria-hidden="true">' + ico + '</span>' +
        '<span class="mr-main"><span class="mr-tit">' + tit + '</span>' +
        '<span class="mr-sub">' + sub + '</span></span>' +
        '<span class="mr-chevron" aria-hidden="true">›</span></button>';
    }
    var html = '<div class="menu-sec">Estado del modo docente</div><div class="menu-grupo">' +
      dOK.map(function (m) {
        return '<span class="menu-row" style="cursor:default">' +
          '<span class="mr-ico" aria-hidden="true">' + m.ico + '</span>' +
          '<span class="mr-main"><span class="mr-tit">' + m.n + '</span></span>' +
          (m.ok ? '<span class="badge nota verde">✓ detectado</span>' : '<span class="badge estado">por mapear</span>') + '</span>';
      }).join('') + '</div>' +
      '<div class="menu-sec">Atajos</div><div class="menu-grupo">' +
      menuRowDoc('📣', 'Mensajes y circulares', 'comunicados del colegio', 'ir:comunicados') +
      menuRowDoc('⚙️', 'Ajustes', 'tema, colores y metas', 'ajustes') +
      menuRowDoc('↻', 'Sincronizar portal', 'volver a leer Educalinks', 'refresh-manual') +
      menuRowDoc('⏻', 'Cerrar sesión', '', 'salir') +
      '</div>';
    if (mods.length) {
      html += '<div class="menu-sec">Rutas detectadas (para desarrollo)</div>' +
        '<p class="sub" style="font-size:.68rem;word-break:break-all">' + mods.map(function (m) { return esc(m.nombre + ' → ' + m.ruta); }).join(' · ') + '</p>';
    }
    renderEn('contenido-mas', html);
  }
  function pedirPermisoAuto() {
    if (!Object.keys(REC).length || !('Notification' in window)) return;
    if (Notification.permission === 'default') Notification.requestPermission();
  }
  function __detener() {
    state.activo = false;
    [timers.vivo, timers.rec, timers.nov].forEach(function (t) { if (t) clearInterval(t); });
    timers.vivo = timers.rec = timers.nov = null;
    scheduleRetry(false);
  }
  function setOnline(online) {
    var banner = $('#banner-offline');
    var f = $('#franja');
    if (online) {
      if (banner) banner.classList.add('oculto');
      if (state.fragil) recargar();
    } else {
      if (banner) banner.classList.remove('oculto');
    }
  }
  function loginInvitado() {
    var b = $('#btn-invitado');
    if (b) { b.disabled = true; b.textContent = 'Entrando sin validación…'; }
    apiFetch('api/invitado', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
      .then(function (r) {
        if (r.ok) return;
        var err = new Error('HTTP ' + r.status); err.status = r.status; throw err;
      })
      .then(function () {
        toast('👤 Modo invitado activo — mostrando datos guardados');
        window.App.iniciar();
      })
      .catch(function (e) {
        toast('No se pudo entrar como invitado', 'err');
      })
      .finally(function () {
        if (b) { b.disabled = false; b.textContent = '👤 Entrar como invitado'; }
      });
  }

  function cerrarSesion() {
    apiFetch('api/logout', { method: 'POST' }).finally(function () {
      __detener();
      try { localStorage.removeItem(LS_CACHE); } catch (e) {}
      window.Login.mostrar();
    });
  }

  /* ================= INPUTS AJUSTES / BUSCADOR ================= */
  function ligarInputs() {
    document.addEventListener('keydown', function (evk) {
      if (evk.target && evk.target.id === 'flash-resp' && evk.key === 'Enter') {
        evk.preventDefault();
        flashComprobar();
      }
    });
    document.addEventListener('input', function (ev) {
      var el = ev.target;
      if (el.dataset && el.dataset.cfg) {
        var k = el.dataset.cfg;
        if (k === 'dark' || k === 'ocultarHechas' || k === 'contraste' || k === 'digest') cfg[k] = el.checked;
        else if (k === 'accentLibre' || k === 'cardStyle' || k === 'ordenMaterias') cfg[k] = el.value;
        else cfg[k] = parseFloat(el.value);
        guardarCfg(); aplicarVisuales();
        var v = $('[data-cfg-val="' + k + '"]'); if (v) v.textContent = cfg[k];
      }
      if (el.dataset && el.dataset.colorMateria) {
        colorMateriaSet(el.dataset.colorMateria, el.value);
      }
      if (el.dataset && el.dataset.icoMateria) {
        var v = el.value.trim();
        if (v) ICONO_MAT[el.dataset.icoMateria] = v;
        else delete ICONO_MAT[el.dataset.icoMateria];
        guardarIconos();
      }
      if (el.id === 'buscador') { abrirPalette(el.value); }
      if (el.id === 'pal-input') renderPalette(el.value);
      if (el.id === 'pop-color') {
        cfg.accentLibre = el.value;
        guardarCfg(); aplicarVisuales();
      }
      if (el.id === 'pop-glass') {
        cfg.glass = parseInt(el.value, 10);
        guardarCfg(); aplicarVisuales();
      }
      if (el.id === 'hist-buscar') { }
      if (el.id === 'com-buscar') { }
      if (el.id === 'sim-materia' || el.id === 'sim-meta' || el.id === 'sim-k') calcSim();
      if (el.id === 'exam-nuevo-paso' && ev.type === 'keydown' && ev.key === 'Enter') { ev.preventDefault(); examAddPaso(); }
    });
    document.addEventListener('change', function (ev) {
      var el = ev.target;
      if (el.dataset && el.dataset.subtIdx != null && subtActual) {
        subtToggle(parseInt(el.dataset.subtIdx, 10));
        return;
      }
      if (el.dataset && el.dataset.cfg) {
        var k = el.dataset.cfg;
        if (k === 'dark' || k === 'ocultarHechas' || k === 'contraste' || k === 'digest') cfg[k] = el.checked;
        else if (k === 'accentLibre' || k === 'cardStyle' || k === 'ordenMaterias') cfg[k] = el.value;
        else cfg[k] = parseFloat(el.value);
        guardarCfg(); aplicarVisuales();
        if (k === 'pomoFocus' || k === 'pomoPause' || k === 'pomoLargo') { if (!POMO.activo) { POMO.modo = 'focus'; POMO.resta = pomoTotalSeg(); } if (state.vista === 'estudio') renderEstudio(); }
        renderVistaActual();
      }
      if (el.dataset && el.dataset.colorMateria) { renderVistaActual(); }
      if (el.dataset && el.dataset.widToggle) { widgetToggle(el.dataset.widToggle); }
      if (el.dataset && el.dataset.objMateria) {
        var val = parseFloat(el.value);
        if (!isNaN(val)) {
          cfg.objMateria = cfg.objMateria || {};
          cfg.objMateria[el.dataset.objMateria] = Math.max(1, Math.min(10, val));
          guardarCfg();
          if (state.vista === 'rendimiento') renderRendimiento();
        }
      }
      if (el.dataset && el.dataset.examCheck != null && examenActual) {
        var PLANES = leerLS('agenda_exam_plan', {});
        var plan = PLANES[examenActual.id];
        if (plan && plan.pasos[+el.dataset.examCheck]) {
          plan.pasos[+el.dataset.examCheck].done = el.checked;
          guardarLS('agenda_exam_plan', PLANES);
        }
      }
      if (el.id === 'sim-materia' || el.id === 'sim-meta' || el.id === 'sim-k') calcSim();
    });
  }

  function colorMateriaSet(nombre, valor) {
    COLORES_MAT[nombre] = valor;
    guardarColores();
  }

  function actualizarVivoWrap() {
    actualizarVivo();
    enfTick();
    pomoTick();
    refrescarCuentas();
  }

  var agg = { comTab: 'todos', calFiltro: null };

  /* ================= 4.0: PENDIENTES PERSONALES, COLORES, WIDGETS ================= */
  var PT = leerLS('agenda_pt', []);
  function guardarPT() { guardarLS('agenda_pt', PT); }
  function guardarActividadesPersonales() { guardarPT(); }

  function personaEvento(p) {
    return {
      id: 'pt-' + p.id,
      materia: p.materia || 'Personal',
      titulo: p.titulo,
      calificacion: null,
      fecha_inicio: p.fecha || null,
      fecha_fin: p.fecha || null,
      estado: 'Personal',
      periodo_codi: '',
      personal: true
    };
  }

  function agendaTodo() {
    if (!state.datos) return [];
    return (state.datos.agenda || []).concat(PT.map(personaEvento));
  }

  function normalizar(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim(); }
  function clavesIguales(a, b) { return normalizar(a) === normalizar(b); }

  var COLORES_MAT = leerLS('agenda_colores_mat', {});
  function guardarColores() { guardarLS('agenda_colores_mat', COLORES_MAT); }
  var PALETA_MAT = ['#f25022', '#16a34a', '#2563eb', '#9333ea', '#0891b2', '#db2777', '#ca8a04', '#0d9488', '#dc2626', '#65a30d', '#7c3aed', '#ea580c', '#6d28d9', '#059669', '#0284c7'];
  function colorMateria(nombre) {
    if (!nombre) return 'hsl(var(--a-h),var(--a-s),var(--a-l))';
    if (COLORES_MAT[nombre]) return COLORES_MAT[nombre];
    var m = null;
    for (var k in COLORES_MAT) { if (clavesIguales(k, nombre)) { m = COLORES_MAT[k]; break; } }
    if (m) { COLORES_MAT[nombre] = m; guardarColores(); return m; }
    var usados = Object.keys(COLORES_MAT).length;
    var c = PALETA_MAT[usados % PALETA_MAT.length];
    COLORES_MAT[nombre] = c;
    guardarColores();
    return c;
  }

  /* ---- Materiales del aula virtual (lazy) ---- */
  var MATER = leerLS('agenda_materiales', null);
  var materialesCargando = false;
  function cargarMateriales() {
    if (materialesCargando || MATER) return Promise.resolve();
    materialesCargando = true;
    return apiFetch('api/materiales', { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
      .then(function (j) {
        MATER = j.materiales || [];
        guardarLS('agenda_materiales', MATER);
      })
      .catch(function (e) { console.warn('materiales no pudieron cargarse (se mostrarán vacíos)', e); })
      .finally(function () { materialesCargando = false; });
  }
  function materialesMateria(nombre) {
    if (!MATER) return [];
    for (var i = 0; i < MATER.length; i++) {
      if (clavesIguales(MATER[i].materia, nombre)) return MATER[i].items || [];
    }
    return [];
  }
  function nombreArchivoLindo(f) {
    return f.replace(/^\d+-/, '').replace(/[-_]/g, ' ').replace(/\.(\w+)$/, ' .$1');
  }

  /* ---- widgets del inicio ---- */
  var WIDGETS_DEF = [
    { id: 'saludo', icon: '👋', nombre: 'Saludo y frase' },
    { id: 'importantes', icon: '⭐', nombre: 'Importantes (estrellas)' },
    { id: 'hoy', icon: '🟢', nombre: 'Hoy: clases y pendientes' },
    { id: 'manana', icon: '🟠', nombre: 'Bloque Mañana' },
    { id: 'semana', icon: '🟡', nombre: 'Bloque Esta semana' },
    { id: 'proximo', icon: '🔵', nombre: 'Próximamente' },
    { id: 'alertas', icon: '⚠️', nombre: 'Alertas (atrasadas/críticas)' },
    { id: 'rendimiento', icon: '📊', nombre: 'Mi rendimiento' },
    { id: 'racha', icon: '🔥', nombre: 'Racha y metas' },
    { id: 'novedades', icon: '🔔', nombre: 'Últimas novedades' }
  ];
  var WIDGETS_VISIBLES = leerLS('agenda_wid_vis', null);
  var WIDGETS_ORDEN = leerLS('agenda_wid_orden', null);
  function guardarWidgets() {
    guardarLS('agenda_wid_vis', WIDGETS_VISIBLES);
    guardarLS('agenda_wid_orden', WIDGETS_ORDEN);
  }
  function widgetsOrden() {
    if (WIDGETS_ORDEN && WIDGETS_ORDEN.length) return WIDGETS_ORDEN.filter(function (id) { return WIDGETS_DEF.some(function (w) { return w.id === id; }); })
      .concat(WIDGETS_DEF.filter(function (w) { return !WIDGETS_ORDEN.includes(w.id); }).map(function (w) { return w.id; }));
    return WIDGETS_DEF.map(function (w) { return w.id; });
  }
  function widgetVisible(id) {
    if (!WIDGETS_VISIBLES) return true;
    return WIDGETS_VISIBLES[id] !== false;
  }

  /* ---- Comodidad / accesibilidad ---- */
  function aplicarVisualesExtra() {
    var h = document.documentElement;
    h.setAttribute('data-dens', cfg.densidad || 'comoda');
    h.setAttribute('data-fuente', cfg.fuente || 'auto');
    h.setAttribute('data-contraste', cfg.contraste ? 'alto' : 'normal');
    h.setAttribute('data-card', cfg.cardStyle === 'solido' ? 'solido' : 'glass');
    /* intensidad del glass (personalizable 0-100) */
    var g = cfg.glass == null ? 100 : Math.max(0, Math.min(100, cfg.glass));
    var px = Math.round(14 * g / 100);
    h.style.setProperty('--blur', px < 1 ? 'none' : 'saturate(' + Math.round(140 + g * 0.4) + '%) blur(' + px + 'px)');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', cfg.dark ? 'hsl(' + cfg.tema + ',45%,20%)' : 'hsl(' + cfg.tema + ',100%,50%)');
  }

  /* ---------- popover de personalización rápida ---------- */
  var acentosAbierto = false;
  function renderAcentosPop() {
    var sw = PRESETS_ACENTO.map(function (p) {
      return '<button class="sw' + (cfg.tema === p.h && !cfg.accentLibre && (cfg.temaS == null || cfg.temaS === p.s) ? ' activa' : '') +
        '" data-accion="tema-sw" data-h="' + p.h + '" data-s="' + p.s + '" data-l="' + p.l + '" title="' + p.n + '" aria-label="Tema ' + p.n + '" style="background:hsl(' + p.h + ',' + p.s + '%,' + p.l + '%)"></button>';
    }).join('');
    renderEn('pop-swatches', sw);
    var color = $('#pop-color'); if (color) color.value = cfg.accentLibre || '#ff6a00';
    var glass = $('#pop-glass'); if (glass) glass.value = cfg.glass == null ? 100 : cfg.glass;
    $$('#pop-tema .seg-btn').forEach(function (b) {
      var modo = cfg.temaModo || 'auto';
      b.classList.toggle('activa', b.dataset.modo === (modo === 'auto' ? 'auto' : (cfg.dark ? 'oscuro' : 'claro')));
    });
  }
  function toggleAcentos() {
    acentosAbierto = !acentosAbierto;
    var el = document.getElementById('popover-acentos');
    el.classList.toggle('abierto', acentosAbierto);
    if (acentosAbierto) renderAcentosPop();
  }
  function cerrarAcentos() {
    acentosAbierto = false;
    var el = document.getElementById('popover-acentos');
    if (el) el.classList.remove('abierto');
  }
  function setTemaModo(modo) {
    cfg.temaModo = modo;
    if (modo === 'auto') cfg.dark = null;
    guardarCfg(); aplicarVisuales(); renderAcentosPop();
  }

  /* ======================================================
     5.0 — NUEVAS VISTAS Y MOTORES
     Pendientes · Materias · Evaluaciones · Documentos ·
     Estudio (Pomodoro + Flashcards SRS) · Más · Digest
     ====================================================== */

  /* ---- completadas esta semana (para la meta) ---- */
  function completadasSemana() {
    var iso = fechaISO(iniSemana(new Date()));
    var n = 0;
    for (var k in HECHAS_TS) if (HECHAS_TS[k] >= iso) n++;
    return n;
  }

  /* ---- planificación (docentes + leccionario), lazy ---- */
  var PLAN = leerLS('agenda_plan', null);
  var planCargando = false;
  function cargarPlanificacion() {
    if (planCargando || (PLAN && PLAN.length)) return Promise.resolve();
    planCargando = true;
    return apiFetch('api/planificacion', { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
      .then(function (j) {
        PLAN = j.materias || [];
        guardarLS('agenda_plan', PLAN);
      })
      .catch(function (e) { console.warn('planificación no disponible', e); })
      .finally(function () { planCargando = false; });
  }
  function docenteDe(materia) {
    if (!PLAN) return '';
    for (var i = 0; i < PLAN.length; i++) {
      if (clavesIguales(PLAN[i].materia, materia)) return PLAN[i].docente || '';
    }
    return '';
  }
  function leccionarioDe(materia) {
    if (!PLAN) return null;
    for (var i = 0; i < PLAN.length; i++) {
      if (clavesIguales(PLAN[i].materia, materia)) {
        var lec = PLAN[i].leccionario;
        return (lec && lec.filas && lec.filas.length) ? lec : null;
      }
    }
    return null;
  }

  /* ================= PENDIENTES ================= */
  function renderPendientes() {
    if (!state.datos) { renderEn('contenido-pendientes', skeleton()); return; }
    var pend = pendientesActivos();
    var hoyN = 0, semN = 0, atrN = 0, progN = 0;
    pend.forEach(function (e) {
      var n = diasRestantes(e);
      if (n < 0) atrN++;
      else if (n === 0) hoyN++;
      else if (n <= 7) semN++;
      if (HECHAS[e.id] === 'progreso') progN++;
    });
    var comp = completadasSemana();
    var metaSem = cfg.metaSemanal || 10;
    var pctSem = Math.min(100, Math.round(comp / Math.max(1, metaSem) * 100));

    var filtro = agg.pendFiltro || 'todas';
    var visibles = pend.filter(function (e) {
      var n = diasRestantes(e);
      if (filtro === 'hoy') return n === 0;
      if (filtro === 'semana') return n >= 0 && n <= 7;
      if (filtro === 'atrasadas') return n < 0;
      if (filtro === 'progreso') return HECHAS[e.id] === 'progreso';
      return true;
    });

    var html =
      '<div class="tarjeta">' +
      '<div class="pend-barra"><div class="pb-track"><div class="pb-fill" style="width:' + pctSem + '%"></div></div>' +
      '<span class="pb-lbl" aria-live="polite">🎯 Meta semanal: ' + comp + '/' + metaSem + ' completadas (' + pctSem + '%)</span></div>' +
      '<div class="pend-resumen">' +
      '<div class="pp"><span class="pp-val rojo">' + atrN + '</span><span class="pp-lbl">Atrasadas</span></div>' +
      '<div class="pp"><span class="pp-val">' + hoyN + '</span><span class="pp-lbl">Para hoy</span></div>' +
      '<div class="pp"><span class="pp-val ambar">' + progN + '</span><span class="pp-lbl">En progreso</span></div>' +
      '</div></div>' +
      '<div class="chips scroll">' +
      ['todas:Todas (' + pend.length + ')', 'hoy:Hoy (' + hoyN + ')', 'semana:Esta semana (' + semN + ')',
        'atrasadas:Atrasadas (' + atrN + ')', 'progreso:En progreso (' + progN + ')'].map(function (par) {
          var kv = par.split(':');
          return '<button class="chip' + (filtro === kv[0] ? ' activa' : '') + '" data-accion="pend-filtro" data-f="' + kv[0] + '">' + kv[1] + '</button>';
        }).join('') +
      '<button class="chip" data-accion="pt-add">＋ Nuevo pendiente</button></div>';

    if (visibles.length) {
      html += '<div class="tarjeta">' + visibles.slice(0, 60).map(function (e) {
        return cardPendiente(e);
      }).join('') + '</div>';
      if (visibles.length > 60) html += '<div class="sub" style="text-align:center">' + (visibles.length - 60) + ' más…</div>';
    } else {
      html += '<div class="vacio">🎉 Nada por aquí.<br><small>' + (filtro === 'todas' ? 'No tienes pendientes activos.' : 'Prueba otro filtro.') + '</small></div>';
    }
    renderEn('contenido-pendientes', html);
  }

  function cardPendiente(e) {
    var id = e.id;
    var est = HECHAS[id] === true ? 'hecha' : (HECHAS[id] === 'progreso' ? 'prog' : 'pend');
    var color = e.personal ? 'var(--ambar)' : colorMateria(e.materia);
    return '<div class="card ' + (est === 'hecha' ? 'hecha' : est === 'prog' ? 'progreso' : '') + ' ' + prioClase(e) + '" style="border-left-color:' + color + '">' +
      '<div class="info">' +
      '<div class="materia">' + (e.personal ? '✏️ MÍO' + (e.materia && e.materia !== 'Personal' ? ' · ' + esc(e.materia) : '') : chipMateria(e.materia) + esc(e.materia || 'General')) +
      (esExamen(e.titulo) ? ' · <span style="color:var(--rojo)">EXAMEN</span>' : '') +
      (esImportante(e.id) ? ' · ⭐' : '') + '</div>' +
      '<div class="titulo">' + esc(e.titulo) + '</div>' +
      '<div class="fecha-min">' + esc(evFechaLinda(e)) + '</div></div>' +
      '<div class="chips-der">' +
      '<div class="estado-3p" role="group" aria-label="Estado del pendiente">' +
      '<button data-accion="estado-3p" data-id="' + esc(id) + '" data-estado="pend" class="' + (est === 'pend' ? 'on-pend' : '') + '" title="Pendiente" aria-label="Pendiente">○</button>' +
      '<button data-accion="estado-3p" data-id="' + esc(id) + '" data-estado="prog" class="' + (est === 'prog' ? 'on-prog' : '') + '" title="En progreso" aria-label="En progreso">⏳</button>' +
      '<button data-accion="estado-3p" data-id="' + esc(id) + '" data-estado="hecha" class="' + (est === 'hecha' ? 'on-hecha' : '') + '" title="Completado" aria-label="Completado">✓</button>' +
      '</div>' +
      (e.personal ? '<button class="acc-btn" data-accion="pt-del" data-id="' + esc(id) + '" title="Eliminar">🗑️</button>' : '') +
      '</div></div>';
  }
  function evFechaLinda(e) {
    var n = diasRestantes(e);
    if (n == null) return 'Sin fecha';
    if (n < 0) return '⚠ Atrasada ' + Math.abs(n) + ' ' + (Math.abs(n) === 1 ? 'día' : 'días') + ' · ' + esc(e.fecha_inicio || '');
    if (n === 0) return 'HOY · ' + esc(e.fecha_inicio || '');
    if (n === 1) return 'Mañana · ' + esc(e.fecha_inicio || '');
    return esc(e.fecha_inicio || '') + ' · en ' + n + ' días';
  }

  /* ================= MATERIAS ================= */
  function renderMaterias() {
    if (!state.datos) { renderEn('contenido-materias', skeleton()); return; }
    cargarPlanificacion().then(function () {
      if (state.vista === 'materias' && !PLAN) { renderMaterias(); }
    });
    var nombres = [];
    var visto = {};
    function agregar(n) {
      if (!n) return;
      var k = normalizar(n);
      if (!visto[k]) { visto[k] = 1; nombres.push(n); }
    }
    ((state.datos.resumen || {}).materias || []).forEach(function (m) { agregar(m.materia); });
    materiasUnicas().forEach(agregar);
    (state.datos.horario || []).forEach(function (b) { agregar(b.materia); });
    (PLAN || []).forEach(function (p) { agregar(p.materia); });

    var datos = nombres.map(function (nombre) {
      var res = ((state.datos.resumen || {}).materias || []).filter(function (m) { return clavesIguales(m.materia, nombre); })[0];
      return {
        nombre: nombre,
        pro: res ? esCal(res.promedio) : null,
        act: res ? res.actividades : 0,
        pend: pendientesActivos().filter(function (e) { return clavesIguales(e.materia, nombre); }),
        doc: docenteDe(nombre),
        clases: (state.datos.horario || []).filter(function (b) { return clavesIguales(b.materia, nombre); }).length
      };
    });
    if (cfg.ordenMaterias === 'promedio') {
      datos.sort(function (a, b) { return (b.pro || -1) - (a.pro || -1) || String(a.nombre).localeCompare(String(b.nombre)); });
    } else if (cfg.ordenMaterias === 'pendientes') {
      datos.sort(function (a, b) { return b.pend.length - a.pend.length || String(a.nombre).localeCompare(String(b.nombre)); });
    } else {
      datos.sort(function (a, b) { return String(a.nombre).localeCompare(String(b.nombre)); });
    }

    var html = '<div class="seg" style="margin:.1rem 0 .55rem" role="tablist" aria-label="Vista de materias">' +
      [['lista', '☰ Lista'], ['tarjetas', '🗂️ Tarjetas'], ['compacto', '▪ Compacto']].map(function (v) {
        return '<button class="seg-btn' + (cfg.materiasVista === v[0] || (!cfg.materiasVista && v[0] === 'lista') ? ' activa' : '') + '" data-accion="materias-vista" data-v="' + v[0] + '" role="tab">' + v[1] + '</button>';
      }).join('') + '</div>';

    var vista = cfg.materiasVista || 'lista';
    if (vista === 'tarjetas') {
      html += '<div class="mat-cards">' + datos.map(function (m) {
        var prox = m.pend.length ? m.pend[0] : null;
        return '<button class="mat-card" data-accion="mat-abrir" data-materia="' + esc(m.nombre) + '" style="--mat-c:' + colorMateria(m.nombre) + '">' +
          '<div class="m-nombre">' + esc(m.nombre) + '</div>' +
          (m.doc ? '<div class="m-docente">👨‍🏫 ' + esc(truncNombre(m.doc, 28)) + '</div>' : '') +
          '<div class="m-stats">' +
          (m.pro != null ? '<span class="m-chip" style="color:' + sisColor(m.pro) + ';font-weight:800">📊 ' + fmtNum(m.pro, 2) + '</span>' : '<span class="m-chip">sin notas</span>') +
          (m.pend.length ? '<span class="m-chip' + (m.pend.length > 3 ? ' alerta' : '') + '">📝 ' + m.pend.length + '</span>' : '') +
          '</div>' +
          (prox ? '<div class="m-prox">📌 ' + esc(truncNombre(prox.titulo, 30)) + '</div>' : '') +
          '</button>';
      }).join('') + '</div>';
    } else if (vista === 'compacto') {
      html += '<div class="mat-compacto">' + datos.map(function (m) {
        return '<button class="mc-cel" data-accion="mat-abrir" data-materia="' + esc(m.nombre) + '" title="' + esc(m.nombre) + (m.doc ? ' · ' + esc(m.doc) : '') + '">' +
          '<span class="dot" style="background:' + colorMateria(m.nombre) + ';width:.65rem;height:.65rem;border-radius:50%"></span>' +
          '<span class="mc-n">' + esc(truncNombre(m.nombre, 22)) + '</span>' +
          (m.pro != null ? '<span class="mc-p ' + sisColor(m.pro) + '">' + fmtNum(m.pro, 1) + '</span>' : '<span class="mc-p" style="color:var(--text-muted)">—</span>') +
          (m.pend.length ? '<span class="m-chip' + (m.pend.length > 3 ? ' alerta' : '') + '">' + m.pend.length + '</span>' : '') +
          '</button>';
      }).join('') + '</div>';
    } else {
      html += '<div class="mat-lista">' + datos.map(function (m) {
        return '<button class="mat-row" data-accion="mat-abrir" data-materia="' + esc(m.nombre) + '">' +
          chipMateria(m.nombre) +
          '<span class="mr-main"><span class="mr-nombre">' + esc(m.nombre) + '</span>' +
          (m.doc ? '<span class="mr-doc">' + esc(truncNombre(m.doc, 30)) + '</span>' : '') + '</span>' +
          (m.pro != null ? '<span class="mr-prom ' + sisColor(m.pro) + '">' + fmtNum(m.pro, 2) + '</span>' : '<span class="mr-prom muted">—</span>') +
          (m.pend.length ? '<span class="mr-chip' + (m.pend.length > 3 ? ' alerta' : '') + '">' + m.pend.length + '</span>' : '') +
          '<span class="mr-chevron" aria-hidden="true">›</span>' +
          '</button>';
      }).join('') + '</div>';
    }
    html += (datos.some(function (m) { return m.pend.length; }) ?
      '<p class="sub" style="text-align:center;margin-top:.5rem">El número indica pendientes activos · toca una materia para ver todo su detalle</p>' : '');
    renderEn('contenido-materias', html ||
      '<div class="vacio">📚 Aún no detectamos materias.<br><small>Actualiza los datos con ↻</small></div>');
  }

  function abrirMateria(nombre) {
    materiaActual = nombre;
    if (!agg.matTab) agg.matTab = 'resumen';
    /* logro Explorador: registrar materias vistas (únicas) */
    var vistas = leerLS('agenda_matvistas', []);
    if (!vistas.some(function (v) { return clavesIguales(v, nombre); })) {
      vistas.push(nombre);
      guardarLS('agenda_matvistas', vistas);
      guardarLS('agenda_materias_vistas', vistas.length);
    }
    renderMateriaOverlay();
    openOverlay('overlay-materia');
  }

  var NOTAS_DET = null;
  var notasDetCargando = false;
  function cargarNotasDetalle() {
    if (notasDetCargando || NOTAS_DET) return Promise.resolve();
    notasDetCargando = true;
    return apiFetch('api/notas/detalle', { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
      .then(function (j) { NOTAS_DET = j; })
      .catch(function (e) { console.warn('notas detalladas no disponibles', e); })
      .finally(function () { notasDetCargando = false; });
  }
  function notasDetMateria(nombre) {
    if (!NOTAS_DET || !NOTAS_DET.disponible) return [];
    var filas = [];
    (NOTAS_DET.periodos || []).forEach(function (p) {
      (p.materias || []).forEach(function (m) {
        if (clavesIguales(m.materia, nombre)) {
          filas.push({ periodo: p.periodo, m: m });
        }
      });
    });
    return filas;
  }

  function renderMateriaOverlay() {
    var nombre = materiaActual;
    if (!nombre) return;
    var tabs = [['resumen', 'Resumen'], ['agenda', 'Agenda'], ['notas', 'Notas'], ['materiales', 'Materiales'], ['asistencia', 'Asistencia']];
    $('#materia-titulo').innerHTML = chipMateria(nombre) +
      esc(nombre) + ' <span style="margin-left:auto"></span>' +
      '<button class="x" data-accion="mat-full" title="' + (agg.matFull ? 'Salir de pantalla completa' : 'Pantalla completa (más info)') + '" aria-label="Pantalla completa">' + (agg.matFull ? '⤡' : '⛶') + '</button>' +
      '<button class="x" data-accion="materia-cerrar" aria-label="Cerrar">✕</button>' +
      '<div class="chips" style="margin:.55rem 0 .2rem">' + tabs.map(function (t) {
        return '<button class="chip' + (agg.matTab === t[0] ? ' activa' : '') + '" data-accion="mat-tab" data-tab="' + t[0] + '">' + t[1] + '</button>';
      }).join('') + '</div>';
    document.getElementById('overlay-materia').classList.toggle('completo', !!agg.matFull);

    var res = ((state.datos.resumen || {}).materias || []).filter(function (m) { return clavesIguales(m.materia, nombre); })[0] || null;
    var pro = res ? esCal(res.promedio) : null;
    var pendM = pendientesActivos().filter(function (e) { return clavesIguales(e.materia, nombre); });
    var calif = agendaTodo().filter(function (e) {
      return !e.personal && clavesIguales(e.materia, nombre) && esCal(e.calificacion) != null;
    }).sort(function (a, b) { return String(b.fecha_inicio || '').localeCompare(String(a.fecha_inicio || '')); });
    var mats = materialesMateria(nombre);
    var lec = leccionarioDe(nombre);
    var doc = docenteDe(nombre);
    var fl = FLASH.filter(function (c) { return clavesIguales(c.m, nombre); });
    var fal = (state.datos || {}).faltas || {};

    var html = '';
    if (agg.matTab === 'resumen') {
      html += '<div class="caja-prom">' +
        '<div class="pp"><span class="pp-val ' + (pro != null ? sisColor(pro) : '') + '">' + fmtNum(pro, 2) + '</span><span class="pp-lbl">Promedio</span></div>' +
        '<div class="pp"><span class="pp-val">' + pendM.length + '</span><span class="pp-lbl">Pendientes</span></div>' +
        '<div class="pp"><span class="pp-val">' + (res ? res.actividades : (calif.length || 0)) + '</span><span class="pp-lbl">Calificadas</span></div>' +
        '</div>' +
        (doc ? '<div class="sub" style="margin:.55rem 0 .2rem">👨‍🏫 Docente: <strong>' + esc(doc) + '</strong></div>' : '');
      if (pendM.length) {
        html += '<div class="mat-detalle-sec"><h4>📌 Pendientes (' + pendM.length + ')</h4>' +
          pendM.slice(0, 3).map(function (e) { return cardEvento(e, { compacta: true, prioridades: true }); }).join('') +
          (pendM.length > 3 ? '<button class="btn ghost mini" data-accion="mat-tab" data-tab="agenda">Ver agenda completa →</button>' : '') + '</div>';
      }
      if (calif.length) {
        html += '<div class="mat-detalle-sec"><h4>📝 Últimas notas</h4><div class="tarjeta" style="padding:.5rem .7rem">' +
          calif.slice(0, 3).map(function (e) {
            return '<div class="fila-per"><span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(truncNombre(e.titulo, 36)) + '</span>' +
              '<span class="badge nota ' + sisColor(esCal(e.calificacion)) + '">' + esc(e.calificacion) + '</span></div>';
          }).join('') + '</div></div>';
      }
      html += '<div class="mat-detalle-sec"><div style="display:flex;gap:.5rem;flex-wrap:wrap">' +
        '<button class="btn ghost mini" data-accion="flash-nueva" data-materia="' + esc(nombre) + '">🃏 Flashcard (' + fl.length + ')</button>' +
        '<button class="btn ghost mini" data-accion="pomo-para-examen" data-materia="' + esc(nombre) + '">🍅 Estudiar</button>' +
        '<button class="btn ghost mini" data-accion="mat-share" data-materia="' + esc(nombre) + '">🔗 Compartir resumen</button></div></div>';
    }

    if (agg.matTab === 'agenda') {
      html += pendM.length ?
        '<div class="mat-detalle-sec"><h4>📌 Pendientes (' + pendM.length + ')</h4>' +
        pendM.slice(0, agg.matFull ? 50 : 6).map(function (e) { return cardEvento(e, { compacta: true, prioridades: true }); }).join('') + '</div>'
        : '<div class="vacio" style="padding:.8rem">Sin pendientes de esta materia.</div>';
      html += calif.length ?
        '<div class="mat-detalle-sec"><h4>✅ Calificadas (' + calif.length + (agg.matFull ? '' : ' · últimas 8') + ')</h4><div class="tarjeta" style="padding:.5rem .7rem">' +
        calif.slice(0, agg.matFull ? 50 : 8).map(function (e) {
          return '<div class="fila-per"><span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(truncNombre(e.titulo, 40)) + ' <span class="sub">' + esc(e.fecha_inicio || '') + '</span></span>' +
            '<span class="badge nota ' + sisColor(esCal(e.calificacion)) + '">' + esc(e.calificacion) + '</span></div>';
        }).join('') + '</div></div>' : '';
    }

    if (agg.matTab === 'notas') {
      var det = notasDetMateria(nombre);
      if (!NOTAS_DET && !notasDetCargando) {
        html += '<div class="vacio" style="padding:.9rem;font-size:.85rem">⏳ Cargando desglose oficial de la libreta…</div>';
        cargarNotasDetalle().then(function () { if (materiaActual === nombre) renderMateriaOverlay(); });
      } else if (!det.length) {
        html += '<div class="vacio" style="padding:.9rem">La libreta oficial aún no publica notas de esta materia.</div>';
      } else {
        html += '<p class="sub" style="margin-bottom:.4rem">Desglose oficial (libreta de Educalinks):</p>';
        det.forEach(function (fila) {
          var m = fila.m;
          html += '<div class="fila-per"><span><strong>' + esc(fila.periodo) + '</strong></span>' +
            '<span class="badge nota ' + sisColor(m.total) + '">' + fmtNum(m.total, 2) + '</span></div>' +
            (m.componentes && m.componentes.length ?
              '<div class="barra-p" style="margin:.2rem 0 .5rem"><span class="b-lbl">TAR·LEC·ACT·TRG</span>' +
              '<span class="b-track" style="height:2.2rem;border-radius:.6rem;position:relative;overflow:hidden;background:var(--borde)">' +
              m.componentes.slice(0, 4).map(function (v, i) {
                return '<span style="position:absolute;top:0;bottom:0;width:calc(25% - 2px);left:calc(' + (i * 25) + '% + ' + (i * 2) + 'px);background:' + (esCal(v) != null && esCal(v) >= cfg.meta ? 'var(--verde)' : esCal(v) != null && esCal(v) < cfg.riesgo ? 'var(--rojo)' : 'var(--ambar)') + ';opacity:.75"></span>';
              }).join('') +
              '<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:space-around;color:var(--texto);font-weight:800;font-size:.78rem">' +
              m.componentes.slice(0, 4).map(function (v) { return fmtNum(esCal(v), 1); }).join(' ') + '</span></span></div>' : '') +
            (m.examen_parcial != null ? '<div class="sub" style="margin-bottom:.4rem">Examen parcial: <strong>' + fmtNum(m.examen_parcial, 2) + '</strong> (30%) · cierre: <strong>' + fmtNum(m.aporte_cierre_70, 2) + '</strong> (70%)</div>' : '');
        });
        if (pro != null) {
          var meta = (cfg.objMateria && cfg.objMateria[nombre] != null) ? cfg.objMateria[nombre] : cfg.meta;
          html += '<div class="tip" style="font-size:.78rem">🎯 Meta en esta materia: ' + fmtNum(meta, 1) + ' · actual ' + fmtNum(pro, 2) + (pro >= meta ? ' ✅' : ' ⏳') + '</div>';
        }
      }
    }

    if (agg.matTab === 'materiales') {
      if (lec) {
        html += '<div class="mat-detalle-sec"><h4>📖 Leccionario (temas)</h4><div class="tarjeta" style="padding:.5rem .7rem;font-size:.8rem">' +
          lec.filas.slice(0, agg.matFull ? 40 : 8).map(function (f) {
            return '<div style="padding:.3rem 0;border-bottom:1px dashed var(--borde)">' + esc(f.join(' · ').slice(0, 120)) + '</div>';
          }).join('') + '</div></div>';
      }
      html += mats.length ?
        '<div class="mat-detalle-sec"><h4>📎 Materiales del aula (' + mats.length + ')</h4>' +
        mats.slice(0, agg.matFull ? 100 : 8).map(function (it) {
          var btns = (it.archivos || []).map(function (a) {
            return '<a class="acc-btn" href="' + API + 'api/descargar?url=' + encodeURIComponent(a.url) + '&nombre=' + encodeURIComponent(a.nombre) + '" target="_blank" title="Descargar ' + esc(a.nombre) + '">⤓</a>';
          }).join('');
          return '<div class="mat-item"><div class="mi"><span class="mi-strong">' + esc(truncNombre(it.titulo, 46)) + '</span>' +
            (it.publicado_en ? '<div class="mi-sub">' + esc(it.publicado_en) + '</div>' : '') + '</div>' +
            '<div class="ax">' + btns + '</div></div>';
        }).join('') + '</div>'
        : '<div class="vacio" style="padding:.9rem">Sin materiales publicados en el aula virtual.</div>';
      if (agg.matFull && fl.length) {
        html += '<div class="mat-detalle-sec"><h4>🃏 Flashcards de la materia (' + fl.length + ')</h4><div class="tarjeta" style="padding:.5rem .7rem;font-size:.8rem">' +
          fl.slice(0, 12).map(function (c) {
            return '<div class="fila-per"><span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(truncNombre(c.f, 40)) + '</span><span class="sub">caja ' + (c.caja || 0) + '</span></div>';
          }).join('') + '</div></div>';
      }
    }

    if (agg.matTab === 'asistencia') {
      var fres = fal.resumen || {};
      if (fal.disponible === false) {
        html += '<div class="vacio" style="padding:.9rem">No se pudo obtener el historial de asistencia.</div>';
      } else {
        html += '<p class="sub" style="margin-bottom:.4rem">Educalinks registra la asistencia de forma global (no por materia). Tu historial completo:</p>' +
          '<div class="caja-prom">' +
          '<div class="pp"><span class="pp-val ambar">' + (fres.faltas_justificadas || 0) + '</span><span class="pp-lbl">F. justificadas</span></div>' +
          '<div class="pp"><span class="pp-val rojo">' + (fres.faltas_injustificadas || 0) + '</span><span class="pp-lbl">F. injustificadas</span></div>' +
          '<div class="pp"><span class="pp-val">' + (fres.atrasos || 0) + '</span><span class="pp-lbl">Atrasos</span></div>' +
          '</div>' +
          '<div class="mat-detalle-sec"><h4>Últimos registros</h4><div class="tarjeta" style="padding:.5rem .7rem;font-size:.78rem">' +
          (fal.eventos || []).slice(0, 8).map(function (ev) {
            return '<div class="fila-per"><span>' + esc(ev.fecha) + '</span><span class="sub">' + esc(ev.tipo) + '</span></div>';
          }).join('') + '</div></div>';
      }
    }

    $('#materia-detalle').innerHTML = html;
  }

  function abrirInfo(titulo, cuerpoHtml) {
    $('#info-titulo').innerHTML = titulo +
      ' <span style="margin-left:auto"></span><button class="x" data-accion="info-cerrar" aria-label="Cerrar">✕</button>';
    $('#info-cuerpo').innerHTML = cuerpoHtml;
    openOverlay('overlay-info');
  }

  function abrirInfoAsistencia() {
    var fal = state.datos.faltas || {};
    var fres = fal.resumen || {};
    $('#info-titulo').innerHTML = '🧾 Mi asistencia <span style="margin-left:auto"></span><button class="x" data-accion="info-cerrar" aria-label="Cerrar">✕</button>';
    var html = '<div class="caja-prom">' +
      '<div class="pp"><span class="pp-val ambar">' + (fres.faltas_justificadas || 0) + '</span><span class="pp-lbl">Justificadas</span></div>' +
      '<div class="pp"><span class="pp-val rojo">' + (fres.faltas_injustificadas || 0) + '</span><span class="pp-lbl">Injustificadas</span></div>' +
      '<div class="pp"><span class="pp-val">' + (fres.atrasos || 0) + '</span><span class="pp-lbl">Atrasos</span></div></div>' +
      '<div class="mat-detalle-sec"><h4>Historial (' + (fal.eventos || []).length + ')</h4><div class="tarjeta" style="padding:.5rem .7rem;font-size:.8rem;max-height:40vh;overflow:auto">' +
      (fal.eventos || []).map(function (ev) {
        return '<div class="fila-per"><span>' + esc(ev.fecha) + '</span>' +
          '<span class="sub">' + esc(ev.tipo) + ' · ' + esc(ev.titulo || '') + '</span></div>';
      }).join('') + '</div></div>';
    $('#info-cuerpo').innerHTML = html;
    openOverlay('overlay-info');
  }

  function abrirInfoPagos() {
    var pagos = ((state.datos.panel || {}).pagos || []);
    $('#info-titulo').innerHTML = '💳 Pagos pendientes <span style="margin-left:auto"></span><button class="x" data-accion="info-cerrar" aria-label="Cerrar">✕</button>';
    $('#info-cuerpo').innerHTML = pagos.length ?
      '<div class="tarjeta" style="padding:.6rem .8rem">' + pagos.map(function (p) {
        return '<div class="fila-per"><span><strong>' + esc(p.deuda) + '</strong> <span class="sub">· vence ' + esc(p.vencimiento || '—') + '</span></span>' +
          '<span class="mono" style="font-weight:800">' + esc(p.valor || '') + '</span></div>';
      }).join('') + '</div>' +
      '<p class="sub" style="margin-top:.5rem">Datos de referencia; el pago se realiza por los canales oficiales del colegio.</p>'
      : '<div class="vacio">Sin pagos pendientes 🎉</div>';
    openOverlay('overlay-info');
  }

  /* ================= EVALUACIONES ================= */
  function renderEvaluaciones() {
    if (!state.datos) { renderEn('contenido-evaluaciones', skeleton()); return; }
    var hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    var evals = agendaTodo().filter(function (e) {
      return !e.personal && esExamen(e.titulo) && e.fecha_inicio && diasRestantes(e) >= 0;
    }).sort(function (a, b) { return String(a.fecha_inicio).localeCompare(String(b.fecha_inicio)); });

    var html = '';
    var crit = semanaCritica();
    if (crit) {
      html += '<div class="critica-card" role="status">🔥 <strong>Semana cargada:</strong> ' + crit.n + ' evaluaciones/entregas entre ' +
        fmtCorta(crit.desde) + ' y ' + fmtCorta(crit.hasta) + '. Organiza tu tiempo con anticipación.</div>';
    }
    if (evals.length) {
      html += '<div class="prio-cab ahora"><span class="punto" aria-hidden="true"></span> PRÓXIMAS EVALUACIONES <span class="n">' + evals.length + '</span></div>' +
        evals.map(function (e) {
          var n = diasRestantes(e);
          return '<div class="eval-item" data-accion="eval-abrir" data-id="' + esc(e.id) + '" role="button" tabindex="0">' +
            '<div class="eval-cd"><div class="n">' + (n === 0 ? 'HOY' : n) + '</div><div class="u">' + (n === 0 ? '' : n === 1 ? 'día' : 'días') + '</div></div>' +
            '<div style="flex:1;min-width:0"><div class="materia" style="font-size:.72rem;font-weight:800;color:' + colorMateria(e.materia) + ';text-transform:uppercase">' + esc(e.materia) + '</div>' +
            '<div class="titulo" style="font-size:.95rem;font-weight:700;margin-top:.15rem">' + esc(e.titulo) + '</div>' +
            '<div class="sub" style="margin-top:.15rem">' + fmtDia(parseLocal(e.fecha_inicio)) + '</div></div>' +
            '<span aria-hidden="true" style="color:var(--texto3)">›</span></div>';
        }).join('');
    } else {
      html += '<div class="vacio">🎉 No hay evaluaciones próximas.<br><small>Disfruta la calma.</small></div>';
    }

    /* heatmap de carga a 30 días */
    var hoyIso = fechaISO(hoy);
    var porDia = {};
    pendientesActivos().forEach(function (e) {
      if (!e.fecha_inicio) return;
      porDia[e.fecha_inicio] = (porDia[e.fecha_inicio] || 0) + 1;
    });
    html += '<h2 class="seccion">🌡️ Carga de los próximos 30 días</h2><div class="hm-grid" role="img" aria-label="Mapa de carga de actividades">';
    for (var i = 0; i < 30; i++) {
      var dd = addDays(hoy, i);
      var iso = fechaISO(dd);
      var c = porDia[iso] || 0;
      var cls = c === 0 ? '' : c === 1 ? 'n1' : c === 2 ? 'n2' : c === 3 ? 'n3' : 'n4';
      html += '<div class="hm-cel ' + cls + '" title="' + fmtDia(dd) + ': ' + c + ' actividad(es)">' + dd.getDate() + '</div>';
    }
    html += '</div><div class="hm-leyenda"><span><i style="background:var(--bg-subtle)"></i>libre</span>' +
      '<span><i style="background:hsla(157,72%,45%,.25)"></i>1</span><span><i style="background:hsla(45,100%,50%,.4)"></i>2</span>' +
      '<span><i style="background:hsla(28,100%,52%,.55)"></i>3</span><span><i style="background:hsla(0,84%,58%,.75)"></i>4+</span></div>';
    renderEn('contenido-evaluaciones', html);
  }

  function abrirExamen(id) {
    var ev = eventoPorId(id);
    if (!ev) return;
    examenActual = ev;
    var PLANES = leerLS('agenda_exam_plan', {});
    var plan = PLANES[ev.id];
    if (!plan) {
      var lec = leccionarioDe(ev.materia);
      var pasos;
      if (lec && lec.filas.length) {
        pasos = lec.filas.slice(-6).map(function (f) { return { t: f.join(' · ').slice(0, 80), done: false }; });
      } else {
        pasos = [
          { t: 'Repasar apuntes y materiales de clase', done: false },
          { t: 'Hacer un resumen propio del tema', done: false },
          { t: 'Resolver ejercicios / prácticas del tema', done: false },
          { t: 'Repaso final el día anterior', done: false }
        ];
      }
      plan = { pasos: pasos };
      PLANES[ev.id] = plan;
      guardarLS('agenda_exam_plan', PLANES);
    }
    var n = diasRestantes(ev);
    var mats = materialesMateria(ev.materia).slice(0, 6);
    var html = '<div class="critica-card" style="text-align:center;font-size:1rem">' +
      (n === 0 ? '⏰ <strong>¡Es HOY!</strong>' : n === 1 ? '🔥 <strong>Mañana</strong>' : '⏳ <strong>En ' + n + ' días</strong>') +
      ' · ' + fmtDia(parseLocal(ev.fecha_inicio)) + '</div>' +
      '<div class="mat-detalle-sec"><h4>✅ Mi plan de estudio</h4><div class="tarjeta" style="padding:.6rem .8rem">' +
      plan.pasos.map(function (p, i) {
        return '<label class="plan-check"><input type="checkbox" data-exam-check="' + i + '"' + (p.done ? ' checked' : '') +
          ' aria-label="Paso ' + (i + 1) + '"><span>' + esc(p.t) + '</span></label>';
      }).join('') +
      '<div style="display:flex;gap:.4rem;margin-top:.6rem">' +
      '<input type="text" id="exam-nuevo-paso" placeholder="Añadir paso…" style="flex:1;border:1.5px solid var(--borde);border-radius:var(--radio-s);padding:.5rem .65rem;background:var(--bg2);color:var(--texto);font-size:.85rem">' +
      '<button class="btn mini" data-accion="exam-addpaso">＋</button></div>' +
      '</div></div>';
    if (mats.length) {
      html += '<div class="mat-detalle-sec"><h4>📎 Carpeta de repaso (aula virtual)</h4>' +
        mats.map(function (it) {
          var btns = (it.archivos || []).map(function (a) {
            return '<a class="acc-btn" href="' + API + 'api/descargar?url=' + encodeURIComponent(a.url) + '&nombre=' + encodeURIComponent(a.nombre) + '" target="_blank" title="Descargar ' + esc(a.nombre) + '">⤓</a>';
          }).join('');
          return '<div class="mat-item"><div class="mi"><span class="mi-strong">' + esc(truncNombre(it.titulo, 44)) + '</span></div><div class="ax">' + btns + '</div></div>';
        }).join('') + '</div>';
    }
    html += '<div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.8rem">' +
      '<button class="btn ghost mini" data-accion="pomo-para-examen" data-materia="' + esc(ev.materia) + '">🍅 Estudiar ahora (Pomodoro)</button>' +
      '<button class="btn ghost mini" data-accion="flash-nueva" data-materia="' + esc(ev.materia) + '">🃏 Crear flashcard</button></div>';
    $('#examen-titulo').innerHTML = '📌 ' + esc(ev.titulo) + ' <span style="margin-left:auto"></span><button class="x" data-accion="examen-cerrar" aria-label="Cerrar">✕</button>';
    $('#examen-detalle').innerHTML = html;
    openOverlay('overlay-examen');
  }

  /* ================= DOCUMENTOS ================= */
  function tipoDocumento(it) {
    var t = ((it.titulo || '') + ' ' + ((it.archivos || []).map(function (a) { return a.nombre; }).join(' '))).toLowerCase();
    if (/examen|quiz|evalu|parcial|mock/.test(t)) return 'Evaluaciones';
    if (/gu[ií]a|worksheet|workbook|reading/.test(t)) return 'Guías';
    if (/lab/.test(t)) return 'Laboratorios';
    if (/present|slide|ppt|diapositiv|exposici/.test(t)) return 'Presentaciones';
    if (/tarea|homework|actividad|assignment|proyect/.test(t)) return 'Tareas';
    return 'Otros';
  }
  function renderDocumentos() {
    if (!MATER) {
      renderEn('contenido-documentos', '<div class="vacio">📎 Cargando materiales del aula virtual…<br><small>La primera carga puede tardar un poco.</small></div>');
      cargarMateriales().then(function () { if (state.vista === 'documentos') renderDocumentos(); });
      return;
    }
    var q = (agg.docQ || '').toLowerCase();
    var html = '<input type="search" class="com-buscar" id="doc-buscar" placeholder="🔎 Buscar en documentos…" value="' + esc(agg.docQ || '') + '" autocomplete="off">';
    var favoritos = [];
    (MATER || []).forEach(function (mt) {
      (mt.items || []).forEach(function (it) {
        var key = 'd:' + mt.materia + '|' + it.titulo;
        if (FAV[key] && (!q || (it.titulo + ' ' + mt.materia).toLowerCase().indexOf(q) >= 0)) {
          favoritos.push({ mt: mt, it: it, key: key });
        }
      });
    });
    if (favoritos.length) {
      html += '<h2 class="seccion">⭐ Favoritos</h2>' + favoritos.map(function (f) { return docItem(f.mt, f.it, f.key); }).join('');
    }
    (MATER || []).forEach(function (mt) {
      var items = (mt.items || []).filter(function (it) {
        return !q || (it.titulo + ' ' + mt.materia).toLowerCase().indexOf(q) >= 0;
      });
      if (!items.length) return;
      var abierto = agg.docAbiertos ? agg.docAbiertos[mt.materia] !== false : true;
      html += '<div class="doc-cab' + (abierto ? ' abierto' : '') + '" data-accion="doc-toggle" data-grupo="' + esc(mt.materia) + '" role="button" tabindex="0">' +
        '<span class="flecha" aria-hidden="true">▶</span><span class="dot" style="background:' + colorMateria(mt.materia) + ';width:.7rem;height:.7rem;border-radius:50%"></span>' +
        esc(mt.materia) + '<span class="m-chip" style="margin-left:auto">' + items.length + '</span></div>';
      if (abierto) {
        var porTipo = {};
        items.forEach(function (it) {
          var t = tipoDocumento(it);
          (porTipo[t] = porTipo[t] || []).push(it);
        });
        html += '<div class="doc-grupo">';
        Object.keys(porTipo).sort().forEach(function (t) {
          html += '<div class="doc-tipo">' + esc(t) + '</div>' +
            porTipo[t].map(function (it) { return docItem(mt, it, 'd:' + mt.materia + '|' + it.titulo); }).join('');
        });
        html += '</div>';
      }
    });
    html += (MATER.every(function (mt) { return !(mt.items || []).length; })
      ? '<div class="vacio">📂 El aula virtual no tiene materiales publicados.<br><small>Intenta actualizar con ↻</small></div>' : '');
    renderEn('contenido-documentos', html);
    setTimeout(function () {
      var el = $('#doc-buscar');
      if (el) el.addEventListener('input', function () {
        agg.docQ = el.value;
        renderDocumentos();
      });
    }, 0);
  }
  function docItem(mt, it, key) {
    var btns = (it.archivos || []).map(function (a) {
      return '<a class="acc-btn" href="' + API + 'api/descargar?url=' + encodeURIComponent(a.url) + '&nombre=' + encodeURIComponent(a.nombre) + '" target="_blank" title="Descargar ' + esc(a.nombre) + '" aria-label="Descargar">⤓</a>';
    }).join('');
    return '<div class="doc-item">' +
      '<button class="acc-btn fav ' + (FAV[key] ? 'on' : '') + '" data-accion="fav-doc" data-key="' + esc(key) + '" title="Favorito" aria-label="Marcar favorito">★</button>' +
      '<span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(it.titulo) +
      (it.publicado_en ? ' <span class="sub">' + esc(it.publicado_en) + '</span>' : '') + '</span>' +
      '<span class="ax" style="display:inline-flex;gap:.3rem">' + btns + '</span></div>';
  }

  /* ================= ESTUDIO: POMODORO + FLASHCARDS ================= */
  var POMO = { activo: false, modo: 'focus', resta: (cfg.pomoFocus || 25) * 60, materia: '', tarea: '' };
  var SESIONES = leerLS('agenda_sesiones', []);
  function guardarSesiones() { guardarLS('agenda_sesiones', SESIONES); }

  function pomoTotalSeg() {
    if (POMO.modo === 'focus') return (cfg.pomoFocus || 25) * 60;
    var largo = ((POMO.ciclos || 0) % 4 === 0 && (POMO.ciclos || 0) > 0);
    return (largo ? (cfg.pomoLargo || 15) : (cfg.pomoPause || 5)) * 60;
  }
  function pomoTick() {
    if (!POMO.activo) return;
    POMO.resta--;
    if (POMO.resta <= 0) {
      if (POMO.modo === 'focus') {
        var mins = cfg.pomoFocus || 25;
        POMO.ciclos = (POMO.ciclos || 0) + 1;
        SESIONES.push({ f: fechaISO(new Date()) + 'T' + pad(new Date().getHours()) + ':' + pad(new Date().getMinutes()), m: POMO.materia || '', mins: mins });
        guardarSesiones();
        beep(2);
        toast('🍅 ¡Sesión completada! (' + POMO.ciclos + ' ciclos hoy) Toma un descanso.');
        if (notificacionPermitida()) {
          try { new Notification('🍅 Pomodoro completado', { body: (POMO.materia ? POMO.materia + ': ' : '') + mins + ' min estudiados. Descansa.', icon: 'img/icon-192.png' }); } catch (e) {}
        }
        POMO.modo = 'pause';
        POMO.resta = pomoTotalSeg();
      } else {
        beep(1, 0.15);
        toast('⏰ Descanso terminado. ¿Otra ronda?');
        if (notificacionPermitida()) {
          try { new Notification('⏰ Descanso terminado', { body: 'De vuelta a estudiar 💪', icon: 'img/icon-192.png' }); } catch (e) {}
        }
        POMO.modo = 'focus';
        POMO.resta = pomoTotalSeg();
        POMO.activo = false;
      }
    }
    var el = $('#pomo-tiempo');
    if (el && state.vista === 'estudio') {
      el.textContent = pad(Math.floor(Math.max(0, POMO.resta) / 60)) + ':' + pad(Math.max(0, POMO.resta) % 60);
      var fill = $('#pomo-fill');
      if (fill) fill.style.width = Math.round((1 - Math.max(0, POMO.resta) / pomoTotalSeg()) * 100) + '%';
      var sub = $('#pomo-modo');
      if (sub) sub.textContent = POMO.modo === 'focus' ? (POMO.activo ? '🧠 Enfoque' : '🍅 Listo para enfocar') :
        ((POMO.ciclos || 0) % 4 === 0 && (POMO.ciclos || 0) > 0 ? '☕ Descanso largo' : '☕ Descanso');
      var cic = $('#pomo-ciclos');
      if (cic) cic.textContent = '🍅'.repeat(Math.min(4, POMO.ciclos || 0)) || '—';
    }
  }
  function pomoToggle() {
    POMO.activo = !POMO.activo;
    if (POMO.activo && POMO.resta <= 0) POMO.resta = pomoTotalSeg();
    var selM = $('#pomo-materia'); if (selM) POMO.materia = selM.value;
    var selT = $('#pomo-tarea'); if (selT) POMO.tarea = selT.value;
    toast(POMO.activo ? '▶ Sesión iniciada. ¡A enfocarse!' : '⏸ Pausado');
    renderEstudio();
  }
  function pomoReset() {
    POMO.activo = false; POMO.modo = 'focus'; POMO.resta = pomoTotalSeg();
    renderEstudio();
  }

  var FLASH = leerLS('agenda_flash', []);
  var FLASH_INT = [0, 1, 2, 4, 7, 15, 30];
  function guardarFlash() { guardarLS('agenda_flash', FLASH); }
  function flashDue() {
    var hoyIso = fechaISO(new Date());
    return FLASH.filter(function (c) { return (c.prox || '') <= hoyIso; });
  }
  function flashProximas(caja) {
    var dias = FLASH_INT[Math.max(0, Math.min(FLASH_INT.length - 1, caja))];
    var d = addDays(new Date(), dias);
    return fechaISO(d);
  }

  function renderEstudio() {
    if (!state.datos) { renderEn('contenido-estudio', skeleton()); return; }
    var pend = pendientesActivos().slice(0, 25);
    var mats = materiasUnicas();
    var due = flashDue();
    var totMin = 0, semanaMin = 0;
    var porMateria = {};
    var isoSem = fechaISO(iniSemana(new Date()));
    SESIONES.forEach(function (s) {
      totMin += s.mins || 0;
      if ((s.f || '') >= isoSem) {
        semanaMin += s.mins || 0;
        porMateria[s.m || 'Sin materia'] = (porMateria[s.m || 'Sin materia'] || 0) + (s.mins || 0);
      }
    });

    var html = '<div class="estudio-grid">' +
      '<div class="pomo-card"><h2 class="seccion" style="margin-top:0">🍅 Pomodoro</h2>' +
      '<div class="pomo-tiempo" id="pomo-tiempo" aria-live="polite">' + pad(Math.floor(Math.max(0, POMO.resta) / 60)) + ':' + pad(Math.max(0, POMO.resta) % 60) + '</div>' +
      '<div class="pomo-sub" id="pomo-modo">' + (POMO.modo === 'focus' ? (POMO.activo ? '🧠 Enfoque' : '🍅 Listo para enfocar') : '☕ Descanso') + '</div>' +
      '<div class="pomo-sub" id="pomo-ciclos" style="font-size:.85rem">' + ('🍅'.repeat(Math.min(4, POMO.ciclos || 0)) || '—') + '</div>' +
      '<div class="pomo-track"><div class="pomo-fill" id="pomo-fill" style="width:' + Math.round((1 - Math.max(0, POMO.resta) / pomoTotalSeg()) * 100) + '%"></div></div>' +
      '<label class="lbl" style="margin-top:.4rem">Materia' +
      '<select id="pomo-materia" class="sel" style="width:100%">' +
      '<option value="">— elegir —</option>' +
      mats.map(function (m) { return '<option' + (POMO.materia === m ? ' selected' : '') + '>' + esc(m) + '</option>'; }).join('') +
      '</select></label>' +
      '<label class="lbl">Pendiente (opcional)' +
      '<select id="pomo-tarea" class="sel" style="width:100%">' +
      '<option value="">— elegir —</option>' +
      pend.map(function (e) { return '<option' + (POMO.tarea === e.id ? ' selected' : '') + ' value="' + esc(e.id) + '">' + esc(truncNombre(e.materia + ': ' + e.titulo, 34)) + '</option>'; }).join('') +
      '</select></label>' +
      '<div style="display:flex;gap:.5rem;margin-top:.7rem;flex-wrap:wrap">' +
      '<button class="btn" data-accion="pomo-toggle">' + (POMO.activo ? '⏸ Pausar' : '▶ Empezar') + '</button>' +
      '<button class="btn ghost" data-accion="pomo-reset">↻ Reiniciar</button></div>' +
      '<p class="sub" style="margin-top:.5rem">Sesiones de ' + (cfg.pomoFocus || 25) + ' min con descansos de ' + (cfg.pomoPause || 5) + ' min.</p>' +
      '</div>' +
      '<div class="pomo-card"><h2 class="seccion" style="margin-top:0">📈 Mi estudio</h2>' +
      '<div class="stat"><div class="s-t"><b>🔥 Racha de estudio</b><span>' + rachaEstudio() + (rachaEstudio() === 1 ? ' día' : ' días') + '</span></div></div>' +
      '<div class="stat"><div class="s-t"><b>Esta semana</b><span>' + semanaMin + ' min</span></div></div>' +
      '<div class="stat"><div class="s-t"><b>Historia total</b><span>' + totMin + ' min (' + SESIONES.length + ' sesiones)</span></div></div>' +
      '<h2 class="seccion" style="font-size:.8rem">Minutos por día de la semana (histórico)</h2>' +
      (function () {
        var por = estudioPorDow();
        var mx = Math.max.apply(null, por.concat([1]));
        var html2 = '';
        for (var k = 1; k <= 6; k++) {
          html2 += '<div class="stat"><div class="s-t"><b>' + esc(DIAS[k].slice(0, 3)) + '</b><span>' + por[k] + '</span></div>' +
            '<div class="s-b"><div class="s-f" style="width:' + Math.round(por[k] / mx * 100) + '%"></div></div></div>';
        }
        return html2;
      })() +
      '</div></div>' +

      '<h2 class="seccion">🃏 Flashcards</h2>' +
      '<div class="tarjeta" style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap">' +
      '<div style="text-align:center"><div class="k-num" style="font-size:1.8rem">' + due.length + '</div><div class="k-lbl">para repasar hoy</div></div>' +
      '<div style="text-align:center"><div class="k-num" style="font-size:1.8rem;color:var(--texto2)">' + FLASH.length + '</div><div class="k-lbl">en total</div></div>' +
      '<div style="flex:1"></div>' +
      '<div style="display:flex;gap:.5rem;flex-wrap:wrap">' +
      '<button class="btn" data-accion="flash-open">▶ Repasar (' + due.length + ')</button>' +
      '<button class="btn ghost" data-accion="flash-nueva">＋ Nueva</button></div></div>' +
      '<div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.5rem">' +
      '<button class="btn ghost mini" data-accion="flash-lote">📥 Importar lote (texto)</button>' +
      '<button class="btn ghost mini" data-accion="flash-csv">📤 Exportar CSV</button>' +
      '<button class="btn ghost mini" data-accion="flash-importar">📥 Importar CSV</button>' +
      '<button class="btn ghost mini" data-accion="flash-modo">✏️ Modo: ' + (agg.flashModo === 'escribir' ? 'escribir respuesta' : 'voltear tarjeta') + '</button></div>' +
      '<p class="sub" style="margin-top:.5rem">💡 Repaso espaciado: las tarjetas que recuerdas bien vuelven más tarde; las difíciles vuelven mañana. Crea flashcards desde una materia o desde el plan de un examen.</p>';
    renderEn('contenido-estudio', html);
  }

  function abrirFlashRepaso() {
    flashCola = flashDue().slice(0);
    if (!flashCola.length) { toast('🎉 No hay flashcards para repasar hoy.'); return; }
    flashActual = 0;
    flashGirada = false;
    renderFlashCard();
    openOverlay('overlay-flash');
  }
  function renderFlashCard() {
    if (flashActual >= flashCola.length) {
      $('#flash-cuerpo').innerHTML = '<div class="vacio" style="padding:2rem 1rem">🏁 ¡Repaso terminado!<br><small>Vuelve mañana: el sistema te traerá las tarjetas que tocan.</small>' +
        '<div style="margin-top:.8rem"><button class="btn" data-accion="flash-cerrar">Listo</button></div></div>';
      return;
    }
    var c = flashCola[flashActual];
    var modoEscribir = agg.flashModo === 'escribir';
    var cuerpo = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.6rem">' +
      '<span class="sub">' + esc(c.m || 'General') + ' · tarjeta ' + (flashActual + 1) + '/' + flashCola.length + '</span>' +
      '<button class="x" data-accion="flash-cerrar" aria-label="Cerrar">✕</button></div>';
    if (modoEscribir) {
      cuerpo += '<div class="flash-cara" style="position:relative;min-height:180px">' +
        '<span class="f-hint">Pregunta</span><span class="f-txt">' + esc(c.f) + '</span>' +
        (flashGirada ?
          '<span class="f-hint" style="margin-top:.4rem">Respuesta correcta</span><span class="f-txt" style="color:var(--text-brand)">' + esc(c.r) + '</span>' :
          '<input type="text" id="flash-resp" placeholder="Escribe tu respuesta…" aria-label="Tu respuesta" style="margin-top:.6rem;width:100%;border:1.5px solid var(--borde);border-radius:var(--radio-s);padding:.6rem .7rem;background:var(--bg2);color:var(--texto);font-size:.95rem">' +
          '<button class="btn mini" data-accion="flash-resp" style="margin-top:.6rem">Comprobar</button>') +
        '</div>';
      if (flashGirada) {
        cuerpo += '<div class="flash-rate">' +
          '<button class="r-otra" data-accion="flash-rate" data-r="otra">😵 Me equivoqué</button>' +
          '<button class="r-bien" data-accion="flash-rate" data-r="bien">🙂 La acerté</button></div>';
      }
    } else {
      cuerpo += '<div class="flash-card' + (flashGirada ? ' girada' : '') + '" id="flash-card" data-accion="flash-girar" role="button" tabindex="0" aria-label="Girar tarjeta">' +
        '<div class="flash-inner">' +
        '<div class="flash-cara"><span class="f-hint">Pregunta</span><span class="f-txt">' + esc(c.f) + '</span><span class="f-hint">toca para ver la respuesta</span></div>' +
        '<div class="flash-cara reverso"><span class="f-hint">Respuesta</span><span class="f-txt">' + esc(c.r) + '</span></div>' +
        '</div></div>' +
        (flashGirada ?
          '<div class="flash-rate">' +
          '<button class="r-otra" data-accion="flash-rate" data-r="otra">😵 Otra vez</button>' +
          '<button class="r-costa" data-accion="flash-rate" data-r="costa">😅 Costó</button>' +
          '<button class="r-bien" data-accion="flash-rate" data-r="bien">🙂 Bien</button>' +
          '<button class="r-facil" data-accion="flash-rate" data-r="facil">😎 Fácil</button>' +
          '</div>' : '');
    }
    $('#flash-cuerpo').innerHTML = cuerpo;
    if (modoEscribir && !flashGirada) {
      setTimeout(function () { var i = document.getElementById('flash-resp'); if (i) i.focus(); }, 60);
    }
  }
  function flashComprobar() {
    var c = flashCola[flashActual];
    if (!c) return;
    var inp = document.getElementById('flash-resp');
    var val = inp ? inp.value : '';
    var ok = normalizar(val) !== '' && (normalizar(val) === normalizar(c.r) ||
      normalizar(val).indexOf(normalizar(c.r)) >= 0);
    flashGirada = true;
    renderFlashCard();
    var cuerpo = $('#flash-cuerpo');
    var rate = cuerpo.querySelector('.flash-rate');
    var hint = document.createElement('div');
    hint.style.cssText = 'text-align:center;font-weight:800;margin-top:.7rem;font-size:.95rem;color:' +
      (ok ? 'var(--success)' : 'var(--error)');
    hint.textContent = ok ? '✅ ¡Correcto!' : '❌ Casi… ¡a repasar!';
    if (rate) cuerpo.insertBefore(hint, rate);
  }
  function flashRate(r) {
    var c = flashCola[flashActual];
    if (!c) return;
    var i = FLASH.indexOf(c);
    if (i >= 0) {
      if (r === 'otra') { c.caja = 0; c.prox = fechaISO(new Date()); }
      else if (r === 'costa') { c.caja = Math.max(1, c.caja); c.prox = flashProximas(Math.max(1, c.caja - 1)); }
      else if (r === 'bien') { c.caja = (c.caja || 0) + 1; c.prox = flashProximas(c.caja); }
      else { c.caja = (c.caja || 0) + 2; c.prox = flashProximas(c.caja); }
      FLASH[i] = c;
      guardarFlash();
    }
    flashActual++;
    flashGirada = false;
    renderFlashCard();
    if (state.vista === 'estudio') renderEstudio();
  }
  function abrirNuevaFlash(materia) {
    $('#flash-frente').value = '';
    $('#flash-reverso').value = '';
    $('#flash-materia').value = materia || '';
    openOverlay('overlay-nuevaflash');
    setTimeout(function () { var t = $('#flash-frente'); if (t) t.focus(); }, 60);
  }
  function guardarFlashcard() {
    var f = ($('#flash-frente').value || '').trim();
    var r = ($('#flash-reverso').value || '').trim();
    if (!f || !r) { toast('Escribe la pregunta y la respuesta.', 'err'); return; }
    FLASH.push({
      id: 'fc' + Date.now(), f: f, r: r,
      m: ($('#flash-materia').value || '').trim(),
      caja: 0, prox: fechaISO(new Date())
    });
    guardarFlash();
    closeOverlay('overlay-nuevaflash');
    toast('🃏 Flashcard creada');
    if (state.vista === 'estudio') renderEstudio();
  }

  /* ================= "MÁS" (menú agrupado) ================= */
  function renderMas() {
    if (!state.datos) { renderEn('contenido-mas', skeleton()); return; }
    var pend = pendientesActivos();
    var evals7 = pend.filter(function (e) { var n = diasRestantes(e); return n != null && n >= 0 && n <= 7 && esExamen(e.titulo); }).length;
    var noLeidos = (state.datos.mensajes || []).filter(function (m) { return !esLeido(claveMsg(m.id)); }).length;
    var docs = (MATER || []).reduce(function (a, mt) { return a + (mt.items || []).length; }, 0);
    var due = flashDue().length;
    var pagos = ((state.datos.panel || {}).pagos || []);
    var fal = state.datos.faltas || {};
    var fres = fal.resumen || {};

    function menuRow(ico, tit, sub, accion, contador) {
      return '<button class="menu-row" data-accion="' + accion + '">' +
        '<span class="mr-ico" aria-hidden="true">' + ico + '</span>' +
        '<span class="mr-main"><span class="mr-tit">' + tit + '</span>' +
        (sub ? '<span class="mr-sub">' + sub + '</span>' : '') + '</span>' +
        (contador ? '<span class="m-chip alerta" aria-live="polite">' + contador + '</span>' : '') +
        '<span class="mr-chevron" aria-hidden="true">›</span></button>';
    }
    function grupo(titulo, filas) {
      return '<div class="menu-sec">' + titulo + '</div><div class="menu-grupo">' + filas + '</div>';
    }

    var html =
      grupo('Académico',
        menuRow('📌', 'Evaluaciones', evals7 ? evals7 + ' en los próximos 7 días' : 'próximas y mapa de carga', 'ir:evaluaciones', evals7) +
        menuRow('📂', 'Documentos', docs ? docs + ' materiales del aula virtual' : 'materiales por materia', 'ir:documentos', '') +
        menuRow('🧠', 'Estudio', due ? due + ' flashcards para hoy · pomodoro' : 'pomodoro, sesiones y flashcards', 'ir:estudio', due)) +
      grupo('Colegio',
        menuRow('📣', 'Comunicados', 'mensajes y circulares', 'ir:comunicados', noLeidos) +
        (fal.disponible ?
          menuRow('🧾', 'Mi asistencia',
            (fres.faltas_justificadas || 0) + ' faltas justif. · ' + (fres.faltas_injustificadas || 0) + ' injustif. · ' + (fres.atrasos || 0) + ' atrasos',
            'asistencia-ver', '') : '') +
        (pagos.length ?
          menuRow('💳', 'Pagos pendientes', pagos.map(function (p) { return p.deuda; }).join(' · '), 'pagos-ver', pagos.length) : '')) +
      grupo('Mis datos',
        menuRow('📓', 'Mi libreta', 'apuntes rápidos personales', 'libreta-abrir', '') +
        menuRow('🏆', 'Mis logros', 'insignias por tus avances', 'logros-ver', (function () { var l = calcularLogros().filter(function (x) { return x.ok; }).length; return l || ''; })()) +
        menuRow('📊', 'Exportar notas', 'CSV con todas tus actividades', 'csv-notas', '') +
        menuRow('🗓️', 'Exportar agenda', 'archivo .ics para tu calendario', 'ics-agenda', '') +
        menuRow('🗂️', 'Exportar expediente', 'todo tu historial en un JSON', 'exp-json', '') +
        menuRow('⌨️', 'Ayuda y atajos', 'todo lo que EducaFix puede hacer', 'ayuda-ver', '') +
        menuRow('⚙️', 'Ajustes', 'personalización, metas y estudio', 'ajustes', '')) +
      '<div class="tip">💡 <strong>Calendario mensual y horario:</strong> ahora viven dentro de <strong>Semana</strong> (pestañas «Mes» y «Horario»).<br><br><strong>Calendario externo:</strong> en Google Calendar usa "Suscribirse a un calendario" con la URL de tu PC: <code>' + esc(location.origin) + '/api/calendario.ics</code></div>';
    renderEn('contenido-mas', html);
  }

  /* ================= DIGEST DIARIO ================= */
  function tickDigest() {
    if (!state.activo || !cfg.digest || !state.datos) return;
    if (!notificacionPermitida()) return;
    var hoyIso = fechaISO(new Date());
    var DIG = leerLS('agenda_digest', {});
    var h = new Date().getHours();
    var clases = claseActual().bloquesDia.length;
    var pend = pendientesActivos();
    var hoyP = pend.filter(function (e) { return diasRestantes(e) === 0; }).length;
    var manana = pend.filter(function (e) { return diasRestantes(e) === 1; }).length;
    if (h >= 7 && !DIG[hoyIso + 'm']) {
      DIG[hoyIso + 'm'] = 1;
      guardarLS('agenda_digest', DIG);
      try {
        new Notification('☀️ Tu día', {
          body: clases + ' clase(s) · ' + hoyP + ' pendiente(s) para hoy' + (manana ? ' · ' + manana + ' para mañana' : ''),
          icon: 'img/icon-192.png', tag: 'digest-m'
        });
      } catch (e) {}
    }
    if (h >= 19 && !DIG[hoyIso + 'n']) {
      DIG[hoyIso + 'n'] = 1;
      guardarLS('agenda_digest', DIG);
      var comp = completadasSemana();
      try {
        new Notification('🌙 Resumen', {
          body: 'Hoy completaste ' + (HECHAS_TS && Object.keys(HECHAS_TS).filter(function (k) { return HECHAS_TS[k] === hoyIso; }).length || 0) +
            ' actividad(es) · ' + comp + ' en la semana. Mañana: ' + manana + ' pendiente(s).',
          icon: 'img/icon-192.png', tag: 'digest-n'
        });
      } catch (e) {}
    }
  }

  /* ================= EXPEDIENTE ================= */
  function exportarExpediente() {
    if (!state.datos) { toast('Espera a que carguen los datos.', 'err'); return; }
    var exp = {
      generado: new Date().toISOString(),
      usuario: 'estudiante',
      agenda: state.datos.agenda,
      resumen_notas: state.datos.resumen,
      horario: state.datos.horario,
      panel: state.datos.panel,
      mensajes: state.datos.mensajes,
      circulares: state.datos.circulares,
      pendientes_completados: HECHAS,
      completados_cuando: HECHAS_TS,
      pendientes_personales: PT,
      notas_personales: NP,
      recordatorios: REC,
      sesiones_estudio: SESIONES,
      flashcards: FLASH,
      objetivos_por_materia: cfg.objMateria || {},
      configuracion: { meta: cfg.meta, metaSemanal: cfg.metaSemanal, riesgo: cfg.riesgo }
    };
    descargar('expediente_mi_agenda_' + fechaISO(new Date()) + '.json',
      JSON.stringify(exp, null, 2), 'application/json;charset=utf-8');
    toast('🗂️ Expediente exportado');
  }

  /* ======================================================
     8.0 — FUNCIONES NUEVAS
     Importantes ⭐ · Sub-tareas · Libreta · Iconos materia ·
     Recordatorio exacto · Pomodoro+ (sonido, ciclos, stats) ·
     Flashcards+ (escribir, lote, CSV) · Logros · Hueco libre ·
     Ayuda · Onboarding · Sync-edad · FAB · Filtros
     ====================================================== */
  var SUBT = leerLS('agenda_subt', {});
  function guardarSubt() { guardarLS('agenda_subt', SUBT); }
  var LIBRETA = leerLS('agenda_libreta', '');
  var ICONO_MAT = leerLS('agenda_iconos_mat', {});
  function guardarIconos() { guardarLS('agenda_iconos_mat', ICONO_MAT); }
  function iconoMateria(nombre) {
    if (!nombre) return '';
    for (var k in ICONO_MAT) { if (clavesIguales(k, nombre)) return ICONO_MAT[k]; }
    return '';
  }
  function chipMateria(nombre) {
    var ic = iconoMateria(nombre);
    return ic ? '<span style="margin-right:.2rem">' + esc(ic) + '</span>' :
      '<span class="dot" style="background:' + colorMateria(nombre) + ';width:.55rem;height:.55rem;border-radius:50%;display:inline-block;margin-right:.2rem"></span>';
  }

  /* ---- ⭐ importantes ---- */
  function esImportante(id) { return !!FAV['e:' + id]; }
  function toggleStar(id) {
    FAV['e:' + id] = !FAV['e:' + id];
    if (!FAV['e:' + id]) delete FAV['e:' + id];
    guardarLS(LS_FAV, FAV);
    renderVistaActual();
  }

  /* ---- ☑ sub-tareas por actividad ---- */
  var subtActual = null;
  function abrirSubtareas(id) {
    subtActual = id;
    var ev = eventoPorId(id);
    $('#subt-titulo').innerHTML = '☑ ' + esc(ev ? truncNombre(ev.titulo, 30) : id) +
      ' <span style="margin-left:auto"></span><button class="x" data-accion="subt-cerrar" aria-label="Cerrar">✕</button>';
    renderSubt();
    openOverlay('overlay-subt');
    setTimeout(function () { var i = $('#subt-nuevo'); if (i) i.focus(); }, 60);
  }
  function renderSubt() {
    if (!subtActual) return;
    var lista = SUBT[subtActual] || [];
    var done = lista.filter(function (s) { return s.done; }).length;
    var html = lista.length ? lista.map(function (s, i) {
      return '<label class="subt-item"><input type="checkbox" data-subt-idx="' + i + '"' + (s.done ? ' checked' : '') +
        ' aria-label="Sub-tarea ' + (i + 1) + '"><span style="flex:1">' + esc(s.t) + '</span>' +
        '<button class="del" data-accion="subt-del" data-idx="' + i + '" aria-label="Eliminar">✕</button></label>';
    }).join('') : '<div class="vacio" style="padding:.8rem;font-size:.85rem">Divide la actividad en pasos pequeños.</div>';
    if (lista.length) html = '<div class="sub" style="margin-bottom:.3rem">' + done + '/' + lista.length + ' completadas</div>' + html;
    $('#subt-lista').innerHTML = html;
  }
  function subtAdd() {
    if (!subtActual) return;
    var el = $('#subt-nuevo');
    var t = el ? el.value.trim() : '';
    if (!t) return;
    SUBT[subtActual] = SUBT[subtActual] || [];
    SUBT[subtActual].push({ t: t, done: false });
    guardarSubt();
    el.value = '';
    renderSubt();
    renderVistaActual();
  }
  function subtToggle(i) {
    if (!subtActual || !SUBT[subtActual]) return;
    SUBT[subtActual][i].done = !SUBT[subtActual][i].done;
    guardarSubt(); renderSubt(); renderVistaActual();
  }
  function subtDel(i) {
    if (!subtActual || !SUBT[subtActual]) return;
    SUBT[subtActual].splice(i, 1);
    if (!SUBT[subtActual].length) delete SUBT[subtActual];
    guardarSubt(); renderSubt(); renderVistaActual();
  }

  /* ---- 📓 libreta ---- */
  function abrirLibreta() {
    $('#libreta-texto').value = LIBRETA;
    openOverlay('overlay-libreta');
  }
  function guardarLibreta() {
    LIBRETA = $('#libreta-texto').value;
    guardarLS('agenda_libreta', LIBRETA);
    toast('📓 Libreta guardada');
  }

  /* ---- ⏲ recordatorio con fecha exacta ---- */
  function setRecCustom() {
    if (!recActual) return;
    var el = $('#rec-datetime');
    var v = el ? el.value : '';
    if (!v) { toast('Elige fecha y hora.', 'err'); return; }
    if (!notificacionPermitida()) {
      pedirPermiso();
      if (Notification.permission !== 'granted') { toast('Notificaciones bloqueadas.', 'err'); return; }
    }
    REC[recActual] = v;
    guardarLS(LS_REC, REC);
    delete NOTIFICADOS[recActual];
    guardarLS(LS_NOTIF, NOTIFICADOS);
    toast('⏰ Recordatorio fijado para ' + v.replace('T', ' a las '));
    closeOverlay('overlay-rec');
    renderVistaActual();
  }
  function venceEn(ev) {
    if (REC[ev.id] && typeof REC[ev.id] === 'string' && REC[ev.id].indexOf('T') >= 0) {
      return parseLocal(REC[ev.id]).getTime();
    }
    var d = parseLocal(ev.fecha_inicio);
    if (isNaN(d.getTime())) return null;
    var mins = (typeof REC[ev.id] === 'string' && /\d{4}-/.test(REC[ev.id])) ? 0 : Number(REC[ev.id]) || 0;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - mins * 60000;
  }

  /* ---- 🔊 beep (WebAudio, sin archivos) ---- */
  function beep(n, sep) {
    try {
      var ctx = beep.ctx || (beep.ctx = new (window.AudioContext || window.webkitAudioContext)());
      for (var i = 0; i < (n || 2); i++) {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.frequency.value = 880;
        o.type = 'sine';
        var t0 = ctx.currentTime + i * (sep || 0.28);
        g.gain.setValueAtTime(0.001, t0);
        g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.25);
        o.start(t0); o.stop(t0 + 0.3);
      }
    } catch (e) {}
  }

  /* ---- ☕ próximo hueco libre de hoy ---- */
  function proximoHueco() {
    var c = claseActual();
    if (!c.bloquesDia || !c.bloquesDia.length) return null;
    var ahora = new Date();
    var mins = ahora.getHours() * 60 + ahora.getMinutes();
    var orden = c.bloquesDia.slice(0).sort(function (a, b) { return (aMin(a.hora_inicio) || 0) - (aMin(b.hora_inicio) || 0); });
    for (var i = 0; i < orden.length; i++) {
      var ini = aMin(orden[i].hora_inicio);
      var prevFin = i === 0 ? 0 : (aMin(orden[i - 1].hora_fin) || (aMin(orden[i - 1].hora_inicio) || 0) + 45);
      var gap = ini - Math.max(mins, prevFin);
      if (gap >= 30 && ini > mins) {
        return { desde: orden[i].hora_inicio, mins: gap };
      }
    }
    var ultimo = orden[orden.length - 1];
    var finUltimo = aMin(ultimo.hora_fin) || (aMin(ultimo.hora_inicio) || 0) + 45;
    if (finUltimo < mins) return { desde: null, mins: null, libreYa: true };
    return null;
  }

  /* ---- 📤 compartir resumen semanal ---- */
  function compartirSemana(ini) {
    if (!state.datos) return;
    var fin = addDays(ini, 6);
    var evs = [];
    for (var i = 0; i < 7; i++) evs = evs.concat(eventosDia(addDays(ini, i)));
    var texto = '📅 Mi semana ' + numSemana(ini) + ' (' + fmtCorta(ini) + ' – ' + fmtCorta(fin) + ') — EducaFix ⚡\n\n' +
      (evs.length ? evs.map(function (e) {
        return '• ' + DIAS_C[parseLocal(e.fecha_inicio).getDay()] + ' ' + e.materia + ': ' + truncNombre(e.titulo, 40);
      }).join('\n') : 'Semana libre 🎉') +
      '\n\n' + evs.filter(function (e) { return esExamen(e.titulo); }).length + ' evaluación(es)';
    if (navigator.share) navigator.share({ title: 'Mi semana', text: texto }).catch(function () {});
    else if (navigator.clipboard) navigator.clipboard.writeText(texto).then(function () { toast('📋 Resumen semanal copiado'); });
  }

  /* ---- 📋 copiar pendientes del día ---- */
  function copiarDia(iso) {
    var evs = eventosDia(parseLocal(iso)).filter(function (e) { return HECHAS[e.id] !== true; });
    if (!evs.length) { toast('Sin pendientes ese día.'); return; }
    var texto = '📌 Pendientes ' + fmtDia(parseLocal(iso)) + ':\n' +
      evs.map(function (e) { return '☐ ' + e.materia + ': ' + e.titulo; }).join('\n');
    if (navigator.clipboard) navigator.clipboard.writeText(texto).then(function () { toast('📋 ' + evs.length + ' pendientes copiados'); });
  }

  /* ---- ✏️ flashcards: modo escribir + lote + CSV ---- */
  function abrirImportarFlash() {
    abrirInfo('📥 Importar flashcards',
      '<p class="sub" style="margin-bottom:.5rem">Pega varias tarjetas, una por línea: <code>pregunta | respuesta</code> (separadas por la barra vertical).</p>' +
      '<textarea id="flash-lote" rows="7" placeholder="¿Fórmula de velocidad? | v = d/t&#10;¿Capital de Ecuador? | Quito" aria-label="Lote de flashcards"></textarea>' +
      '<label class="lbl" style="margin-top:.6rem">Materia<input type="text" id="flash-lote-m" list="dl-mats" placeholder="Opcional"></label>' +
      '<button class="btn mini" style="margin-top:.5rem" data-accion="flash-lote-guardar">📥 Importar</button>');
    setTimeout(function () { var el = document.getElementById('flash-lote'); if (el) el.focus(); }, 60);
  }
  function guardarLoteFlash() {
    var el = document.getElementById('flash-lote');
    var mat = (document.getElementById('flash-lote-m') || {}).value || '';
    var lineas = (el ? el.value : '').split('\n');
    var n = 0;
    lineas.forEach(function (l) {
      var sep = l.indexOf('|');
      if (sep < 1) return;
      var f = l.slice(0, sep).trim(), r = l.slice(sep + 1).trim();
      if (!f || !r) return;
      FLASH.push({ id: 'fc' + Date.now() + Math.random().toString(36).slice(2, 6), f: f, r: r, m: mat.trim(), caja: 0, prox: fechaISO(new Date()) });
      n++;
    });
    guardarFlash();
    closeOverlay('overlay-info');
    toast('🃏 ' + n + ' flashcards importadas');
    if (state.vista === 'estudio') renderEstudio();
  }
  function exportarFlashCSV() {
    if (!FLASH.length) { toast('No tienes flashcards aún.', 'err'); return; }
    var filas = [['pregunta', 'respuesta', 'materia', 'caja', 'proxima']];
    FLASH.forEach(function (c) { filas.push([c.f, c.r, c.m || '', c.caja || 0, c.prox || '']); });
    var csv = filas.map(function (f) { return f.map(function (x) { return '"' + String(x).replace(/"/g, '""') + '"'; }).join(';'); }).join('\r\n');
    descargar('flashcards_' + fechaISO(new Date()) + '.csv', '\ufeff' + csv, 'text/csv;charset=utf-8');
    toast('🃏 Flashcards exportadas');
  }
  function importarFlashCSV(texto) {
    var lineas = texto.split(/\r?\n/).slice(1);
    var n = 0;
    lineas.forEach(function (l) {
      if (!l.trim()) return;
      var c = l.split(';').map(function (x) { return x.replace(/^"|"$/g, '').replace(/""/g, '"'); });
      if (c.length < 2 || !c[0] || !c[1]) return;
      FLASH.push({ id: 'fc' + Date.now() + Math.random().toString(36).slice(2, 6), f: c[0], r: c[1], m: c[2] || '', caja: 0, prox: fechaISO(new Date()) });
      n++;
    });
    guardarFlash();
    toast('🃏 ' + n + ' importadas desde CSV');
    if (state.vista === 'estudio') renderEstudio();
  }

  /* ---- 📈 estadísticas de estudio + racha ---- */
  function rachaEstudio() {
    var dias = {};
    SESIONES.forEach(function (s) { if (s.f) dias[s.f.slice(0, 10)] = 1; });
    var racha = 0;
    for (var i = 0; i < 90; i++) {
      var iso = fechaISO(addDays(new Date(), -i));
      if (dias[iso]) racha++;
      else if (i > 0) break;
    }
    return racha;
  }
  function estudioPorDow() {
    var por = [0, 0, 0, 0, 0, 0, 0];
    SESIONES.forEach(function (s) {
      var d = parseLocal(s.f || '');
      if (!isNaN(d.getTime())) por[d.getDay()] += (s.mins || 0);
    });
    return por;
  }

  /* ---- 🏆 logros ---- */
  function calcularLogros() {
    var res = (state.datos || {}).resumen || {};
    var pro = esCal((res.general || {}).promedio);
    var semMin = 0;
    var isoSem = fechaISO(iniSemana(new Date()));
    SESIONES.forEach(function (s) { if ((s.f || '') >= isoSem) semMin += s.mins || 0; });
    var sinAtrasos = pendientesActivos().filter(function (e) { return diasRestantes(e) < 0; }).length === 0;
    return [
      { ico: '🔥', n: 'Racha de puntualidad', d: '7 días sin pendientes atrasados', ok: (estadoRachaN() >= 7) },
      { ico: '🍅', n: 'Primer pomodoro', d: 'Completa una sesión de estudio', ok: SESIONES.length >= 1 },
      { ico: '⏱️', n: 'Maratón semanal', d: '60+ minutos de estudio esta semana', ok: semMin >= 60 },
      { ico: '🃏', n: 'Coleccionista', d: '20 flashcards creadas', ok: FLASH.length >= 20 },
      { ico: '🎯', n: 'Meta alcanzada', d: 'Promedio igual o superior a tu meta', ok: pro != null && pro >= cfg.meta },
      { ico: '🧹', n: 'Semana perfecta', d: 'Cero actividades atrasadas', ok: sinAtrasos },
      { ico: '📚', n: 'Explorador', d: 'Revisa el detalle de 5 materias', ok: (leerLS('agenda_materias_vistas', 0) >= 5) },
      { ico: '✍️', n: 'Escritor', d: 'Escribe tu primera nota personal', ok: Object.keys(NP).length >= 1 }
    ];
  }
  function estadoRachaN() {
    var racha = 0;
    for (var n = 0; n < 60; n++) {
      var dd = addDays(new Date(), -n);
      var pend = eventosDia(dd).filter(function (e) {
        if (HECHAS[e.id]) return false;
        if (esCal(e.calificacion) != null) return false;
        return e.fecha_inicio && diffDias(dd, new Date()) < 0;
      }).length === 0;
      if (!pend) { return n > 0 ? racha : 0; }
      racha++;
    }
    return racha;
  }
  function abrirLogros() {
    var logros = calcularLogros();
    var n = logros.filter(function (l) { return l.ok; }).length;
    abrirInfo('🏆 Mis logros (' + n + '/' + logros.length + ')',
      logros.map(function (l) {
        return '<div class="logro' + (l.ok ? ' conseguido' : '') + '"><span class="lg-ico" aria-hidden="true">' + l.ico + '</span>' +
          '<span class="lg-txt"><b>' + l.n + '</b><span>' + l.d + '</span></span>' +
          (l.ok ? '<span class="badge nota verde">✓</span>' : '<span class="sub">🔒</span>') + '</div>';
      }).join(''));
  }

  /* ---- ❓ ayuda de atajos ---- */
  function abrirAyuda() {
    abrirInfo('⌨️ Atajos y trucos', [
      ['1 – 6', 'Vistas principales (Inicio…Más)'],
      ['/', 'Búsqueda global'],
      ['Ctrl + K', 'Paleta de comandos'],
      ['R', 'Recargar datos'],
      ['D', 'Modo oscuro / claro'],
      ['F', 'Modo enfoque'],
      ['C', 'Calendario del mes'],
      ['Esc', 'Cerrar paneles'],
      ['🔗', 'Compartir actividad (WhatsApp, correo…)'],
      ['⭐', 'Marcar importante: aparece en el Inicio'],
      ['☑', 'Sub-tareas: divide la actividad en pasos'],
      ['📅', 'Agregar la actividad a tu calendario']
    ].map(function (f) { return '<div class="ayuda-fila"><b class="kbd">' + f[0] + '</b><span>' + f[1] + '</span></div>'; }).join('') +
      '<p class="sub" style="margin-top:.6rem">💡 Instala la app desde el menú de tu navegador para usarla como aplicación en el celular con acceso sin conexión.</p>');
  }

  /* ---- 💡 onboarding (solo la primera vez) ---- */
  function onboarding() {
    if (leerLS('agenda_onboarding', 0)) return;
    guardarLS('agenda_onboarding', 1);
    setTimeout(function () { toast('👋 ¡Bienvenido a EducaFix! Abre 🔎 o pulsa / para buscar cualquier cosa.'); }, 1200);
    setTimeout(function () { toast('⭐ Marca actividades como importantes y fija recordatorios con ⏰'); }, 6200);
    setTimeout(function () { toast('🎨 Personaliza colores y tema desde el botón 🎨 del header'); }, 11200);
  }

  /* ---- 📄 libretas oficiales (PDF) por periodo + CSV oficial ---- */
  var LIBRETAS = null;
  function libretasLista() {
    if (LIBRETAS) return LIBRETAS;
    cargarLibretas();
    return [];
  }
  function cargarLibretas() {
    return apiFetch('api/notas/libretas')
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
      .then(function (j) {
        LIBRETAS = j.libretas || [];
        if (state.vista === 'rendimiento') renderRendimiento();
      })
      .catch(function (e) { console.warn('libretas no disponibles', e); });
  }
  function descargarLibretaPDF(peri) {
    window.open(API + 'api/notas/libreta/' + peri, '_blank');
    toast('📄 Abriendo libreta oficial…');
  }
  function exportarNotasOficialesCSV() {
    if (!NOTAS_DET || !NOTAS_DET.disponible) {
      cargarNotasDetalle().then(function () { exportarNotasOficialesCSV(); });
      return;
    }
    var filas = [['periodo', 'materia', ' TAR', 'LEC', 'ACT', 'TRG', 'aporte_cierre_70', 'examen_parcial', 'aporte_parcial_30', 'total']];
    (NOTAS_DET.periodos || []).forEach(function (p) {
      (p.materias || []).forEach(function (m) {
        var comps = (m.componentes || []).concat([null, null, null, null]).slice(0, 4);
        filas.push([p.periodo, m.materia].concat(comps).concat([
          m.aporte_cierre_70, m.examen_parcial, m.aporte_parcial_30, m.total]));
      });
    });
    var csv = filas.map(function (f) { return f.map(function (x) { return '"' + String(x == null ? '' : x) + '"'; }).join(';'); }).join('\r\n');
    descargar('notas_oficiales_' + fechaISO(new Date()) + '.csv', '\ufeff' + csv, 'text/csv;charset=utf-8');
    toast('📊 Notas oficiales exportadas');
  }

  /* ---- 🕐 edad de la última sincronización ---- */
  function edadSync() {
    if (!state.ultCarga) return '';
    var min = Math.round((Date.now() - state.ultCarga) / 60000);
    if (min < 1) return 'ahora';
    if (min < 60) return 'hace ' + min + ' min';
    var h = Math.floor(min / 60);
    return 'hace ' + h + ' h' + (min % 60 ? ' ' + (min % 60) + ' m' : '');
  }

  window.App = {
    iniciar: iniciar,
    cerrarSesion: cerrarSesion,
    setOnline: setOnline,
    __detener: __detener
  };

  cargarCfg();
  aplicarVisuales();
  ligarAcciones();
  ligarInputs();
  ligarTeclado();
  ligarPull();

  apiFetch('api/me', { headers: { 'Accept': 'application/json' } })
    .then(function (r) {
      if (!r.ok) throw new Error('401');
      return r.json();
    })
    .then(function (me) {
      iniciar(me && me.perfil);
    })
    .catch(function () { window.Login.mostrar(); });
})();