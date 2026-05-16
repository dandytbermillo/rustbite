import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx,js,jsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          red: "#D7261E",
          redDark: "#9B1A14",
          yellow: "#FFBE0B",
          yellowDark: "#E6A500",
          black: "#141414",
          cream: "#FFF8E7",
          gray: "#F2F2F2",
        },
      },
      fontFamily: {
        sans: ['Archivo', 'Inter', 'system-ui', 'sans-serif'],
        display: ['"Archivo Black"', 'Archivo', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
