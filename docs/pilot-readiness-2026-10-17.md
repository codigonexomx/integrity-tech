# Preparación del piloto para publicar

Verificación del sábado 17 de octubre de 2026, zona de referencia Ciudad de México. La preparación local está comprobada; no se compró alojamiento, no se cambió DNS, no se desplegó a producción y no se enviaron correos ni invitaciones reales. El lunes previsto para contratar es el 19 de octubre de 2026, sujeto a la decisión del usuario y al importe final del proveedor.

## Trabajo preparado

- Correcciones del recorrido de reclutador y candidato, estados y puntuaciones; migración de vencimiento y contenido de práctica separado de los instrumentos experimentales.
- Arquitectura de una máquina: gateway HTTPS, frontend, backend, PostgreSQL, Redis y archivos privados persistentes. No requiere comprar dominio ni servicios administrados separados para la base o Redis.
- Generación de secretos propios sin sobrescritura, configuración comprobable sin mostrar credenciales y rechazo de un despliegue de Vercel sin dirección de backend.
- Respaldo cifrado con pausa consistente de escrituras y Redis; restauración completa en destino nuevo, con rechazo de destinos existentes y archivos manipulados.
- Plantillas de respaldo programado, guía de instalación, aceptación remota, recuperación y operación. Las plantillas de servidor todavía no están instaladas ni activadas.
- Propuestas para D&C, Hunters y Prohiring, acuerdo borrador y ejemplo ficticio con membrete de Código Nexo. Copias finales y borradores de correo conservados localmente, fuera del repositorio público y sin enviar.

## Resultado de las comprobaciones

| Comprobación | Resultado |
|---|---|
| Backend | 37 suites y 174 pruebas aprobadas |
| Integración ligera | 4 pruebas aprobadas |
| Cliente API, cola y configuración | 7 pruebas aprobadas |
| Navegador con servicios aislados | 12 pruebas aprobadas, incluido el flujo de diez candidatos simultáneos |
| Migraciones | Las 12 migraciones aplicadas en una base aislada vacía |
| Compilación | Backend compilado e imágenes de frontend, backend y gateway construidas |
| Lint | Sin errores; quedan advertencias de mantenimiento existentes |
| Dependencias de producción | Cero vulnerabilidades reportadas por npm audit en backend y frontend al corte |
| Configuración propuesta | Diez comprobaciones aprobadas; no acredita DNS ni servicios remotos |
| Recuperación integral | Reporte y fecha recuperados, archivo privado idéntico, Redis persistido y acceso HTTPS local verificado |
| Salvaguardas de recuperación | Rechazo de respaldo manipulado y de destino con recursos existentes |
| Secretos | Archivos de entorno, respaldos, capturas de cuentas e instantáneas excluidos; revisión de coincidencias antes de subir |
| Materiales comerciales | Diez copias PDF/Word cotejadas por SHA-256 contra los documentos finales revisados |

El ensayo de recuperación creó una fuente y un destino ficticios y los eliminó al terminar. No restauró encima del piloto principal. Ese piloto se conservó activo y saludable. Los tiempos observados son de una instalación local y no establecen un RTO contractual.

Evidencias sin credenciales: [recuperación integral](evidence/pilot-recovery-2026-10-17.json) y [configuración propuesta](evidence/pilot-configuration-2026-10-17.json). Las capturas, registros completos y credenciales temporales no forman parte de la subida pública.

## Qué queda para el alojamiento definitivo

1. Elegir y autorizar el servidor, región, impuestos y presupuesto; confirmar acceso al DNS de `codigonexo.mx`.
2. Desplegar el SHA revisado con una base nueva y secretos propios. Vincular `integrity.codigonexo.mx` y comprobar certificado y acceso externo.
3. Repetir aceptación y recuperación en ese servidor, activar y supervisar respaldos y su copia externa autorizada.
4. Completar identidad legal, roles de datos, conservación, apoyo, facturación y condiciones de una campaña real antes de su primer pago y activación.

La versión antigua de Vercel no se sustituye al subir la rama `codex/pilot-ready`. No fusionar a main sin revisar su despliegue automático. La automatización de GitHub queda definida para verificar compilación y recuperación; su estado remoto debe consultarse después de subir.
