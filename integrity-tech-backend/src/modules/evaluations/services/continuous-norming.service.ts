import { Injectable, Logger, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../shared/database/prisma.service';

@Injectable()
export class ContinuousNormingService {
  private readonly logger = new Logger(ContinuousNormingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Obtiene el percentil continuo interpolando linealmente sobre las curvas GAMLSS del subgrupo demográfico.
   */
  async getPercentileContinuous(
    testId: string,
    organizationId: string,
    theta: number,
    pais?: string,
    nivelEducativo?: string,
    tipoPuesto?: string,
  ): Promise<number | null> {
    const safePais = pais || 'Global';
    const safeEdu = nivelEducativo || 'Global';
    const safePst = tipoPuesto || 'Global';

    // 1. Jerarquía de especificidad estricta para buscar el baremo continuo
    const searchQueries = [
      { pais: safePais, nivelEducativo: safeEdu, tipoPuesto: safePst },
      { pais: safePais, nivelEducativo: safeEdu, tipoPuesto: 'Global' },
      { pais: safePais, nivelEducativo: 'Global', tipoPuesto: 'Global' },
      { pais: 'Global', nivelEducativo: 'Global', tipoPuesto: 'Global' },
    ];

    let row = null;
    for (const query of searchQueries) {
      row = await this.prisma.continuousNorm.findFirst({
        where: {
          organizationId,
          testId,
          pais: query.pais,
          nivelEducativo: query.nivelEducativo,
          tipoPuesto: query.tipoPuesto,
        },
      });
      if (row) break;
    }

    if (!row) {
      // Intentar obtener cualquier fila de este test como último recurso para evitar fallos
      row = await this.prisma.continuousNorm.findFirst({
        where: { organizationId, testId },
      });
    }

    if (!row) {
      this.logger.warn(`No se encontraron curvas de baremación continua para el test ${testId}`);
      throw new NotFoundException('Baremo continuo no disponible para esta organización.');
    }

    // 2. Extraer los percentiles de la curva (P5..P95)
    const values = [
      Number(row.p5),
      Number(row.p10),
      Number(row.p25),
      Number(row.p50),
      Number(row.p75),
      Number(row.p90),
      Number(row.p95),
    ];
    const percentiles = [5, 10, 25, 50, 75, 90, 95];

    // 3. Manejo de extremos fuera de la curva
    if (theta <= values[0]) {
      // Extrapolación lineal simple hacia abajo (ej. hasta percentil 1)
      const slope = (percentiles[1] - percentiles[0]) / (values[1] - values[0]);
      const ext = percentiles[0] + slope * (theta - values[0]);
      return Math.round(Math.max(1, Math.min(4, ext)));
    }

    if (theta >= values[values.length - 1]) {
      // Extrapolación lineal simple hacia arriba (ej. hasta percentil 99)
      const lastIdx = values.length - 1;
      const slope = (percentiles[lastIdx] - percentiles[lastIdx - 1]) / (values[lastIdx] - values[lastIdx - 1]);
      const ext = percentiles[lastIdx] + slope * (theta - values[lastIdx]);
      return Math.round(Math.max(96, Math.min(99, ext)));
    }

    // 4. Interpolación lineal en el intervalo correspondiente
    let p = 50;
    for (let i = 0; i < values.length - 1; i++) {
      if (theta >= values[i] && theta <= values[i + 1]) {
        const span = values[i + 1] - values[i];
        if (span > 1e-6) {
          const t = (theta - values[i]) / span;
          p = percentiles[i] + t * (percentiles[i + 1] - percentiles[i]);
        } else {
          p = percentiles[i];
        }
        break;
      }
    }

    return Math.round(p);
  }

  /**
   * Ejecuta el script de Python para calibrar las normas continuas suavizadas
   */
  async runContinuousCalibration(_testId: string): Promise<never> {
    throw new ConflictException('Calibración continua deshabilitada: requiere validación científica y aislamiento por organización.');
  }
}
