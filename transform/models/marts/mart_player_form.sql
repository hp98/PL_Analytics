-- Player-form + season-aggregate mart: one row per (season, element) = the
-- LATEST snapshot, carrying rolling 3/6/10-appearance form, per-90 rates, a
-- minutes-reliability score, AND season totals. This is the single table that
-- backs the Player Explorer (M2). Windows are appearance-based (a double
-- gameweek counts as two), ordered by kickoff time.
--
-- Note: shots, key passes, and big chances are NOT in the FPL/vaastav feed and
-- are deferred to M4 (Understat/FBref). Only fields we actually have appear here.

with app as (
    select
        season,
        element,
        name,
        position,
        team_name,
        team_sk,
        gw,
        fixture_id,
        kickoff_time,
        minutes,
        total_points,
        value,
        selected,
        goals_scored,
        assists,
        clean_sheets,
        goals_conceded,
        bonus,
        bps,
        ict_index,
        transfers_in,
        transfers_out,
        coalesce(expected_goals, 0)             as xg,
        coalesce(expected_assists, 0)           as xa,
        coalesce(expected_goal_involvements, 0) as xgi,
        coalesce(expected_goals_conceded, 0)    as xgc,
        row_number() over (
            partition by season, element
            order by kickoff_time, fixture_id
        ) as appearance_idx
    from {{ ref('fct_player_gameweek') }}
),

rolling as (
    select
        *,
        sum(total_points) over w3  as points_last3,
        sum(total_points) over w6  as points_last6,
        sum(total_points) over w10 as points_last10,
        sum(minutes) over w3       as minutes_last3,
        sum(minutes) over w6       as minutes_last6,
        sum(minutes) over w10      as minutes_last10,
        sum(xg)  over w6           as xg_last6,
        sum(xa)  over w6           as xa_last6,
        sum(xgi) over w6           as xgi_last6,
        sum(bps) over w6           as bps_last6,
        count(*) over w6           as appearances_last6,
        sum(case when minutes >= 60 then 1 else 0 end) over w6 as starts60_last6
    from app
    window
        w3  as (partition by season, element order by kickoff_time, fixture_id
                rows between 2 preceding and current row),
        w6  as (partition by season, element order by kickoff_time, fixture_id
                rows between 5 preceding and current row),
        w10 as (partition by season, element order by kickoff_time, fixture_id
                rows between 9 preceding and current row)
),

season_totals as (
    select
        season,
        element,
        count(*)               as season_appearances,
        sum(total_points)      as season_points,
        sum(minutes)           as season_minutes,
        sum(goals_scored)      as season_goals,
        sum(assists)           as season_assists,
        sum(clean_sheets)      as season_clean_sheets,
        sum(goals_conceded)    as season_goals_conceded,
        sum(bonus)             as season_bonus,
        sum(bps)               as season_bps,
        round(sum(ict_index), 1) as season_ict,
        sum(transfers_in)      as season_transfers_in,
        sum(transfers_out)     as season_transfers_out,
        round(sum(xg), 2)      as season_xg,
        round(sum(xa), 2)      as season_xa,
        round(sum(xgi), 2)     as season_xgi,
        round(sum(xgc), 2)     as season_xgc
    from app
    group by season, element
)

select
    md5(r.season || '|' || r.element::varchar) as player_nk,
    r.season,
    r.element,
    r.name,
    r.position,
    r.team_name,
    r.team_sk,
    r.gw                       as latest_gw,
    r.kickoff_time            as latest_kickoff,
    r.value                   as price_tenths,
    r.value / 10.0            as price_m,
    r.selected                as selected_latest,   -- ownership proxy (count)

    -- rolling form
    r.points_last3,
    r.points_last6,
    r.points_last10,
    round(r.points_last6 * 90.0 / nullif(r.minutes_last6, 0), 2) as points_per90_last6,
    round(r.xgi_last6   * 90.0 / nullif(r.minutes_last6, 0), 3)  as xgi_per90_last6,
    round(r.xg_last6    * 90.0 / nullif(r.minutes_last6, 0), 3)  as xg_per90_last6,
    round(r.xa_last6    * 90.0 / nullif(r.minutes_last6, 0), 3)  as xa_per90_last6,
    round(r.bps_last6   * 90.0 / nullif(r.minutes_last6, 0), 2)  as bps_per90_last6,
    round(r.starts60_last6::double / nullif(r.appearances_last6, 0), 3) as minutes_reliability_last6,

    -- season aggregates (Explorer columns)
    t.season_appearances,
    t.season_points,
    t.season_minutes,
    t.season_goals,
    t.season_assists,
    t.season_clean_sheets,
    t.season_goals_conceded,
    t.season_bonus,
    t.season_bps,
    t.season_ict,
    t.season_xg,
    t.season_xa,
    t.season_xgi,
    t.season_xgc,
    t.season_transfers_in,
    t.season_transfers_out,
    round(t.season_points::double / nullif(t.season_appearances, 0), 2) as points_per_appearance
from rolling r
join season_totals t on r.season = t.season and r.element = t.element
qualify row_number() over (
    partition by r.season, r.element
    order by r.kickoff_time desc, r.fixture_id desc
) = 1
