# CV Autofill

Extensión de Chrome que llena formularios de postulación laboral a partir de un CV en PDF, usando Gemini, Claude o ChatGPT (OpenAI).

## Instalación

1. Abrí `chrome://extensions`
2. Activá **Modo de desarrollador**
3. Tocá **Cargar descomprimida** y elegí esta carpeta
4. Tocá el ícono de la extensión para abrir el panel lateral

## Cómo usarla

### 1. Configurar la IA

1. Abrí **Configuración IA**
2. Elegí proveedor (`Gemini`, `Claude` o `ChatGPT`) y pegá tu API key

**Si no sabés cómo obtener la API key de [Gemini](https://www.google.com/search?q=Como+obtener+apikey+de+Gemini), [Claude](https://www.google.com/search?q=Como+obtener+apikey+de+Claude) o [ChatGPT](https://www.google.com/search?q=Como+obtener+apikey+de+OpenAI+ChatGPT), hacé click en los nombres.**

3. Revisá el modelo (por defecto la versión gratis/barata de cada uno) y tocá **Guardar**

Listado de modelos: [Gemini](https://ai.google.dev/gemini-api/docs/models) · [Claude](https://docs.anthropic.com/en/docs/about-claude/models) · [ChatGPT / OpenAI](https://platform.openai.com/docs/models)

Defaults: Gemini `gemini-3.8-flash` · Claude `claude-haiku-4-5-20251001` · OpenAI `gpt-4o-mini`

### 2. Cargar el CV

1. Elegí un PDF del CV
2. Tocá **Parsear CV**
3. Revisá el JSON del perfil (nombre, experiencias, descripciones, links, etc.)
4. Editá lo que haga falta y tocá **Guardar perfil**

La extensión también lee hipervínculos embebidos del PDF (LinkedIn, GitHub, etc.), aunque estén detrás de íconos.

### 3. Llenar el formulario

1. Abrí la página del formulario de postulación
2. Tocá **Llenar**
3. La extensión escanea los campos, agrega bloques de experiencia/educación si hace falta, y mapea por pasos (sección por sección)
4. Si la IA está saturada, reintenta sola y muestra el progreso en el panel

### 4. Revisar el reporte

- **Verde**: llenado con buena confianza
- **Amarillo**: llenado con baja confianza (revisalo)
- **Rojo**: no se pudo llenar (motivo en la lista)

Hacé click en un ítem del reporte para ir al campo en la página.

### Formularios multi-paso

Si el formulario tiene varias pantallas, tocá **Llenar** en cada una.

## Limitaciones

- Captchas
- Algunos iframes cross-origin
- `input[type=file]` (CV adjunto) no se sube automáticamente
- Campos que requieren decisión personal (salario, motivación, DEI) quedan sin llenar a propósito

## Template de CV

En el repo está [`cv_template_spanish.html`](cv_template_spanish.html), un curriculum de ejemplo listo para adaptar.

Paso a paso para generar el PDF sin romper los hipervínculos:

1. Editá el HTML con tus datos (nombre, contactos, LinkedIn, GitHub, experiencias, etc.)
2. Abrilo en el navegador (doble click o arrastrarlo a Chrome)
3. Usá **Ctrl+P** (o Cmd+P en Mac) para imprimir
4. En destino elegí **Guardar como PDF** (no uses “Microsoft Print to PDF” ni impresoras del sistema: suelen perder los links)
5. Guardá el PDF y usalo en la extensión
