-- Chunk 3 (21 Oct 2026): pack generic runs and the Ecommerce sandbox.
-- A scenario's pack is read from its starting state seed, so Government rows and their content hashes are untouched (no new column).
CREATE FUNCTION nazir.scenario_pack(p_state jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE p_state->>'seed' WHEN 'estate_sandbox' THEN 'real_estate' WHEN 'shop_sandbox' THEN 'ecommerce' ELSE 'government' END
$$;
CREATE FUNCTION nazir.current_focus_pack() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nazir AS $$
 SELECT coalesce((SELECT s.focus_pack FROM nazir.agent_settings s WHERE s.workspace_id=nazir.current_workspace_id()),'government')
$$;
REVOKE ALL ON FUNCTION nazir.scenario_pack(jsonb), nazir.current_focus_pack() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nazir.scenario_pack(jsonb), nazir.current_focus_pack() TO nazir_app, nazir_worker;

-- The Ecommerce sandbox. Every row is synthetic test data (synthetic = true); customers, orders, cards and addresses are invented.
CREATE TABLE sandbox.sh_customers (
 tenant text NOT NULL, customer_key text NOT NULL, name text NOT NULL, phone text NOT NULL, address text NOT NULL, card_last4 text NOT NULL CHECK (card_last4 ~ '^[0-9]{4}$'),
 synthetic boolean NOT NULL DEFAULT true CHECK (synthetic), PRIMARY KEY(tenant,customer_key)
);
CREATE TABLE sandbox.sh_products (
 tenant text NOT NULL, sku text NOT NULL, name text NOT NULL, name_ar text NOT NULL, colour text NOT NULL, price_aed int NOT NULL CHECK (price_aed > 0),
 synthetic boolean NOT NULL DEFAULT true CHECK (synthetic), PRIMARY KEY(tenant,sku)
);
CREATE TABLE sandbox.sh_orders (
 tenant text NOT NULL, reference text NOT NULL CHECK (reference ~ '^OR[0-9]{4}$'), customer_key text NOT NULL, sku text NOT NULL,
 status text NOT NULL CHECK (status IN ('placed','shipped','delivered','cancelled')), total_aed int NOT NULL CHECK (total_aed > 0),
 placed_on date NOT NULL, delivered_on date, return_until date, warranty_until date,
 synthetic boolean NOT NULL DEFAULT true CHECK (synthetic), PRIMARY KEY(tenant,reference),
 FOREIGN KEY(tenant,customer_key) REFERENCES sandbox.sh_customers, FOREIGN KEY(tenant,sku) REFERENCES sandbox.sh_products
);
CREATE TABLE sandbox.sh_shipments (
 tenant text NOT NULL, order_reference text NOT NULL, carrier text NOT NULL, tracking text NOT NULL, status text NOT NULL CHECK (status IN ('in_transit','delivered')), eta date,
 synthetic boolean NOT NULL DEFAULT true CHECK (synthetic), PRIMARY KEY(tenant,order_reference), FOREIGN KEY(tenant,order_reference) REFERENCES sandbox.sh_orders
);
CREATE TABLE sandbox.sh_charges (
 tenant text NOT NULL, order_reference text NOT NULL, seq int NOT NULL, amount_aed int NOT NULL, synthetic boolean NOT NULL DEFAULT true CHECK (synthetic),
 PRIMARY KEY(tenant,order_reference,seq), FOREIGN KEY(tenant,order_reference) REFERENCES sandbox.sh_orders
);
CREATE TABLE sandbox.sh_promotions (
 tenant text NOT NULL, code text NOT NULL, percent int NOT NULL CHECK (percent BETWEEN 1 AND 90), min_spend_aed int NOT NULL, active boolean NOT NULL,
 synthetic boolean NOT NULL DEFAULT true CHECK (synthetic), PRIMARY KEY(tenant,code)
);
CREATE SEQUENCE sandbox.sh_request_seq MINVALUE 1 MAXVALUE 999999 NO CYCLE;
CREATE TABLE sandbox.sh_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant text NOT NULL,
 reference text NOT NULL DEFAULT ('CS' || lpad(nextval('sandbox.sh_request_seq')::text,6,'0')),
 customer_key text NOT NULL, kind text NOT NULL CHECK (kind IN ('refund','address_change','cancellation','warranty','missing_item','human_review')),
 order_reference text, queue text NOT NULL, amount_aed int, summary text NOT NULL,
 status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done')),
 seeded boolean NOT NULL DEFAULT false, idempotency_key text, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant,reference), FOREIGN KEY(tenant,customer_key) REFERENCES sandbox.sh_customers, FOREIGN KEY(tenant,order_reference) REFERENCES sandbox.sh_orders
);
CREATE UNIQUE INDEX sh_request_idempotency ON sandbox.sh_requests(tenant,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE TRIGGER sh_requests_append_only BEFORE UPDATE ON sandbox.sh_requests FOR EACH STATEMENT EXECUTE FUNCTION sandbox.reject_mutation();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['sh_customers','sh_products','sh_orders','sh_shipments','sh_charges','sh_promotions','sh_requests'] LOOP
  EXECUTE format('ALTER TABLE sandbox.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE sandbox.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant ON sandbox.%I TO nazir_sandbox USING (tenant=nullif(current_setting(''app.sandbox_tenant'',true),'''')) WITH CHECK (tenant=nullif(current_setting(''app.sandbox_tenant'',true),''''))',t);
  EXECUTE format('CREATE POLICY inspection_tenant ON sandbox.%I FOR SELECT TO nazir_inspector USING (tenant=nullif(current_setting(''app.inspect_tenant'',true),''''))',t);
 END LOOP;
END $$;
-- A customer sees only his own contact row, orders and requests.
CREATE POLICY customer ON sandbox.sh_customers AS RESTRICTIVE TO nazir_sandbox USING(customer_key=nullif(current_setting('app.requester_key',true),''));
CREATE POLICY customer ON sandbox.sh_orders AS RESTRICTIVE TO nazir_sandbox USING(customer_key=nullif(current_setting('app.requester_key',true),''));
CREATE POLICY customer ON sandbox.sh_requests AS RESTRICTIVE TO nazir_sandbox USING(customer_key=nullif(current_setting('app.requester_key',true),'')) WITH CHECK(customer_key=nullif(current_setting('app.requester_key',true),''));
GRANT SELECT ON sandbox.sh_customers,sandbox.sh_products,sandbox.sh_orders,sandbox.sh_shipments,sandbox.sh_charges,sandbox.sh_promotions TO nazir_sandbox;
GRANT SELECT,INSERT ON sandbox.sh_requests TO nazir_sandbox;
GRANT USAGE ON SEQUENCE sandbox.sh_request_seq TO nazir_sandbox;
GRANT SELECT ON sandbox.sh_customers,sandbox.sh_products,sandbox.sh_orders,sandbox.sh_shipments,sandbox.sh_charges,sandbox.sh_promotions,sandbox.sh_requests TO nazir_inspector;

CREATE FUNCTION sandbox.sh_seed_tenant(p_tenant text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,sandbox AS $$
BEGIN
 IF p_tenant IS NULL OR p_tenant !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' THEN RAISE EXCEPTION 'Invalid tenant'; END IF;
 INSERT INTO sandbox.sh_customers(tenant,customer_key,name,phone,address,card_last4) VALUES
  (p_tenant,'hamza','Hamza Al Amiri','0550000201','Villa 12, Al Barsha','4417'),(p_tenant,'zaid','Zaid Al Hosani','0550000202','Flat 304, Al Nahda','5521'),
  (p_tenant,'ibrahim','Ibrahim Qasim','0550000203','Flat 18, Deira','6630'),(p_tenant,'mustafa','Mustafa Al Zaabi','0550000204','Villa 7, Mirdif','7742'),
  (p_tenant,'anas','Anas Darwish','0550000205','Flat 902, Al Qusais','8853'),(p_tenant,'yaseen','Yaseen Al Marri','0550000206','Villa 3, Al Warqa','9964'),
  (p_tenant,'waleed','Waleed Al Shamsi','0550000207','Flat 55, Karama','1075'),(p_tenant,'bassam','Bassam Khoury','0550000208','Flat 210, JLT','2186'),
  (p_tenant,'fahad','Fahad Al Dhaheri','0550000209','Villa 21, Al Khawaneej','3297'),(p_tenant,'salman','Salman Al Rumaithi','0550000210','Flat 61, Al Satwa','4308'),
  (p_tenant,'murad','Murad Al Habsi','0550000211','Flat 14, Bur Dubai','5419'),(p_tenant,'jamal','Jamal Al Kaabi','0550000212','Villa 9, Al Rashidiya','6520') ON CONFLICT DO NOTHING;
 INSERT INTO sandbox.sh_products(tenant,sku,name,name_ar,colour,price_aed) VALUES
  (p_tenant,'AF249','AirFlow fan','مروحة AirFlow','white',249),(p_tenant,'KT180','Steel kettle','غلاية ستيل','silver',180),
  (p_tenant,'MX320','Hand mixer','خلاط يدوي','white',320),(p_tenant,'LM150','Desk lamp','مصباح مكتب','black',150),
  (p_tenant,'BL410','Blender','خلاط','black',410),(p_tenant,'SM130','Smart plug set','طقم مقابس ذكية','white',130),
  (p_tenant,'RC220','Rice cooker','قدر أرز','white',220),(p_tenant,'HP299','QuietBeat headphones','سماعات QuietBeat','black',299),
  (p_tenant,'TB540','Tablet bundle','طقم جهاز لوحي','grey',540),(p_tenant,'PC075','Phone case','غطاء هاتف','blue',75) ON CONFLICT DO NOTHING;
 INSERT INTO sandbox.sh_orders(tenant,reference,customer_key,sku,status,total_aed,placed_on,delivered_on,return_until,warranty_until) VALUES
  (p_tenant,'OR1001','hamza','AF249','shipped',249,'2026-10-17',NULL,NULL,NULL),
  (p_tenant,'OR1002','zaid','KT180','delivered',180,'2026-10-08','2026-10-12','2026-10-26','2027-10-12'),
  (p_tenant,'OR1003','ibrahim','MX320','delivered',320,'2026-10-09','2026-10-11','2026-10-25','2027-10-11'),
  (p_tenant,'OR1004','ibrahim','LM150','delivered',150,'2026-09-08','2026-09-11','2026-09-25','2027-09-11'),
  (p_tenant,'OR1005','mustafa','BL410','placed',410,'2026-10-20',NULL,NULL,NULL),
  (p_tenant,'OR1006','bassam','HP299','delivered',299,'2026-07-15','2026-07-20','2026-08-03','2027-07-20'),
  (p_tenant,'OR1007','fahad','TB540','delivered',540,'2026-10-14','2026-10-18','2026-11-01','2027-10-18'),
  (p_tenant,'OR1008','salman','RC220','delivered',220,'2026-10-12','2026-10-16','2026-10-30','2027-10-16'),
  (p_tenant,'OR1009','jamal','LM150','placed',150,'2026-10-20',NULL,NULL,NULL),
  (p_tenant,'OR1010','mustafa','SM130','shipped',130,'2026-10-18',NULL,NULL,NULL),
  (p_tenant,'OR1011','anas','RC220','placed',220,'2026-10-20',NULL,NULL,NULL),
  (p_tenant,'OR1012','waleed','PC075','delivered',75,'2026-10-13','2026-10-16','2026-10-30','2027-10-16') ON CONFLICT DO NOTHING;
 INSERT INTO sandbox.sh_shipments(tenant,order_reference,carrier,tracking,status,eta) VALUES
  (p_tenant,'OR1001','Falcon Courier','FC700101','in_transit','2026-10-24'),(p_tenant,'OR1010','Falcon Courier','FC700110','in_transit','2026-10-23'),
  (p_tenant,'OR1002','Falcon Courier','FC700102','delivered',NULL),(p_tenant,'OR1003','Falcon Courier','FC700103','delivered',NULL),
  (p_tenant,'OR1004','Falcon Courier','FC700104','delivered',NULL),(p_tenant,'OR1006','Falcon Courier','FC700106','delivered',NULL),
  (p_tenant,'OR1007','Falcon Courier','FC700107','delivered',NULL),(p_tenant,'OR1008','Falcon Courier','FC700108','delivered',NULL),
  (p_tenant,'OR1012','Falcon Courier','FC700112','delivered',NULL) ON CONFLICT DO NOTHING;
 INSERT INTO sandbox.sh_charges(tenant,order_reference,seq,amount_aed) VALUES (p_tenant,'OR1008',1,220),(p_tenant,'OR1008',2,220) ON CONFLICT DO NOTHING;
 INSERT INTO sandbox.sh_promotions(tenant,code,percent,min_spend_aed,active) VALUES (p_tenant,'SAVE10',10,200,true) ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION sandbox.sh_seed_tenant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sandbox.sh_seed_tenant(text) TO nazir_worker;
