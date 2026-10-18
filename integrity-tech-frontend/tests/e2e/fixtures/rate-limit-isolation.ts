import net from 'node:net';

type RedisConnection = {
  host: string;
  port: number;
  password?: string;
  db?: number;
};

class IncompleteRedisResponseError extends Error {}

function parseRedisConnection(): RedisConnection {
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    const url = new URL(redisUrl);
    const db = url.pathname && url.pathname !== '/' ? Number(url.pathname.slice(1)) : undefined;
    return {
      host: url.hostname || '127.0.0.1',
      port: url.port ? Number(url.port) : 6379,
      password: url.password ? decodeURIComponent(url.password) : undefined,
      db: Number.isFinite(db) ? db : undefined,
    };
  }

  return {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT || 6379),
    password: process.env.REDIS_PASSWORD || undefined,
  };
}

function encodeCommand(parts: string[]): string {
  return `*${parts.length}\r\n${parts.map((part) => `$${Buffer.byteLength(part)}\r\n${part}\r\n`).join('')}`;
}

function parseResp(buffer: Buffer): unknown {
  let offset = 0;

  function readLine() {
    const end = buffer.indexOf('\r\n', offset);
    if (end === -1) throw new IncompleteRedisResponseError('Incomplete Redis response.');
    const line = buffer.toString('utf8', offset, end);
    offset = end + 2;
    return line;
  }

  function readValue(): unknown {
    if (offset >= buffer.length) throw new IncompleteRedisResponseError('Incomplete Redis response.');
    const type = buffer.toString('utf8', offset, offset + 1);
    offset += 1;

    if (type === '+') return readLine();
    if (type === ':') return Number(readLine());
    if (type === '-') throw new Error(readLine());
    if (type === '$') {
      const length = Number(readLine());
      if (length === -1) return null;
      if (offset + length + 2 > buffer.length) throw new IncompleteRedisResponseError('Incomplete Redis response.');
      const value = buffer.toString('utf8', offset, offset + length);
      offset += length + 2;
      return value;
    }
    if (type === '*') {
      const length = Number(readLine());
      const values: unknown[] = [];
      for (let i = 0; i < length; i += 1) values.push(readValue());
      return values;
    }

    throw new Error(`Unsupported Redis response type: ${type}`);
  }

  return readValue();
}

async function sendRedisCommand(socket: net.Socket, parts: string[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for Redis response.'));
    }, 5000);
    const onData = (chunk: Buffer) => {
      chunks.push(chunk);
      try {
        const response = parseResp(Buffer.concat(chunks));
        cleanup();
        resolve(response);
      } catch (error) {
        if (error instanceof IncompleteRedisResponseError) return;
        cleanup();
        reject(error);
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off('data', onData);
      socket.off('error', onError);
    };

    socket.on('data', onData);
    socket.once('error', onError);
    socket.write(encodeCommand(parts));
  });
}

async function connectRedis(connection: RedisConnection): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: connection.host, port: connection.port });
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

export async function clearE2ERateLimitKeys() {
  const connection = parseRedisConnection();
  const keyPrefix = process.env.REDIS_KEY_PREFIX || 'integrity:e2e:';
  const pattern = `${keyPrefix}integrity:rate-limit:*`;
  const socket = await connectRedis(connection);

  try {
    if (connection.password) await sendRedisCommand(socket, ['AUTH', connection.password]);
    if (connection.db !== undefined) await sendRedisCommand(socket, ['SELECT', String(connection.db)]);

    let cursor = '0';
    do {
      const response = await sendRedisCommand(socket, ['SCAN', cursor, 'MATCH', pattern, 'COUNT', '1000']);
      if (!Array.isArray(response) || response.length !== 2 || !Array.isArray(response[1])) {
        throw new Error('Unexpected Redis SCAN response.');
      }

      cursor = String(response[0]);
      const keys = response[1].map(String);
      if (keys.length > 0) await sendRedisCommand(socket, ['DEL', ...keys]);
    } while (cursor !== '0');
  } finally {
    socket.end();
  }
}
