# Piloto pequeño de Integrity Tech

Este despliegue usa una sola máquina: Caddy, Next.js, API/consumidor de colas, PostgreSQL 16, Redis y disco privado persistente. No necesita GCP, Vercel, S3, una API de IA ni servicios de psicometría de pago. No se ha contratado ni publicado ningún servicio externo.

El alcance es probar invitación → consentimiento → respuestas → reporte descriptivo. La práctica incluida no es una prueba validada ni un instrumento de selección. Los cuestionarios experimentales de integridad no deben decidir contrataciones.

Ver el estado de aceptación actualizado en [pilot-acceptance-2026-10-17.md](pilot-acceptance-2026-10-17.md).

Para la preparación de publicación y recuperación integral usar [pilot-launch.md](pilot-launch.md). La ficha de operación y los procedimientos están en [pilot-operations.md](pilot-operations.md). Las verificaciones locales no acreditan todavía la aceptación en un servidor público.

## Preparación local

Desde la raíz, con Docker Desktop/Compose y Node 22 o superior:

```sh
node scripts/setup-pilot.mjs
docker compose --env-file .env.pilot -f docker-compose.pilot.yml up -d --build --wait
node scripts/bootstrap-pilot.mjs
```

`setup-pilot` crea `.env.pilot` con permisos 0600, contraseñas y claves aleatorias; se niega a sobrescribirlo. Si ya existe, conservarlo. El correo inicial es `admin@piloto.local`; la contraseña está en `PILOT_ADMIN_PASSWORD`. No pegar ese archivo en chats ni versionarlo. El bootstrap no modifica contraseñas ni privilegios de usuarios existentes y solo crea una práctica técnica; repetirlo no debe duplicar contenido.

Abrir **https://localhost:8443**, después `/staff/login`, usando la organización `piloto`. El certificado local de Caddy es autofirmado: el navegador puede pedir confiar en él. El certificado público se obtiene automáticamente únicamente al configurar un dominio real. HTTP local usa 8080; para el piloto local entrar directamente a HTTPS 8443.

Los servicios internos no publican PostgreSQL, Redis ni la API en puertos del equipo. Solo el gateway se enlaza a 127.0.0.1. Las respuestas se guardan y puntúan directamente en PostgreSQL antes de confirmarlas. La cola del navegador permite reintentos de conexión; la API conserva el consumidor para drenar trabajos antiguos de forma segura. No añadir un segundo worker. Cámara y telemetría del navegador están desactivadas por defecto.

## Ejercicio de aceptación

1. Entrar a Consola de candidatos y seleccionar “Práctica del proceso de evaluación”.
2. Crear una invitación con identidad ficticia. Copiar el enlace/código y abrirlo en una ventana privada. El envío de correo no está integrado: la distribución es manual.
3. Aceptar el consentimiento, responder los tres reactivos y finalizar.
4. Revisar el reporte desde la cuenta staff. La suma máxima de esta práctica es **3 puntos**, no 100 ni un percentil. Una pregunta omitida impide entregar y permite corregirla. Tras confirmar entrega, ni respuestas ni puntuación pueden modificarse.
5. Repetir con un móvil y una interrupción breve de red. Verificar que las respuestas pendientes se sincronizan al reconectar.
6. Antes de personas reales, acordar contenido autorizado, finalidad, aviso de privacidad, plazo de retención y quién atiende solicitudes. El consentimiento de la aplicación no sustituye esos acuerdos.

Las sesiones del piloto expiran; volver a entrar si aparece 401. La invitación expira a los cinco días. No hay cobro automático, envío de email, SSO ni certificación psicométrica.

## Cambios de seguridad y exactitud

- Claves de integridad corregidas en revisión **1.1.0**. No se reinterpretan ni modifican las respuestas históricas. El reporte de revisión anterior se presenta como retirado y no interpretable; se bloquea reclamar invitaciones que resuelvan a la versión incorrecta.
- La semilla demo está prohibida en producción. El piloto no publica la prueba experimental de integridad; usa el bootstrap de práctica.
- Baremos continuos simulados, calibración automática, CAT experimental, recomendaciones IGA y LTI quedan fuera de la superficie del piloto. El generador de normas retirado falla sin consultar ni escribir datos. No se conserva una opción de entorno para habilitar el generador inseguro.
- Las calibraciones nocturnas ya no se registran y el arranque no crea funciones SQL globales ni baremos implícitos.
- Bull, rate limiting y health probes consumen la misma REDIS_URL, incluyendo autenticación y TLS. Redis del piloto usa AOF, fsync y noeviction.
- El backend exige secretos de cifrado en producción. El disco privado requiere declarar persistencia. Esto no significa que todos los campos de PostgreSQL estén cifrados por la aplicación; proteger también la máquina y los respaldos.
- El servidor no confía en X-Forwarded-For suministrado por un cliente. En el piloto pequeño el límite se comparte detrás del proxy; antes de escalar, configurar proxies de confianza por red y pruebas de suplantación.
- Se actualizaron dependencias de producción, Next.js/React y runtime Docker/CI a Node 22. `npm audit --omit=dev --audit-level=high` ya bloquea CI; los avisos de herramientas de desarrollo se revisan por separado.

