import { Reflector } from '@nestjs/core';
import { RateLimitGuard } from './rate-limit.guard';
import { RATE_LIMIT_KEY } from './rate-limit.decorator';

describe('RateLimitGuard', () => {
  it('ignores forged forwarded addresses', async () => {
    const store = buildStore();
    const guard = buildGuard({ scope: 'auth-login', limit: 1, windowMs: 60000 }, store);
    await guard.canActivate(mockContext({ ip: '127.0.0.1', body: { email: 'a@b.test' }, headers: { 'x-forwarded-for': '8.8.8.8' } }) as any);
    expect(store.increment).toHaveBeenCalledWith('auth-login:127.0.0.1:a@b.test', 60000);
  });

  it('blocks login by IP and email after the configured limit', async () => {
    const store = buildStore();
    const guard = buildGuard({ scope: 'auth-login', limit: 2, windowMs: 60_000 }, store);
    const ctx = mockContext({
      ip: '127.0.0.1',
      method: 'POST',
      url: '/api/auth/login',
      body: { email: 'admin@integrity.demo' },
      headers: {},
    });

    await expect(guard.canActivate(ctx as any)).resolves.toBe(true);
    await expect(guard.canActivate(ctx as any)).resolves.toBe(true);
    await expectRateLimit(guard, ctx);
  });

  it('blocks invitation verification by IP and access code', async () => {
    const store = buildStore();
    const guard = buildGuard({ scope: 'invitation-verify', limit: 1, windowMs: 60_000 }, store);
    const ctx = mockContext({
      ip: '127.0.0.1',
      method: 'POST',
      url: '/api/evaluations/invitations/verify',
      body: { accessCode: 'IT-123456' },
      headers: {},
    });

    await expect(guard.canActivate(ctx as any)).resolves.toBe(true);
    await expectRateLimit(guard, ctx);
    expect(store.increment).toHaveBeenCalledWith('invitation-verify:127.0.0.1:IT-123456', 60_000);
  });

  it('fails closed when Redis is required but unavailable', async () => {
    const store = { increment: jest.fn().mockRejectedValue(new Error('redis down')) };
    const guard = buildGuard({ scope: 'auth-login', limit: 1, windowMs: 60_000 }, store);
    const ctx = mockContext({
      ip: '127.0.0.1',
      method: 'POST',
      url: '/api/auth/login',
      body: { email: 'admin@integrity.demo' },
      headers: {},
    });

    try {
      await guard.canActivate(ctx as any);
      throw new Error('Expected fail closed rejection');
    } catch (error: any) {
      expect(error.getStatus()).toBe(503);
    }
  });

  async function expectRateLimit(guard: RateLimitGuard, ctx: any) {
    try {
      await guard.canActivate(ctx as any);
      throw new Error('Expected rate limit rejection');
    } catch (error: any) {
      expect(error.getStatus()).toBe(429);
      expect(error.message).toContain('Demasiadas solicitudes');
    }
  }

  function buildGuard(options: any, store = buildStore()) {
    const reflector = {
      getAllAndOverride: jest.fn((key) => key === RATE_LIMIT_KEY ? options : undefined),
    } as unknown as Reflector;
    const prisma = {
      organization: { findUnique: jest.fn() },
      candidateInvitation: { findFirst: jest.fn() },
      auditEvent: { create: jest.fn().mockResolvedValue(undefined) },
    };
    return new RateLimitGuard(reflector, prisma as any, store as any);
  }

  function buildStore() {
    let count = 0;
    return {
      increment: jest.fn(async () => {
        count += 1;
        return { count, resetAt: Date.now() + 60_000, source: 'redis' };
      }),
    };
  }

  function mockContext(req: any) {
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => req,
      }),
    };
  }
});
