import { NotFoundException } from '@nestjs/common';
import { ContinuousNormingService } from './continuous-norming.service';

describe('ContinuousNormingService tenant isolation', () => {
  const prisma = {
    continuousNorm: { findFirst: jest.fn() },
  } as any;

  let service: ContinuousNormingService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ContinuousNormingService(prisma);
  });

  it('never starts a shell or generates norms from untrusted test identifiers', async () => {
    await expect(service.runContinuousCalibration('$(invalid)')).rejects.toThrow('deshabilitada');
    expect(prisma.continuousNorm.findFirst).not.toHaveBeenCalled();
  });

  it('queries continuous norms by organization and demographic hierarchy', async () => {
    prisma.continuousNorm.findFirst.mockResolvedValue({
      testId: 'IT2_AC10',
      organizationId: 'org-a',
      pais: 'México',
      nivelEducativo: 'Universitario',
      tipoPuesto: 'Gerente',
      p5: -1.5,
      p10: -1,
      p25: -0.5,
      p50: 0,
      p75: 0.5,
      p90: 1,
      p95: 1.5,
    });

    const percentile = await service.getPercentileContinuous(
      'IT2_AC10',
      'org-a',
      0.25,
      'México',
      'Universitario',
      'Gerente',
    );

    expect(percentile).toBeGreaterThan(50);
    expect(prisma.continuousNorm.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org-a',
          testId: 'IT2_AC10',
          pais: 'México',
          nivelEducativo: 'Universitario',
          tipoPuesto: 'Gerente',
        }),
      }),
    );
  });

  it('does not fall back to another organization when no norm exists', async () => {
    prisma.continuousNorm.findFirst.mockResolvedValue(null);

    await expect(service.getPercentileContinuous('IT2_AC10', 'org-a', 0.25))
      .rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.continuousNorm.findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { organizationId: 'org-a', testId: 'IT2_AC10' } }),
    );
  });
});
