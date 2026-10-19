# Preparación del piloto de Código Nexo

Integrity Tech se prepara para un piloto asistido de un proceso, hasta diez candidatos, un cuestionario de hasta diez preguntas y un reclutador. Este procedimiento no contrata servicios ni autoriza candidatos reales. La activación comercial requiere acuerdo y ficha completos.

Estado y evidencias de preparación: [pilot-readiness-2026-10-17.md](pilot-readiness-2026-10-17.md).

## Qué puede quedar listo sin alojamiento

- Código, migraciones, imágenes y procedimientos revisados en una rama de preparación.
- Entorno privado generado sin contraseñas de ejemplo y comprobación de configuración sin imprimir secretos.
- Respaldo cifrado y restauración de PostgreSQL, archivos privados y Redis en contenedores aislados.
- Material comercial, responsabilidades, canal de atención propuesto y ficha de operación.
- Procedimiento de instalación, comprobación externa y reversión.

La rama `codex/pilot-ready` tiene deshabilitado el despliegue automático de Vercel mediante el `vercel.json` del frontend. Subir la rama no equivale a publicar el piloto ni a actualizar producción. No fusionar a main antes de revisar el despliegue: main sigue conectado a Vercel.

## Compra prevista para el lunes 19 de octubre de 2026

La compra requiere confirmación del usuario en el proveedor. La referencia consultada es una máquina de 4 GiB y 2 vCPU con disco persistente, US$24/mes, y respaldo diario del proveedor, 30% adicional: US$31.20 antes de impuestos y extras. Es una referencia, no una capacidad garantizada ni una contratación efectuada. Confirmar región, factura, impuestos y cargos en pantalla. El respaldo de disco del proveedor complementa el respaldo cifrado de aplicación; no lo sustituye.

No comprar otro dominio. Se propone `integrity.codigonexo.mx`, sujeto a acceso al DNS del dominio existente. No activar Cloud SQL, Memorystore, trabajadores separados, correo de pago, IA ni un plan comercial de Vercel para esta arquitectura de una sola máquina. No usar Vercel Hobby para prestar el piloto comercial.

## Instalación en el servidor nuevo

Usar un sistema soportado con Docker Engine, Docker Compose v2 y Node.js 22 o superior. El administrador debe revisar actualizaciones, acceso SSH con llave, firewall y espacio disponible. Publicar solo 80/443; restringir SSH. No exponer PostgreSQL, Redis ni la API directamente. Preparar usuario de despliegue `integrity` y directorio `/opt/integrity-tech` si se usarán las unidades systemd adjuntas. El acceso al grupo Docker equivale a privilegios administrativos; limitar quién lo posee.

Clonar el repositorio y seleccionar el SHA aprobado de la rama. No utilizar las credenciales del piloto local ni copiar su base como datos de un cliente. Crear una base nueva y secretos propios del servidor:

```sh
node scripts/setup-pilot.mjs --domain integrity.codigonexo.mx --admin-email CORREO_ADMIN_CONFIRMADO
node scripts/preflight-pilot.mjs --remote
docker compose --env-file .env.pilot -f docker-compose.pilot.yml build
docker compose --env-file .env.pilot -f docker-compose.pilot.yml up -d --wait
node scripts/bootstrap-pilot.mjs
```

El generador no sobrescribe `.env.pilot`; crea secretos distintos y modo 0600. El archivo contiene credenciales y claves de cifrado: custodiar una copia protegida fuera del servidor, separada del respaldo cifrado. La clave de respaldo por sí sola no recupera los secretos usados por la aplicación.

Antes de abrir al público, confirmar que el registro DNS del subdominio apunta al servidor elegido. No alterar los registros del dominio principal, `www` ni correo. El proveedor de DNS puede administrar el subdominio sin una compra independiente. HTTPS se comprueba una vez propagado DNS y accesibles 80/443.

