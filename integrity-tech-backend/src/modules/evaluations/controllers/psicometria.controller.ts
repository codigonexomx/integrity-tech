import { Controller, All, ServiceUnavailableException } from '@nestjs/common';

// Intentionally not registered. Kept as a fail-closed placeholder for future reviewed science.
@Controller('api/v1/psicometria')
export class PsicometriaController {
  @All('*path')
  disabled(): never {
    throw new ServiceUnavailableException('Analítica experimental no disponible durante el piloto.');
  }
}
