-- Auth.js stretches a database session to its full 30 days the first time it is used, which undid the 12 hour life of a demo session.
-- A demo person's session now keeps the time it was given, and the ones already stretched are cut back.
CREATE OR REPLACE FUNCTION nazir.auth_update_session(p_hash text,p_expires timestamptz) RETURNS SETOF nazir.auth_sessions
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
UPDATE nazir.auth_sessions s SET expires=CASE WHEN EXISTS(SELECT 1 FROM nazir.users u WHERE u.id=s.user_id AND u.email LIKE '%@demo.nazir.test') THEN s.expires ELSE coalesce(p_expires,s.expires) END
WHERE s.token_hash=p_hash AND s.expires>clock_timestamp() RETURNING s.*
$$;
UPDATE nazir.auth_sessions s SET expires=LEAST(s.expires,clock_timestamp()+interval '12 hours')
FROM nazir.users u WHERE u.id=s.user_id AND u.email LIKE '%@demo.nazir.test';
