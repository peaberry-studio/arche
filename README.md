# {{COMPANY_NAME}} AI Hub (Vault Template)

Este vault es una plantilla reutilizable para crear un hub interno de empresa con:

- Base de conocimiento (soporte, producto, marketing, operaciones)
- Documentos (PRD/especificaciones, guiones, copys)
- Configuración de agentes de OpenCode (en `opencode.json`)

## Setup inicial

1. Clonar/copiar este vault
2. Buscar y reemplazar todos los placeholders `{{...}}` con los valores de tu empresa:
   - `{{COMPANY_NAME}}` - Nombre de la empresa
   - `{{PRODUCT_NAME}}` - Nombre del producto principal
   - `{{WEBSITE_DOMAIN}}` - Dominio web (ej: example.com)
   - Ver lista completa de placeholders más abajo

3. Crear `me.txt` (no se versiona) con tu nombre en la primera línea (puedes copiar `me.example.txt`).
   Esto permite que los agentes sepan quién está usando el vault.

## Placeholders a reemplazar

### Identidad de marca (`Company/01 - Identidad de marca.md`)
- `{{COMPANY_CONTEXT}}` - Contexto/descripción de la empresa
- `{{MISSION_STATEMENT}}` - Misión
- `{{VISION_STATEMENT}}` - Visión
- `{{VALUE_1..5}}` - Valores (5 slots)
- `{{TARGET_AUDIENCE_1..3}}` - Público objetivo (3 slots)
- `{{MAIN_PROMISE}}` - Promesa principal
- `{{DIFFERENTIATOR_1..5}}` - Diferenciadores (5 slots)
- `{{SLOGAN_1..2}}` - Slogans (2 slots)

### Voz y tono (`Company/02 - Voz y tono.md`)
- `{{CORE_IDEA}}` - Idea central de comunicación
- `{{VOICE_ATTRIBUTE_1..4}}` - Atributos de voz
- `{{PRINCIPLE_1..6}}` - Principios de comunicación
- `{{TONE_SUPPORT}}`, `{{TONE_MARKETING_1..3}}`, `{{TONE_PRODUCT}}` - Tonos por contexto
- `{{WRITING_STYLE_1..7}}` - Reglas de estilo de escritura
- `{{CTA_EXAMPLE}}` - Ejemplo de CTA
- `{{FORBIDDEN_WORDS}}`, `{{WORDS_TO_WATCH}}` - Palabras prohibidas/a vigilar
- `{{TEMPLATE_MARKETING}}`, `{{TEMPLATE_PRODUCT}}`, `{{TEMPLATE_SUPPORT}}` - Plantillas rápidas
- `{{TARGET_FEELING}}` - Sensación objetivo

### Canales (`Company/05 - Canales y contacto.md`)
- `{{CHANNEL_1..3_NAME}}`, `{{CHANNEL_1..3_URL}}` - Canales de contacto
- `{{WEB_URL}}` - URL de la web
- `{{ROLE_1..3}}`, `{{PERSON_1..3_FILE}}`, `{{PERSON_1..3_NAME}}` - Organización
- `{{CTA_RULE}}`, `{{CTA_TEMPLATE_1..4}}` - CTAs
- `{{SIGNATURE_PERSON_FILE}}`, `{{SIGNATURE_PERSON_NAME}}`, `{{SIGNATURE_ROLE}}` - Firma

### Producto (`Company/Product/`)
- `{{PRODUCT_NAME}}` - Nombre del producto
- `{{PRODUCT_DESCRIPTION}}` - Descripción breve
- `{{APP_PLATFORMS}}` - Plataformas (iOS, Android, Web...)
- `{{BACKEND_STACK}}` - Stack de backend
- `{{PAYMENT_PROVIDER}}` - Proveedor de pagos
- `{{ANALYTICS_TOOLS}}` - Herramientas de analítica
- `{{FEATURE_1..3}}` - Funcionalidades principales

### SEO (`Outputs/SEO/00 - Indice SEO.md`)
- `{{WEBSITE_DOMAIN}}` - Dominio para SEO

### Comunicaciones (`Outputs/Comunicaciones/00 - Comunicaciones - Indice.md`)
- `{{OWNER_NAME}}` - Nombre del owner por defecto

## Estructura del vault

```
Company/
├── 01 - Identidad de marca.md
├── 02 - Voz y tono.md
├── 03 - Glosario.md
├── 04 - Herramientas - Linear MCP.md
├── 05 - Canales y contacto.md
├── Product/
│   ├── 00 - Overview.md
│   ├── 01 - Soporte - Indice KB.md
│   ├── 02 - Changelog de la app.md
│   └── docs/
└── People/
    ├── 00 - Indice.md
    └── Employee Template.md

Outputs/
├── Comunicaciones/
├── Meetings/
└── SEO/

System Prompts/
├── assistant.md
├── support.md
├── copywriter.md
├── ...

Templates/
├── Especificacion - PRD.md
├── Soporte - KB Entry.md
├── Marketing - Informe de campanas.md
└── Comunicaciones - Instagram - Carrusel.md
```

## Puntos de entrada

- [[Company/01 - Identidad de marca]]
- [[Company/02 - Voz y tono]]
- [[Company/04 - Herramientas - Linear MCP]]
- [[Company/Product/00 - Overview]]
- [[Company/Product/01 - Soporte - Indice KB|Soporte - Índice KB]]
- [[Templates/Especificacion - PRD|Especificación - PRD]]
- [[Templates/Soporte - KB Entry]]
- [[Templates/Marketing - Informe de campanas|Marketing - Informe de campañas]]

## Agentes disponibles

Los agentes se configuran en `opencode.json` y sus prompts viven en `System Prompts/`:

- `assistant` - Orquestador general
- `support` - Soporte de producto
- `requirements` - PRDs/especificaciones
- `knowledge-curator` - Mantenimiento del KB
- `copywriter` - Copy con voz de marca
- `ads-scripts` - Guiones de anuncios
- `performance-marketing` - Performance (Meta Ads/ASA)
- `seo` - SEO (contenido y técnico)
- `linear` - Operaciones en Linear
- `code-review` - Code review
- `test-orchestrator` - Testing
