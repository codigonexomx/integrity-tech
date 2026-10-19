# Guía de Despliegue en Google Cloud Platform (GCP)
**Para:** Equipo de Ingeniería y Operaciones de Integrity Tech
**Estado:** diseño histórico, no validado para el piloto. Usar [pilot.md](pilot.md); no ejecutar esta guía para iniciar el piloto económico.

---

## 1. Resumen de la Arquitectura en GCP

La arquitectura de Integrity Tech en Google Cloud Platform (GCP) está diseñada para garantizar alta disponibilidad, seguridad estricta y escalabilidad automática sin servidores físicos.

```
                      [Candidato / Reclutador (HTTPS)]
                                     │
                                     ▼
                                  [Vercel]
                             (Next.js Frontend)
                                     │ (Peticiones a /api/*)
                                     ▼
                            [Cloud Run Load Balancer]
                                     │
                 ┌───────────────────┴───────────────────┐
                 ▼                                       ▼
       [Cloud Run Web API]                    [Cloud Run Worker]
      (integrity-tech-api)                 (integrity-tech-worker)
                 │                                       │
                 ├───────────────────┬───────────────────┤
                 │                   │                   │
                 ▼                   ▼                   ▼
        [Cloud SQL Postgres]    [Memorystore Redis]   [Cloud Storage]
         (Base de Datos)        (BullMQ / RateLimit) (Snapshots/Fotos)
```

---

## 2. Requisitos Previos y Recursos de GCP

Antes de ejecutar el pipeline, se deben aprovisionar o configurar los siguientes servicios desde la consola de GCP o mediante la CLI de Google Cloud (`gcloud`):

### A. Artifact Registry (Repositorio Docker)
Crea un repositorio de Docker en la región objetivo (por ejemplo, `us-central1`):
```bash
gcloud artifacts repositories create integrity-tech \
    --repository-format=docker \
    --location=us-central1 \
    --description="Repositorio de imágenes Docker de Integrity Tech"
```

### B. Cloud SQL (Base de Datos PostgreSQL)
Aprovisiona una instancia de PostgreSQL (versión 15 o superior). Se recomienda habilitar conexiones mediante **Private IP** para mayor seguridad, o bien habilitar conexiones a través del proxy de Cloud SQL.
*   Crea una base de datos llamada `integrity_db`.
*   Crea un usuario administrador y genera una contraseña segura.

### C. Memorystore (Redis)
Aprovisiona una instancia de Redis en la misma red VPC que tus servicios de Cloud Run.
*   Registra la dirección IP y el puerto de la instancia (por defecto, `6379`).
*   Configura un **Serverless VPC Access Connector** en GCP para permitir que Cloud Run se conecte a la IP privada de Redis de manera segura.

### D. Cloud Storage (GCS)
Crea un bucket privado de Google Cloud Storage para almacenar de forma persistente las evidencias fotográficas de proctoring.
*   Nombre sugerido: `<mi-proyecto>-integrity-private-storage`.
*   Deshabilita el acceso público al bucket.

---

## 3. Integración con Secret Manager

Para evitar escribir secretos reales en las variables de entorno o en archivos de configuración, debes registrar los siguientes secretos en **GCP Secret Manager**:

1.  `INTEGRITY_DATABASE_URL`: URL completa de conexión a PostgreSQL (por ejemplo, `postgresql://postgres:contraseña-segura@10.x.x.x:5432/integrity_db?schema=public&connection_limit=10`).
2.  `INTEGRITY_JWT_SECRET`: Llave simétrica aleatoria y fuerte de al menos 32 caracteres.
3.  `INTEGRITY_REDIS_URL`: URL de conexión a la instancia de Memorystore (por ejemplo, `redis://10.x.x.x:6379`).

*En la consola de Cloud Run, mapea estos secretos directamente a las variables de entorno del contenedor:*
*   `DATABASE_URL` -> referenciado a `INTEGRITY_DATABASE_URL:latest`
*   `JWT_SECRET` -> referenciado a `INTEGRITY_JWT_SECRET:latest`
*   `REDIS_URL` -> referenciado a `INTEGRITY_REDIS_URL:latest`

---

## 4. Pipeline de CI/CD con Cloud Build

El pipeline de compilación se define en el archivo `cloudbuild.yaml` en la raíz del proyecto. Este archivo:
1.  Compila el backend en un entorno optimizado multi-stage.
2.  Construye dos imágenes Docker independientes (`integrity-tech-api` e `integrity-tech-worker`) utilizando el mismo código fuente optimizado.
3.  Sube las imágenes resultantes a **Artifact Registry** etiquetándolas con el SHA del commit y la etiqueta `latest`.

