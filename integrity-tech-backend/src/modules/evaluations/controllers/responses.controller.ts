import { Body, Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../shared/guards/jwt-auth.guard';
import { SubmitSnapshotDto } from '../dto/evaluation-flow.dto';
import { SubmitAnswerBodyDto } from '../dto/submit-answer.dto';
import { SubmitFeedbackDto } from '../dto/submit-feedback.dto';
import { AttemptOwnerGuard } from '../guards/attempt-owner.guard';
import { ResponseService } from '../services/response.service';
import { RateLimit } from '../../../shared/security/rate-limit.decorator';
import { RateLimitGuard } from '../../../shared/security/rate-limit.guard';

@ApiTags('Evaluations (Motor de Evaluación)')
@ApiBearerAuth()
@Controller('evaluations')
export class ResponsesController {
  constructor(private readonly responseService: ResponseService) {}

  @ApiOperation({
    summary: 'Enviar respuesta de una pregunta de examen',
    description: 'Guarda y puntúa la respuesta de forma transaccional antes de confirmar recepción.',
  })
  @ApiParam({ name: 'attemptId', description: 'ID único del intento de evaluación (UUIDv7)', type: String })
  @ApiResponse({ status: 202, description: 'La respuesta fue guardada y puntuada.' })
  @Post('attempts/:attemptId/submit')
  @UseGuards(JwtAuthGuard, AttemptOwnerGuard, RateLimitGuard)
  @RateLimit({ scope: 'answer-submit', limit: 120, windowMs: 60_000 })
  @HttpCode(HttpStatus.ACCEPTED)
  submitAnswer(
    @Req() req: any,
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @Body() body: SubmitAnswerBodyDto,
  ) {
    return this.responseService.submitAnswer(attemptId, body, req.user, this.extractRequestMetadata(req));
  }

  @ApiOperation({
    summary: 'Registrar encuesta NPS y retroalimentación técnica del alumno',
    description: 'Guarda la puntuación NPS (0-10) y el comentario cualitativo en la tabla exam_attempts al finalizar la sesión.',
  })
  @ApiParam({ name: 'attemptId', description: 'ID único del intento de evaluación (UUIDv7)', type: String })
  @Post('attempts/:attemptId/feedback')
  @UseGuards(JwtAuthGuard, AttemptOwnerGuard)
  @HttpCode(HttpStatus.OK)
  submitFeedback(
    @Req() req: any,
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @Body() body: SubmitFeedbackDto,
  ) {
    return this.responseService.submitFeedback(attemptId, body, req.user);
  }

  @ApiOperation({
    summary: 'Subir captura de foto de webcam/celular en tiempo real',
    description: 'Recibe una foto codificada en Base64, la guarda en storage privado y registra solo metadata de supervisión en base de datos.',
  })
  @ApiParam({ name: 'attemptId', description: 'ID único del intento de evaluación (UUIDv7)', type: String })
  @Post('attempts/:attemptId/snapshots')
  @UseGuards(JwtAuthGuard, AttemptOwnerGuard)
  @HttpCode(HttpStatus.CREATED)
  uploadSnapshot(
    @Req() req: any,
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @Body() body: SubmitSnapshotDto,
  ) {
    return this.responseService.uploadSnapshot(attemptId, body, req.user);
  }

  private extractRequestMetadata(req: any) {
    return {
      ipAddress: req.ip || req.headers?.['x-forwarded-for'] || null,
      userAgent: req.headers?.['user-agent'] || null,
    };
  }
}
