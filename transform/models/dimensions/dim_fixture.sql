-- Fixture dimension. Grain: (season, fixture_id), pk fixture_sk. Carries the
-- official 1-5 FDR for both sides; our model difficulty is added in the
-- fixture-ticker mart (M2/M4).

select
    f.fixture_sk,
    f.season,
    f.fixture_id,
    f.gw,
    md5(f.season || '|' || f.gw::varchar) as gameweek_sk,
    f.kickoff_time,
    f.finished,
    f.started,
    f.home_team_id,
    f.away_team_id,
    f.home_team_sk,
    f.away_team_sk,
    home_t.team_name       as home_team_name,
    away_t.team_name       as away_team_name,
    home_t.team_short_name as home_team_short,
    away_t.team_short_name as away_team_short,
    f.home_score,
    f.away_score,
    f.home_fdr,
    f.away_fdr,
    f.minutes
from {{ ref('stg_fixtures') }} f
left join {{ ref('stg_teams') }} home_t on f.home_team_sk = home_t.team_sk
left join {{ ref('stg_teams') }} away_t on f.away_team_sk = away_t.team_sk
