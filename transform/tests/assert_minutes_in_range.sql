-- Data-quality gate: minutes must be a sane match value. A PL match has no extra
-- time, so 0..120 is generous (covers stoppage-time bookkeeping quirks). Any row
-- outside this range indicates a parse/ingest fault. Returns offending rows.
select
    player_gw_sk,
    season,
    element,
    gw,
    minutes
from {{ ref('fct_player_gameweek') }}
where minutes < 0 or minutes > 120
