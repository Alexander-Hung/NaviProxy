import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#172026',
        mist: '#eef3f6',
        spruce: '#176b5b',
        coral: '#d25f4c',
        amber: '#d49a2a'
      },
      boxShadow: {
        soft: '0 18px 45px rgba(23, 32, 38, 0.12)'
      }
    }
  },
  plugins: []
} satisfies Config;
