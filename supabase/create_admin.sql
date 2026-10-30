-- Create one admin account after running setup.sql.
-- Replace the username and password placeholders before running this query.
-- Postgres hashes the password with pgcrypto's bcrypt implementation.
-- The password is visible in the SQL query text while you run it. Do not save,
-- commit, or share this query after replacing the placeholder.

insert into public.admins (username, password_hash, created_at, is_active)
values (
  'REPLACE_WITH_USERNAME',
  extensions.crypt('REPLACE_WITH_LONG_PASSWORD', extensions.gen_salt('bf', 12)),
  now(),
  true
);

-- To reset an existing admin instead of creating a new row, comment out the
-- INSERT above and use this UPDATE (replace both placeholders):
-- update public.admins
-- set password_hash = extensions.crypt('REPLACE_WITH_NEW_LONG_PASSWORD', extensions.gen_salt('bf', 12)),
--     is_active = true
-- where username = 'EXISTING_USERNAME';