### Ejecutar compilación manualmente:
```bash
gcloud builds submit --config=cloudbuild.yaml --substitutions=_LOCATION="us-central1",_REPOSITORY="integrity-tech"
```

---

## 5. Configuración y Despliegue en Cloud Run

Los servicios de backend y procesamiento de tareas se despliegan de forma independiente en Cloud Run.

### A. Servicio Web de la API (`integrity-tech-api`)
*   **Imagen:** `us-central1-docker.pkg.dev/<PROJECT_ID>/integrity-tech/integrity-tech-api:latest`
*   **Puerto de Contenedor:** `3001`
*   **Concurrencia:** Recomendado 80 solicitudes simultáneas por contenedor.
*   **Autoscaling:** Mínimo 1 contenedor (para evitar arranques en frío) y máximo 10 contenedores.
*   **Probes de Salud (Health Checks):**
    *   *Startup Probe:* HTTP `/health/live` (Timeout: 5s, Periodo: 10s, Reintentos: 3).
    *   *Liveness Probe:* HTTP `/health/live` (Timeout: 5s, Periodo: 30s).
    *   *Readiness Probe:* HTTP `/health/ready` (Verifica conexiones activas a Postgres, Redis y colas).
*   **Variables de Entorno Clave:**
    *   `PORT=3001`
    *   `NODE_ENV=production`
    *   `CORS_ORIGINS=https://integrity-tech-eight.vercel.app`
    *   `STORAGE_PROVIDER=gcs`
    *   `STORAGE_GCS_BUCKET=<mi-proyecto>-integrity-private-storage`
    *   `RATE_LIMIT_STORE=redis`
    *   `RATE_LIMIT_REDIS_REQUIRED=true`

### B. Servicio de Procesamiento en Segundo Plano (`integrity-tech-worker`)
*   **Imagen:** `us-central1-docker.pkg.dev/<PROJECT_ID>/integrity-tech/integrity-tech-worker:latest`
*   **EntryPoint / CMD:** Override de comando a `node dist/main-worker.js`.
*   **Ingreso de Red:** Interno (no exponer a Internet pública).
*   **Autoscaling:** Mínimo 1, máximo 5 (ajustar según carga de procesamiento psicométrico).
*   **Variables de Entorno Clave:**
    *   `NODE_ENV=production`
    *   `STORAGE_PROVIDER=gcs`
    *   `STORAGE_GCS_BUCKET=<mi-proyecto>-integrity-private-storage`

---

## 6. Migraciones y Inicialización de Base de Datos (Seeds)

Dado que las bases de datos de Cloud SQL están protegidas, la aplicación de migraciones y semillas se realiza de la siguiente manera en producción:

### Ejecución de Migraciones en Cloud Run:
El contenedor de la API incluye un comando de arranque en producción (`npx prisma migrate deploy && npm run start:prod`). Cada vez que Cloud Run inicie una versión nueva de contenedor, se aplicarán de forma automática las migraciones pendientes sin interrumpir el servicio.

### Sembrado Inicial de Producción (Seeding):
Para inicializar perfiles y usuarios clave en la base de datos de GCP:
1.  Conéctate mediante el Proxy de Cloud SQL localmente:
    ```bash
    ./cloud-sql-proxy <INSTANCE_CONNECTION_NAME>
    ```
2.  Configura temporalmente tu `DATABASE_URL` local apuntando a `127.0.0.1:5432` y ejecuta:
    ```bash
    npm run seed
    ```
3.  Esto sembrará la cuenta de administración principal: `admin@integrity.demo` / `IntegrityDemo123!`.

---

## 7. Aprovisionamiento detallado y comandos de despliegue en GCP

### A. Creación de Secretos en Secret Manager
Ejecuta los siguientes comandos para registrar los secretos de producción:
```bash
# 1. Base de datos
gcloud secrets create INTEGRITY_DATABASE_URL --replication-policy="automatic"
echo -n "postgresql://postgres:PASSWORD@127.0.0.1:5432/integrity_db?schema=public&connection_limit=10" | gcloud secrets versions add INTEGRITY_DATABASE_URL --data-file=-

# 2. JWT Secret
gcloud secrets create INTEGRITY_JWT_SECRET --replication-policy="automatic"
echo -n "CLAVE_SECRET_FUERTE_DE_32_CARACTERES" | gcloud secrets versions add INTEGRITY_JWT_SECRET --data-file=-

# 3. Redis URL
gcloud secrets create INTEGRITY_REDIS_URL --replication-policy="automatic"
echo -n "redis://10.0.0.3:6379" | gcloud secrets versions add INTEGRITY_REDIS_URL --data-file=-
```

