import { ServiceUnavailableException, Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../shared/guards/jwt-auth.guard';
import { PERMISSIONS, Permissions, PermissionsGuard } from '../../iam';
import { RecalcularIgaDto } from '../dto/evaluation-flow.dto';
import { ReportService } from '../services/report.service';

@ApiTags('Evaluations (Motor de Evaluación)')
@ApiBearerAuth()
@Controller('evaluations')
export class ReportsController {
  constructor(private readonly reportService: ReportService) {}

  @ApiOperation({
    summary: 'Obtener reporte consolidado detallado de un intento',
    description: 'Devuelve el informe conductual psicométrico por dimensiones y el timeline de proctoring de un candidato.',
  })
  @ApiParam({ name: 'attemptId', description: 'ID único del intento de evaluación (UUIDv7)', type: String })
  @ApiResponse({ status: 200, description: 'Reporte del candidato devuelto con éxito.' })
  @Get('attempts/:attemptId')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions(PERMISSIONS.REPORTS_READ)
  getAttemptReport(@Req() req: any, @Param('attemptId', ParseUUIDPipe) attemptId: string) {
    return this.reportService.getAttemptReport(attemptId, req.user, this.extractRequestMetadata(req));
  }

  @ApiOperation({ summary: 'Obtener resultados globales detallados e Índice IGA de un intento' })
  @ApiParam({ name: 'attemptId', description: 'ID único del intento de evaluación (UUIDv7)', type: String })
  @Get('attempts/:attemptId/resultados')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions(PERMISSIONS.REPORTS_READ)
  getAttemptResultados(@Req() req: any, @Param('attemptId', ParseUUIDPipe) attemptId: string) {
    throw new ServiceUnavailableException('IGA y recomendaciones automáticas no disponibles durante el piloto.');
  }

  @ApiOperation({ summary: 'Forzar recálculo del Índice IGA asignando un perfil de puesto' })
  @ApiParam({ name: 'attemptId', description: 'ID único del intento de evaluación (UUIDv7)', type: String })
  @Post('attempts/:attemptId/recalcular-iga')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions(PERMISSIONS.ATTEMPTS_UPDATE)
  @HttpCode(HttpStatus.OK)
  recalcularIga(
    @Req() req: any,
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @Body() body: RecalcularIgaDto,
  ) {
    throw new ServiceUnavailableException('IGA y recomendaciones automáticas no disponibles durante el piloto.');
  }

  @ApiOperation({ summary: 'Obtener la lista de todos los perfiles de puesto configurados' })
  @ApiResponse({ status: 200, description: 'Lista de perfiles devuelta con éxito.' })
  @Get('perfiles')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions(PERMISSIONS.REPORTS_READ)
  getPerfiles(@Req() req: any) {
    return this.reportService.getPerfiles(req.user.organizationId);
  }

  private extractRequestMetadata(req: any) {
    return {
      ipAddress: req.ip || req.headers?.['x-forwarded-for'] || null,
      userAgent: req.headers?.['user-agent'] || null,
    };
  }
}
