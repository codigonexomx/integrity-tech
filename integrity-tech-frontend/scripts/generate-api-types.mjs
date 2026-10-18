import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(__dirname, '..');
const repoRoot = resolve(frontendRoot, '..');
const sourceOpenApiPath = resolve(repoRoot, 'integrity-tech-backend', 'openapi.json');
const generatedOpenApiPath = resolve(frontendRoot, 'src', 'generated', 'openapi.json');
const generatedTypesPath = resolve(frontendRoot, 'src', 'generated', 'api', 'types.ts');

const openApi = JSON.parse(readFileSync(sourceOpenApiPath, 'utf8'));
const paths = Object.keys(openApi.paths || {});
const hasPath = (path) => paths.includes(path) || paths.includes(`/api${path}`);
const requiredPaths = [
  '/auth/login',
  '/auth/refresh',
  '/auth/logout',
  '/evaluations/invitations',
  '/evaluations/invitations/verify',
  '/evaluations/invitations/claim',
  '/evaluations/attempts',
  '/evaluations/attempts/{attemptId}/session',
  '/evaluations/attempts/{attemptId}/submit',
  '/evaluations/attempts/{attemptId}/finalize',
  '/evaluations/attempts/{attemptId}/consent',
  '/evaluations/attempts/{attemptId}',
  '/evaluations/attempts/{attemptId}/resultados',
  '/psychometric-governance/assessments',
  '/psychometric-governance/items',
  '/audit/events',
  '/files/{fileId}/download-url',
];

const missingPaths = requiredPaths.filter((path) => !hasPath(path));
if (missingPaths.length > 0) {
  throw new Error(`OpenAPI is missing required paths: ${missingPaths.join(', ')}`);
}

const generatedTypes = `// Generated from ../integrity-tech-backend/openapi.json by scripts/generate-api-types.mjs.
// Keep this file focused on the frontend contracts currently consumed by the app.

export type ApiErrorResponse = {
  statusCode?: number;
  error?: string;
  message?: string | string[];
  timestamp?: string;
  path?: string;
  requestId?: string | null;
  traceId?: string | null;
};

export type QuestionType = 'MULTIPLE_CHOICE' | 'TRUE_FALSE' | 'SHORT_ANSWER' | 'TEXT_RESPONSE' | 'LIKERT' | string;

export type QuestionOption = {
  id: string;
  text: string;
};

export type QuestionContent = {
  text: string;
  options?: QuestionOption[];
  scale?: {
    min: number;
    max: number;
    labels: Record<string, string>;
  };
  [key: string]: unknown;
};

export type QuestionDto = {
  id: string;
  itemVersionId?: string | null;
  type: QuestionType;
  content: QuestionContent;
  defaultPoints: number;
  governanceMode?: string;
};

export type ExamDto = {
  id: string;
  title: string;
  description?: string;
  durationMinutes?: number | null;
  startTime?: string;
  endTime?: string;
};

export type ExamAttemptDto = {
  id: string;
  examId: string;
  userId: string;
  status: 'IN_PROGRESS' | 'SUBMITTED' | 'GRADING' | 'COMPLETED' | 'ABANDONED' | 'EXPIRED' | string;
  startedAt: string;
  submittedAt?: string | null;
  score?: number | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type ExamSessionResponse = {
  attemptId: string;
  status: ExamAttemptDto['status'];
  serverNow?: string;
  deadlineAt?: string;
  answers?: Record<string, Record<string, unknown>>;
  startedAt?: string;
  submittedAt?: string | null;
  exam: Pick<ExamDto, 'id' | 'title' | 'durationMinutes'>;
  questions: QuestionDto[];
};

export type SubmitAnswerRequest = {
  questionId: string;
  response: Record<string, unknown>;
  tiempoMs?: number;
  itemVersionId?: string | null;
};

export type SubmitAnswerResponse = {
  status: 'accepted' | 'success' | string;
  message?: string;
  jobId?: string;
};

export type SubmitProctoringLogRequest = {
  eventType: 'tab_focus_lost' | 'tab_focus_gained' | 'ip_change' | 'connection_lost' | 'connection_restored' | 'clock_tampering' | string;
  metadata: Record<string, unknown>;
  timestamp: string;
};

export type VerifyInvitationRequest = {
  accessCode: string;
};

export type VerifyInvitationResponse = {
  candidateName: string;
  email: string;
  examId: string;
  examTitle: string;
};

export type ClaimInvitationRequest = {
  accessCode: string;
  candidateName: string;
  email: string;
};

export type ClaimInvitationResponse = {
  token: string;
  attemptId: string;
  [key: string]: unknown;
};

export type CreateInvitationRequest = {
  candidateName: string;
  email: string;
  examId: string;
};

export type CreateInvitationResponse = {
  accessCode: string;
  directLink: string;
  [key: string]: unknown;
};

export type StaffLoginRequest = {
  email: string;
  password: string;
  organizationSlug?: string;
};

export type StaffLoginResponse = {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    organizationId: string;
    organizationName?: string;
    permissions?: string[];
    roles: string[];
  };
};

export type RefreshTokenRequest = {
  refreshToken: string;
};

export type RefreshTokenResponse = {
  accessToken: string;
};

export type CandidateConsentResponse = {
  accepted: boolean;
  consentVersion?: string | null;
  acceptedAt?: string | null;
};

export type AttemptListItem = {
  id: string;
  candidateName: string;
  email: string;
  assessmentTitle: string;
  date: string;
  overallScore: string;
  incidentsCount: number;
  riskStatus: 'SAFE' | 'WARNING' | 'CRITICAL' | string;
  statusLabel: string;
};

export type PerfilPuesto = {
  id: string;
  nombre: string;
  [key: string]: unknown;
};

export type AttemptReportResponse = {
  candidateName: string;
  email: string;
  assessmentTitle: string;
  date: string;
  overallScore: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  sessionHmac?: string | null;
  governanceTrace?: unknown;
  dimensions?: Array<{ name: string; score: number; description: string }>;
  alerts?: string[];
  proctoringLogs?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

export type AttemptResultadosResponse = {
  perfil_puesto?: string;
  iga?: {
    valor: number;
    recomendacion?: string;
    alertas?: string[];
  };
  governanceTrace?: unknown;
  [key: string]: unknown;
};

export type EditorialVersionModel = 'assessmentVersion' | 'itemVersion' | 'normGroupVersion' | 'scoringModelVersion' | 'reportTemplateVersion';
export type EditorialAction = 'request_internal_review' | 'request_psychologist_review' | 'approve' | 'publish' | 'retire' | 'return_to_draft';
`;

mkdirSync(dirname(generatedOpenApiPath), { recursive: true });
mkdirSync(dirname(generatedTypesPath), { recursive: true });
writeFileSync(generatedOpenApiPath, `${JSON.stringify(openApi, null, 2)}\n`);
writeFileSync(generatedTypesPath, generatedTypes);

console.log(`[api-types] Copied OpenAPI to ${generatedOpenApiPath}`);
console.log(`[api-types] Wrote ${generatedTypesPath}`);
