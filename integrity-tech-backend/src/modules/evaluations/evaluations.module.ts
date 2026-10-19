import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { AuditModule } from '../audit/audit.module';
import { IamModule } from '../iam';
import { PsychometricGovernanceModule } from '../psychometric-governance/psychometric-governance.module';
import { AttemptsController } from './controllers/attempts.controller';
import { CandidateConsentController } from './controllers/candidate-consent.controller';
import { EvaluationFinalizeController } from './controllers/evaluation-finalize.controller';
import { EvaluationSessionController } from './controllers/evaluation-session.controller';
import { InvitationsController } from './controllers/invitations.controller';
import { ReportsController } from './controllers/reports.controller';
import { ResponsesController } from './controllers/responses.controller';
import { AttemptRepository } from './repositories/attempt.repository';
import { InvitationRepository } from './repositories/invitation.repository';
import { ReportRepository } from './repositories/report.repository';
import { AttemptService } from './services/attempt.service';
import { CandidateConsentService } from './services/candidate-consent.service';
import { EvaluationQueueProducer } from './services/evaluation-queue.producer';
import { AnswersQueueProcessor } from './services/answers-queue.processor';
import { ProctoringQueueProcessor } from './services/proctoring-queue.processor';
import { FinalizeService } from './services/finalize.service';
import { IgaCalculatorService } from './services/iga-calculator.service';
import { InvitationService } from './services/invitation.service';
import { ThetaCalculatorService } from './services/theta-calculator.service';
import { PersonFitService } from './services/person-fit.service';
import { CatService } from './services/cat.service';
import { ItemSelectorService } from './services/item-selector.service';
import { ThetaEstimatorService } from './services/theta-estimator.service';
import { ReportGeneratorService } from './services/report-generator.service';
import { AdverseImpactService } from './services/adverse-impact.service';
import { RoiService } from './services/roi.service';
import { ContinuousNormingService } from './services/continuous-norming.service';
import { RapidGuessingService } from './services/rapid-guessing.service';
import { PsychometricsRoleGuard } from './guards/psychometrics-role.guard';
import { ReportService } from './services/report.service';
import { ResponseService } from './services/response.service';
import { SessionService } from './services/session.service';
import { RateLimitGuard } from '../../shared/security/rate-limit.guard';
import { RedisRateLimitStore } from '../../shared/security/redis-rate-limit.store';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    AuditModule,
    IamModule, // Necesario para que JwtAuthGuard pueda inyectar IamFacade
    PsychometricGovernanceModule,
    StorageModule,
    BullModule.registerQueue(
      {
        name: 'answers-queue',
      },
      {
        name: 'proctoring-queue',
      },
    ),
  ],
  controllers: [
    InvitationsController,
    AttemptsController,
    CandidateConsentController,
    ResponsesController,
    EvaluationSessionController,
    EvaluationFinalizeController,
    ReportsController,
  ],
  providers: [
    InvitationRepository,
    AttemptRepository,
    ReportRepository,
    InvitationService,
    AttemptService,
    CandidateConsentService,
    ResponseService,
    SessionService,
    FinalizeService,
    ReportService,
    EvaluationQueueProducer,
    AnswersQueueProcessor,
    ProctoringQueueProcessor,
    IgaCalculatorService,
    ThetaCalculatorService,
    PersonFitService,
    CatService,
    ItemSelectorService,
    ThetaEstimatorService,
    ReportGeneratorService,
    AdverseImpactService,
    RoiService,
    ContinuousNormingService,
    RapidGuessingService,
    PsychometricsRoleGuard,
    RateLimitGuard,
    RedisRateLimitStore,
  ],
  exports: [
    InvitationService,
    AttemptService,
    CandidateConsentService,
    ResponseService,
    SessionService,
    FinalizeService,
    ReportService,
    EvaluationQueueProducer,
    IgaCalculatorService,
    ThetaCalculatorService,
    PersonFitService,
    CatService,
    ItemSelectorService,
    ThetaEstimatorService,
    ReportGeneratorService,
    AdverseImpactService,
    RoiService,
    ContinuousNormingService,
    RapidGuessingService,
  ],
})
export class EvaluationsModule {}