## Datos existentes y versiones

Para un piloto, preferir una base nueva. No ejecutar seeds sobre producción para “reparar” historia. La semilla de desarrollo crea la revisión 1.1.0 con claves corregidas y la identifica como experimental. Conservar versiones publicadas y sus intentos para auditoría. Si había invitaciones o intentos de integridad antiguos, cancelarlos operativamente y emitir otros únicamente después de revisar y publicar la versión apropiada. Las correcciones de código no validan científicamente ningún instrumento.

No ejecutar `prisma migrate dev` sobre datos reales. `migrate` es un servicio de una sola ejecución que aplica `prisma migrate deploy` antes de la API. Revisar SQL y respaldo antes de actualizar un piloto con información real.

## Respaldo sin servicios contratados

```sh
node scripts/backup-pilot.mjs
node scripts/backup-pilot.mjs --verify pilot-backups/ARCHIVO.itp
```

El respaldo interrumpe brevemente frontend y API, guarda PostgreSQL, archivos privados y Redis, y los vuelve a arrancar. Se cifra con AES-256-GCM y la clave `PILOT_BACKUP_KEY`. La verificación autentica el cifrado y comprueba que el archivo contiene los tres componentes; **no sustituye un ensayo de restauración**. No ejecutar simultáneamente con despliegues u otros respaldos.

Copiar el respaldo a otro medio y conservar la clave por separado, con acceso restringido. Guardarlo solo en el mismo disco no protege frente a pérdida de la máquina. No hay programación automática ni retención externa configurada. Para el primer piloto, hacer copia después de cada jornada y antes de actualizaciones; objetivo propuesto RPO 24 horas, RTO 4 horas, sujeto a un ensayo real.

Una restauración debe hacerse primero en una instalación aislada: autenticar/descifrar el archivo, cargar `database.sql` en PostgreSQL vacío, recuperar el contenido de los volúmenes privados y Redis con servicios detenidos, conservar los secretos originales y verificar acceso, cantidades de registros y una evaluación completa. No restaurar encima de datos del piloto sin una decisión explícita de recuperación.

## Verificación técnica local

Los puertos 15432 y 16379 se reservan para servicios de prueba, sin datos reales:

```sh
docker compose -f docker-compose.verify.yml up -d --wait
cd integrity-tech-backend
export DATABASE_URL='postgresql://postgres:local-test-only@127.0.0.1:15432/integrity_tech_e2e?schema=public'
npx prisma migrate deploy
npm run seed:e2e
npm run build
npm test -- --runInBand
npm run test:integration
cd ../integrity-tech-frontend
npx playwright install chromium
REDIS_HOST=127.0.0.1 REDIS_PORT=16379 REDIS_URL=redis://127.0.0.1:16379 REDIS_KEY_PREFIX=integrity:verify: E2E_BACKEND_URL=http://127.0.0.1:13001 E2E_FRONTEND_URL=http://127.0.0.1:13000 E2E_API_BASE_URL=http://127.0.0.1:13001/api OTEL_ENABLED=false npm run test:e2e
```

Al terminar: `docker compose -f docker-compose.verify.yml down` desde la raíz. No usar `down -v` sobre el piloto: elimina sus datos. Para detener el piloto y conservar datos: `docker compose --env-file .env.pilot -f docker-compose.pilot.yml stop`.

## Salida a un servidor económico

Solo después de validar el recorrido y la recuperación. Punto de partida para dimensionar: una máquina con 4 GB de RAM y disco persistente; construir imágenes puede requerir más memoria. No es una capacidad concurrente certificada.

En `.env.pilot` configurar `PILOT_DOMAIN` a un dominio propio, `PILOT_ORIGIN=https://ese-dominio`, `PILOT_BIND_IP=0.0.0.0`, `PILOT_HTTP_PORT=80`, `PILOT_HTTPS_PORT=443`; cambiar correo de administración **antes del primer bootstrap**. Abrir solo 80/443 y el acceso administrativo restringido. Mantener DB/Redis privados. El DNS debe apuntar al servidor para emitir certificado. No habilitar cámara ni analítica experimental.

Antes de la primera invitación real: probar restauración en una instalación aislada; comprobar el dominio y la sesión desde un móvil; ejecutar evaluación de referencia; revisar aislamiento entre organizaciones; limitar el primer grupo y medir fallos y soporte. Esta configuración no promete alta disponibilidad: una sola máquina es un punto de falla.
