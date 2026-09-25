-- =============================================================
-- Budget categories: stable keys, custom flag, construction library.
--
-- 1) budget_categories gains:
--      subcategory_key text null  (stable id for predefined entries;
--        NULL for custom user entries whose name is the identity),
--      is_custom boolean not null default false.
--    Existing icon column is reused (central registry ids only).
-- 2) Seeds construction top-level parents + the predefined subcategory
--    library (idempotent by name/key). Custom rows are never touched.
-- 3) Partial unique index on subcategory_key keeps predefined identity
--    stable without constraining custom names.
--
-- RLS, audit, unrelated tables: untouched. No rows deleted.
-- =============================================================

alter table public.budget_categories
  add column if not exists subcategory_key text,
  add column if not exists is_custom boolean default false;

update public.budget_categories
  set is_custom = false
  where is_custom is null;

alter table public.budget_categories
  alter column is_custom set default false;

alter table public.budget_categories
  alter column is_custom set not null;

comment on column public.budget_categories.subcategory_key is
  'Stable predefined-library key (e.g. concrete). NULL for custom entries.';
comment on column public.budget_categories.is_custom is
  'True for user-created entries; predefined library rows stay false.';

create unique index if not exists budget_categories_subkey_uidx
  on public.budget_categories (subcategory_key)
  where subcategory_key is not null;

-- Predefined construction subcategory seed (generated).
-- Stable subcategory_key values; English canonical names; icons are
-- central registry ids. Idempotent: skips existing keys/names.
insert into public.budget_categories (name, icon, sort_order)
  select 'Construction', 'hard-hat', 5
  where not exists (select 1 from public.budget_categories c where c.name = 'Construction');
insert into public.budget_categories (name, icon, sort_order)
  select 'Electrical', 'zap', 5
  where not exists (select 1 from public.budget_categories c where c.name = 'Electrical');
insert into public.budget_categories (name, icon, sort_order)
  select 'Plumbing & Water', 'droplets', 5
  where not exists (select 1 from public.budget_categories c where c.name = 'Plumbing & Water');
insert into public.budget_categories (name, icon, sort_order)
  select 'HVAC', 'wind', 5
  where not exists (select 1 from public.budget_categories c where c.name = 'HVAC');
insert into public.budget_categories (name, icon, sort_order)
  select 'Materials', 'package', 5
  where not exists (select 1 from public.budget_categories c where c.name = 'Materials');
insert into public.budget_categories (name, icon, sort_order)
  select 'Joinery', 'door-open', 5
  where not exists (select 1 from public.budget_categories c where c.name = 'Joinery');
insert into public.budget_categories (name, icon, sort_order)
  select 'Site & Logistics', 'truck', 5
  where not exists (select 1 from public.budget_categories c where c.name = 'Site & Logistics');
insert into public.budget_categories (name, icon, sort_order)
  select 'Safety', 'shield-check', 5
  where not exists (select 1 from public.budget_categories c where c.name = 'Safety');
