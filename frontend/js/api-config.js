/* ================================================================
   EducaFix — configuración de la API (CARGA ANTES QUE LOS DEMÁS JS)
   ----------------------------------------------------------------
   • Vacío ('')  → modo todo-en-uno: el propio backend (uvicorn/FastAPI)
                   sirve este frontend (local, VPS, Render todo-en-uno).
   • Con URL     → modo híbrido: el frontend está en Netlify (o cualquier
                   hosting estático) y la API vive en otro servidor.
   ================================================================ */
window.API_BASE = 'https://educafix.onrender.com';
