/** @type {import('next').NextConfig} */
if (process.env.VERCEL && !process.env.BACKEND_URL) {
  throw new Error('BACKEND_URL es obligatorio en Vercel. Configura un backend operativo antes de desplegar.');
}
const backendUrl = process.env.BACKEND_URL || 'http://localhost:3001';
const backendOrigin = new URL(backendUrl);
if (!['http:', 'https:'].includes(backendOrigin.protocol) || backendOrigin.username || backendOrigin.password || backendOrigin.search || backendOrigin.hash || backendOrigin.pathname !== '/') {
  throw new Error('BACKEND_URL debe ser un origen HTTP(S), sin credenciales, ruta ni parámetros.');
}

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/api/:path*`,
      },
      {
        source: '/health/:path*',
        destination: `${backendUrl}/health/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
