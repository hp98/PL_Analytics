import { useState } from "react";

import { useTeams } from "../features/teams/useTeams";
import { kitUrl } from "../lib/fpl";

interface Props {
  team: string | number | null | undefined;
  /** Goalkeepers wear a different kit in the official assets. */
  isKeeper?: boolean;
  size?: number;
  className?: string;
}

/** Official club kit, served through our edge Worker.
 *
 * The kits live on fantasy.premierleague.com (not the crest CDN), so they are
 * proxied rather than hotlinked: that inherits the Worker's CORS headers and
 * edge cache, and avoids depending on the browser being able to reach that host
 * directly. If the image fails, the card still shows name and points. */
export function TeamKit({ team, isKeeper = false, size = 44, className = "" }: Props) {
  const { codeOf } = useTeams();
  const [failed, setFailed] = useState(false);
  const code = codeOf(team);
  if (code === null || failed) return null;

  const src = kitUrl(code, isKeeper);

  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={className}
      style={{ width: size, height: size, objectFit: "contain" }}
    />
  );
}
