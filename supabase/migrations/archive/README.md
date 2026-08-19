# Superseded — do not run these

`0010_ops_portal_roles.sql` and `0011_activity_log_and_staff_admin.sql`
were written against a `staff` table this project never actually has. The
live database uses `admin_users` instead (role check constraint
`'admin' | 'planner' | 'sales'`), which `0012_adapt_to_real_schema.sql`
builds on top of.

`0012`'s own header says as much ("SUPERSEDES 0010/0011 for this
project... Do NOT run 0010/0011 against this project"), but the project
README didn't reflect that until this was caught in review — it told you
to run `0010` then `0011`, in that order, ahead of `0012`.

Running `0010` here is actively harmful, not just redundant: it
`create or replace`s `is_admin()` to check the (nonexistent, for this
project) `staff` table, silently breaking every `is_admin()`-gated RLS
policy `0012` set up. It also adds a self-service role-escalation hole
(`staff can update own profile`, unscoped to any column) that doesn't
exist in `0012`'s `admin_users` policies.

Kept here for history only. The real migration order is:

```
0009_base_schema.sql
0012_adapt_to_real_schema.sql
0013_locations_and_guests.sql
0014_security_hardening.sql
```
