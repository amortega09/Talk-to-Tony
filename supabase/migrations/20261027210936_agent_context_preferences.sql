alter table day_bot.connections
  add column agent_context jsonb not null default '{}',
  add column checkin_state jsonb not null default '{}';

alter table day_bot.jobs add column metrics jsonb not null default '{}';