### B. Configuración de VPC Serverless Access Connector
Para conectar Cloud Run de forma segura a Cloud SQL y Memorystore Redis en la IP privada, debes crear un VPC Connector en tu red:
```bash
gcloud compute networks vpc-access connectors create integrity-vpc-connector \
    --region=us-central1 \
    --range=10.8.0.0/28 \
    --network=default
```

### C. Despliegue del Servicio Web API (`integrity-tech-api`)
Ejecuta el siguiente comando para desplegar el servidor backend expuesto a la red pública:
```bash
gcloud run deploy integrity-tech-api \
    --image=us-central1-docker.pkg.dev/PROJECT_ID/integrity-tech/integrity-tech-api:latest \
    --region=us-central1 \
    --port=3001 \
    --min-instances=1 \
    --max-instances=10 \
    --cpu=2 \
    --memory=2Gi \
    --concurrency=80 \
    --vpc-connector=projects/PROJECT_ID/locations/us-central1/connectors/integrity-vpc-connector \
    --service-account=integrity-run-sa@PROJECT_ID.iam.gserviceaccount.com \
    --set-env-vars="PORT=3001,NODE_ENV=production,CORS_ORIGINS=https://integrity-tech-eight.vercel.app,STORAGE_PROVIDER=gcs,STORAGE_GCS_BUCKET=PROJECT_ID-integrity-private-storage,RATE_LIMIT_STORE=redis,RATE_LIMIT_REDIS_REQUIRED=true,OTEL_ENABLED=false" \
    --set-secrets="DATABASE_URL=INTEGRITY_DATABASE_URL:latest,JWT_SECRET=INTEGRITY_JWT_SECRET:latest,REDIS_URL=INTEGRITY_REDIS_URL:latest" \
    --allow-unauthenticated
```

### D. Despliegue del Background Worker (`integrity-tech-worker`)
Ejecuta el siguiente comando para desplegar el worker asíncrono BullMQ (sin acceso de red público / headless):
```bash
gcloud run deploy integrity-tech-worker \
    --image=us-central1-docker.pkg.dev/PROJECT_ID/integrity-tech/integrity-tech-worker:latest \
    --region=us-central1 \
    --command="node,dist/main-worker.js" \
    --no-cpu-throttling \
    --min-instances=1 \
    --max-instances=5 \
    --cpu=1 \
    --memory=1Gi \
    --vpc-connector=projects/PROJECT_ID/locations/us-central1/connectors/integrity-vpc-connector \
    --service-account=integrity-run-sa@PROJECT_ID.iam.gserviceaccount.com \
    --set-env-vars="NODE_ENV=production,STORAGE_PROVIDER=gcs,STORAGE_GCS_BUCKET=PROJECT_ID-integrity-private-storage" \
    --set-secrets="DATABASE_URL=INTEGRITY_DATABASE_URL:latest,JWT_SECRET=INTEGRITY_JWT_SECRET:latest,REDIS_URL=INTEGRITY_REDIS_URL:latest" \
    --no-allow-unauthenticated
```

---

## 8. Configuración del Frontend en Vercel

Una vez que `integrity-tech-api` esté desplegado en Cloud Run, copia su URL HTTPS pública y configúrala en el panel del proyecto de **Vercel** (`integrity-tech-eight`):

1.  **`BACKEND_URL`**: `https://integrity-tech-api-xxxxx-uc.a.run.app` (URL de Cloud Run sin el prefijo `/api` para compatibilidad con rewrites de Next.js).
2.  **`NEXT_PUBLIC_API_BASE_URL`**: `https://integrity-tech-api-xxxxx-uc.a.run.app/api`.

---

## 9. Estrategia de Rollback y Escalamiento

### Rollback (Retorno a Versión Anterior)
Si se detecta un fallo en producción tras un despliegue:
1.  Ve al servicio de Cloud Run en la consola de GCP.
2.  Haz clic en **Manage Revisions**.
3.  Selecciona la revisión anterior que funcionaba de manera óptima y asigna el **100% del tráfico** a esa revisión de forma inmediata.
4.  Esto revertirá instantáneamente los contenedores y el tráfico sin requerir una nueva compilación de Docker.

### Escalamiento Horizontal
*   **CPU y Memoria:** Se recomienda asignar al menos 2 vCPUs y 2 GB de RAM por contenedor en la API de producción para mitigar la latencia de cómputo de la calibración theta.
*   **Límites de Conexión en Base de Datos:** Prisma está limitado mediante `connection_limit=10` en la cadena de conexión. Con un pool máximo de 10 contenedores en Cloud Run, el número total de conexiones simultáneas a Cloud SQL será de 100, lo cual es fácilmente soportado por una instancia micro de Cloud SQL.

