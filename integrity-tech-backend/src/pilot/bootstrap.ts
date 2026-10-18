import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import { PasswordService } from '../modules/iam/services/password.service';
import { PERMISSIONS } from '../modules/iam/permissions';

export async function bootstrapPilot(prisma: PrismaClient, env: NodeJS.ProcessEnv = process.env) {
  const email = (env.PILOT_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = env.PILOT_ADMIN_PASSWORD || '';
  const slug = env.PILOT_ORGANIZATION || 'piloto';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 20 || /demo|change-me/i.test(password)) {
    throw new Error('Configura PILOT_ADMIN_EMAIL y PILOT_ADMIN_PASSWORD única de al menos 20 caracteres.');
  }
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(slug)) throw new Error('PILOT_ORGANIZATION debe ser un slug de 2 a 64 caracteres.');
  return prisma.$transaction(async tx => {
    const org = await tx.organization.upsert({ where: { slug }, update: {}, create: { slug, name: slug } });
    const existing = await tx.user.findUnique({ where: { unique_email_per_org: { organizationId: org.id, email } } });
    // Re-running bootstrap must never reset a password or grant an existing account new privileges.
    if (existing) return { organization: org.slug, initialized: false };
    const admin = await tx.user.create({ data: {
      organizationId: org.id, email, passwordHash: new PasswordService().hashPassword(password), firstName: 'Administrador', lastName: 'Piloto',
    } });
    const role = await tx.role.upsert({ where: { name: 'admin' }, update: {}, create: { name: 'admin', description: 'Administración' } });
    for (const code of Object.values(PERMISSIONS)) {
      const permission = await tx.permission.upsert({ where: { code }, update: {}, create: { code } });
      await tx.rolePermission.upsert({ where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } }, update: {}, create: { roleId: role.id, permissionId: permission.id } });
    }
    await tx.userRole.create({ data: { userId: admin.id, roleId: role.id } });
    const existingAssessment = await tx.assessment.findUnique({ where: { organizationId_code: { organizationId: org.id, code: 'PILOTO_PRACTICA' } } });
    if (!existingAssessment) {
      const assessment = await tx.assessment.create({ data: { organizationId: org.id, code: 'PILOTO_PRACTICA', name: 'Práctica del proceso de evaluación', status: 'PUBLISHED', createdByUserId: admin.id } });
      const blueprintJson = { purpose: 'Práctica técnica con datos ficticios. No mide aptitud laboral.', validationStatus: 'PRACTICE_ONLY' };
      const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
      const version = await tx.assessmentVersion.create({ data: {
        assessmentId: assessment.id, organizationId: org.id, version: '1.0.0', status: 'PUBLISHED', title: assessment.name,
        blueprintJson, contentHash: hash(blueprintJson), publishedAt: new Date(), createdByUserId: admin.id, approvedByUserId: admin.id,
      } });
      const questions = [
        { text: 'Práctica: un pedido tiene 3 cajas con 4 unidades cada una. ¿Cuántas unidades hay?', options: [{ id: 'a', text: '7' }, { id: 'b', text: '12' }, { id: 'c', text: '16' }], correctOptionId: 'b' },
        { text: 'Práctica: ¿qué acción permite revisar un dato antes de enviarlo?', options: [{ id: 'a', text: 'Compararlo con la fuente' }, { id: 'b', text: 'Adivinarlo' }, { id: 'c', text: 'Omitir la revisión' }], correctOptionId: 'a' },
        { text: 'Práctica: una reunión empieza a las 10:00 y dura 30 minutos. ¿Cuándo termina?', options: [{ id: 'a', text: '10:15' }, { id: 'b', text: '11:00' }, { id: 'c', text: '10:30' }], correctOptionId: 'c' },
      ];
      for (const [i, q] of questions.entries()) {
        const item = await tx.item.create({ data: { organizationId: org.id, itemCode: `PRACTICA_${i + 1}`, status: 'ACTIVE', createdByUserId: admin.id } });
        const stemJson = { type: 'MULTIPLE_CHOICE', defaultPoints: 1, content: { text: q.text, options: q.options, dimension: 'PRACTICA' } };
        const scoringKeyJson = { correctOptionId: q.correctOptionId };
        const iv = await tx.itemVersion.create({ data: { itemId: item.id, version: '1.0.0', status: 'PUBLISHED', stemJson, scoringKeyJson, contentHash: hash({ stemJson, scoringKeyJson }), publishedAt: new Date(), createdByUserId: admin.id, approvedByUserId: admin.id } });
        await tx.assessmentVersionItem.create({ data: { assessmentVersionId: version.id, itemVersionId: iv.id, sortOrder: i, weight: 1, role: 'SCORED' } });
      }
      await tx.exam.create({ data: { id: assessment.id, organizationId: org.id, title: assessment.name, description: blueprintJson.purpose, durationMinutes: 15, isPublished: true, createdBy: admin.id } });
    }
    return { organization: org.slug, initialized: true };
  }, { timeout: 30_000 });
}

if (require.main === module) {
  const prisma = new PrismaClient();
  bootstrapPilot(prisma)
    .then(result => console.log(JSON.stringify(result)))
    .catch(() => { console.error('No se pudo inicializar el piloto. Revisa variables y migraciones; no se imprimen credenciales.'); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
