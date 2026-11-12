-- Staging: per-season team dimension from teams.csv, including the FPL-provided
-- strength ratings. Our own Elo / attack-defence model ratings are added in the
-- modelling stage (M4); here we surface the official strengths only.
-- Grain: (season, team_id).

with src as (
    select * from {{ source('interim', 'teams') }}
)

select
    md5(season || '|' || id::varchar) as team_sk,
    season,
    id                as team_id,
    name              as team_name,
    short_name        as team_short_name,
    code              as team_code,
    try_cast(strength as integer)                 as strength,
    try_cast(strength_overall_home as integer)    as strength_overall_home,
    try_cast(strength_overall_away as integer)    as strength_overall_away,
    try_cast(strength_attack_home as integer)     as strength_attack_home,
    try_cast(strength_attack_away as integer)     as strength_attack_away,
    try_cast(strength_defence_home as integer)    as strength_defence_home,
    try_cast(strength_defence_away as integer)    as strength_defence_away,
    pulse_id
from src
