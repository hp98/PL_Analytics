-- Team dimension. Grain: (season, team_id), pk team_sk. Surfaces the official
-- FPL strength ratings; model-derived Elo/attack-defence ratings land in M4.

select
    team_sk,
    season,
    team_id,
    team_name,
    team_short_name,
    team_code,
    strength,
    strength_overall_home,
    strength_overall_away,
    strength_attack_home,
    strength_attack_away,
    strength_defence_home,
    strength_defence_away,
    pulse_id
from {{ ref('stg_teams') }}
