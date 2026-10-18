import { PrismaClient } from '@prisma/client';
import { createHash, pbkdf2Sync, randomBytes } from 'crypto';
import {
  INTEGRITY_LABORAL_ASSESSMENT_CODE,
  INTEGRITY_LABORAL_DIMENSIONS,
  INTEGRITY_LABORAL_ITEMS,
  INTEGRITY_LABORAL_LIKERT_OPTIONS,
  INTEGRITY_LABORAL_MODEL,
  INTEGRITY_LABORAL_SCORING_REVISION,
  likertWeights,
} from '../src/modules/evaluations/integrity-laboral/integrity-laboral.definition';

const prisma = new PrismaClient();

function hashPassword(password: string): string {
  const iterations = 310000;
  const salt = randomBytes(16).toString('base64url');
  const hash = pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('base64url');
  return `pbkdf2$${iterations}$${salt}$${hash}`;
}


function hashPayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function taxonomyCode(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
    .slice(0, 80);
}

async function ensureTaxonomy(organizationId: string) {
  const category = await (prisma as any).psychometricCategory.upsert({
    where: { organizationId_code: { organizationId, code: 'INTEGRIDAD_LABORAL' } },
    update: {
      name: 'Integridad Laboral',
      description: 'Reactivos experimentales de integridad laboral basados en Honestidad-Humildad.',
    },
    create: {
      organizationId,
      code: 'INTEGRIDAD_LABORAL',
      name: 'Integridad Laboral',
      description: 'Reactivos experimentales de integridad laboral basados en Honestidad-Humildad.',
    },
  });

  const competencies = new Map<string, any>();
  for (const dimension of INTEGRITY_LABORAL_DIMENSIONS) {
    const competency = await (prisma as any).competency.upsert({
      where: { organizationId_code: { organizationId, code: dimension.key } },
      update: { name: dimension.name, description: dimension.description },
      create: { organizationId, code: dimension.key, name: dimension.name, description: dimension.description },
    });
    competencies.set(dimension.key, competency);
  }

  const scale = await (prisma as any).psychometricScale.upsert({
    where: { organizationId_code: { organizationId, code: 'HONESTIDAD_HUMILDAD' } },
    update: {
      name: 'Honestidad-Humildad',
      description: 'Factor H del modelo referente teórico HEXACO de Lee & Ashton; instrumento propio no validado.',
    },
    create: {
      organizationId,
      code: 'HONESTIDAD_HUMILDAD',
      name: 'Honestidad-Humildad',
      description: 'Factor H del modelo referente teórico HEXACO de Lee & Ashton; instrumento propio no validado.',
    },
  });

  const subscales = new Map<string, any>();
  for (const dimension of INTEGRITY_LABORAL_DIMENSIONS) {
    const subscale = await (prisma as any).psychometricSubscale.upsert({
      where: { scaleId_code: { scaleId: scale.id, code: dimension.key } },
      update: { name: dimension.name, description: dimension.description },
      create: { scaleId: scale.id, code: dimension.key, name: dimension.name, description: dimension.description },
    });
    subscales.set(dimension.key, subscale);
  }

  return { category, competencies, scale, subscales };
}

