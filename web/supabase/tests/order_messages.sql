-- Rollback-only fixture: the "on hold", "work continues" and "order update" wordings can be saved.
begin;
create temp table t_settings (settings jsonb) on commit drop;
create trigger t_check before insert on t_settings for each row execute function private.check_messages();
do $test$
begin
  insert into t_settings values ('{"messages":{"items":{"held":{"text":"On hold"},"resumed":{"text":"Back on it"},"update":{"text":"At {stage}","send":"share"}}}}');
  begin
    insert into t_settings values ('{"messages":{"items":{"nope":{"text":"x"}}}}');
    raise exception 'An unknown message was accepted';
  exception when others then
    if sqlerrm <> 'Invalid message settings' then raise; end if;
  end;
end $test$;
rollback;
