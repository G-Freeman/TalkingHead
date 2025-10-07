/** @type {import('tailwindcss').Config} */
module.exports = {
    content: ['./index.html', './src/**/*.{ts,tsx}'],
    theme: {
        extend: {
            colors: {
                surface: '#0f111a',
                panel: '#181b28'
            }
        }
    },
    plugins: []
};