async function ensureOfficialIntegrityLaboralAssessment(organizationId: string, adminId: string) {
  const taxonomy = await ensureTaxonomy(organizationId);
  const assessment = await (prisma as any).assessment.upsert({
    where: { organizationId_code: { organizationId, code: INTEGRITY_LABORAL_ASSESSMENT_CODE } },
    update: {
      name: 'Evaluación de Integridad Laboral',
      description: 'Evaluación experimental basada en el factor Honestidad-Humildad (H) del modelo referente teórico HEXACO de Lee & Ashton; instrumento propio no validado.',
      status: 'PUBLISHED',
      createdByUserId: adminId,
    },
    create: {
      organizationId,
      code: INTEGRITY_LABORAL_ASSESSMENT_CODE,
      name: 'Evaluación de Integridad Laboral',
      description: 'Evaluación experimental basada en el factor Honestidad-Humildad (H) del modelo referente teórico HEXACO de Lee & Ashton; instrumento propio no validado.',
      status: 'PUBLISHED',
      createdByUserId: adminId,
    },
  });

  const blueprintJson = {
    source: 'experimental_seed',
    scoringRevision: INTEGRITY_LABORAL_SCORING_REVISION,
    validationStatus: 'EXPERIMENTAL',
    assessmentCode: INTEGRITY_LABORAL_ASSESSMENT_CODE,
    title: 'Evaluación de Integridad Laboral',
    scientificModel: INTEGRITY_LABORAL_MODEL,
    dimensions: INTEGRITY_LABORAL_DIMENSIONS,
    responseType: 'LIKERT_5',
    randomizeItems: true,
    scoring: 'sum_by_dimension_and_global_without_norms',
  };

  const assessmentVersion = await (prisma as any).assessmentVersion.upsert({
    where: { assessmentId_version: { assessmentId: assessment.id, version: INTEGRITY_LABORAL_SCORING_REVISION } },
    update: {},
    create: {
      assessmentId: assessment.id,
      organizationId,
      version: INTEGRITY_LABORAL_SCORING_REVISION,
      status: 'PUBLISHED',
      title: 'Evaluación de Integridad Laboral',
      description: 'Primera versión experimental de la evaluación de integridad laboral.',
      blueprintJson,
      contentHash: hashPayload(blueprintJson),
      publishedAt: new Date(),
      createdByUserId: adminId,
      approvedByUserId: adminId,
    },
  });

  for (const itemDefinition of INTEGRITY_LABORAL_ITEMS) {
    const dimension = INTEGRITY_LABORAL_DIMENSIONS.find((entry) => entry.key === itemDefinition.dimensionKey)!;
    const itemCode = `EIL_${String(itemDefinition.order).padStart(2, '0')}_${taxonomyCode(dimension.name)}`;
    const item = await (prisma as any).item.upsert({
      where: { organizationId_itemCode: { organizationId, itemCode } },
      update: {
        status: 'ACTIVE',
        categoryId: taxonomy.category.id,
        competencyId: taxonomy.competencies.get(itemDefinition.dimensionKey)?.id || null,
        scaleId: taxonomy.scale.id,
        subscaleId: taxonomy.subscales.get(itemDefinition.dimensionKey)?.id || null,
        createdByUserId: adminId,
      },
      create: {
        organizationId,
        itemCode,
        status: 'ACTIVE',
        categoryId: taxonomy.category.id,
        competencyId: taxonomy.competencies.get(itemDefinition.dimensionKey)?.id || null,
        scaleId: taxonomy.scale.id,
        subscaleId: taxonomy.subscales.get(itemDefinition.dimensionKey)?.id || null,
        createdByUserId: adminId,
      },
    });

    const stemJson = {
      type: 'LIKERT',
      defaultPoints: 1,
      content: {
        assessmentCode: INTEGRITY_LABORAL_ASSESSMENT_CODE,
        dimension: dimension.name,
        dimensionKey: itemDefinition.dimensionKey,
        text: itemDefinition.text,
        prompt: itemDefinition.text,
        questionType: 'LIKERT',
        responseScale: INTEGRITY_LABORAL_LIKERT_OPTIONS,
        internalOrder: itemDefinition.order,
        reverseScored: itemDefinition.reverseScored,
        instructions: 'Indica qué tan de acuerdo estás con cada afirmación.',
      },
    };
    const scoringKeyJson = {
      scoring: 'LIKERT_SUM',
      scoringRevision: INTEGRITY_LABORAL_SCORING_REVISION,
      assessmentCode: INTEGRITY_LABORAL_ASSESSMENT_CODE,
      dimensionKey: itemDefinition.dimensionKey,
      dimension: dimension.name,
      reverseScored: itemDefinition.reverseScored,
      weights: likertWeights(itemDefinition.reverseScored),
    };

    const itemVersion = await (prisma as any).itemVersion.upsert({
      where: { itemId_version: { itemId: item.id, version: INTEGRITY_LABORAL_SCORING_REVISION } },
      update: {},
      create: {
        itemId: item.id,
        version: INTEGRITY_LABORAL_SCORING_REVISION,
        status: 'PUBLISHED',
        language: 'es',
        stemJson,
        scoringKeyJson,
        tags: { assessmentCode: INTEGRITY_LABORAL_ASSESSMENT_CODE, dimension: dimension.name, experimental: true },
        difficulty: null,
        discrimination: null,
        expectedTimeSeconds: 45,
        contentHash: hashPayload({ stemJson, scoringKeyJson }),
        publishedAt: new Date(),
        createdByUserId: adminId,
        approvedByUserId: adminId,
      },
    });

    await (prisma as any).assessmentVersionItem.upsert({
      where: {
        assessmentVersionId_itemVersionId: {
          assessmentVersionId: assessmentVersion.id,
          itemVersionId: itemVersion.id,
        },
      },
      update: { sortOrder: itemDefinition.order - 1, weight: 1, role: 'SCORED' },
      create: {
        assessmentVersionId: assessmentVersion.id,
        itemVersionId: itemVersion.id,
        sortOrder: itemDefinition.order - 1,
        weight: 1,
        role: 'SCORED',
      },
    });
  }

  await (prisma as any).exam.upsert({
    where: { id: assessment.id },
    update: {
      organizationId,
      title: 'Evaluación de Integridad Laboral',
      description: 'Evaluación experimental de integridad laboral basada en Honestidad-Humildad (HEXACO).',
      durationMinutes: 20,
      isPublished: true,
      createdBy: adminId,
    },
    create: {
      id: assessment.id,
      organizationId,
      title: 'Evaluación de Integridad Laboral',
      description: 'Evaluación experimental de integridad laboral basada en Honestidad-Humildad (HEXACO).',
      durationMinutes: 20,
      isPublished: true,
      createdBy: adminId,
    },
  });

  const scoringModel = await (prisma as any).scoringModel.upsert({
    where: { organizationId_code: { organizationId, code: `${INTEGRITY_LABORAL_ASSESSMENT_CODE}_SCORING_${INTEGRITY_LABORAL_SCORING_REVISION}` } },
    update: {
      assessmentVersionId: assessmentVersion.id,
      name: 'Scoring sumatorio Integridad Laboral',
      modelType: 'LIKERT_SUM_BY_DIMENSION',
    },
    create: {
      organizationId,
      assessmentVersionId: assessmentVersion.id,
      code: `${INTEGRITY_LABORAL_ASSESSMENT_CODE}_SCORING_${INTEGRITY_LABORAL_SCORING_REVISION}`,
      name: 'Scoring sumatorio Integridad Laboral',
      modelType: 'LIKERT_SUM_BY_DIMENSION',
    },
  });

  await (prisma as any).scoringModelVersion.upsert({
    where: { scoringModelId_version: { scoringModelId: scoringModel.id, version: INTEGRITY_LABORAL_SCORING_REVISION } },
    update: {},
    create: {
      scoringModelId: scoringModel.id,
      version: INTEGRITY_LABORAL_SCORING_REVISION,
      status: 'PUBLISHED',
      algorithmKey: 'integrity-laboral-likert-sum',
      parametersJson: { usesNorms: false, usesPercentiles: false, dimensions: INTEGRITY_LABORAL_DIMENSIONS },
      contentHash: hashPayload({ scoring: INTEGRITY_LABORAL_ASSESSMENT_CODE, version: INTEGRITY_LABORAL_SCORING_REVISION }),
      effectiveFrom: new Date(),
      createdByUserId: adminId,
      approvedByUserId: adminId,
    },
  });

  const reportTemplate = await (prisma as any).reportTemplate.upsert({
    where: { organizationId_code: { organizationId, code: `${INTEGRITY_LABORAL_ASSESSMENT_CODE}_REPORT_${INTEGRITY_LABORAL_SCORING_REVISION}` } },
    update: {
      assessmentVersionId: assessmentVersion.id,
      name: 'Reporte Integridad Laboral',
    },
    create: {
      organizationId,
      assessmentVersionId: assessmentVersion.id,
      code: `${INTEGRITY_LABORAL_ASSESSMENT_CODE}_REPORT_${INTEGRITY_LABORAL_SCORING_REVISION}`,
      name: 'Reporte Integridad Laboral',
    },
  });

  await (prisma as any).reportTemplateVersion.upsert({
    where: { reportTemplateId_version: { reportTemplateId: reportTemplate.id, version: INTEGRITY_LABORAL_SCORING_REVISION } },
    update: {},
    create: {
      reportTemplateId: reportTemplate.id,
      version: INTEGRITY_LABORAL_SCORING_REVISION,
      status: 'PUBLISHED',
      templateJson: { sections: ['integrity_laboral_profile'], usesNorms: false, usesPercentiles: false },
      contentHash: hashPayload({ report: INTEGRITY_LABORAL_ASSESSMENT_CODE, version: INTEGRITY_LABORAL_SCORING_REVISION }),
      effectiveFrom: new Date(),
      createdByUserId: adminId,
      approvedByUserId: adminId,
    },
  });

  return { assessment, assessmentVersion };
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Seed demo prohibido en producción. Usa npm run bootstrap:pilot.');
  const organization = await prisma.organization.upsert({
    where: { slug: 'integrity-demo' },
    update: {},
    create: {
      name: 'Integrity Demo',
      slug: 'integrity-demo',
    },
  });

  const permissions = await Promise.all(
    [
      'organization.manage',
      'users.manage',
      'roles.manage',
      'invitations.create',
      'invitations.read',
      'attempts.read',
      'attempts.update',
      'reports.read',
      'psychometrics.read',
      'psychometrics.write',
      'audit.read',
      'admin.manage',
      'exam:create',
      'exam:attempt',
    ].map((code) =>
      prisma.permission.upsert({
        where: { code },
        update: {},
        create: {
          code,
          description: `Permiso demo: ${code}`,
        },
      }),
    ),
  );

  const adminRole = await prisma.role.upsert({
    where: { name: 'admin' },
    update: {},
    create: {
      name: 'admin',
      description: 'Administrador demo con acceso completo.',
    },
  });

  const recruiterRole = await prisma.role.upsert({
    where: { name: 'recruiter' },
    update: {},
    create: {
      name: 'recruiter',
      description: 'Reclutador demo para invitaciones y reportes.',
    },
  });

  const psychologistRole = await prisma.role.upsert({
    where: { name: 'psychologist' },
    update: {},
    create: {
      name: 'psychologist',
      description: 'Psicóloga demo para consulta psicométrica.',
    },
  });

  const evaluatorRole = await prisma.role.upsert({
    where: { name: 'evaluator' },
    update: {},
    create: {
      name: 'evaluator',
      description: 'Evaluador demo para revisión de resultados.',
    },
  });

  for (const permission of permissions) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: adminRole.id,
          permissionId: permission.id,
        },
      },
      update: {},
      create: {
        roleId: adminRole.id,
        permissionId: permission.id,
      },
    });
  }

  for (const code of ['invitations.create', 'invitations.read', 'attempts.read', 'reports.read']) {
    const permission = permissions.find((p) => p.code === code)!;
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: recruiterRole.id,
          permissionId: permission.id,
        },
      },
      update: {},
      create: {
        roleId: recruiterRole.id,
        permissionId: permission.id,
      },
    });
  }

  for (const role of [psychologistRole, evaluatorRole]) {
    for (const code of ['attempts.read', 'reports.read', 'psychometrics.read']) {
      const permission = permissions.find((p) => p.code === code)!;
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: role.id,
            permissionId: permission.id,
          },
        },
        update: {},
        create: {
          roleId: role.id,
          permissionId: permission.id,
        },
      });
    }
  }

  const demoPassword = process.env.DEMO_STAFF_PASSWORD || 'IntegrityDemo123!';
  const demoPasswordHash = hashPassword(demoPassword);

  const admin = await prisma.user.upsert({
    where: {
      unique_email_per_org: {
        organizationId: organization.id,
        email: 'admin@integrity.demo',
      },
    },
    update: {
      firstName: 'Admin',
      lastName: 'Demo',
      isActive: true,
      passwordHash: demoPasswordHash,
    },
    create: {
      organizationId: organization.id,
      email: 'admin@integrity.demo',
      passwordHash: demoPasswordHash,
      firstName: 'Admin',
      lastName: 'Demo',
    },
  });

  const recruiter = await prisma.user.upsert({
    where: {
      unique_email_per_org: {
        organizationId: organization.id,
        email: 'recruiter@integrity.demo',
      },
    },
    update: {
      firstName: 'Recruiter',
      lastName: 'Demo',
      isActive: true,
      passwordHash: demoPasswordHash,
    },
    create: {
      organizationId: organization.id,
      email: 'recruiter@integrity.demo',
      passwordHash: demoPasswordHash,
      firstName: 'Recruiter',
      lastName: 'Demo',
    },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: admin.id,
        roleId: adminRole.id,
      },
    },
    update: {},
    create: {
      userId: admin.id,
      roleId: adminRole.id,
    },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: recruiter.id,
        roleId: recruiterRole.id,
      },
    },
    update: {},
    create: {
      userId: recruiter.id,
      roleId: recruiterRole.id,
    },
  });

  const questionBank = await prisma.questionBank.upsert({
    where: { id: '00000000-0000-7000-8000-000000000101' },
    update: {
      organizationId: organization.id,
      name: 'Banco Demo Integrity Test',
      createdBy: admin.id,
    },
    create: {
      id: '00000000-0000-7000-8000-000000000101',
      organizationId: organization.id,
      name: 'Banco Demo Integrity Test',
      description: 'Reactivos mínimos para probar el flujo real candidato-reclutador.',
      createdBy: admin.id,
    },
  });

  const demoQuestions = [
    {
      id: '00000000-0000-7000-8000-000000000201',
      type: 'MULTIPLE_CHOICE',
      defaultPoints: 2,
      contentJsonb: {
        dimension: 'INTEGRIDAD',
        text: 'Encuentras un sobrante de caja al finalizar tu turno. ¿Qué haces?',
        options: [
          { id: 'a', text: 'Lo tomo porque nadie lo notará.' },
          { id: 'b', text: 'Lo reporto y documento el cierre.' },
          { id: 'c', text: 'Lo dejo sin avisar.' },
          { id: 'd', text: 'Lo comparto con el equipo.' },
        ],
        correctConfig: { correctOptionId: 'b' },
      },
    },
    {
      id: '00000000-0000-7000-8000-000000000202',
      type: 'LIKERT',
      defaultPoints: 1,
      contentJsonb: {
        dimension: 'PERSONALIDAD',
        text: 'Cumplo los procedimientos incluso cuando nadie supervisa.',
        scale: {
          min: 1,
          max: 5,
          labels: {
            '1': 'Totalmente en desacuerdo',
            '5': 'Totalmente de acuerdo',
          },
        },
        correctConfig: {
          weights: { '1': 0, '2': 0.25, '3': 0.5, '4': 0.75, '5': 1 },
        },
      },
    },
    {
      id: '00000000-0000-7000-8000-000000000203',
      type: 'MULTIPLE_CHOICE',
      defaultPoints: 1,
      contentJsonb: {
        dimension: 'COGNITIVO',
        text: '¿Qué número continúa la serie 2, 4, 8, 16?',
        options: [
          { id: 'a', text: '20' },
          { id: 'b', text: '24' },
          { id: 'c', text: '32' },
          { id: 'd', text: '36' },
        ],
        correctConfig: { correctOptionId: 'c' },
      },
    },
  ];

  for (const question of demoQuestions) {
    await prisma.question.upsert({
      where: { id: question.id },
      update: {
        questionBankId: questionBank.id,
        type: question.type,
        contentJsonb: question.contentJsonb,
        defaultPoints: question.defaultPoints,
      },
      create: {
        id: question.id,
        questionBankId: questionBank.id,
        type: question.type,
        contentJsonb: question.contentJsonb,
        defaultPoints: question.defaultPoints,
      },
    });
  }

  const exam = await prisma.exam.upsert({
    where: { id: '00000000-0000-7000-8000-000000000301' },
    update: {
      organizationId: organization.id,
      title: 'Evaluación Demo Integrity Test',
      isPublished: true,
      createdBy: admin.id,
      durationMinutes: 30,
    },
    create: {
      id: '00000000-0000-7000-8000-000000000301',
      organizationId: organization.id,
      title: 'Evaluación Demo Integrity Test',
      description: 'Examen mínimo publicado para pruebas end-to-end.',
      durationMinutes: 30,
      isPublished: true,
      createdBy: admin.id,
    },
  });

  for (const [index, question] of demoQuestions.entries()) {
    await prisma.examQuestion.upsert({
      where: {
        unique_question_per_exam: {
          examId: exam.id,
          questionId: question.id,
        },
      },
      update: {
        points: question.defaultPoints,
        sortOrder: index,
      },
      create: {
        examId: exam.id,
        questionId: question.id,
        points: question.defaultPoints,
        sortOrder: index,
      },
    });
  }

  await prisma.perfilPuesto.upsert({
    where: { id: '00000000-0000-7000-8000-000000000401' },
    update: {
      organizationId: organization.id,
    },
    create: {
      id: '00000000-0000-7000-8000-000000000401',
      organizationId: organization.id,
      nombre: 'Perfil Demo General',
      wIntegridad: 0.4,
      wPersonalidad: 0.2,
      wCognitivo: 0.2,
      wCompetencias: 0.2,
    },
  });


  const integrityLaboral = await ensureOfficialIntegrityLaboralAssessment(organization.id, admin.id);

  console.log('Seed demo completado.');
  console.log('Organizacion:', organization.slug);
  console.log('Admin demo:', admin.email);
  console.log('Recruiter demo:', recruiter.email);
  console.log('Examen demo:', exam.id);
  console.log('Evaluación oficial:', integrityLaboral.assessment.id);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
