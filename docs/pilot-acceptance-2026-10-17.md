# Aceptación del piloto tras las correcciones — 17 de octubre de 2026

**Aprobado para una demostración local asistida, con datos ficticios y la práctica incluida.** Los cinco problemas de la revisión anterior se corrigieron y se repitió el recorrido de reclutador y candidato. No se contrató ni publicó ningún servicio.

No equivale a habilitar selección de personal real: el contenido es de práctica, no una medición validada de aptitud. El despliegue sigue accesible únicamente desde este equipo.

## Correcciones y resultados

| Problema anterior | Cambio | Verificación final |
|---|---|---|
| Modificación después de entregar | Respuesta guardada y puntuada antes de confirmar recepción; escritura y cierre usan el mismo bloqueo transaccional de PostgreSQL. Los completados rechazan nuevas respuestas y no recalculan puntuación ni fecha. Trabajos antiguos tampoco escriben sobre completados. | API 409 al intentar cambiar; resultado y fecha idénticos tras reintento y trabajo antiguo; recarga visual permanece en Examen Entregado. Carrera entre respuesta y cierre serializada. |
| Entrega con omisiones | El cliente dirige a la pregunta faltante y el servidor también rechaza la entrega incompleta. No se marca enviado ni se muestra éxito. | Aviso visible, candidato puede completar la omitida y entregar. El caso API queda IN_PROGRESS antes de completar; luego COMPLETED. Respuestas vacías rechazadas con 400. |
| Recuperación y temporizador | Se restaura desde respuestas del servidor y cola local del mismo intento; lecturas privadas sin caché y con identificador nuevo por solicitud. Tiempo calculado desde inicio y duración del servidor, sin reiniciarlo en cada carga. | La selección 12 y la segunda respuesta reaparecen tras recargar, sin pedir consentimiento otra vez; reloj pasó de 14:58 a aproximadamente 14:00 conservando tiempo transcurrido. Fecha límite idéntica en consultas API. |
| Escala equivocada en listado | Se muestran puntos brutos y un estado de avance separado. Fechas ISO en API y formato local en interfaz. | Panel 3 puntos y reporte 3 puntos; caso cero muestra 0 puntos. El 100% del reporte está identificado como porcentaje del rango, no percentil. |
| Acceso y promesas del reclutador | Login según permisos, consola de candidatos, organización de sesión, búsqueda/actualización, navegación y cierre de sesión. Se retiraron filtros de fraude y promesas de proctoring/psicometría del recorrido. Sesiones de candidato por intento, separadas de staff. | Reclutador limitado aterriza en su consola; invita, busca y lee reporte. Staff sigue autenticado mientras candidato responde en otra pestaña del mismo origen. Tras logout no reaparecen candidatos. Recursos administrativos devuelven 403. |

El vencimiento con preguntas pendientes se registra como EXPIRED y conserva respuestas sin emitir puntuación parcial. Se añadió y aplicó `20261017000000_pilot_expired_attempts`, la migración número 12. Backend y job de migración comparten imagen para que las actualizaciones incluyan el SQL nuevo.

## Recorrido visual ejecutado

Cuenta ficticia con cuatro permisos: `invitations.create`, `invitations.read`, `attempts.read` y `reports.read`. Esa cuenta se desactiva y sus sesiones se revocan al terminar.

1. Login por formulario → consola de candidatos.
2. Invitación por formulario a Demo Cliente Verificada, `demo-cliente-verificada@example.test` → enlace de acceso.
3. Candidato abre enlace → confirma evaluación → acepta aviso del piloto.
4. Selecciona 12 y Compararlo con la fuente → recarga → ambas selecciones restauradas; tiempo transcurrido conservado.
5. Intenta entregar dejando la tercera en blanco → aviso y pregunta recuperable.
6. Contesta 10:30 → entrega confirmada → encuesta ficticia NPS 9 y comentario guardados.
7. Recarga después de entregar → pantalla cerrada, sin preguntas editables ni temporizador en ejecución.
8. Reclutador conserva su sesión → actualiza/busca → panel y reporte coinciden en 3 puntos.
9. Candidato sale y no puede volver a sus preguntas; staff cierra sesión desde el reporte y al volver a la consola no recibe datos privados.

