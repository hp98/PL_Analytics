/** Half-pitch markings as one inline SVG (no extra DOM, scales with the pitch).
 *
 * Drawn to real proportions — a pitch is 68m x 105m, so this half is 68 x 52.5,
 * rendered at 10 units per metre (680 x 525 plus a little room below the
 * halfway line). Attacking half only, goal at the top: that's how a squad is
 * actually read, and it keeps the whole XI on screen at once.
 */
export function PitchMarkings() {
  const line = "rgb(255 255 255 / 0.62)";
  const w = 2;
  return (
    <svg
      viewBox="0 0 680 540"
      preserveAspectRatio="none"
      aria-hidden="true"
      className="absolute inset-0 h-full w-full pointer-events-none"
    >
      <g fill="none" stroke={line} strokeWidth={w}>
        {/* touchlines + goal line */}
        <rect x="6" y="6" width="668" height="528" />

        {/* goal (7.32m) */}
        <rect x="303" y="0" width="74" height="10" fill="rgb(255 255 255 / 0.45)" />

        {/* six-yard box: 18.32m x 5.5m */}
        <rect x="248" y="6" width="184" height="55" />

        {/* penalty area: 40.32m x 16.5m */}
        <rect x="138" y="6" width="404" height="165" />

        {/* penalty spot, 11m out */}
        <circle cx="340" cy="116" r="3.5" fill={line} stroke="none" />

        {/* penalty arc: r = 9.15m about the spot, the part clear of the box */}
        <path d="M 249 171 A 91.5 91.5 0 0 0 431 171" />

        {/* halfway line + centre circle (its top half falls on this half) */}
        <line x1="6" y1="534" x2="674" y2="534" />
        <path d="M 248.5 534 A 91.5 91.5 0 0 1 431.5 534" />
        <circle cx="340" cy="534" r="3.5" fill={line} stroke="none" />
      </g>
    </svg>
  );
}
