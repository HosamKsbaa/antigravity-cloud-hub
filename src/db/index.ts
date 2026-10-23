import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import fs from 'fs';
import { config } from '../config.js';
import * as schema from './schema.js';

const { Pool } = pg;

let sslConfig: pg.ConnectionConfig['ssl'] = false;

if (config.dbCa) {
  let caContent = config.dbCa;
  if (fs.existsSync(config.dbCa)) {
    caContent = fs.readFileSync(config.dbCa, 'utf8');
  }
  sslConfig = {
    rejectUnauthorized: true,
    ca: caContent,
  };
}

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: sslConfig,
});

export const db = drizzle(pool, { schema });

/**
 * Auto-migration and DDL initialization helper.
 * Ensures enums, tables, and indices exist upon startup.
 */
export async function initDb() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";

      DO $$ 
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
          CREATE TYPE user_role AS ENUM ('admin', 'user');
        END IF;
      END $$;

      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(255),
        role user_role NOT NULL DEFAULT 'user',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

      CREATE TABLE IF NOT EXISTS api_keys (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(128) NOT NULL,
        key_prefix VARCHAR(16) NOT NULL,
        key_hash VARCHAR(255) NOT NULL UNIQUE,
        last_used_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
      CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

      CREATE TABLE IF NOT EXISTS plugins (
        id VARCHAR(128) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        display_name VARCHAR(255) NOT NULL,
        description TEXT,
        author_id UUID REFERENCES users(id) ON DELETE SET NULL,
        latest_version VARCHAR(64) NOT NULL,
        has_rules BOOLEAN NOT NULL DEFAULT FALSE,
        has_mcp BOOLEAN NOT NULL DEFAULT FALSE,
        sidecars JSONB NOT NULL DEFAULT '[]'::jsonb,
        skills JSONB NOT NULL DEFAULT '[]'::jsonb,
        suggested_prompts JSONB NOT NULL DEFAULT '[]'::jsonb,
        tags JSONB NOT NULL DEFAULT '[]'::jsonb,
        downloads_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      ALTER TABLE plugins ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb;

      CREATE TABLE IF NOT EXISTS plugin_versions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        plugin_id VARCHAR(128) NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
        version VARCHAR(64) NOT NULL,
        changelog TEXT,
        file_path TEXT NOT NULL,
        file_size BIGINT NOT NULL,
        checksum_sha256 VARCHAR(64) NOT NULL,
        uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_plugin_version UNIQUE (plugin_id, version)
      );
      CREATE INDEX IF NOT EXISTS idx_plugin_versions_plugin ON plugin_versions(plugin_id);

      CREATE TABLE IF NOT EXISTS skills (
        id VARCHAR(128) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        display_name VARCHAR(255) NOT NULL,
        description TEXT,
        license VARCHAR(64),
        publisher VARCHAR(128),
        author_id UUID REFERENCES users(id) ON DELETE SET NULL,
        latest_version VARCHAR(64) NOT NULL DEFAULT 'v1',
        has_scripts BOOLEAN NOT NULL DEFAULT FALSE,
        has_references BOOLEAN NOT NULL DEFAULT FALSE,
        has_templates BOOLEAN NOT NULL DEFAULT FALSE,
        tags JSONB NOT NULL DEFAULT '[]'::jsonb,
        suggested_prompts JSONB NOT NULL DEFAULT '[]'::jsonb,
        downloads_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      ALTER TABLE skills ADD COLUMN IF NOT EXISTS has_scripts BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE skills ADD COLUMN IF NOT EXISTS has_references BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE skills ADD COLUMN IF NOT EXISTS has_templates BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE skills ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb;
      ALTER TABLE skills ADD COLUMN IF NOT EXISTS suggested_prompts JSONB NOT NULL DEFAULT '[]'::jsonb;

      CREATE TABLE IF NOT EXISTS skill_versions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        skill_id VARCHAR(128) NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
        version VARCHAR(64) NOT NULL,
        file_path TEXT NOT NULL,
        file_size BIGINT NOT NULL,
        checksum_sha256 VARCHAR(64) NOT NULL,
        uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_skill_version UNIQUE (skill_id, version)
      );
      CREATE INDEX IF NOT EXISTS idx_skill_versions_skill ON skill_versions(skill_id);

      CREATE TABLE IF NOT EXISTS telemetry_conversations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        conversation_id VARCHAR(128) NOT NULL,
        title TEXT,
        workspace_name VARCHAR(255),
        workspace_path TEXT,
        is_subagent BOOLEAN DEFAULT FALSE,
        agent_name VARCHAR(128),
        parent_conversation_id VARCHAR(128),
        root_parent_id VARCHAR(128),
        primary_model VARCHAR(128),
        turns INTEGER NOT NULL DEFAULT 0,
        input_tokens BIGINT NOT NULL DEFAULT 0,
        cache_read_tokens BIGINT NOT NULL DEFAULT 0,
        output_tokens BIGINT NOT NULL DEFAULT 0,
        thinking_tokens BIGINT NOT NULL DEFAULT 0,
        response_tokens BIGINT NOT NULL DEFAULT 0,
        total_tokens BIGINT NOT NULL DEFAULT 0,
        cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
        first_at TIMESTAMPTZ,
        last_active_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_user_conversation UNIQUE (user_id, conversation_id)
      );
      CREATE INDEX IF NOT EXISTS idx_telemetry_conv_user ON telemetry_conversations(user_id);
      CREATE INDEX IF NOT EXISTS idx_telemetry_conv_last_active ON telemetry_conversations(last_active_at DESC);
      CREATE INDEX IF NOT EXISTS idx_telemetry_conv_workspace ON telemetry_conversations(workspace_name);

      CREATE TABLE IF NOT EXISTS telemetry_records (
        id BIGSERIAL PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        conversation_id VARCHAR(128) NOT NULL,
        step_index INTEGER NOT NULL,
        model_code INTEGER,
        model_name VARCHAR(128),
        backend_model VARCHAR(128),
        input_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        thinking_tokens INTEGER NOT NULL DEFAULT 0,
        response_tokens INTEGER NOT NULL DEFAULT 0,
        total_step_tokens INTEGER NOT NULL DEFAULT 0,
        latency_ms INTEGER NOT NULL DEFAULT 0,
        ttft_ms INTEGER NOT NULL DEFAULT 0,
        cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
        tools JSONB NOT NULL DEFAULT '[]'::jsonb,
        prompt_summary TEXT,
        trace_id VARCHAR(128),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_user_conv_step UNIQUE (user_id, conversation_id, step_index)
      );
      CREATE INDEX IF NOT EXISTS idx_telemetry_rec_user_conv ON telemetry_records(user_id, conversation_id);
      CREATE INDEX IF NOT EXISTS idx_telemetry_rec_model ON telemetry_records(backend_model);
      CREATE INDEX IF NOT EXISTS idx_telemetry_rec_created ON telemetry_records(created_at DESC);

      CREATE TABLE IF NOT EXISTS telemetry_daily_summary (
        id BIGSERIAL PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        model_name VARCHAR(128) NOT NULL,
        workspace_name VARCHAR(255) NOT NULL DEFAULT '',
        turns INTEGER NOT NULL DEFAULT 0,
        input_tokens BIGINT NOT NULL DEFAULT 0,
        cache_read_tokens BIGINT NOT NULL DEFAULT 0,
        output_tokens BIGINT NOT NULL DEFAULT 0,
        thinking_tokens BIGINT NOT NULL DEFAULT 0,
        response_tokens BIGINT NOT NULL DEFAULT 0,
        total_tokens BIGINT NOT NULL DEFAULT 0,
        cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_user_date_model_ws UNIQUE (user_id, date, model_name, workspace_name)
      );
      CREATE INDEX IF NOT EXISTS idx_telemetry_daily_date ON telemetry_daily_summary(date DESC);
      CREATE INDEX IF NOT EXISTS idx_telemetry_daily_user ON telemetry_daily_summary(user_id);
    `);
  } finally {
    client.release();
  }
}
