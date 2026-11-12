-- Regression guard (§10): every ingested season must carry a plausible number of
-- player-gameweek rows. A truncated or half-failed ingest would drop a season
-- well below this floor. Returns any season under the configured minimum.
select
    season,
    count(*) as row_count
from {{ ref('fct_player_gameweek') }}
where season <> '{{ var("current_season") }}'   -- exempt the in-progress season
group by season
having count(*) < {{ var('min_rows_per_season') }}
