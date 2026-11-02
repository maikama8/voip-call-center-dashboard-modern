/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "var(--bg)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        ink: "var(--ink)",
        muted: "var(--muted)",
        line: "var(--line)",
        accent: "var(--accent)",
        "accent-soft": "var(--accent-soft)",
        warn: "var(--warn)",
        "warn-soft": "var(--warn-soft)",
        danger: "var(--danger)",
        "danger-soft": "var(--danger-soft)",
        info: "var(--info)",
        "info-soft": "var(--info-soft)",
      },
      boxShadow: {
        panel: "var(--shadow)",
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
