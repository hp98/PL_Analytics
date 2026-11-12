-- Staging: player x fixture grain. The interim parquet is already typed and
-- canonicalised, so this layer only parses the kickoff timestamp and mints the
-- surrogate keys used across the star schema.
--
-- Grain: (season, element, fixture). During double gameweeks a player has two
-- rows in the same `gw`, disambiguated by `fixture`.

with src as (
    select * from {{ source('interim', 'player_gameweek') }}
)

select
    -- surrogate / foreign keys
    md5(season || '|' || element::varchar || '|' || fixture::varchar) as player_gw_sk,
    md5(season || '|' || element::varchar)                            as player_nk,
    md5(season || '|' || fixture::varchar)                            as fixture_sk,
    -- own team is a NAME string here; its id-based team_sk is resolved in the
    -- fact via a join to stg_teams. opponent_team is already a team id.
    md5(season || '|' || opponent_team::varchar)                      as opponent_team_sk,
    md5(season || '|' || gw::varchar)                                 as gameweek_sk,

    -- natural keys / dimensions
    season,
    gw,
    element,
    name,
    position,
    team,
    opponent_team,
    fixture,
    was_home,
    try_cast(kickoff_time as timestamp) as kickoff_time,

    -- playing time
    minutes,
    starts,
    was_started,

    -- scoring events
    total_points,
    goals_scored,
    assists,
    clean_sheets,
    goals_conceded,
    own_goals,
    penalties_saved,
    penalties_missed,
    yellow_cards,
    red_cards,
    saves,
    bonus,
    bps,

    -- underlying / advanced
    influence,
    creativity,
    threat,
    ict_index,
    expected_goals,
    expected_assists,
    expected_goal_involvements,
    expected_goals_conceded,

    -- price / ownership / transfers
    value,
    value / 10.0 as price_m,          -- price in £m for readability
    selected,
    transfers_in,
    transfers_out,
    transfers_balance,

    -- match context
    team_h_score,
    team_a_score

from src