insert into public.budget_categories (name, icon, sort_order)
  select 'Maintenance', 'wrench', 5
  where not exists (select 1 from public.budget_categories c where c.name = 'Maintenance');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Masonry', null, 'brick-wall', (select id from public.budget_categories where name = 'Construction' limit 1), 'masonry', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'masonry');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Concrete', null, 'blocks', (select id from public.budget_categories where name = 'Construction' limit 1), 'concrete', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'concrete');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Reinforcement Steel', null, 'cog', (select id from public.budget_categories where name = 'Construction' limit 1), 'reinforcement-steel', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'reinforcement-steel');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Formwork', null, 'container', (select id from public.budget_categories where name = 'Construction' limit 1), 'formwork', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'formwork');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Foundations', null, 'landmark', (select id from public.budget_categories where name = 'Construction' limit 1), 'foundations', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'foundations');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Structural Work', null, 'building', (select id from public.budget_categories where name = 'Construction' limit 1), 'structural-work', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'structural-work');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Plastering', null, 'paint-roller', (select id from public.budget_categories where name = 'Construction' limit 1), 'plastering', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'plastering');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Painting', null, 'paintbrush', (select id from public.budget_categories where name = 'Construction' limit 1), 'painting', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'painting');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Flooring', null, 'layers', (select id from public.budget_categories where name = 'Construction' limit 1), 'flooring', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'flooring');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Roofing', null, 'hard-hat', (select id from public.budget_categories where name = 'Construction' limit 1), 'roofing', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'roofing');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Waterproofing', null, 'droplets', (select id from public.budget_categories where name = 'Construction' limit 1), 'waterproofing', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'waterproofing');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Insulation', null, 'thermometer', (select id from public.budget_categories where name = 'Construction' limit 1), 'insulation', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'insulation');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Finishing', null, 'ruler', (select id from public.budget_categories where name = 'Construction' limit 1), 'finishing', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'finishing');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Demolition', null, 'hammer', (select id from public.budget_categories where name = 'Construction' limit 1), 'demolition', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'demolition');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Excavation', null, 'tractor', (select id from public.budget_categories where name = 'Construction' limit 1), 'excavation', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'excavation');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Scaffolding', null, 'fence', (select id from public.budget_categories where name = 'Construction' limit 1), 'scaffolding', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'scaffolding');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Electrical Installation', null, 'zap', (select id from public.budget_categories where name = 'Electrical' limit 1), 'electrical-installation', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'electrical-installation');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Cables', null, 'cable', (select id from public.budget_categories where name = 'Electrical' limit 1), 'cables', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'cables');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Wiring', null, 'plug', (select id from public.budget_categories where name = 'Electrical' limit 1), 'wiring', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'wiring');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Distribution Boards', null, 'plug-zap', (select id from public.budget_categories where name = 'Electrical' limit 1), 'distribution-boards', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'distribution-boards');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Circuit Breakers', null, 'power', (select id from public.budget_categories where name = 'Electrical' limit 1), 'circuit-breakers', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'circuit-breakers');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Switches', null, 'toggle', (select id from public.budget_categories where name = 'Electrical' limit 1), 'switches', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'switches');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Sockets', null, 'circle-dot', (select id from public.budget_categories where name = 'Electrical' limit 1), 'sockets', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'sockets');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Lighting', null, 'lightbulb', (select id from public.budget_categories where name = 'Electrical' limit 1), 'lighting', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'lighting');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'LED Lighting', null, 'lamp', (select id from public.budget_categories where name = 'Electrical' limit 1), 'led-lighting', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'led-lighting');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Emergency Lighting', null, 'siren', (select id from public.budget_categories where name = 'Electrical' limit 1), 'emergency-lighting', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'emergency-lighting');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Electrical Panels', null, 'gauge', (select id from public.budget_categories where name = 'Electrical' limit 1), 'electrical-panels', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'electrical-panels');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Grounding', null, 'battery', (select id from public.budget_categories where name = 'Electrical' limit 1), 'grounding', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'grounding');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Generators', null, 'cog', (select id from public.budget_categories where name = 'Electrical' limit 1), 'generators', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'generators');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Water Supply', null, 'droplets', (select id from public.budget_categories where name = 'Plumbing & Water' limit 1), 'water-supply', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'water-supply');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Drainage', null, 'waves', (select id from public.budget_categories where name = 'Plumbing & Water' limit 1), 'drainage', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'drainage');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Wastewater', null, 'pipette', (select id from public.budget_categories where name = 'Plumbing & Water' limit 1), 'wastewater', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'wastewater');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Piping', null, 'wrench', (select id from public.budget_categories where name = 'Plumbing & Water' limit 1), 'piping', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'piping');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Valves', null, 'gauge', (select id from public.budget_categories where name = 'Plumbing & Water' limit 1), 'valves', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'valves');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Pumps', null, 'cog', (select id from public.budget_categories where name = 'Plumbing & Water' limit 1), 'pumps', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'pumps');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Water Tanks', null, 'container', (select id from public.budget_categories where name = 'Plumbing & Water' limit 1), 'water-tanks', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'water-tanks');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Water Heaters', null, 'heater', (select id from public.budget_categories where name = 'Plumbing & Water' limit 1), 'water-heaters', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'water-heaters');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Sanitary Equipment', null, 'toilet', (select id from public.budget_categories where name = 'Plumbing & Water' limit 1), 'sanitary-equipment', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'sanitary-equipment');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Fittings', null, 'key', (select id from public.budget_categories where name = 'Plumbing & Water' limit 1), 'fittings', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'fittings');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Irrigation', null, 'shower', (select id from public.budget_categories where name = 'Plumbing & Water' limit 1), 'irrigation', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'irrigation');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Air Conditioning', null, 'snowflake', (select id from public.budget_categories where name = 'HVAC' limit 1), 'air-conditioning', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'air-conditioning');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Ventilation', null, 'fan', (select id from public.budget_categories where name = 'HVAC' limit 1), 'ventilation', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'ventilation');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Heating', null, 'flame', (select id from public.budget_categories where name = 'HVAC' limit 1), 'heating', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'heating');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Ductwork', null, 'air-vent', (select id from public.budget_categories where name = 'HVAC' limit 1), 'ductwork', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'ductwork');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'HVAC Equipment', null, 'settings', (select id from public.budget_categories where name = 'HVAC' limit 1), 'hvac-equipment', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'hvac-equipment');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Chillers', null, 'snowflake', (select id from public.budget_categories where name = 'HVAC' limit 1), 'chillers', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'chillers');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Heat Pumps', null, 'thermometer', (select id from public.budget_categories where name = 'HVAC' limit 1), 'heat-pumps', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'heat-pumps');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Air Handling Units', null, 'fan', (select id from public.budget_categories where name = 'HVAC' limit 1), 'air-handling-units', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'air-handling-units');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Heavy Machinery', null, 'tractor', (select id from public.budget_categories where name = 'Equipment' limit 1), 'heavy-machinery', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'heavy-machinery');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Excavators', null, 'forklift', (select id from public.budget_categories where name = 'Equipment' limit 1), 'excavators', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'excavators');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Loaders', null, 'truck', (select id from public.budget_categories where name = 'Equipment' limit 1), 'loaders', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'loaders');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Cranes', null, 'settings', (select id from public.budget_categories where name = 'Equipment' limit 1), 'cranes', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'cranes');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Generators', null, 'power', (select id from public.budget_categories where name = 'Equipment' limit 1), 'generators-eq', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'generators-eq');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Compressors', null, 'gauge', (select id from public.budget_categories where name = 'Equipment' limit 1), 'compressors', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'compressors');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Power Tools', null, 'drill', (select id from public.budget_categories where name = 'Equipment' limit 1), 'power-tools', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'power-tools');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Hand Tools', null, 'wrench', (select id from public.budget_categories where name = 'Equipment' limit 1), 'hand-tools', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'hand-tools');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Safety Equipment', null, 'shield-check', (select id from public.budget_categories where name = 'Equipment' limit 1), 'safety-equipment', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'safety-equipment');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Transport Equipment', null, 'package', (select id from public.budget_categories where name = 'Equipment' limit 1), 'transport-equipment', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'transport-equipment');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Cement', null, 'package', (select id from public.budget_categories where name = 'Materials' limit 1), 'cement', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'cement');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Sand', null, 'layers', (select id from public.budget_categories where name = 'Materials' limit 1), 'sand', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'sand');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Gravel', null, 'container', (select id from public.budget_categories where name = 'Materials' limit 1), 'gravel', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'gravel');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Steel', null, 'cog', (select id from public.budget_categories where name = 'Materials' limit 1), 'steel', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'steel');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Timber', null, 'ruler', (select id from public.budget_categories where name = 'Materials' limit 1), 'timber', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'timber');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Bricks', null, 'brick-wall', (select id from public.budget_categories where name = 'Materials' limit 1), 'bricks', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'bricks');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Blocks', null, 'blocks', (select id from public.budget_categories where name = 'Materials' limit 1), 'blocks', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'blocks');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Tiles', null, 'grid', (select id from public.budget_categories where name = 'Materials' limit 1), 'tiles', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'tiles');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Glass', null, 'app-window', (select id from public.budget_categories where name = 'Materials' limit 1), 'glass', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'glass');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Aluminium', null, 'frame', (select id from public.budget_categories where name = 'Materials' limit 1), 'aluminium-mat', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'aluminium-mat');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Wood', null, 'drafting-compass', (select id from public.budget_categories where name = 'Materials' limit 1), 'wood', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'wood');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Paint', null, 'paint-bucket', (select id from public.budget_categories where name = 'Materials' limit 1), 'paint', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'paint');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Doors', null, 'door-open', (select id from public.budget_categories where name = 'Joinery' limit 1), 'doors', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'doors');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Windows', null, 'app-window', (select id from public.budget_categories where name = 'Joinery' limit 1), 'windows', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'windows');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Aluminium Joinery', null, 'frame', (select id from public.budget_categories where name = 'Joinery' limit 1), 'aluminium-joinery', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'aluminium-joinery');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'PVC Joinery', null, 'door-closed', (select id from public.budget_categories where name = 'Joinery' limit 1), 'pvc-joinery', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'pvc-joinery');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Locks', null, 'lock', (select id from public.budget_categories where name = 'Joinery' limit 1), 'locks', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'locks');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Handles', null, 'key', (select id from public.budget_categories where name = 'Joinery' limit 1), 'handles', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'handles');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Frames', null, 'rows', (select id from public.budget_categories where name = 'Joinery' limit 1), 'frames', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'frames');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Shutters', null, 'columns', (select id from public.budget_categories where name = 'Joinery' limit 1), 'shutters', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'shutters');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Site Transport', null, 'truck', (select id from public.budget_categories where name = 'Site & Logistics' limit 1), 'site-transport', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'site-transport');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Delivery', null, 'package', (select id from public.budget_categories where name = 'Site & Logistics' limit 1), 'delivery', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'delivery');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Storage', null, 'container', (select id from public.budget_categories where name = 'Site & Logistics' limit 1), 'storage', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'storage');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Site Security', null, 'shield-check', (select id from public.budget_categories where name = 'Site & Logistics' limit 1), 'site-security', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'site-security');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Waste Removal', null, 'trash', (select id from public.budget_categories where name = 'Site & Logistics' limit 1), 'waste-removal', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'waste-removal');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Temporary Facilities', null, 'building', (select id from public.budget_categories where name = 'Site & Logistics' limit 1), 'temporary-facilities', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'temporary-facilities');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Site Utilities', null, 'plug', (select id from public.budget_categories where name = 'Site & Logistics' limit 1), 'site-utilities', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'site-utilities');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Fuel', null, 'battery', (select id from public.budget_categories where name = 'Site & Logistics' limit 1), 'fuel', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'fuel');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Personal Protective Equipment', null, 'shield-check', (select id from public.budget_categories where name = 'Safety' limit 1), 'ppe', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'ppe');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Safety Helmets', null, 'hard-hat', (select id from public.budget_categories where name = 'Safety' limit 1), 'safety-helmets', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'safety-helmets');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Safety Harnesses', null, 'cable', (select id from public.budget_categories where name = 'Safety' limit 1), 'safety-harnesses', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'safety-harnesses');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Safety Signage', null, 'siren', (select id from public.budget_categories where name = 'Safety' limit 1), 'safety-signage', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'safety-signage');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Fire Extinguishers', null, 'flame', (select id from public.budget_categories where name = 'Safety' limit 1), 'fire-extinguishers', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'fire-extinguishers');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'First Aid', null, 'briefcase', (select id from public.budget_categories where name = 'Safety' limit 1), 'first-aid', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'first-aid');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Site Safety', null, 'traffic-cone', (select id from public.budget_categories where name = 'Safety' limit 1), 'site-safety', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'site-safety');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Architect', null, 'drafting-compass', (select id from public.budget_categories where name = 'Professional Services' limit 1), 'architect', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'architect');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Engineering', null, 'ruler', (select id from public.budget_categories where name = 'Professional Services' limit 1), 'engineering', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'engineering');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Structural Engineering', null, 'cog', (select id from public.budget_categories where name = 'Professional Services' limit 1), 'structural-engineering', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'structural-engineering');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Electrical Engineering', null, 'zap', (select id from public.budget_categories where name = 'Professional Services' limit 1), 'electrical-engineering', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'electrical-engineering');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Mechanical Engineering', null, 'settings', (select id from public.budget_categories where name = 'Professional Services' limit 1), 'mechanical-engineering', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'mechanical-engineering');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Surveying', null, 'scale', (select id from public.budget_categories where name = 'Professional Services' limit 1), 'surveying', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'surveying');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Inspection', null, 'file-search', (select id from public.budget_categories where name = 'Professional Services' limit 1), 'inspection', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'inspection');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Consulting', null, 'handshake', (select id from public.budget_categories where name = 'Professional Services' limit 1), 'consulting', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'consulting');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Project Management', null, 'clipboard-list', (select id from public.budget_categories where name = 'Professional Services' limit 1), 'project-management', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'project-management');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Preventive Maintenance', null, 'settings', (select id from public.budget_categories where name = 'Maintenance' limit 1), 'preventive-maintenance', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'preventive-maintenance');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Corrective Maintenance', null, 'wrench', (select id from public.budget_categories where name = 'Maintenance' limit 1), 'corrective-maintenance', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'corrective-maintenance');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Electrical Maintenance', null, 'zap', (select id from public.budget_categories where name = 'Maintenance' limit 1), 'electrical-maintenance', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'electrical-maintenance');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Plumbing Maintenance', null, 'droplets', (select id from public.budget_categories where name = 'Maintenance' limit 1), 'plumbing-maintenance', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'plumbing-maintenance');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'HVAC Maintenance', null, 'fan', (select id from public.budget_categories where name = 'Maintenance' limit 1), 'hvac-maintenance', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'hvac-maintenance');
insert into public.budget_categories (name, description, icon, parent_category_id, subcategory_key, is_custom, sort_order)
  select 'Building Maintenance', null, 'building', (select id from public.budget_categories where name = 'Maintenance' limit 1), 'building-maintenance', false, 50
  where not exists (select 1 from public.budget_categories c where c.subcategory_key = 'building-maintenance');

notify pgrst, 'reload schema';
