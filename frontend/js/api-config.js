/* ================================================================
   EducaFix — configuración de la API (CARGA ANTES QUE LOS DEMÁS JS)
   ----------------------------------------------------------------
   • Vacío ('')  → la API se sirve DESDE EL MISMO ORIGEN:
                   - local/todo-en-uno: el propio backend sirve el frontend
                   - Netlify: el proxy de netlify.toml reenvía /api/* al
                     backend de Render (recomendado: sin CORS ni bloqueos)
   • Con URL     → modo híbrido directo (solo si NO usas el proxy).
   ================================================================ */
window.API_BASE = '';
