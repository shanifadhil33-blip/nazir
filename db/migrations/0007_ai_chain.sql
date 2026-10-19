CREATE TABLE nazir.ai_usage (
 day date NOT NULL, task text NOT NULL CHECK(task IN ('test_run','live_demo','probe')),
 provider text NOT NULL, model text NOT NULL,
 calls integer NOT NULL DEFAULT 0 CHECK(calls>=0), ok integer NOT NULL DEFAULT 0 CHECK(ok>=0), failed integer NOT NULL DEFAULT 0 CHECK(failed>=0),
 PRIMARY KEY(day,task,provider,model), CHECK(ok+failed<=calls)
);
CREATE TABLE nazir.ai_cooldowns (
 provider text NOT NULL, model text NOT NULL, until timestamptz NOT NULL, reason text NOT NULL,
 PRIMARY KEY(provider,model)
);
CREATE TABLE nazir.ai_calls (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), at timestamptz NOT NULL,
 task text NOT NULL CHECK(task IN ('test_run','live_demo','probe')), purpose text NOT NULL CHECK(purpose IN ('agent','judge')),
 provider text NOT NULL, model text NOT NULL, family text NOT NULL,
 outcome text NOT NULL CHECK(outcome IN ('ok','error','skipped')), reason text NOT NULL,
 http_status integer CHECK(http_status BETWEEN 100 AND 599), latency_ms integer NOT NULL CHECK(latency_ms>=0),
 failover boolean NOT NULL, attempt_no integer NOT NULL CHECK(attempt_no>0), workspace_id uuid, conversation_id uuid
);
CREATE INDEX ON nazir.ai_usage(day,provider);
CREATE INDEX ON nazir.ai_calls(at);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['ai_usage','ai_cooldowns','ai_calls'] LOOP
  EXECUTE format('ALTER TABLE nazir.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE nazir.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON nazir.%I FROM PUBLIC,nazir_app,nazir_worker,nazir_sandbox,nazir_inspector',t);
 END LOOP;
