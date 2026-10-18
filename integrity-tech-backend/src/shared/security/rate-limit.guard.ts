import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../database/prisma.service';
import { RATE_LIMIT_KEY, RateLimitOptions, RateLimitScope } from './rate-limit.decorator';
import { RedisRateLimitStore } from './redis-rate-limit.store';

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly store: RedisRateLimitStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options) return true;

    const req = context.switchToHttp().getRequest();
    const key = this.buildKey(options.scope, req);
    let hit;
    try {
      hit = await this.store.increment(key, options.windowMs);
    } catch (error) {
      this.logger.error(`Redis requerido para rate limiting no está disponible: ${error.message}`);
      throw new HttpException('Servicio temporalmente no disponible. Intenta nuevamente en unos minutos.', HttpStatus.SERVICE_UNAVAILABLE);
    }

    if (hit.count > options.limit) {
      await this.recordRateLimitExceeded(options.scope, req);
      throw new HttpException('Demasiadas solicitudes. Intenta nuevamente en unos minutos.', HttpStatus.TOO_MANY_REQUESTS);
    }

    return true;
  }

  private buildKey(scope: RateLimitScope, req: any): string {
    const ip = this.getIp(req);
    const body = req.body || {};
    const params = req.params || {};
    const user = req.user || {};

    switch (scope) {
      case 'auth-login':
        return `${scope}:${ip}:${String(body.email || '').trim().toLowerCase()}`;
      case 'auth-refresh':
        return `${scope}:${ip}:${this.hashToken(String(body.refreshToken || ''))}`;
      case 'invitation-verify':
      case 'invitation-claim':
        return `${scope}:${ip}:${String(body.accessCode || '').trim().toUpperCase()}`;
      case 'answer-submit':
      case 'attempt-finalize':
      case 'candidate-consent':
        return `${scope}:${user.userId || ip}:${params.attemptId || 'unknown'}`;
      case 'psychometrics-write':
        return `${scope}:${user.userId || ip}`;
      default:
        return `${scope}:${ip}`;
    }
  }

  private hashToken(value: string): string {
    if (!value) return 'missing';
    return `${value.slice(0, 8)}:${value.length}`;
  }

  private getIp(req: any): string {
    return req.ip || req.socket?.remoteAddress || 'unknown-ip';
  }

  private async recordRateLimitExceeded(scope: RateLimitScope, req: any): Promise<void> {
    try {
      const organizationId = await this.resolveOrganizationId(req);

      await (this.prisma as any).auditEvent.create({
        data: {
          organizationId,
          actorUserId: req.user?.userId || null,
          actorType: this.resolveActorType(scope, req),
          action: 'security.rate_limit.exceeded',
          resourceType: 'RateLimit',
          resourceId: scope,
          ipAddress: this.getIp(req),
          userAgent: req.headers?.['user-agent'] || null,
          metadata: {
            method: req.method,
            path: req.originalUrl || req.url,
          },
        },
      });
    } catch (error) {
      this.logger.warn(`No se pudo auditar rate limit excedido: ${error.message}`);
    }
  }

  private async resolveOrganizationId(req: any): Promise<string | null> {
    if (req.user?.organizationId) return req.user.organizationId;

    const organizationSlug = req.body?.organizationSlug;
    if (organizationSlug) {
      const organization = await this.prisma.organization.findUnique({
        where: { slug: organizationSlug },
        select: { id: true },
      });
      if (organization?.id) return organization.id;
    }

    const accessCode = typeof req.body?.accessCode === 'string'
      ? req.body.accessCode.trim().toUpperCase()
      : null;
    if (accessCode) {
      const invitation = await this.prisma.candidateInvitation.findFirst({
        where: { accessCode },
        select: { organizationId: true },
      });
      if (invitation?.organizationId) return invitation.organizationId;
    }

    return null;
  }

  private resolveActorType(scope: RateLimitScope, req: any): 'STAFF' | 'CANDIDATE' | 'SYSTEM' {
    if (req.user?.roles?.includes?.('candidate')) return 'CANDIDATE';
    if (req.user?.userId) return 'STAFF';
    if (scope === 'invitation-verify' || scope === 'invitation-claim') return 'CANDIDATE';
    return 'SYSTEM';
  }

  static resetForTests() {
    // Kept for backwards-compatible tests; use RedisRateLimitStore.resetForTests for new tests.
  }
}
