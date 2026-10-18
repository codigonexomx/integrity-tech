# Verificación del piloto - 17 de octubre de 2026

> Evidencia anterior a la última corrección. Consultar [pilot-acceptance-2026-10-17.md](pilot-acceptance-2026-10-17.md) para el estado actual.

Resultado: piloto técnico local funcionando en **https://localhost:8443**, accesible solo desde esta computadora. No se contrataron servicios ni se publicó infraestructura externa. Seguir [pilot.md](pilot.md) para acceso, respaldo, detención y futura instalación en un servidor.

## Comprobaciones realizadas

| Comprobación | Resultado |
| --- | --- |
| Pruebas unitarias backend | 36 suites, 163 pruebas aprobadas |
| Integración ligera backend | 4 pruebas aprobadas |
| Pruebas frontend de API y cola local | 3 pruebas aprobadas |
| Playwright E2E | 12 pruebas aprobadas |
| Diez flujos simultáneos | Completaron invitación, consentimiento, respuestas, finalización y reporte sin publicar puntuaciones parciales |
| Migraciones desde base vacía | Las 11 migraciones se aplicaron correctamente en la base aislada |
| Compilación | Backend y frontend aprobados; imágenes Docker con Node 22 construidas |
| Dependencias productivas | `npm audit --omit=dev`: 0 vulnerabilidades reportadas en ambos proyectos al corte |
| Lint | Sin errores; permanecen avisos de mantenimiento y hooks |
| Bootstrap | Probado contra base real y dentro del backend productivo; repetición sin duplicar contenido ni cambiar credenciales |
| Navegador contra HTTPS real | Login, invitación, consentimiento, tres respuestas correctas y reporte de 3 puntos comprobados |
| Archivos privados | Acceso autenticado y clasificación probados en E2E |
| Aislamiento | Candidato sin acceso a datos staff; UUID de otra organización no expone intentos ni reportes |
| Sesiones | Refresh y revocación/logout comprobados |
| Funciones cerradas | Calibración y LTI sin rutas públicas; IGA devuelve indisponibilidad; métricas externas devuelven 404 |
| Resiliencia | Respuestas conservadas localmente ante fallo de red y respuesta HTTP 429 |
| Respaldo cifrado | PostgreSQL, archivos privados y Redis archivados con AES-256-GCM; verificación aprobada |
| Manipulación de respaldo | Una copia con tag alterado fue rechazada |
| Restauración de PostgreSQL del respaldo real | Descifrada y restaurada en base separada; se verificaron 1 usuario y 3 reactivos presentes al momento del respaldo |
| Salud posterior al respaldo | PostgreSQL, Redis, cola y almacenamiento reportaron `up` |
| Secretos | `.env.pilot` con modo 0600 e ignorado por Git; respaldos locales también ignorados |
| Diff | `git diff --check` sin errores |

Las pruebas de concurrencia se hicieron en la computadora local y no son una certificación de capacidad, disponibilidad o rendimiento para otra máquina. La restauración de los archivos privados y del estado de Redis en una instalación nueva todavía debe ensayarse: se verificaron su inclusión y autenticidad en el archivo, pero el ensayo de restauración ejecutado cubrió PostgreSQL.

## Correcciones de exactitud comprobadas

- El acuerdo con apropiarse de caja chica obtiene puntuación baja; el rechazo al fraude en gastos, puntuación alta.
- La revisión 1.1.0 mantiene separadas las versiones anteriores; las claves y modelos históricos no se recalculan en silencio.
- Los extremos de una escala Likert se normalizan a 0 y 100; el máximo se deriva de los reactivos de la versión, incluyendo versiones más cortas.
- No se completa un intento cuando falta una respuesta aceptada que sigue en cola.
- Los resultados antiguos de integridad se presentan como retirados, sin fortalezas o recomendaciones inferidas.
- La interfaz muestra sumas y porcentajes descriptivos, sin semáforo de contratación, afirmaciones de cadena de firmas o ausencia de fraude.

## Incidencias del entorno resueltas

Docker estaba detenido. Al iniciarlo reactivó contenedores antiguos de este mismo repositorio; se detuvieron sin borrar datos. Las pruebas utilizan servicios y puertos propios y no reutilizan servidores ajenos. Se corrigió la preparación de rate limiting para que cada archivo de pruebas limpie exclusivamente su prefijo de claves.

Algunos arranques quedaron bloqueados por el motor local en estado `Created`, antes de ejecutar la aplicación. Se reinició Docker, conservando los volúmenes y el respaldo, y posteriormente se comprobó el gateway HTTPS y el recorrido completo en navegador. El gateway incluye su configuración en la imagen para no depender de un montaje desde el disco externo.

## Límites que siguen vigentes

- El contenido de práctica solo prueba la plataforma. Corregir claves no valida científicamente un cuestionario. Los instrumentos experimentales no deben determinar contrataciones.
- El certificado de localhost necesita aceptación o confianza local en el navegador. No se modificó el almacén de certificados de macOS. Un dominio público requiere DNS y certificado del servidor, conforme a la guía.
- Una máquina sigue siendo un punto de falla. No hay SLA, monitoreo externo, retención automatizada ni programación de respaldo configurados.
- El respaldo está en el mismo equipo; copiarlo a otro medio y custodiar la clave por separado antes de guardar datos reales.
- Las sesiones mantienen tokens en localStorage. La CSP y el alcance sin scripts externos reducen superficie, pero no sustituyen una revisión de XSS ni una futura migración a cookies HttpOnly según el diseño de sesión.
- La ausencia de avisos en dependencias de producción no equivale a ausencia de vulnerabilidades. Las herramientas de desarrollo conservan avisos que deben revisarse por separado.
- No hay correo transaccional ni cobro automático: las invitaciones del piloto se comparten manualmente.

Estado final: aplicación, base, Redis y gateway locales activos; datos de prueba ficticios. Los servicios aislados de verificación pueden detenerse sin afectar el piloto.