END $$;
-- Internal validation is not executable by service roles. Error messages never echo inputs.
CREATE FUNCTION nazir.ai_identifiers(p_provider text,p_model text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT coalesce(p_provider ~ '^[a-z][a-z0-9_]{0,31}$' AND p_model ~ '^[A-Za-z0-9@][A-Za-z0-9_./:@-]{0,127}$',false)
$$;
CREATE FUNCTION nazir.ai_reserve(p_task text,p_provider text,p_model text,p_task_cap integer,p_provider_cap integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
DECLARE today date;
BEGIN
 IF p_task IS NULL OR p_task NOT IN ('test_run','live_demo','probe') OR NOT nazir.ai_identifiers(p_provider,p_model) OR p_task_cap IS NULL OR p_provider_cap IS NULL OR p_task_cap<0 OR p_provider_cap<0 THEN RAISE EXCEPTION 'Invalid AI reservation'; END IF;
 -- One daily lock protects both cross-provider task totals and cross-task provider totals.
 PERFORM pg_advisory_xact_lock(710192027);
 today := (clock_timestamp() AT TIME ZONE 'UTC')::date;
 IF (SELECT coalesce(sum(calls),0) FROM nazir.ai_usage WHERE day=today AND task=p_task)>=p_task_cap
 OR (SELECT coalesce(sum(calls),0) FROM nazir.ai_usage WHERE day=today AND provider=p_provider)>=p_provider_cap THEN RETURN false; END IF;
 INSERT INTO nazir.ai_usage(day,task,provider,model,calls) VALUES(today,p_task,p_provider,p_model,1)
 ON CONFLICT(day,task,provider,model) DO UPDATE SET calls=ai_usage.calls+1;
 RETURN true;
END $$;
CREATE FUNCTION nazir.ai_record(p_at timestamptz,p_task text,p_purpose text,p_provider text,p_model text,p_family text,p_outcome text,p_reason text,p_http_status integer,p_latency_ms integer,p_failover boolean,p_attempt_no integer,p_workspace_id uuid,p_conversation_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF p_at IS NULL OR NOT isfinite(p_at) OR p_task IS NULL OR p_task NOT IN ('test_run','live_demo','probe') OR p_purpose IS NULL OR p_purpose NOT IN ('agent','judge') OR NOT nazir.ai_identifiers(p_provider,p_model)
 OR p_family IS NULL OR p_family NOT IN ('google_gemini','nvidia_nemotron','google_gemma','openai_gpt_oss','zhipu_glm','alibaba_qwen','unknown')
 OR p_outcome IS NULL OR p_outcome NOT IN ('ok','error','skipped')
 OR p_reason IS NULL OR p_reason NOT IN ('ok','no_key','cooling','dropped','forced_down','cap_reached','rate_limited','day_used','payment_required','auth_failed','timeout','http_5xx','network','invalid_response','invalid_tool_args','deadline')
 OR p_latency_ms IS NULL OR p_latency_ms<0 OR p_attempt_no IS NULL OR p_attempt_no<1 OR p_failover IS NULL THEN RAISE EXCEPTION 'Invalid AI record'; END IF;
 INSERT INTO nazir.ai_calls(at,task,purpose,provider,model,family,outcome,reason,http_status,latency_ms,failover,attempt_no,workspace_id,conversation_id)
 VALUES(p_at,p_task,p_purpose,p_provider,p_model,p_family,p_outcome,p_reason,p_http_status,p_latency_ms,p_failover,p_attempt_no,p_workspace_id,p_conversation_id);
 -- Only network outcomes consume an earlier reservation. Local rejections have no usage row.
 IF p_outcome<>'skipped' AND p_reason<>'forced_down' THEN
  UPDATE nazir.ai_usage SET ok=ok+CASE WHEN p_outcome='ok' THEN 1 ELSE 0 END,failed=failed+CASE WHEN p_outcome='error' THEN 1 ELSE 0 END
  WHERE day=(p_at AT TIME ZONE 'UTC')::date AND task=p_task AND provider=p_provider AND model=p_model;
 END IF;
END $$;
CREATE FUNCTION nazir.ai_cool(p_provider text,p_model text,p_until timestamptz,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
BEGIN
 IF NOT nazir.ai_identifiers(p_provider,CASE WHEN p_model='*' THEN 'all' ELSE p_model END) OR p_until IS NULL OR NOT isfinite(p_until) OR p_reason IS NULL OR p_reason NOT IN ('day_used','rate_limited','payment_required','auth_failed') THEN RAISE EXCEPTION 'Invalid AI cooldown'; END IF;
 INSERT INTO nazir.ai_cooldowns VALUES(p_provider,p_model,p_until,p_reason)
 ON CONFLICT(provider,model) DO UPDATE SET until=greatest(ai_cooldowns.until,excluded.until),reason=excluded.reason;
END $$;
CREATE FUNCTION nazir.ai_active_cooldowns() RETURNS SETOF nazir.ai_cooldowns
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
 SELECT * FROM nazir.ai_cooldowns WHERE until>clock_timestamp()
$$;
CREATE FUNCTION nazir.ai_usage_today() RETURNS SETOF nazir.ai_usage
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
 SELECT * FROM nazir.ai_usage WHERE day=(clock_timestamp() AT TIME ZONE 'UTC')::date
$$;
REVOKE ALL ON FUNCTION nazir.ai_identifiers(text,text),nazir.ai_reserve(text,text,text,integer,integer),nazir.ai_record(timestamptz,text,text,text,text,text,text,text,integer,integer,boolean,integer,uuid,uuid),nazir.ai_cool(text,text,timestamptz,text),nazir.ai_active_cooldowns(),nazir.ai_usage_today() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.ai_reserve(text,text,text,integer,integer),nazir.ai_record(timestamptz,text,text,text,text,text,text,text,integer,integer,boolean,integer,uuid,uuid),nazir.ai_cool(text,text,timestamptz,text),nazir.ai_active_cooldowns(),nazir.ai_usage_today() TO nazir_worker;
