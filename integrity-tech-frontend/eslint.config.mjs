import next from 'eslint-config-next/core-web-vitals';
export default [
  ...next,
  { ignores: ['.next/**', 'src/generated/**', 'next-env.d.ts'] },
  { rules: {
    'react-hooks/set-state-in-effect': 'off',
    'react-hooks/refs': 'off',
    'react-hooks/purity': 'off',
    'react-hooks/preserve-manual-memoization': 'off',
    'react-hooks/immutability': 'off',
  } },
];
