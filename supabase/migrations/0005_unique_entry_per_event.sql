-- Press Link: a school may submit one entry per event. An `events` row is
-- already unique per contest type, level and language, so this constraint is
-- exactly "one entry per event, per school, per language".

-- Refuse to run rather than silently deleting a school's work: any existing
-- duplicate has to be resolved by hand before the constraint can go on.
do $$
declare
  duplicate_count int;
begin
  select count(*) into duplicate_count
  from (
    select school_id, event_id
    from entries
    group by school_id, event_id
    having count(*) > 1
  ) as duplicates;

  if duplicate_count > 0 then
    raise exception
      'Cannot add entries_school_event_unique: % school/event pair(s) already have more than one entry. Remove the extras first.',
      duplicate_count;
  end if;
end
$$;

alter table entries
  add constraint entries_school_event_unique unique (school_id, event_id);
