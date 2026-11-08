-- The migration owner can switch roles within a transaction. Ordinary owner queries retain their privileges.
CREATE ROLE pes_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
--> statement-breakpoint
GRANT pes_app TO CURRENT_USER WITH INHERIT FALSE;
--> statement-breakpoint
GRANT pes_app TO CURRENT_USER WITH SET TRUE;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO pes_app;
--> statement-breakpoint
DO $tenant_wall$
DECLARE
  table_name text;
  tenant_column text;
  tenant_scope constant text := '(SELECT NULLIF(current_setting(''app.household_id'', true), '''')::uuid)';
BEGIN
  -- List app-owned tenant tables explicitly. Global counters, Auth, Vault and Storage keep their existing access.
  FOREACH table_name IN ARRAY ARRAY[
    'api_tokens', 'ask_receipts', 'balance_updates', 'bills', 'canvases', 'card_statements', 'cards', 'charges',
    'clients', 'conversation_turns', 'documents', 'events', 'family_links', 'fx_rates', 'households', 'invites',
    'invoices', 'members', 'memories', 'paypal_connections', 'pots', 'push_subscriptions', 'readings',
    'reminder_settings', 'reminders', 'request_buckets', 'rules', 'settlements', 'standing_rules',
    'suggestions', 'users', 'webhook_deliveries'
  ] LOOP
    tenant_column := CASE WHEN table_name = 'households' THEN 'id' ELSE 'household_id' END;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO pes_app', table_name);
    EXECUTE format(
      'CREATE POLICY pes_app_household ON public.%1$I FOR ALL TO pes_app
       USING (%2$I = %3$s)
       WITH CHECK (%2$I = %3$s)',
      table_name, tenant_column, tenant_scope
    );
  END LOOP;
END
$tenant_wall$;