Intento visible de referencia: `1b65c712-c110-4524-badb-ea8411793746`. Para una demo limpia, buscar el correo anterior; el resto del listado contiene los casos ficticios de QA conservados como evidencia.

La interfaz se verificó en el navegador integrado, incluyendo disposición móvil y ausencia de desbordamiento horizontal en los anchos efectivos observados alrededor de 390 px. El control de tamaño del navegador no aplicó de forma consistente el ancho de escritorio solicitado; no se presenta eso como una comprobación independiente a 1440 px. No se probaron teléfonos físicos ni todas las variantes de Safari/Android.

El certificado local fue rechazado por el navegador integrado. La prueba visual utilizó una dirección temporal solo en loopback que verificaba el TLS ascendente con la CA local, sin modificar la confianza del equipo. Las regresiones HTTP sí se ejecutaron directamente por HTTPS con esa CA. No se ha validado un dominio público.

## Comprobaciones técnicas finales

- Backend: 37 suites, **169 pruebas** aprobadas.
- Integración ligera: **4 pruebas** aprobadas.
- Frontend: **4 pruebas** de cliente API y política de cola aprobadas, incluida separación de credenciales y lecturas nuevas.
- Regresión con servidor, PostgreSQL y Redis reales: **7 grupos** aprobados, cinco candidatos nuevos por ejecución. Incluye permisos, recuperación/fecha límite, cierre estable, trabajo antiguo, omisión, vacío, cero/máximo, carrera de respuesta/cierre, vencimiento y logout.
- Imágenes de producción del frontend y backend construidas y ejecutándose. Lint sin errores; persisten advertencias previas de mantenimiento.
- Migración de vencimiento aplicada satisfactoriamente. No se borraron volúmenes ni datos anteriores.

La suite completa histórica de Playwright no se volvió a ejecutar en esta ronda. El recorrido visual descrito sí se realizó mediante controles reales de la interfaz; no se sustituyó por llamadas API. Las regresiones HTTP complementan esa prueba.

Evidencias en `output/pilot-qa-fixed/`: `api-regression.json`, capturas de recuperación, omisión, entrega, cierre y reporte. Los archivos cuyo nombre incluye escritorio conservan una captura de la misma sesión; no acreditan por sí solos un ancho de 1440 px. Los informes `pilot-qa-2026-10-17.md` y `pilot-verification.md` son históricos; este documento describe el estado posterior.

## Repetir las regresiones técnicas

Con el piloto local ya saludable, desde la raíz:

```sh
node scripts/prepare-pilot-qa.cjs
node scripts/verify-pilot.mjs
node scripts/prepare-pilot-qa.cjs --cleanup
```

El preparador guarda credenciales aleatorias únicamente en `/private/tmp/integrity-qa-recruiter.json`, con modo 0600, y copia solo la CA pública local. El verificador crea datos ficticios; adelanta el inicio de uno de sus propios intentos para probar vencimiento y ejecuta un trabajo antiguo contra otro de sus intentos completados. No usar contra una instalación con personas reales. Esperar al menos un minuto entre ejecuciones: los límites de acceso siguen activos y no se eluden.

El limpiador desactiva exclusivamente la cuenta temporal ficticia y revoca sus sesiones; conserva candidatos e intentos para revisar resultados. No deja contraseñas ni tokens en el informe.

## Alcance de la demostración

Puede enseñarse ahora invitación → práctica → recuperación → entrega → reporte descriptivo. El valor que se demuestra es el funcionamiento de la plataforma. No presentar esta práctica como detector de honestidad, predictor de desempeño o instrumento validado.

Para acceso remoto y candidatos reales siguen pendientes decisiones de privacidad, conservación/borrado, responsable/contacto, contenido autorizado, un dominio con HTTPS público y restauración integral en otra instalación. Son requisitos de la siguiente fase; no se ha contratado infraestructura para cubrirlos. Los cinco bloqueos funcionales de esta revisión están corregidos dentro del alcance local verificado.
