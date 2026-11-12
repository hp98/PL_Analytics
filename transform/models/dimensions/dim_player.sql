-- Player dimension, SCD-2 on (price, position, team) within a season, so that
-- historical prices and mid-season position/club changes are queryable (§5).
-- Grain: (season, element, change-segment), pk player_scd_sk.
--
-- Implemented as a gaps-and-islands over the per-gameweek attribute signature:
-- a new segment opens whenever value/position/team differs from the prior GW.

with by_gw as (
    -- Collapse double-gameweek rows to one per (season, element, gw). Price and
    -- position are constant within a GW; take the max value defensively.
    select
        season,
        element,
        gw,
        player_nk,
        any_value(name)     as name,
        any_value(position) as position,
        any_value(team)     as team,
        max(value)          as value
    from {{ ref('stg_player_gameweek') }}
    group by season, element, gw, player_nk
),

sig as (
    select
        *,
        concat_ws('|', value::varchar, position, team) as attr_sig
    from by_gw
),

flagged as (
    select
        *,
        case
            when attr_sig is distinct from
                 lag(attr_sig) over (partition by season, element order by gw)
            then 1 else 0
        end as is_change
    from sig
),

segmented as (
    select
        *,
        sum(is_change) over (
            partition by season, element
            order by gw
            rows between unbounded preceding and current row
        ) as seg
    from flagged
),

segments as (
    select
        season,
        element,
        player_nk,
        seg,
        any_value(name)     as name,
        any_value(position) as position,
        any_value(team)     as team,
        any_value(value)    as value,
        min(gw)             as valid_from_gw,
        max(gw)             as valid_to_gw
    from segmented
    group by season, element, player_nk, seg
),

latest as (
    select season, element, max(valid_to_gw) as last_gw
    from segments
    group by season, element
)

select
    md5(s.season || '|' || s.element::varchar || '|' || s.seg::varchar) as player_scd_sk,
    s.player_nk,
    s.season,
    s.element,
    s.name,
    s.position,
    s.team,
    s.value                 as price_tenths,
    s.value / 10.0          as price_m,
    s.valid_from_gw,
    s.valid_to_gw,
    (s.valid_to_gw = l.last_gw) as is_current_segment,
    -- identity / availability enrichment from players_raw (season snapshot)
    p.web_name,
    p.first_name,
    p.second_name,
    p.team_id,
    p.status,
    p.chance_of_playing_next_round,
    p.selected_by_percent,
    p.ep_next,
    p.birth_date
from segments s
join latest l
    on s.season = l.season and s.element = l.element
left join {{ ref('stg_players') }} p
    on s.player_nk = p.player_nk
