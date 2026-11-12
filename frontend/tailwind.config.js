/** @type {import('tailwindcss').Config} */

// Every colour is a CSS variable (space-separated RGB channels) so a single set
// of tokens themes the whole app. `<alpha-value>` keeps Tailwind opacity
// modifiers (e.g. bg-surface-2/50) working. Palettes live in index.css, keyed by
// [data-theme="dark|light|football"].
const withVar = (name) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          0: withVar("--surface-0"),
          1: withVar("--surface-1"),
          2: withVar("--surface-2"),
          3: withVar("--surface-3"),
        },
        ink: {
          DEFAULT: withVar("--ink"),
          muted: withVar("--ink-muted"),
          faint: withVar("--ink-faint"),
        },
        brand: {
          DEFAULT: withVar("--brand"),
          dim: withVar("--brand-dim"),
        },
        // Position chip colours (GKP/DEF/MID/FWD), theme-tuned for contrast.
        pos: {
          gkp: withVar("--pos-gkp"),
          def: withVar("--pos-def"),
          mid: withVar("--pos-mid"),
          fwd: withVar("--pos-fwd"),
        },
        // Colour-blind-safe FDR ramp (blue -> teal -> amber -> orange -> red),
        // semantic and identical across themes.
        fdr: {
          1: withVar("--fdr-1"),
          2: withVar("--fdr-2"),
          3: withVar("--fdr-3"),
          4: withVar("--fdr-4"),
          5: withVar("--fdr-5"),
          // Constant dark label for the mid-ramp cells (never theme-flipped).
          ink: withVar("--fdr-ink"),
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgb(0 0 0 / 0.04), 0 4px 16px -8px rgb(0 0 0 / 0.10)",
      },
    },
  },
  plugins: [],
};
