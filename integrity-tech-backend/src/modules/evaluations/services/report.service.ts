import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { AUDIT_ACTIONS, AuditRequestMetadata } from '../../audit/audit-event.types';
import { AuditService } from '../../audit/services/audit.service';
import { SessionUser } from '../../iam';
import { RecalcularIgaDto } from '../dto/evaluation-flow.dto';
import { ReportGenerated } from '../events/evaluation-domain.events';
import { ReportRepository } from '../repositories/report.repository';
import { IgaCalculatorService } from './iga-calculator.service';
import { ScientificTraceService } from '../../psychometric-governance/services/scientific-trace.service';
import { MetricsService } from '../../../shared/observability/metrics.service';
import { EvaluationBusinessRules } from './evaluation-business-rules';
import {
  INTEGRITY_LABORAL_ASSESSMENT_CODE,
  INTEGRITY_LABORAL_DIMENSIONS,
  INTEGRITY_LABORAL_SCORING_REVISION,
  INTEGRITY_LABORAL_NOTICE,
} from '../integrity-laboral/integrity-laboral.definition';

@Injectable()
export class ReportService {
  private readonly logger = new Logger(ReportService.name);

  constructor(
    private readonly reports: ReportRepository,
    private readonly igaCalculator: IgaCalculatorService,
    private readonly auditService: AuditService,
    private readonly scientificTrace: ScientificTraceService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  async getAttemptReport(attemptId: string, staffUser: SessionUser, metadata: AuditRequestMetadata = {}) {
    const organizationId = staffUser.organizationId;
    this.logger.log(`Generando reporte para el intento: ${attemptId}`);

    const att = await this.reports.findReportAttempt(attemptId, organizationId);
    if (!att) {
      throw new BadRequestException('Intento de examen no encontrado.');
    }

    const candidate = await this.reports.findUserInTenant(att.userId, organizationId);
    const exam = await this.reports.findExamInTenant(att.examId, organizationId);
    const templateVersion = await this.reports.findPublishedReportTemplateVersion(
      organizationId,
      (att as any).assessmentVersionId,
    );
    const governanceTrace = templateVersion
      ? (await this.scientificTrace.recordIssuedReport({
          organizationId,
          attemptId: att.id,
          reportTemplateVersionId: templateVersion.id,
          issuedByUserId: staffUser.userId,
        })).governanceTrace
      : await this.scientificTrace.buildAttemptTrace(organizationId, att.id);

    const dimensions = [];
    let integrityProfile = null;
    if (att.scoreDetails) {
      const details = att.scoreDetails as any;
      integrityProfile = this.buildIntegrityLaboralProfile(details);
      for (const [dimName, val] of Object.entries(details)) {
        if (dimName === 'integrityLaboral' || (integrityProfile && !integrityProfile.usable)) continue;
        const dimVal = val as any;
        dimensions.push({
          name: dimName,
          score: dimVal.percentage || 0,
          description: this.getDimensionDescription(dimName),
        });
      }
    }

    const logsMapped = att.logs.map((log) => ({
      id: log.id,
      eventType: log.eventType,
      riskLevel: log.riskLevel,
      timestamp: log.timestamp.toLocaleTimeString(),
      metadata: log.metadata || {},
      message: this.getLogMessage(log.eventType),
    }));

    void new ReportGenerated(att.id, att.organizationId);
    await this.auditService.record({
      organizationId,
      actorUserId: staffUser.userId,
      actorType: 'STAFF',
      action: AUDIT_ACTIONS.REPORT_ACCESSED,
      resourceType: 'ExamAttempt',
      resourceId: att.id,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
      metadata: {
        examId: att.examId,
        candidateUserId: att.userId,
        assessmentVersionId: (att as any).assessmentVersionId || null,
        reportTemplateVersionId: templateVersion?.id || null,
        governanceMode: (governanceTrace as any).mode,
      },
    });
    this.metrics?.recordDomainEvent('ReportGeneration', 'attempt_report', 'success');
    return {
      candidateName: candidate ? `${candidate.firstName} ${candidate.lastName}`.trim() : 'No disponible',
      email: candidate?.email || 'No disponible',
      assessmentTitle: exam?.title || 'No disponible',
      date: att.submittedAt ? att.submittedAt.toISOString() : att.startedAt.toISOString(),
      overallScore: integrityProfile?.usable === false ? 'Resultado retirado' : (att.status === 'EXPIRED' || (att.status === 'IN_PROGRESS' && Date.now() >= att.startedAt.getTime() + ((exam as any)?.durationMinutes || 10) * 60_000)) ? 'Sin puntuación · tiempo terminado con preguntas pendientes' : att.status === 'SUBMITTED' ? 'Pendiente de revisión' : att.status === 'AWAITING_CONSENT' ? 'Pendiente de inicio' : att.status !== 'COMPLETED' ? 'Pendiente de entrega' : att.score !== null && att.score !== undefined ? `${att.score} puntos (suma de reactivos)` : 'No disponible',
      ipAddress: att.ipAddress || 'No disponible',
      userAgent: att.userAgent || 'No disponible',
      sessionHmac: att.ltiMapping ? `lti-${att.ltiMapping.id}` : null,
      governanceTrace,
      dimensions,
      integrityProfile,
      proctoringLogs: logsMapped,
    };
  }

  async getAttemptResultados(attemptId: string, organizationId: string) {
    this.logger.log(`Obteniendo resultados e IGA para el intento: ${attemptId}`);

    const attempt = await this.reports.findResultsAttempt(attemptId, organizationId);
    if (!attempt) {
      throw new BadRequestException('Intento de examen no encontrado.');
    }

    let igaResult = null;
    if (!attempt.resultadoGlobal) {
      try {
        igaResult = await this.igaCalculator.calcularIga(attemptId);
      } catch (err) {
        this.logger.warn(`Fallo al calcular IGA de forma automática: ${err.message}`);
      }
    } else {
      igaResult = {
        iga: Number(attempt.resultadoGlobal.iga),
        recomendacion: attempt.resultadoGlobal.recomendacion,
        alertas: attempt.resultadoGlobal.alertas as string[],
      };
    }

    const testResults: Record<string, any> = {};
    const dbTestResults = attempt.resultadosTest;

    for (const r of dbTestResults) {
      let categoria = 'Desconocido';
      if (r.theta !== null && r.theta !== undefined) {
        const thetaVal = Number(r.theta);
        const cut = await this.reports.findCutScore(organizationId, r.testId, thetaVal);
        if (cut) {
          categoria = cut.categoria;
        } else {
          categoria = EvaluationBusinessRules.categoryForTheta(thetaVal);
        }
      } else if (r.percentil !== null && r.percentil !== undefined) {
        categoria = EvaluationBusinessRules.categoryForPercentile(Number(r.percentil));
      }

      testResults[r.testId] = {
        puntaje_bruto: Number(r.puntajeBruto),
        percentil: r.percentil !== null ? Number(r.percentil) : null,
        theta: r.theta !== null ? Number(r.theta) : null,
        theta_error: r.thetaError !== null ? Number(r.thetaError) : null,
        theta_t: r.thetaT !== null ? Number(r.thetaT) : null,
        theta_ci: r.thetaCi !== null ? Number(r.thetaCi) : null,
        irt_calculated: r.irtCalculated,
        categoria,
      };
    }

    return {
      sesion_id: attemptId,
      perfil_puesto: attempt.resultadoGlobal?.perfil?.nombre || null,
      estado: attempt.status,
      resultados_por_test: testResults,
      iga: igaResult ? {
        valor: igaResult.iga,
        recomendacion: igaResult.recomendacion,
        alertas: igaResult.alertas,
      } : null,
    };
  }

  async recalcularIga(
    attemptId: string,
    user: SessionUser,
    body: RecalcularIgaDto,
    metadata: AuditRequestMetadata = {},
  ) {
    const organizationId = user.organizationId;
    this.logger.log(`Petición de recálculo de IGA para intento: ${attemptId} con perfil: ${body.perfilId}`);
    const attempt = await this.reports.findResultsAttempt(attemptId, organizationId);
    if (!attempt) throw new BadRequestException('Intento de examen no encontrado.');

    await this.igaCalculator.calcularIga(attemptId, body.perfilId);
    await this.auditService.record({
      organizationId,
      actorUserId: user.userId,
      actorType: 'STAFF',
      action: AUDIT_ACTIONS.IGA_RECALCULATED,
      resourceType: 'ExamAttempt',
      resourceId: attemptId,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
      metadata: {
        perfilId: body.perfilId,
      },
    });
    return this.getAttemptResultados(attemptId, organizationId);
  }

  getPerfiles(organizationId: string) {
    return this.reports.findPerfiles(organizationId);
  }


  private buildIntegrityLaboralProfile(details: any) {
    if (details?.integrityLaboral?.assessmentCode !== INTEGRITY_LABORAL_ASSESSMENT_CODE) return null;

    if (details.integrityLaboral.scoringRevision !== INTEGRITY_LABORAL_SCORING_REVISION) {
      return { title: 'Resultado retirado', usable: false, notice: 'Esta versión tenía una clave de puntuación incorrecta. No usar sus resultados; crear una nueva evaluación.', global: { name: 'No interpretable', score: null, maxScore: null, percentage: 0, description: 'Resultado histórico conservado sin reinterpretación.' }, dimensions: [], strengths: [], explorationAreas: [], interviewQuestions: [] };
    }
    const global = details.integrityLaboral.global || null;
    const dimensions = INTEGRITY_LABORAL_DIMENSIONS.map((definition) => {
      const score = details[definition.key] || {};
      const percentage = Number(score.percentage || 0);
      return {
        key: definition.key,
        name: definition.name,
        score: Number(score.earned || 0),
        maxScore: Number(score.max || 25),
        percentage,
        description: 'Puntuación descriptiva de autoinforme; no es un percentil ni una conclusión sobre conducta laboral.',
      };
    });



    return {
      title: 'Perfil de Integridad Laboral',
      usable: true,
      notice: INTEGRITY_LABORAL_NOTICE,
      global: {
        name: 'Integridad Global',
        score: Number(global?.earned || 0),
        maxScore: Number(global?.max || 100),
        percentage: Number(global?.percentage || 0),
        description: INTEGRITY_LABORAL_NOTICE,
      },
      dimensions,
      strengths: [],
      explorationAreas: [],
      interviewQuestions: dimensions.map((dimension) => ({
        dimension: dimension.name,
        question: this.integrityInterviewQuestion(dimension.key),
      })),
    };
  }

  private integrityGlobalInterpretation(percentage: number) {
    if (percentage >= 80) return 'Perfil global alto de integridad laboral en la evaluación aplicada.';
    if (percentage >= 60) return 'Perfil global medio; conviene revisar dimensiones específicas durante entrevista.';
    return 'Perfil global bajo; requiere exploración cuidadosa en entrevista estructurada.';
  }

  private integrityDimensionInterpretation(name: string, percentage: number) {
    if (percentage >= 80) return `${name} aparece como fortaleza observable en esta evaluación.`;
    if (percentage >= 60) return `${name} se ubica en un rango medio y puede explorarse con evidencia conductual.`;
    return `${name} requiere exploración adicional mediante entrevista y referencias laborales.`;
  }

  private integrityStrengthText(name: string) {
    const texts: Record<string, string> = {
      Sinceridad: 'Comunicación directa y menor tendencia a manipular la impresión interpersonal.',
      Justicia: 'Rechazo consistente a prácticas injustas, fraude o uso indebido de recursos.',
      Modestia: 'Apertura a retroalimentación y reconocimiento equilibrado del propio desempeño.',
      'Ausencia de Avaricia': 'Motivación laboral menos centrada en estatus, lujos o ganancia inmediata.',
    };
    return texts[name] || `${name} aparece como fortaleza observable.`;
  }

  private integrityExplorationText(name: string) {
    const texts: Record<string, string> = {
      Sinceridad: 'Explorar situaciones donde haya tenido que admitir errores o comunicar información incómoda.',
      Justicia: 'Explorar criterios éticos ante recursos, favoritismos o ventajas personales.',
      Modestia: 'Explorar reacción ante crítica, reconocimiento de otros y aprendizaje desde posiciones iniciales.',
      'Ausencia de Avaricia': 'Explorar motivadores laborales, expectativas económicas y relación con estatus.',
    };
    return texts[name] || `Explorar con mayor detalle la dimensión ${name}.`;
  }

  private integrityInterviewQuestion(key: string) {
    const questions: Record<string, string> = {
      JUSTICIA: 'Cuénteme una situación donde observó una práctica poco ética en una organización. ¿Qué hizo usted?',
      MODESTIA: 'Hábleme de una ocasión en la que recibió una crítica importante. ¿Cómo reaccionó?',
      SINCERIDAD: 'Describa una ocasión en la que tuvo que admitir un error importante.',
      AUSENCIA_AVARICIA: '¿Qué factores considera más importantes al aceptar una oferta laboral?',
    };
    return questions[key] || 'Comparta un ejemplo conductual reciente relacionado con esta dimensión.';
  }

  private getDimensionDescription(_dimName: string): string {
    return 'Puntuación descriptiva según el contenido publicado. No determina aptitud laboral.';
  }

  private getLogMessage(eventType: string): string {
    return EvaluationBusinessRules.proctoringLogMessage(eventType);
  }
}
