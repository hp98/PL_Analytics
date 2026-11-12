import { useEffect, useRef, useState } from "react";

import { type Theme, useUiStore } from "../store/useUiStore";

const OPTIONS: { value: Theme; label: string; icon: string; hint: string }[] = [
  { value: "dark", label: "Dark", icon: "🌙", hint: "Midnight slate" },
  { value: "light", label: "Light", icon: "☀️", hint: "Clean daylight" },
  { value: "system", label: "System", icon: "🖥️", hint: "Match your OS" },
  { value: "football", label: "Football", icon: "⚽", hint: "Pitch-night purple" },
];

export function ThemeMenu() {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const current = OPTIONS.find((o) => o.value === theme) ?? OPTIONS[0]!;

  return (
    <div className="relative" ref={ref}>
      <button
        className="btn !px-2.5"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Theme"
      >
        <span className="text-base leading-none">{current.icon}</span>
        <span className="hidden sm:inline text-ink-muted">{current.label}</span>
        <span className="text-ink-faint text-[10px]">▾</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-1.5 w-48 card p-1.5 shadow-xl z-30 origin-top-right"
        >
          <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-ink-faint">
            Theme
          </div>
          {OPTIONS.map((o) => {
            const active = o.value === theme;
            return (
              <button
                key={o.value}
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  setTheme(o.value);
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
                  active ? "bg-brand-dim/20 text-ink" : "text-ink-muted hover:bg-surface-2"
                }`}
              >
                <span className="text-base leading-none">{o.icon}</span>
                <span className="flex-1">
                  <span className="block text-ink">{o.label}</span>
                  <span className="block text-[10px] text-ink-faint">{o.hint}</span>
                </span>
                {active && <span className="text-brand">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
