import { Body, Controller, ForbiddenException, Optional, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../../../shared/database/prisma.service';
import { JwtAuthGuard } from '../../../shared/guards/jwt-auth.guard';
import { LoginDto } from '../dto/login.dto';
import { RefreshTokenDto } from '../dto/refresh-token.dto';
import { AuthService } from '../services/auth.service';
import { PasswordService } from '../services/password.service';
import { RequestMetadata, SessionService } from '../services/session.service';
import { AuditService } from '../../audit/services/audit.service';
import { AUDIT_ACTIONS } from '../../audit/audit-event.types';
import { RateLimit } from '../../../shared/security/rate-limit.decorator';
import { RateLimitGuard } from '../../../shared/security/rate-limit.guard';
import { MetricsService } from '../../../shared/observability/metrics.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly passwordService: PasswordService,
    private readonly sessionService: SessionService,
    private readonly auditService: AuditService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  @Post('login')
  @UseGuards(RateLimitGuard)
  @RateLimit({ scope: 'auth-login', limit: 5, windowMs: 60_000 })
  async login(@Body() body: LoginDto, @Req() req: Request) {
    const email = body.email.trim().toLowerCase();
    if (!body.organizationSlug) {
      const matchingUsers = await this.prisma.user.findMany({
        where: { email, isActive: true, organization: { isActive: true } },
        select: { id: true },
        take: 2,
      });
      if (matchingUsers.length > 1) {
        const metadata = this.extractRequestMetadata(req);
        await this.recordLoginFailure(undefined, undefined, metadata, email, 'ambiguous_tenant');
        throw new UnauthorizedException('Credenciales inválidas.');
      }
    }

    const user = await this.prisma.user.findFirst({
      where: {
        email,
        ...(body.organizationSlug ? { organization: { slug: body.organizationSlug } } : {}),
      },
      include: {
        organization: true,
        userRoles: {
          include: {
            role: {
              include: {
                rolePermissions: {
                  include: {
                    permission: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    const metadata = this.extractRequestMetadata(req);
    if (!user || !user.isActive || !user.organization?.isActive) {
      const organizationId = user?.organizationId || await this.resolveOrganizationIdForFailedLogin(body.organizationSlug);
      await this.recordLoginFailure(organizationId, user?.id, metadata, email, 'invalid_user_or_org');
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    if (!this.passwordService.verifyPassword(body.password, user.passwordHash)) {
      await this.recordLoginFailure(user.organizationId, user.id, metadata, email, 'invalid_password');
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    const roles = user.userRoles.map((userRole) => userRole.role.name);
    const permissions = user.userRoles.flatMap((userRole) =>
      userRole.role.rolePermissions.map((rolePermission) => rolePermission.permission.code),
    );
    if (permissions.length === 0) {
      await this.recordLoginFailure(user.organizationId, user.id, metadata, email, 'missing_staff_permissions');
      throw new ForbiddenException('Este usuario no tiene acceso staff.');
    }

    const session = await this.sessionService.createSession(
      {
        userId: user.id,
        organizationId: user.organizationId,
        email: user.email,
        roles,
      },
      metadata,
    );

    const accessToken = this.authService.issueAccessToken({
      userId: user.id,
      organizationId: user.organizationId,
      email: user.email,
      roles,
      sessionId: session.sessionId,
    });
    await this.auditService.record({
      organizationId: user.organizationId,
      actorUserId: user.id,
      actorType: 'STAFF',
      action: AUDIT_ACTIONS.AUTH_LOGIN_SUCCESS,
      resourceType: 'UserSession',
      resourceId: session.sessionId,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
      metadata: { email: user.email, roles },
    });
    this.metrics?.recordDomainEvent('Authentication', 'login', 'success');

    return {
      accessToken,
      refreshToken: session.refreshToken,
      user: {
        id: user.id,
        email: user.email,
        organizationId: user.organizationId,
        organizationSlug: user.organization.slug,
        organizationName: user.organization.name,
        permissions,
        roles,
      },
    };
  }

  @Post('refresh')
  @UseGuards(RateLimitGuard)
  @RateLimit({ scope: 'auth-refresh', limit: 20, windowMs: 60_000 })
  async refresh(@Body() body: RefreshTokenDto, @Req() req: Request) {
    const { user, sessionId } = await this.sessionService.refreshSession(body.refreshToken);
    const accessToken = this.authService.issueAccessToken({
      ...user,
      sessionId,
    });

    const metadata = this.extractRequestMetadata(req);
    await this.auditService.record({
      organizationId: user.organizationId,
      actorUserId: user.userId,
      actorType: user.roles.includes('candidate') ? 'CANDIDATE' : 'STAFF',
      action: AUDIT_ACTIONS.AUTH_REFRESH,
      resourceType: 'UserSession',
      resourceId: sessionId,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
    });
    this.metrics?.recordDomainEvent('Authentication', 'refresh', 'success');

    return { accessToken };
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(@Req() req: Request & { user?: { userId: string; sessionId?: string } }) {
    if (!req.user?.sessionId) {
      throw new UnauthorizedException('La sesión actual no puede revocarse.');
    }

    await this.sessionService.revokeSession(req.user.sessionId, req.user.userId);
    const metadata = this.extractRequestMetadata(req);
    await this.auditService.record({
      organizationId: (req.user as any).organizationId,
      actorUserId: req.user.userId,
      actorType: 'STAFF',
      action: AUDIT_ACTIONS.AUTH_LOGOUT,
      resourceType: 'UserSession',
      resourceId: req.user.sessionId,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
    });
    this.metrics?.recordDomainEvent('Authentication', 'logout', 'success');
    return { status: 'success' };
  }

  private extractRequestMetadata(req: Request): RequestMetadata {
    return {
      ipAddress: req.ip || req.socket?.remoteAddress,
      userAgent: req.get('user-agent'),
    };
  }

  private async recordLoginFailure(
    organizationId: string | undefined,
    userId: string | undefined,
    metadata: RequestMetadata,
    email: string,
    reason: string,
  ): Promise<void> {
    await this.auditService.record({
      organizationId: organizationId || null,
      actorUserId: userId || null,
      actorType: 'STAFF',
      action: AUDIT_ACTIONS.AUTH_LOGIN_FAILED,
      resourceType: 'User',
      resourceId: userId || null,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
      metadata: { email, reason },
    });
    this.metrics?.recordDomainEvent('Authentication', 'login', 'failure');
  }

  private async resolveOrganizationIdForFailedLogin(organizationSlug?: string): Promise<string | undefined> {
    if (!organizationSlug) return undefined;
    const organization = await this.prisma.organization.findUnique({
      where: { slug: organizationSlug },
      select: { id: true },
    });
    return organization?.id;
  }
}
