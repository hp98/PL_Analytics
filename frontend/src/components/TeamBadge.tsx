import { useState } from "react";

import { useTeams } from "../features/teams/useTeams";

interface Props {
  /** Team short name ("ARS"), full name ("Arsenal") or current-season id. */
  team: string | number | null | undefined;
  /** Rendered crest size in px. */
  size?: number;
  /** Show the team's short code next to the crest. */
  withLabel?: boolean;
  className?: string;
}

/** Official Premier League club crest.
 *
 * Served from the Premier League's own CDN (the same source the official game
 * uses) rather than redistributing the crests in this repo. If the image can't
 * load — offline, CDN blocked, or an unknown club — it degrades silently to the
 * text label the screens already show, so nothing breaks. */
export function TeamBadge({ team, size = 18, withLabel = false, className = "" }: Props) {
  const { codeOf, byKey } = useTeams();
  const [failed, setFailed] = useState(false);
  const code = codeOf(team);

  const label =
    typeof team === "number"
      ? (byKey.get(`#${team}`)?.short_name ?? "")
      : (team ?? "");

  const showImg = code !== null && !failed;

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      {showImg && (
        <img
          src={`https://resources.premierleague.com/premierleague/badges/70/t${code}.png`}
          alt=""
          aria-hidden="true"
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          style={{ width: size, height: size, objectFit: "contain" }}
        />
      )}
      {(withLabel || !showImg) && <span>{label}</span>}
    </span>
  );
}
