// netlify/functions/analyze.js
// Las API keys NUNCA salen del servidor — viven en variables de entorno de Netlify

const RATE_LIMIT = new Map(); // IP → { count, resetAt }
const MAX_REQUESTS = 5;       // máximo 5 diagnósticos por IP por hora
const WINDOW_MS = 60 * 60 * 1000; // 1 hora

// ─── RATE LIMITER ─────────────────────────────────────────────────────────────
function checkRateLimit(ip) {
  const now = Date.now();
  const entry = RATE_LIMIT.get(ip);

  if (!entry || now > entry.resetAt) {
    RATE_LIMIT.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }

  if (entry.count >= MAX_REQUESTS) return false;

  entry.count++;
  return true;
}

// ─── INPUT SANITIZER ──────────────────────────────────────────────────────────
function sanitize(str, maxLen = 500) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/[<>]/g, '')           // quitar HTML tags
    .replace(/[\x00-\x1F]/g, ' ')  // quitar caracteres de control
    .trim()
    .slice(0, maxLen);
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
  };

  // Solo POST
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método no permitido' }) };
  }

  // Verificar origen (solo desde tu propio dominio)
  const origin = event.headers.origin || event.headers.referer || '';
  const allowedHost = process.env.ALLOWED_HOST || '';
  if (allowedHost && !origin.includes(allowedHost)) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Origen no permitido' }) };
  }

  // Rate limiting por IP
  const ip = event.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  if (!checkRateLimit(ip)) {
    return {
      statusCode: 429,
      headers,
      body: JSON.stringify({ error: 'Demasiadas solicitudes. Intenta en 1 hora.' })
    };
  }

  // Parsear y validar body
  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'JSON inválido' }) };
  }

  // Validar campos requeridos
  const required = ['nombre', 'empresa', 'cargo', 'email', 'industria', 'equipo', 'facturacion', 'cuello', 'manuales', 'frena', 'crm', 'presupuesto', 'timing'];
  for (const field of required) {
    if (!data[field] || String(data[field]).trim() === '') {
      return { statusCode: 400, headers, body: JSON.stringify({ error: `Campo requerido: ${field}` }) };
    }
  }

  // Validar email
  if (!validateEmail(data.email)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email inválido' }) };
  }

  // Sanitizar todos los campos
  const d = {
    nombre:      sanitize(data.nombre, 100),
    empresa:     sanitize(data.empresa, 100),
    cargo:       sanitize(data.cargo, 100),
    email:       sanitize(data.email, 100),
    whatsapp:    sanitize(data.whatsapp, 30),
    web:         sanitize(data.web, 100),
    industria:   sanitize(data.industria, 80),
    equipo:      sanitize(data.equipo, 30),
    facturacion: sanitize(data.facturacion, 30),
    cuello:      sanitize(data.cuello, 1000),
    manuales:    sanitize(data.manuales, 1000),
    frena:       sanitize(data.frena, 1000),
    crm:         sanitize(data.crm, 200),
    inversion:   sanitize(data.inversion, 100),
    presupuesto: sanitize(data.presupuesto, 50),
    timing:      sanitize(data.timing, 50),
  };

  // Verificar variables de entorno
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const NOTION_TOKEN  = process.env.NOTION_TOKEN;
  const NOTION_DB     = process.env.NOTION_DATABASE_ID;

  if (!ANTHROPIC_KEY || !NOTION_TOKEN || !NOTION_DB) {
    console.error('Variables de entorno faltantes');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Configuración del servidor incompleta' }) };
  }

  // ─── LLAMADA A CLAUDE ────────────────────────────────────────────────────────
  let plan;
  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        system: `Eres un consultor experto en transformacion digital y automatizacion para empresas latinoamericanas. Analiza el diagnostico y responde UNICAMENTE con un objeto JSON valido. Sin texto antes ni despues. Sin backticks. Solo el JSON puro.

Estructura exacta:
{"clasificacion":"BASICO o INTERMEDIO o AVANZADO","paquete_recomendado":"string","precio_recomendado":"string","resumen_ejecutivo":"2-3 oraciones directas al cliente","diagnostico":{"fortalezas":["string","string","string"],"problemas_criticos":[{"problema":"string","impacto":"ALTO o MEDIO o BAJO","impacto_economico_estimado":"string"}],"oportunidades_perdidas":["string","string"]},"plan_de_accion":[{"semana":1,"titulo":"string","acciones":["string","string","string"],"herramienta_recomendada":"string","costo_estimado":"string","resultado_esperado":"string"}],"roi_estimado":{"inversion_total_primer_mes":"string","ahorro_tiempo_horas_semana":0,"incremento_ventas_estimado":"string","tiempo_recuperacion_inversion":"string"},"siguiente_paso":"string con precio exacto del paquete","mensaje_urgencia":"string"}

CLASIFICACION: BASICO 1-5 empleados o sin CRM o presupuesto menor 500. INTERMEDIO 6-20 empleados o herramientas desconectadas o 500-2000. AVANZADO mas de 20 empleados o CRM activo o mas de 2000. Plan entre 4 y 6 semanas. Acciones especificas con herramientas reales y costos en USD para Latinoamerica.`,
        messages: [{
          role: 'user',
          content: `Nombre: ${d.nombre}\nEmpresa: ${d.empresa}\nCargo: ${d.cargo}\nIndustria: ${d.industria}\nEquipo: ${d.equipo}\nFacturacion: ${d.facturacion}\nCuello de botella: ${d.cuello}\nProcesos manuales: ${d.manuales}\nFrena crecimiento: ${d.frena}\nCRM: ${d.crm}\nInversion previa: ${d.inversion}\nPresupuesto: ${d.presupuesto}\nCuando implementar: ${d.timing}\n\nGenera el JSON.`
        }]
      })
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.json();
      throw new Error('Claude: ' + (err.error?.message || claudeRes.status));
    }

    const claudeData = await claudeRes.json();
    const raw = claudeData.content[0].text.trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Respuesta de Claude no es JSON válido');
    plan = JSON.parse(match[0]);

  } catch (e) {
    console.error('Error Claude:', e.message);
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'Error generando diagnóstico: ' + e.message }) };
  }

  // ─── GUARDAR EN NOTION ───────────────────────────────────────────────────────
  try {
    const dbId = NOTION_DB.replace(/-/g, '');
    const formattedId = `${dbId.slice(0,8)}-${dbId.slice(8,12)}-${dbId.slice(12,16)}-${dbId.slice(16,20)}-${dbId.slice(20)}`;

    const notionRes = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + NOTION_TOKEN,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        parent: { database_id: formattedId },
        properties: {
          "Nombre":        { title: [{ text: { content: `${d.nombre} — ${d.empresa}` } }] },
          "Email":         { email: d.email },
          "Empresa":       { rich_text: [{ text: { content: d.empresa } }] },
          "Cargo":         { rich_text: [{ text: { content: d.cargo } }] },
          "WhatsApp":      { phone_number: d.whatsapp || null },
          "Clasificación": { select: { name: plan.clasificacion } },
          "Paquete":       { rich_text: [{ text: { content: plan.paquete_recomendado || '' } }] },
          "Precio":        { rich_text: [{ text: { content: plan.precio_recomendado || '' } }] },
          "Resumen":       { rich_text: [{ text: { content: (plan.resumen_ejecutivo || '').slice(0, 2000) } }] },
          "Siguiente Paso":{ rich_text: [{ text: { content: (plan.siguiente_paso || '').slice(0, 2000) } }] },
          "Plan Semanas":  { rich_text: [{ text: { content: ((plan.plan_de_accion || []).map(s => 'Semana ' + s.semana + ': ' + s.titulo + ' — ' + (s.acciones||[]).join(', ')).join('\n')).slice(0, 2000) } }] },
          "ROI Ahorro Horas": { number: plan.roi_estimado?.ahorro_tiempo_horas_semana || 0 },
          "ROI Incremento Ventas": { rich_text: [{ text: { content: plan.roi_estimado?.incremento_ventas_estimado || '' } }] },
          "Industria":     { select: { name: d.industria || 'Otro' } },
          "Equipo":        { select: { name: d.equipo || '1-5' } },
          "Sitio Web":     { url: (d.web && d.web !== 'no' && d.web.startsWith('http')) ? d.web : null },
          "Cuando implementar": { select: { name: d.timing || 'Este mes' } },
          "Estado":        { select: { name: 'Nuevo' } },
          "Fecha":         { date: { start: new Date().toISOString().split('T')[0] } },
        }
      })
    });

    if (!notionRes.ok) {
      const err = await notionRes.json();
      console.warn('Notion warning:', err.message);
      // No falla — el diagnóstico igual se muestra al cliente
    }
  } catch (e) {
    console.warn('Notion error (no crítico):', e.message);
  }

  // Devolver solo lo necesario — nunca devolver datos internos
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      ok: true,
      clasificacion: plan.clasificacion,
      paquete_recomendado: plan.paquete_recomendado,
      precio_recomendado: plan.precio_recomendado,
      resumen_ejecutivo: plan.resumen_ejecutivo,
      diagnostico: plan.diagnostico,
      plan_de_accion: plan.plan_de_accion,
      roi_estimado: plan.roi_estimado,
      siguiente_paso: plan.siguiente_paso,
      mensaje_urgencia: plan.mensaje_urgencia,
    })
  };
};
