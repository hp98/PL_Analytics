-- Core fact. Grain: (season, element, fixture) — a player x fixture row, so
-- double gameweeks are two rows disambiguated by fixture (pk player_gw_sk).
--
-- The own-team surrogate is resolved here by joining the team NAME carried in
-- merged_gw to the team dimension; opponent/fixture/gameweek keys are already
-- id-based in staging.

with pgw as (
    select * from {{ ref('stg_player_gameweek') }}
),

own_team as (
    select season, team_name, team_id, team_sk
    from {{ ref('stg_teams') }}
)

select
    -- keys
    pgw.player_gw_sk,
    pgw.player_nk,
    ot.team_sk,
    pgw.opponent_team_sk,
    pgw.fixture_sk,
    pgw.gameweek_sk,

    -- degenerate / descriptive
    pgw.season,
    pgw.gw,
    pgw.element,
    pgw.name,
    pgw.position,
    pgw.team              as team_name,
    ot.team_id,
    pgw.opponent_team     as opponent_team_id,
    pgw.fixture           as fixture_id,
    pgw.was_home,
    pgw.kickoff_time,

    -- playing time
    pgw.minutes,
    pgw.starts,
    pgw.was_started,

    -- scoring events
    pgw.total_points,
    pgw.goals_scored,
    pgw.assists,
    pgw.clean_sheets,
    pgw.goals_conceded,
    pgw.own_goals,
    pgw.penalties_saved,
    pgw.penalties_missed,
    pgw.yellow_cards,
    pgw.red_cards,
    pgw.saves,
    pgw.bonus,
    pgw.bps,

    -- underlying / advanced
    pgw.influence,
    pgw.creativity,
    pgw.threat,
    pgw.ict_index,
    pgw.expected_goals,
    pgw.expected_assists,
    pgw.expected_goal_involvements,
    pgw.expected_goals_conceded,

    -- price / ownership / transfers
    pgw.value,
    pgw.price_m,
    pgw.selected,
    pgw.transfers_in,
    pgw.transfers_out,
    pgw.transfers_balance,

    -- match context
    pgw.team_h_score,
    pgw.team_a_score

from pgw
left join own_team ot
    on pgw.season = ot.season and pgw.team = ot.team_name