`preflight-pilot` revisa configuración, no certifica que DNS, HTTPS, privacidad o recuperación remotos estén aprobados. No marca la campaña como activa.

## Aceptación en el entorno definitivo

1. Comprobar DNS, certificado público, redirección a HTTPS y acceso desde otra conexión y un móvil.
2. Crear una organización ficticia aislada y un reclutador de permisos limitados. Completar invitación, consentimiento, respuestas, recarga y entrega; comprobar cero, máximo, pendientes y vencidos. No ejecutar scripts de QA con escrituras sobre personas reales.
3. Cotejar reportes y CSV de hasta diez registros, incluidos quienes no iniciaron. Comprobar que no aparecen claves, respuestas o enlaces de acceso en el CSV.
4. Crear un respaldo cifrado, copiarlo a un medio externo autorizado y verificar que puede recuperarse. Ensayar restauración integral en un destino aislado; cotejar datos, archivos, Redis y acceso.
5. Registrar fecha, SHA, resultado, responsables y ubicación protegida de evidencias. Cerrar las cuentas ficticias y revocar sus sesiones.

No empezar a recibir candidatos reales hasta completar la ficha del acuerdo, los pasos anteriores y las condiciones de datos. El resultado de preparación local no sustituye esa aceptación remota.

## Respaldos y recuperación

```sh
node scripts/backup-pilot.mjs
node scripts/backup-pilot.mjs --verify pilot-backups/ARCHIVO.itp
node scripts/restore-pilot.mjs pilot-backups/ARCHIVO.itp --project integrity-restore-ensayo --env-file .env.pilot --target-env pilot-restore/ensayo/.env.pilot
```

El respaldo pausa frontend y API y detiene Redis limpiamente mientras copia su persistencia; después devuelve los servicios que estaban iniciados. No ejecutar simultáneamente con cambios de versión. El bloqueo local impide dos respaldos a la vez; ante un proceso interrumpido, comprobar que no sigue activo antes de retirar un bloqueo huérfano. Conservar el original cifrado aunque una recuperación falle.

La recuperación rechaza destinos con contenedores o volúmenes existentes. Solo admite nombres `integrity-restore-*`, se enlaza a loopback y puertos alternativos y conserva las claves originales. No hace una sustitución de producción automática. Un cambio de producción tras una incidencia requiere revisar datos nuevos y acordar la recuperación, evitando perder respuestas recibidas después del respaldo.

Las plantillas `deploy/systemd/` proponen respaldo diario a las 04:00 de Ciudad de México. No están instaladas ni activadas. Ajustar la ventana con el cliente y comprobar la ruta real de Node antes de instalar y habilitar el timer. La cuenta de operación debe revisar diariamente el resultado y la copia externa. No activar borrado automático hasta acordar conservación, excepciones y respaldos.

## Actualizaciones y reversión

Registrar el SHA previo y crear un respaldo antes de actualizar. Revisar las migraciones y construir las imágenes antes de reiniciar. Usar `prisma migrate deploy` mediante el servicio `migrate`; no usar seeds de desarrollo. Si una versión falla, no dar por hecho que basta revertir la imagen: una migración de datos puede exigir recuperación o corrección hacia delante. No usar `down -v` en producción.

Para detener sin borrar datos:

```sh
docker compose --env-file .env.pilot -f docker-compose.pilot.yml stop
```

## Ensayo integral local reproducible

```sh
node scripts/rehearse-recovery.mjs
```

Necesita las imágenes del piloto construidas. Crea una fuente y un destino nuevos, con candidatos ficticios y puertos locales propios. Coteja el reporte restaurado, los bytes de un archivo privado, Redis, el acceso HTTPS local, rechazo de respaldo manipulado y rechazo de un destino existente. Elimina solamente los proyectos y secretos temporales que crea. Las evidencias sin credenciales quedan en `output/recovery-readiness/` y no se suben al repositorio por defecto.
