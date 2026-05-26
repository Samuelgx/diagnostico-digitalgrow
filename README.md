# Diagnóstico DigitalGrow — Guía de Deploy

## Estructura del proyecto
```
diagnostico-seguro/
├── netlify.toml                    ← configuración de seguridad
├── public/
│   └── index.html                  ← formulario (sin API keys)
└── netlify/
    └── functions/
        └── analyze.js              ← backend seguro (API keys aquí)
```

## Cómo hacer deploy en Netlify

### Paso 1 — Subir a GitHub
1. Crea un repositorio en github.com
2. Sube esta carpeta completa

### Paso 2 — Conectar en Netlify
1. Ve a netlify.com → New site → Import from Git
2. Selecciona tu repositorio
3. Build command: (vacío)
4. Publish directory: public
5. Deploy site

### Paso 3 — Variables de entorno (las API keys van AQUÍ, no en el código)
En Netlify → Site settings → Environment variables → Add:

```
ANTHROPIC_API_KEY   = sk-ant-api03-TU_KEY
NOTION_TOKEN        = ntn_TU_TOKEN
NOTION_DATABASE_ID  = TU_DATABASE_ID_SIN_GUIONES
ALLOWED_HOST        = tu-sitio.netlify.app
```

### Paso 4 — Redeploy
Netlify → Deploys → Trigger deploy

## Seguridad implementada

- API keys NUNCA en el frontend — solo en variables de entorno del servidor
- Rate limiting: máximo 5 diagnósticos por IP por hora
- Validación y sanitización de todos los campos del formulario
- Headers de seguridad: X-Frame-Options, CSP, XSS Protection
- CORS: solo acepta requests del mismo dominio
- Input sanitization: elimina HTML, caracteres de control, limita longitud
- Validación de email antes de procesar
- Errores genéricos al cliente — nunca expone detalles internos
