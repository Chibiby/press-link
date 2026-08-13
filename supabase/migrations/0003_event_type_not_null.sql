-- Run this only AFTER `npm run seed` has backfilled events.event_type_id.
alter table events alter column event_type_id set not null;
