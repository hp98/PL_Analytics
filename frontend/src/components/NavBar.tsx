import { NavLink } from "react-router-dom";

const ITEMS: { to: string; label: string }[] = [
  { to: "/", label: "Home" },
  { to: "/explorer", label: "Player Explorer" },
  { to: "/fixtures", label: "Fixture Ticker" },
  { to: "/my-team", label: "My Team" },
  { to: "/planner", label: "Transfers & Captaincy" },
  { to: "/differentials", label: "Differentials" },
  { to: "/leagues", label: "Mini-Leagues" },
  { to: "/prices", label: "Prices" },
];

export function NavBar() {
  return (
    <nav className="flex items-center gap-1 h-11 overflow-x-auto">
      {ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === "/"}
          className={({ isActive }) =>
            `px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors ${
              isActive
                ? "bg-brand-dim/20 text-ink font-medium ring-1 ring-brand/25"
                : "text-ink-muted hover:text-ink hover:bg-surface-2"
            }`
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
