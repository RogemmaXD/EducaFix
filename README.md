# EducaFix

Tu centro académico personal sobre Educalinks: prioridades, pendientes,
notas con desglose oficial, asistencia, evaluaciones, materiales del aula
virtual, flashcards con repaso espaciado y pomodoro — en una PWA que también
funciona sin conexión.

Cada estudiante inicia sesión con **sus propias credenciales de Educalinks**;
el servidor las valida contra el portal y nunca las comparte. Las sesiones,
cachés e historial de novedades están aislados por usuario.

## Desarrollo local

```
cd backend
python -m venv venv
venv\Scripts\pip install -r requirements.txt
venv\Scripts\uvicorn main:app --host 0.0.0.0 --port 8000
```

O simplemente ejecuta `iniciar.bat` (Windows). Abre `http://localhost:8000`
o `http://<IP-de-tu-PC>:8000` desde cualquier dispositivo de tu red.

## Variables de entorno (backend/.env)

| Variable | Default | Descripción |
|---|---|---|
| `EDUCA_BASE_URL` | `https://americano.educalinks.com.ec` | Instancia de Educalinks del colegio |
| `ESCUELA_NOMBRE` | `Colegio Americano de Guayaquil` | Nombre que se muestra en login y PWA |
| `EDUCA_USER` / `EDUCA_PASS` / `EDUCA_TIPO` | — | Credenciales para uso personal (pre-fill) |
| `PUBLICA` | vacío | `1` en despliegue público: desactiva el pre-fill de usuario |
| `CORS_ORIGINS` | `*` | Orígenes permitidos, separados por coma (ej. `https://educafix.midominio.com`) |
| `LOGIN_RATE_LIMIT` | `8` | Intentos de login por IP cada 10 minutos |
| `CACHE_TTL_MINUTES`, `PANEL_TTL_MINUTES`, `MATERIALES_TTL_MINUTES`, `PLANIFICACION_TTL_MINUTES`, `FALTAS_TTL_MINUTES`, `LIBRETA_TTL_MINUTES` | varios | TTL de caché de cada fuente |

## Despliegue público (VPS + nginx + HTTPS)

1. **Sube el proyecto** a tu servidor (por ejemplo Ubuntu 22+) e instala Python 3.11+.

2. **Configura el entorno** en `backend/.env`:
   ```
   ESCUELA_NOMBRE=Colegio Americano de Guayaquil
   PUBLICA=1
   CORS_ORIGINS=https://tu-dominio.com
   ```

3. **Corre la API** con un servicio de sistema (systemd):
   ```ini
   # /etc/systemd/system/educafix.service
   [Unit]
   Description=EducaFix
   After=network.target
   [Service]
   WorkingDirectory=/opt/educafix/backend
   ExecStart=/opt/educafix/backend/venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000 --workers 2
   Restart=always
   [Install]
   WantedBy=multi-user.target
   ```

4. **nginx como proxy inverso** con TLS (certbot):
   ```nginx
   server {
     server_name tu-dominio.com;
     client_max_body_size 25M;
     location / {
       proxy_pass http://127.0.0.1:8000;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
     }
   }
   ```

5. `sudo certbot --nginx` y listo: `https://tu-dominio.com` es tu EducaFix público.

### Alternativas sin servidor propio

- **Render / Railway / Fly.io**: despliega `backend/` con start command
  `uvicorn main:app --host 0.0.0.0 --port $PORT` y define las variables de
  entorno del panel. Usa discos persistentes si quieres conservar los
  historiales entre reinicios (`sesiones.db`, `historial_*.db`, `secret.key`).

## Seguridad integrada

- Credenciales "recuérdame" cifradas con Fernet (clave local `secret.key`).
- Cookies `httponly` + `secure` (detrás de HTTPS) + `samesite=lax`.
- Rate limiting por IP en el login y headers de seguridad (nosniff, DENY frames, referrer-policy).
- Proxy anti-SSRF: solo se descargan URLs de dominios `educalinks.com.ec`.
- El scraper solo hace peticiones de **lectura** contra el portal del estudiante.

## Despliegue híbrido: Netlify (frontend) + Render (backend)

Netlify **solo sirve archivos estáticos**: no puede ejecutar el backend
Python de EducaFix. Por eso el proyecto trae todo listo para el modo
híbrido en dos piezas:

### 1) Backend en Render (gratis)

1. Crea el servicio Web en [render.com](https://render.com) desde tu repo
   de GitHub (**New → Web Service**).
2. Configura:
   - **Root Directory**: `backend`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
3. Variables de entorno (Environment):
   ```
   ESCUELA_NOMBRE=Colegio Americano de Guayaquil
   PUBLICA=1
   CORS_ORIGINS=https://TU-USUARIO.netlify.app
   ```
   (usa tu dominio final de Netlify; si aún no lo sabes, vuelve aquí
   después del paso 2 y edita la variable).
4. Guarda y espera la URL: `https://educafix-api.onrender.com` (ejemplo).

> Render free "duerme" tras 15 min sin visitas: la primera petición tras
> el descanso tarda ~50 s en despertar. Es normal.

### 2) Frontend en Netlify

1. [app.netlify.com](https://app.netlify.com) → **Add new site → Import
   an existing project** → tu repo de GitHub.
2. El `netlify.toml` del repo ya define `publish = "frontend"` y sin build
   command — no toques nada más.
3. Una vez desplegado, **edita `frontend/js/api-config.js`** en el repo:

   ```js
   window.API_BASE = 'https://educafix-api.onrender.com';
   ```

4. Haz push: Netlify redepliega y la app ya se conecta a tu API.

### ¿Por qué "Page not found" antes?

Sin `netlify.toml`, Netlify publicaba la **raíz del repo** (donde no hay
`index.html`, porque vive en `frontend/`) — de ahí el error. Con
`publish = "frontend"` publica el frontend correcto.

### Detalles técnicos del modo híbrido (ya integrados)

- Todas las llamadas JS usan `window.API_BASE` (helper `apiFetch`), incluidos
  los enlaces de descarga (`/api/descargar`) y el `.ics`.
- Con `CORS_ORIGINS` específico, el backend emite cookies `SameSite=None;
  Secure` y `Access-Control-Allow-Credentials` (requeridos para la sesión
  entre `netlify.app` y `onrender.com`).
- Con dominio propio (`app.tudominio.com` + `api.tudominio.com`) también
  funciona y la sesión es más robusta.
- El Service Worker ignora `/api/` y otros orígenes: no cachea la API.

## Notas

- Educalinks no expone una API pública; EducaFix hace scraping de solo-lectura
  con sesiones individuales por estudiante. Úsalo con respeto al portal.
- `tools/explorado/` guarda muestras HTML del portal útiles para mantener los
  selectores cuando Educalinks cambie su estructura.
