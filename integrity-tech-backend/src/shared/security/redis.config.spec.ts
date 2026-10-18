import { queueRedisOptions } from './redis.config';

describe('Redis queue configuration', () => {
  it('uses the authenticated URL instead of conflicting host variables', () => {
    expect(queueRedisOptions({ REDIS_URL: 'rediss://user:p%40ss@private.example:6380/2', REDIS_HOST: 'localhost' })).toMatchObject({
      host: 'private.example', port: 6380, username: 'user', password: 'p@ss', db: 2, tls: {},
    });
  });
  it('rejects non Redis protocols', () => {
    expect(() => queueRedisOptions({ REDIS_URL: 'https://example.com' })).toThrow();
  });
});
