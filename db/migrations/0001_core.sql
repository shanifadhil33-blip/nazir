CREATE SCHEMA nazir;
REVOKE ALL ON SCHEMA nazir FROM PUBLIC;
CREATE TABLE nazir.users (
 id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now(),
 email text NOT NULL UNIQUE CHECK(email=lower(email)),
 name text NOT NULL,
 image text
);
CREATE TABLE nazir.workspaces (
 id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now(),
 name text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('real','demo')),
 created_by uuid NOT NULL REFERENCES nazir.users(id)
);
CREATE TABLE nazir.members (
 id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now(),
 workspace_id uuid NOT NULL REFERENCES nazir.workspaces(id),
 UNIQUE(workspace_id,id),
 user_id uuid NOT NULL REFERENCES nazir.users(id),
 display_name text NOT NULL,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','removed')),
 UNIQUE(workspace_id,user_id)
);
CREATE TABLE nazir.member_roles (
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT now(),
 workspace_id uuid NOT NULL REFERENCES nazir.workspaces(id),
 UNIQUE(workspace_id,id),
 member_id uuid NOT NULL,
 role text NOT NULL CHECK(role IN ('service_owner','supplier_maintainer','quality_reviewer','viewer')),
 PRIMARY KEY(member_id,role)
);
CREATE TABLE nazir.rule_packs (
 id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now(),
 workspace_id uuid NOT NULL REFERENCES nazir.workspaces(id),
 UNIQUE(workspace_id,id),
 key text NOT NULL,
 title text NOT NULL,
 UNIQUE(workspace_id,key)
);
CREATE TABLE nazir.rule_pack_versions (
 id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now(),
 workspace_id uuid NOT NULL REFERENCES nazir.workspaces(id),
 UNIQUE(workspace_id,id),
 rule_pack_id uuid NOT NULL,
 version int NOT NULL CHECK(version>0),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved','retired')),
 content jsonb NOT NULL,
 content_hash text NOT NULL,
 approved_by uuid,
 approved_at timestamptz,
 UNIQUE(rule_pack_id,version)
);
CREATE TABLE nazir.agents (
 id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now(),
 workspace_id uuid NOT NULL REFERENCES nazir.workspaces(id),
 UNIQUE(workspace_id,id),
 name text NOT NULL,
 description text
);
CREATE TABLE nazir.agent_versions (
 id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now(),
 workspace_id uuid NOT NULL REFERENCES nazir.workspaces(id),
 UNIQUE(workspace_id,id),
 agent_id uuid NOT NULL,
 label text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('baseline','planted_fault','repair')),
 fault_label text,
 config jsonb NOT NULL,
 config_hash text NOT NULL,
 parent_version_id uuid,
 frozen_at timestamptz,
 CHECK(kind<>'planted_fault' OR (fault_label IS NOT NULL AND length(btrim(fault_label))>0))
);
CREATE TABLE nazir.adapters (
 id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now(),
 workspace_id uuid NOT NULL REFERENCES nazir.workspaces(id),
 UNIQUE(workspace_id,id),
 agent_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('http','built_in')),
 base_url text,
 allowed_hosts text[] NOT NULL DEFAULT '{}',
 tool_manifest jsonb NOT NULL,
 manifest_hash text NOT NULL,
 inspection_ref text,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','checked','failed','disabled')),
 last_check_at timestamptz,
 last_check_result jsonb
);
CREATE TABLE nazir.scenario_meanings (
 id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now(),
 workspace_id uuid NOT NULL REFERENCES nazir.workspaces(id),
 UNIQUE(workspace_id,id),
 family text NOT NULL,
 canonical jsonb NOT NULL
);
CREATE TABLE nazir.scenarios (
 id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now(),
 workspace_id uuid NOT NULL REFERENCES nazir.workspaces(id),
 UNIQUE(workspace_id,id),
 meaning_id uuid NOT NULL,
 stable_key text NOT NULL,
 version int NOT NULL CHECK(version>0),
 family text NOT NULL,
 language text NOT NULL CHECK(language IN ('en','ar')),
 split text NOT NULL CHECK(split IN ('development','hidden')),
 persona jsonb NOT NULL,
 starting_state jsonb NOT NULL,
 allowed_actions text[] NOT NULL,
 forbidden_actions text[] NOT NULL,
 expected_state jsonb NOT NULL,
 source_clause text NOT NULL,
 expectation_kind text NOT NULL CHECK(expectation_kind IN ('public_fact','approved_internal_rule','fictional_demo_rule')),
 severity text NOT NULL CHECK(severity IN ('critical','high','medium','low')),
 rubric_version text NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','retired')),
 approved_by uuid,
 approved_at timestamptz,
 content_hash text NOT NULL,
 UNIQUE(workspace_id,stable_key,version)
);
CREATE TABLE nazir.plans (
 id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now(),
 workspace_id uuid NOT NULL REFERENCES nazir.workspaces(id),
 UNIQUE(workspace_id,id),
 goal text NOT NULL,
 agent_version_id uuid NOT NULL,
 rule_pack_version_id uuid NOT NULL,
 families text[] NOT NULL,
 languages text[] NOT NULL CHECK(languages <@ ARRAY['en','ar']::text[]),
 repeats int NOT NULL CHECK(repeats>0),
 budget_calls int NOT NULL CHECK(budget_calls>0),
 stop_rules jsonb NOT NULL,
 status text NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','approved','rejected','cancelled')),
 proposed_by_type text NOT NULL CHECK(proposed_by_type IN ('member','nazir')),
 proposed_by uuid,
 approved_by uuid,
 approved_at timestamptz
);
CREATE TABLE nazir.runs (
 id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now(),
 workspace_id uuid NOT NULL REFERENCES nazir.workspaces(id),
 UNIQUE(workspace_id,id),
 plan_id uuid NOT NULL,
 agent_version_id uuid NOT NULL,
 rule_pack_version_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','running','passed','failed','inconclusive','cancelled')),
 frozen_manifest jsonb NOT NULL,
 manifest_hash text NOT NULL,
 runner_version text NOT NULL,
 calls_used int NOT NULL DEFAULT 0 CHECK(calls_used>=0),
 started_at timestamptz,
 finished_at timestamptz,
 inconclusive_reason text
);
CREATE TABLE nazir.conversations (
 id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now(),
 workspace_id uuid NOT NULL REFERENCES nazir.workspaces(id),
 UNIQUE(workspace_id,id),
 run_id uuid NOT NULL,
 scenario_id uuid NOT NULL,
 language text NOT NULL CHECK(language IN ('en','ar')),
 status text NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','running','passed','failed','inconclusive','cancelled')),
 idempotency_key text NOT NULL,
 attempt int NOT NULL DEFAULT 1 CHECK(attempt>0),
 lease_owner text,
 lease_expires_at timestamptz,
 sandbox_tenant text,
 inconclusive_reason text,
 started_at timestamptz,
 finished_at timestamptz,
 model_provider text,
 model_id text,
 failover boolean NOT NULL DEFAULT false,
 UNIQUE(run_id,idempotency_key)
);
CREATE TABLE nazir.conversation_messages (
 id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now(),
 workspace_id uuid NOT NULL REFERENCES nazir.workspaces(id),
 UNIQUE(workspace_id,id),
 conversation_id uuid NOT NULL,
 seq int NOT NULL CHECK(seq>0),
 speaker text NOT NULL CHECK(speaker IN ('resident','agent','system')),
 body text NOT NULL,
 UNIQUE(conversation_id,seq)
);
CREATE TABLE nazir.tool_events (
 id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now(),
 workspace_id uuid NOT NULL REFERENCES nazir.workspaces(id),
 UNIQUE(workspace_id,id),
 conversation_id uuid NOT NULL,
 seq int NOT NULL CHECK(seq>0),
 tool_name text NOT NULL,
 request jsonb NOT NULL,
 response jsonb NOT NULL,
 outcome text NOT NULL CHECK(outcome IN ('ok','error','blocked')),
 idempotency_key text,
 payload_hash text NOT NULL,
 UNIQUE(conversation_id,seq)
);
CREATE TABLE nazir.state_readings (
 id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now(),
 workspace_id uuid NOT NULL REFERENCES nazir.workspaces(id),
 UNIQUE(workspace_id,id),
 conversation_id uuid NOT NULL,
 source text NOT NULL CHECK(source IN ('inspection_channel')),
 reading jsonb NOT NULL,
 reading_hash text NOT NULL,
 read_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE nazir.findings (
 id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now(),
 workspace_id uuid NOT NULL REFERENCES nazir.workspaces(id),
 UNIQUE(workspace_id,id),
 run_id uuid NOT NULL,
 conversation_id uuid NOT NULL,
 scenario_id uuid NOT NULL,
 check_layer text NOT NULL CHECK(check_layer IN ('deterministic','semantic','human')),
 title text NOT NULL,
 agent_said text NOT NULL,
 really_happened text NOT NULL,
 rule_pack_version_id uuid NOT NULL,
 rule_clause text NOT NULL,
 agent_version_id uuid NOT NULL,
 severity text NOT NULL CHECK(severity IN ('critical','high','medium','low')),
 root_cause_class text NOT NULL CHECK(root_cause_class IN ('knowledge_or_source','prompt_ambiguity','missing_authorization','wrong_tool_argument','adapter_failure','workflow_failure','unknown')),
 owner_role text NOT NULL CHECK(owner_role IN ('service_owner','supplier_maintainer','quality_reviewer','viewer')),
 evidence jsonb NOT NULL,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','overridden','repair_proposed','retest_passed','retest_failed','accepted'))
);
CREATE TABLE nazir.proposals (
 id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now(),
 workspace_id uuid NOT NULL REFERENCES nazir.workspaces(id),
 UNIQUE(workspace_id,id),
 finding_id uuid NOT NULL,
 proposed_by_type text NOT NULL CHECK(proposed_by_type IN ('member','nazir')),
 proposed_by uuid,
 evidence text NOT NULL,
 patch jsonb,
 expected_benefit text,
 possible_regression text,
 status text NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','approved','rejected','withdrawn')),
 resulting_agent_version_id uuid
);
CREATE TABLE nazir.approvals (
 id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now(),
 workspace_id uuid NOT NULL REFERENCES nazir.workspaces(id),
 UNIQUE(workspace_id,id),
 subject_type text NOT NULL CHECK(subject_type IN ('rule_pack_version','plan','proposal','lesson','finding_override','release','scenario')),
 subject_id uuid NOT NULL,
 decision text NOT NULL CHECK(decision IN ('approve','reject')),
 reason text NOT NULL CHECK(length(btrim(reason))>=3),
 evidence_opened boolean NOT NULL DEFAULT false,
 decided_by uuid NOT NULL,
 decided_by_name_at_event text NOT NULL,
 decided_by_roles_at_event text[] NOT NULL,
 decided_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE nazir.lessons (
 id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now(),
 workspace_id uuid NOT NULL REFERENCES nazir.workspaces(id),
 UNIQUE(workspace_id,id),
 text text NOT NULL,
 scope text NOT NULL CHECK(scope IN ('small','big')),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','waiting_approval','rejected','deleted')),
 source_conversation_ids uuid[] NOT NULL DEFAULT '{}',
 created_by_type text NOT NULL CHECK(created_by_type IN ('member','nazir')),
 confirmed_by uuid,
 approved_by uuid,
 version int NOT NULL DEFAULT 1 CHECK(version>0),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE nazir.lesson_revisions (
 id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now(),
 workspace_id uuid NOT NULL REFERENCES nazir.workspaces(id),
 UNIQUE(workspace_id,id),
 lesson_id uuid NOT NULL,
 version int NOT NULL CHECK(version>0),
 text_before text,
 text_after text NOT NULL,
 status_before text CHECK(status_before IN ('active','waiting_approval','rejected','deleted')),
 status_after text NOT NULL CHECK(status_after IN ('active','waiting_approval','rejected','deleted')),
 changed_by uuid,
 changed_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(lesson_id,version)
);
CREATE INDEX ON nazir.members(workspace_id);
CREATE INDEX ON nazir.member_roles(workspace_id);
ALTER TABLE nazir.member_roles ADD FOREIGN KEY(workspace_id,member_id) REFERENCES nazir.members(workspace_id,id);
CREATE INDEX ON nazir.member_roles(workspace_id,member_id);
CREATE INDEX ON nazir.rule_packs(workspace_id);
CREATE INDEX ON nazir.rule_pack_versions(workspace_id);
ALTER TABLE nazir.rule_pack_versions ADD FOREIGN KEY(workspace_id,rule_pack_id) REFERENCES nazir.rule_packs(workspace_id,id);
CREATE INDEX ON nazir.rule_pack_versions(workspace_id,rule_pack_id);
ALTER TABLE nazir.rule_pack_versions ADD FOREIGN KEY(workspace_id,approved_by) REFERENCES nazir.members(workspace_id,id);
CREATE INDEX ON nazir.rule_pack_versions(workspace_id,approved_by);
CREATE INDEX ON nazir.agents(workspace_id);
CREATE INDEX ON nazir.agent_versions(workspace_id);
ALTER TABLE nazir.agent_versions ADD FOREIGN KEY(workspace_id,agent_id) REFERENCES nazir.agents(workspace_id,id);
CREATE INDEX ON nazir.agent_versions(workspace_id,agent_id);
ALTER TABLE nazir.agent_versions ADD FOREIGN KEY(workspace_id,parent_version_id) REFERENCES nazir.agent_versions(workspace_id,id);
CREATE INDEX ON nazir.agent_versions(workspace_id,parent_version_id);
CREATE INDEX ON nazir.adapters(workspace_id);
ALTER TABLE nazir.adapters ADD FOREIGN KEY(workspace_id,agent_id) REFERENCES nazir.agents(workspace_id,id);
CREATE INDEX ON nazir.adapters(workspace_id,agent_id);
CREATE INDEX ON nazir.scenario_meanings(workspace_id);
CREATE INDEX ON nazir.scenarios(workspace_id);
ALTER TABLE nazir.scenarios ADD FOREIGN KEY(workspace_id,meaning_id) REFERENCES nazir.scenario_meanings(workspace_id,id);
CREATE INDEX ON nazir.scenarios(workspace_id,meaning_id);
ALTER TABLE nazir.scenarios ADD FOREIGN KEY(workspace_id,approved_by) REFERENCES nazir.members(workspace_id,id);
CREATE INDEX ON nazir.scenarios(workspace_id,approved_by);
CREATE INDEX ON nazir.plans(workspace_id);
ALTER TABLE nazir.plans ADD FOREIGN KEY(workspace_id,agent_version_id) REFERENCES nazir.agent_versions(workspace_id,id);
CREATE INDEX ON nazir.plans(workspace_id,agent_version_id);
ALTER TABLE nazir.plans ADD FOREIGN KEY(workspace_id,rule_pack_version_id) REFERENCES nazir.rule_pack_versions(workspace_id,id);
CREATE INDEX ON nazir.plans(workspace_id,rule_pack_version_id);
ALTER TABLE nazir.plans ADD FOREIGN KEY(workspace_id,approved_by) REFERENCES nazir.members(workspace_id,id);
CREATE INDEX ON nazir.plans(workspace_id,approved_by);
ALTER TABLE nazir.plans ADD FOREIGN KEY(workspace_id,proposed_by) REFERENCES nazir.members(workspace_id,id);
CREATE INDEX ON nazir.plans(workspace_id,proposed_by);
CREATE INDEX ON nazir.runs(workspace_id);
ALTER TABLE nazir.runs ADD FOREIGN KEY(workspace_id,agent_version_id) REFERENCES nazir.agent_versions(workspace_id,id);
CREATE INDEX ON nazir.runs(workspace_id,agent_version_id);
ALTER TABLE nazir.runs ADD FOREIGN KEY(workspace_id,rule_pack_version_id) REFERENCES nazir.rule_pack_versions(workspace_id,id);
CREATE INDEX ON nazir.runs(workspace_id,rule_pack_version_id);
ALTER TABLE nazir.runs ADD FOREIGN KEY(workspace_id,plan_id) REFERENCES nazir.plans(workspace_id,id);
CREATE INDEX ON nazir.runs(workspace_id,plan_id);
CREATE INDEX ON nazir.conversations(workspace_id);
ALTER TABLE nazir.conversations ADD FOREIGN KEY(workspace_id,run_id) REFERENCES nazir.runs(workspace_id,id);
CREATE INDEX ON nazir.conversations(workspace_id,run_id);
ALTER TABLE nazir.conversations ADD FOREIGN KEY(workspace_id,scenario_id) REFERENCES nazir.scenarios(workspace_id,id);
CREATE INDEX ON nazir.conversations(workspace_id,scenario_id);
CREATE INDEX ON nazir.conversation_messages(workspace_id);
ALTER TABLE nazir.conversation_messages ADD FOREIGN KEY(workspace_id,conversation_id) REFERENCES nazir.conversations(workspace_id,id);
CREATE INDEX ON nazir.conversation_messages(workspace_id,conversation_id);
CREATE INDEX ON nazir.tool_events(workspace_id);
ALTER TABLE nazir.tool_events ADD FOREIGN KEY(workspace_id,conversation_id) REFERENCES nazir.conversations(workspace_id,id);
CREATE INDEX ON nazir.tool_events(workspace_id,conversation_id);
CREATE INDEX ON nazir.state_readings(workspace_id);
ALTER TABLE nazir.state_readings ADD FOREIGN KEY(workspace_id,conversation_id) REFERENCES nazir.conversations(workspace_id,id);
CREATE INDEX ON nazir.state_readings(workspace_id,conversation_id);
CREATE INDEX ON nazir.findings(workspace_id);
ALTER TABLE nazir.findings ADD FOREIGN KEY(workspace_id,agent_version_id) REFERENCES nazir.agent_versions(workspace_id,id);
CREATE INDEX ON nazir.findings(workspace_id,agent_version_id);
ALTER TABLE nazir.findings ADD FOREIGN KEY(workspace_id,rule_pack_version_id) REFERENCES nazir.rule_pack_versions(workspace_id,id);
CREATE INDEX ON nazir.findings(workspace_id,rule_pack_version_id);
ALTER TABLE nazir.findings ADD FOREIGN KEY(workspace_id,run_id) REFERENCES nazir.runs(workspace_id,id);
CREATE INDEX ON nazir.findings(workspace_id,run_id);
ALTER TABLE nazir.findings ADD FOREIGN KEY(workspace_id,scenario_id) REFERENCES nazir.scenarios(workspace_id,id);
CREATE INDEX ON nazir.findings(workspace_id,scenario_id);
ALTER TABLE nazir.findings ADD FOREIGN KEY(workspace_id,conversation_id) REFERENCES nazir.conversations(workspace_id,id);
CREATE INDEX ON nazir.findings(workspace_id,conversation_id);
CREATE INDEX ON nazir.proposals(workspace_id);
ALTER TABLE nazir.proposals ADD FOREIGN KEY(workspace_id,resulting_agent_version_id) REFERENCES nazir.agent_versions(workspace_id,id);
CREATE INDEX ON nazir.proposals(workspace_id,resulting_agent_version_id);
ALTER TABLE nazir.proposals ADD FOREIGN KEY(workspace_id,finding_id) REFERENCES nazir.findings(workspace_id,id);
CREATE INDEX ON nazir.proposals(workspace_id,finding_id);
ALTER TABLE nazir.proposals ADD FOREIGN KEY(workspace_id,proposed_by) REFERENCES nazir.members(workspace_id,id);
CREATE INDEX ON nazir.proposals(workspace_id,proposed_by);
CREATE INDEX ON nazir.approvals(workspace_id);
ALTER TABLE nazir.approvals ADD FOREIGN KEY(workspace_id,decided_by) REFERENCES nazir.members(workspace_id,id);
CREATE INDEX ON nazir.approvals(workspace_id,decided_by);
CREATE INDEX ON nazir.lessons(workspace_id);
ALTER TABLE nazir.lessons ADD FOREIGN KEY(workspace_id,approved_by) REFERENCES nazir.members(workspace_id,id);
CREATE INDEX ON nazir.lessons(workspace_id,approved_by);
ALTER TABLE nazir.lessons ADD FOREIGN KEY(workspace_id,confirmed_by) REFERENCES nazir.members(workspace_id,id);
CREATE INDEX ON nazir.lessons(workspace_id,confirmed_by);
CREATE INDEX ON nazir.lesson_revisions(workspace_id);
ALTER TABLE nazir.lesson_revisions ADD FOREIGN KEY(workspace_id,lesson_id) REFERENCES nazir.lessons(workspace_id,id);
CREATE INDEX ON nazir.lesson_revisions(workspace_id,lesson_id);
ALTER TABLE nazir.lesson_revisions ADD FOREIGN KEY(workspace_id,changed_by) REFERENCES nazir.members(workspace_id,id);
CREATE INDEX ON nazir.lesson_revisions(workspace_id,changed_by);
CREATE UNIQUE INDEX ON nazir.tool_events(conversation_id,idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE FUNCTION nazir.guard_content() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, nazir AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.id<>OLD.id OR NEW.workspace_id<>OLD.workspace_id OR NEW.created_at<>OLD.created_at THEN RAISE EXCEPTION 'Identity is immutable'; END IF;
  IF TG_TABLE_NAME IN ('rule_pack_versions','scenarios') THEN
   IF OLD.status IN ('approved','retired') THEN
   IF NEW.status NOT IN ('approved','retired') OR (OLD.status='retired' AND NEW.status<>'retired') OR (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN RAISE EXCEPTION 'Approved content is immutable'; END IF;
   END IF;
  ELSIF TG_TABLE_NAME='agent_versions' THEN
   IF OLD.frozen_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Frozen version is immutable'; END IF;
  ELSIF TG_TABLE_NAME='runs' THEN
   IF NEW.frozen_manifest IS DISTINCT FROM OLD.frozen_manifest OR NEW.manifest_hash IS DISTINCT FROM OLD.manifest_hash THEN RAISE EXCEPTION 'Manifest is immutable'; END IF;
  ELSIF TG_TABLE_NAME='findings' AND (to_jsonb(NEW)-ARRAY['status','owner_role']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','owner_role']) THEN RAISE EXCEPTION 'Finding evidence is immutable';
  END IF;
 END IF;
 CASE TG_TABLE_NAME
 WHEN 'rule_pack_versions' THEN NEW.content_hash:=encode(sha256(convert_to(NEW.content::text,'UTF8')),'hex');
 WHEN 'agent_versions' THEN NEW.config_hash:=encode(sha256(convert_to(NEW.config::text,'UTF8')),'hex');
 WHEN 'adapters' THEN NEW.manifest_hash:=encode(sha256(convert_to(NEW.tool_manifest::text,'UTF8')),'hex');
 WHEN 'scenarios' THEN NEW.content_hash:=encode(sha256(convert_to((to_jsonb(NEW)-ARRAY['id','workspace_id','created_at','content_hash','status','approved_by','approved_at'])::text,'UTF8')),'hex');
 WHEN 'runs' THEN NEW.manifest_hash:=encode(sha256(convert_to(NEW.frozen_manifest::text,'UTF8')),'hex');
 WHEN 'tool_events' THEN NEW.payload_hash:=encode(sha256(convert_to(jsonb_build_object('request',NEW.request,'response',NEW.response)::text,'UTF8')),'hex');
 WHEN 'state_readings' THEN NEW.reading_hash:=encode(sha256(convert_to(NEW.reading::text,'UTF8')),'hex');
 ELSE NULL;
 END CASE;
 RETURN NEW;
END $$;
CREATE FUNCTION nazir.reject_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, nazir AS $$ BEGIN RAISE EXCEPTION 'Append only record'; END $$;
CREATE TRIGGER guard_content BEFORE INSERT OR UPDATE ON nazir.rule_pack_versions FOR EACH ROW EXECUTE FUNCTION nazir.guard_content();
CREATE TRIGGER guard_content BEFORE INSERT OR UPDATE ON nazir.agent_versions FOR EACH ROW EXECUTE FUNCTION nazir.guard_content();
CREATE TRIGGER guard_content BEFORE INSERT OR UPDATE ON nazir.adapters FOR EACH ROW EXECUTE FUNCTION nazir.guard_content();
CREATE TRIGGER guard_content BEFORE INSERT OR UPDATE ON nazir.scenarios FOR EACH ROW EXECUTE FUNCTION nazir.guard_content();
CREATE TRIGGER guard_content BEFORE INSERT OR UPDATE ON nazir.runs FOR EACH ROW EXECUTE FUNCTION nazir.guard_content();
CREATE TRIGGER guard_content BEFORE INSERT OR UPDATE ON nazir.findings FOR EACH ROW EXECUTE FUNCTION nazir.guard_content();
CREATE TRIGGER guard_content BEFORE INSERT OR UPDATE ON nazir.tool_events FOR EACH ROW EXECUTE FUNCTION nazir.guard_content();
CREATE TRIGGER guard_content BEFORE INSERT OR UPDATE ON nazir.state_readings FOR EACH ROW EXECUTE FUNCTION nazir.guard_content();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON nazir.conversation_messages FOR EACH ROW EXECUTE FUNCTION nazir.reject_mutation();
CREATE TRIGGER no_truncate BEFORE TRUNCATE ON nazir.conversation_messages FOR EACH STATEMENT EXECUTE FUNCTION nazir.reject_mutation();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON nazir.tool_events FOR EACH ROW EXECUTE FUNCTION nazir.reject_mutation();
CREATE TRIGGER no_truncate BEFORE TRUNCATE ON nazir.tool_events FOR EACH STATEMENT EXECUTE FUNCTION nazir.reject_mutation();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON nazir.state_readings FOR EACH ROW EXECUTE FUNCTION nazir.reject_mutation();
CREATE TRIGGER no_truncate BEFORE TRUNCATE ON nazir.state_readings FOR EACH STATEMENT EXECUTE FUNCTION nazir.reject_mutation();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON nazir.approvals FOR EACH ROW EXECUTE FUNCTION nazir.reject_mutation();
CREATE TRIGGER no_truncate BEFORE TRUNCATE ON nazir.approvals FOR EACH STATEMENT EXECUTE FUNCTION nazir.reject_mutation();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON nazir.lesson_revisions FOR EACH ROW EXECUTE FUNCTION nazir.reject_mutation();
CREATE TRIGGER no_truncate BEFORE TRUNCATE ON nazir.lesson_revisions FOR EACH STATEMENT EXECUTE FUNCTION nazir.reject_mutation();
REVOKE ALL ON ALL TABLES IN SCHEMA nazir FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA nazir FROM PUBLIC;
