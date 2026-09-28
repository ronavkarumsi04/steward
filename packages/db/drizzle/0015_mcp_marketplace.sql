-- MCP marketplace: install a server, see what it may do.
--
-- Two tables, and the split is the design:
--   1. mcp_servers — the install. What a company asked for: a name, a slug (which is what tool names are built
--                    from, so a rename cannot change what an agent was granted), a transport, and the address or
--                    the command. `last_inspected_at` and `last_error` are the server's condition: an inspection
--                    that fails is a fact about the server, recorded here, not an error returned to the surface.
--   2. mcp_tools   — what that install may do, as of the last inspection: every tool the server offered, the
--                    schema a model provider will be handed, the server's own annotations verbatim, and the risk
--                    band Steward derived from them together with the sentence saying where the band came from.
--
-- The runtime builds its tool list from these rows rather than from a live handshake, which is why they are a
-- record and not a cache: an agent run never waits on somebody else's process to start, and a server whose tools
-- changed is reported as drift on the next inspection instead of silently replacing what a founder read.
--
-- The unique index on (company_id, slug) is what makes "two servers cannot mean the same thing" a database
-- invariant rather than a check somebody can forget; the one on (server_id, name) is its per-tool counterpart,
-- and what lets re-inspecting a server update its tools in place instead of duplicating them.
--
-- Note for whoever changes this next: `drizzle-kit generate` cannot be used in this repository. Only
-- `0000_snapshot.json` was ever kept, so the tool diffs today's schema against the initial one and would emit a
-- migration that re-creates most of the database. Migrations here are written by hand, and the journal below
-- with them.
--> statement-breakpoint
CREATE TABLE "mcp_servers" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" text NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"purpose" text DEFAULT '' NOT NULL,
	"transport" text NOT NULL,
	"command" text,
	"args" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"env" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cwd" text,
	"url" text,
	"headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_inspected_at" timestamp with time zone,
	"last_error" text,
	"installed_by" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_tools" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" text NOT NULL,
	"company_id" text NOT NULL,
	"server_id" text NOT NULL,
	"name" text NOT NULL,
	"tool_name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"input_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"annotations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"risk" text NOT NULL,
	"side_effects" text NOT NULL,
	"idempotent" boolean DEFAULT false NOT NULL,
	"dimension" text,
	"risk_source" text NOT NULL,
	"risk_reason" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mcp_tools" ADD CONSTRAINT "mcp_tools_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mcp_tools" ADD CONSTRAINT "mcp_tools_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- A tool without its server is not a tool, and removing an install must take its tool list with it: a company
-- that uninstalled a server must not keep a record of what it could have done as something grantable.
ALTER TABLE "mcp_tools" ADD CONSTRAINT "mcp_tools_server_id_mcp_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."mcp_servers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Same tenancy invariant as every other company-owned table (0009): a row's company must belong to the
-- organization the row claims.
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_tenant_fk" FOREIGN KEY ("company_id","organization_id") REFERENCES "companies" ("id","organization_id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "mcp_tools" ADD CONSTRAINT "mcp_tools_tenant_fk" FOREIGN KEY ("company_id","organization_id") REFERENCES "companies" ("id","organization_id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_servers_slug_idx" ON "mcp_servers" USING btree ("company_id","slug");
--> statement-breakpoint
CREATE INDEX "mcp_servers_company_idx" ON "mcp_servers" USING btree ("company_id","enabled");
--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_tools_name_idx" ON "mcp_tools" USING btree ("server_id","name");
--> statement-breakpoint
CREATE INDEX "mcp_tools_company_idx" ON "mcp_tools" USING btree ("company_id","enabled");
