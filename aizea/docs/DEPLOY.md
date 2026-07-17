# AIzea — Guía de Despliegue

## Requisitos Previos
- Docker y Docker Compose instalados
- API Key de OpenRouter (obtenla en https://openrouter.ai/keys)

## Despliegue con Docker

### 1. Configurar variables de entorno
Crea un archivo `.env` en la raíz del proyecto:
```env
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_MODEL=deepseek/deepseek-chat
```

### 2. Construir y arrancar
```bash
docker-compose up -d --build
```

La aplicación estará disponible en `http://localhost:3000`.

### 3. Detener
```bash
docker-compose down
```

### 4. Datos persistentes
Los volúmenes Docker conservan los datos entre reinicios:
- `aizea-data`: base de datos SQLite
- `aizea-uploads`: archivos PDF subidos
- `aizea-figures`: figuras extraídas

Para eliminar todos los datos:
```bash
docker-compose down -v
```

---

## Desarrollo Local (sin Docker)

### 1. Instalar dependencias
```bash
cd aizea
npm install
```

### 2. Configurar variables de entorno
Copia `.env.example` a `.env` y configura tu API key.

### 3. Inicializar la base de datos
```bash
npx prisma db push
npx prisma generate
```

### 4. Arrancar servidor de desarrollo
```bash
npm run dev
```
Abre `http://localhost:3000`.

### 5. Producción local
```bash
npm run build
npm start
```

---

## Arquitectura de Servicios

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Next.js    │────▶│   Prisma     │────▶│   SQLite    │
│   Frontend   │     │   (ORM)      │     │   (local)   │
└──────┬───────┘     └──────────────┘     └─────────────┘
       │
       │ HTTP
       ▼
┌─────────────┐
│  OpenRouter  │
│  (DeepSeek)  │
└─────────────┘
```

Todos los servicios se ejecutan en el mismo contenedor Docker para simplicidad.
Para una arquitectura de microservicios, se pueden separar en el futuro:
- Servicio de IA (API independiente)
- Servicio de extracción de PDF
- Servicio de exportación
