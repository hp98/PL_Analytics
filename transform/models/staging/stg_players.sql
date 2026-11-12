-- Staging: per-season element (player) metadata from players_raw.
-- Grain: (season, element_id). Used to enrich dim_player with identity,
-- injury/availability signals, and the FPL `ep_next` baseline (a projection
-- comparison baseline in M4).

with src as (
    select * from {{ source('interim', 'players') }}
)

select
    md5(season || '|' || id::varchar) as player_nk,
    season,
    id                                as element_id,
    first_name,
    second_name,
    web_name,
    case element_type
        when 1 then 'GKP'
        when 2 then 'DEF'
        when 3 then 'MID'
        when 4 then 'FWD'
    end                               as position,
    team                              as team_id,
    team_code,
    try_cast(now_cost as integer)     as now_cost,
    now_cost / 10.0                   as now_price_m,
    status,                                    -- a=available, i=injured, s=susp, ...
    try_cast(chance_of_playing_next_round as integer) as chance_of_playing_next_round,
    news,
    news_added,
    try_cast(selected_by_percent as double)   as selected_by_percent,
    try_cast(form as double)                  as form,
    try_cast(points_per_game as double)       as points_per_game,
    try_cast(ep_next as double)               as ep_next,   -- FPL's own next-GW estimate
    try_cast(ep_this as double)               as ep_this,
    birth_date
from src
