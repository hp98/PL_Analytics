-- Gameweek dimension. Grain: (season, gw), pk gameweek_sk. Deadline / official
-- average / highest score come from the bootstrap `events` feed (M3); here we
-- derive what the fixture list supports: kickoff window, and double/blank flags.

with fx as (
    select season, gw, kickoff_time, home_team_id, away_team_id
    from {{ ref('stg_fixtures') }}
    where gw is not null
),

slots as (
    select season, gw, home_team_id as team_id from fx
    union all
    select season, gw, away_team_id as team_id from fx
),

team_counts as (
    select season, gw, team_id, count(*) as team_fixtures
    from slots
    group by season, gw, team_id
),

gw_agg as (
    select
        season,
        gw,
        count(*)          as num_fixtures,
        min(kickoff_time) as first_kickoff,
        max(kickoff_time) as last_kickoff
    from fx
    group by season, gw
),

spread as (
    select
        season,
        gw,
        max(team_fixtures)      as max_team_fixtures,
        count(distinct team_id) as teams_playing
    from team_counts
    group by season, gw
)

select
    md5(g.season || '|' || g.gw::varchar) as gameweek_sk,
    g.season,
    g.gw,
    g.num_fixtures,
    s.teams_playing,
    g.first_kickoff,
    g.last_kickoff,
    (s.max_team_fixtures > 1) as is_double_gw,   -- a team plays twice
    (s.teams_playing < 20)    as is_blank_gw     -- not all 20 teams play
from gw_agg g
join spread s on g.season = s.season and g.gw = s.gw
