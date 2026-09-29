/* ============ Mi Agenda — Login (valida contra Educalinks via proxy) ============ */
(function () {
  'use strict';

  var LS_RECORDADO = 'agenda_usuario';

  var el = {
    pantalla: document.getElementById('pantalla-login'),
    form: document.getElementById('form-login'),
    usuario: document.getElementById('login-usuario'),
    clave: document.getElementById('login-clave'),
    recordar: document.getElementById('login-recordar'),
    error: document.getElementById('login-error'),
    btn: document.getElementById('btn-login'),
    app: document.getElementById('app'),
    franja: document.getElementById('franja'),
    banner: document.getElementById('banner-offline')
  };

  function mostrarError(msj) {
    el.error.textContent = msj;
    el.error.classList.remove('oculto');
  }

  function ocultarError() {
    el.error.classList.add('oculto');
  }

  /* Muestra la pantalla de login (usada por app.js tras un 401). */
  function mostrar(msj) {
    if (window.App && window.App.__detener) window.App.__detener();
    el.app.classList.add('oculto');
    document.querySelectorAll('.vista').forEach(function (v) { v.classList.remove('activa'); });
    document.querySelectorAll('.tab, .bnav-btn').forEach(function (b) {
      b.classList.remove('activa');
    });
    el.pantalla.classList.remove('oculto');
    if (msj) mostrarError(msj);
    try { el.usuario.focus(); } catch (e) {}
  }

  function setCargando(activo) {
    el.btn.disabled = activo;
    el.btn.textContent = activo ? 'Validando con Educalinks…' : 'Iniciar sesión';
  }

  function prefill() {
    var guardado = localStorage.getItem(LS_RECORDADO);
    if (guardado) el.usuario.value = guardado;
    fetch('api/config', { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (c) {
        if (c && c.prefill && !el.usuario.value) el.usuario.value = c.prefill;
      })
      .catch(function () {});
  }

  el.form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    ocultarError();
    var usuario = el.usuario.value.trim();
    var clave = el.clave.value;
    if (!usuario || !clave) { mostrarError('Ingresa usuario y contraseña.'); return; }

    setCargando(true);
    fetch('api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario: usuario, clave: clave, recordar: el.recordar.checked })
    })
      .then(function (r) {
        if (r.ok) return r.json();
        return r.json().then(function (j) {
          var err = new Error(j.detail || 'Error inesperado');
          err.status = r.status;
          throw err;
        });
      })
      .then(function (datos) {
        if (el.recordar.checked) localStorage.setItem(LS_RECORDADO, usuario);
        else localStorage.removeItem(LS_RECORDADO);
        el.pantalla.classList.add('oculto');
        el.clave.value = '';
        window.App.iniciar();
      })
      .catch(function (err) {
        var status = err.status || 0;
        if (status === 401) mostrarError('Usuario o contraseña incorrectos. Verifica e inténtalo de nuevo.');
        else if (status === 400) mostrarError(err.message);
        else if (status === 502) mostrarError(err.message || 'Educalinks no responde ahora. Intenta en unos minutos.');
        else if (status === 0) {
          mostrarError('No se pudo hablar con nuestro servidor local. El portal de Educalinks está por momentos fuera de servicio/sin Internet. Si tenías datos de antes, prueba «Entrar como invitado».');
          setCargando(false);
          return; // keep button disabled state; no further error
        }
        else mostrarError(err.message || 'Error inesperado. Inténtalo de nuevo.');
      })
      .finally(function () { setCargando(false); });
  });

  window.Login = { mostrar: mostrar };

  document.addEventListener('DOMContentLoaded', prefill);
})();