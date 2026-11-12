-- Staging: per-season fixtures from fixtures.csv.
-- Grain: (season, fixture_id). `event` is the gameweek; null for unscheduled.

with src as (
    select * from {{ source('interim', 'fixtures') }}
)

select
    md5(season || '|' || id::varchar)                as fixture_sk,
    season,
    id                                               as fixture_id,
    try_cast(event as integer)                       as gw,
    try_cast(kickoff_time as timestamp)              as kickoff_time,
    coalesce(try_cast(finished as boolean), false)   as finished,
    coalesce(try_cast(started as boolean), false)    as started,
    team_h                                           as home_team_id,
    team_a                                           as away_team_id,
    md5(season || '|' || team_h::varchar)            as home_team_sk,
    md5(season || '|' || team_a::varchar)            as away_team_sk,
    try_cast(team_h_score as integer)                as home_score,
    try_cast(team_a_score as integer)                as away_score,
    try_cast(team_h_difficulty as integer)           as home_fdr,   -- official 1-5 FDR
    try_cast(team_a_difficulty as integer)           as away_fdr,
    try_cast(minutes as integer)                     as minutes,
    pulse_id
from src
