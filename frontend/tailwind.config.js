/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        forest: { 900: '#0d2c26', 800: '#123c33', 700: '#1a5143' },
        emerald: { 600: '#0e7a5f', 500: '#16a37c', 400: '#2dc79a' },
        gold: { 500: '#d8a441', 400: '#e8bc63', 100: '#f6ead0' },
        ink: '#16241f',
        muted: '#7d8a86',
        line: '#e7ece9',
        canvas: '#f5f7f8',
      },
      fontFamily: { sans: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'] },
      boxShadow: { card: '0 1px 2px rgba(13,44,38,.04), 0 10px 30px rgba(13,44,38,.06)' },
      borderRadius: { xl: '16px' },
    },
  },
  plugins: [],
};
