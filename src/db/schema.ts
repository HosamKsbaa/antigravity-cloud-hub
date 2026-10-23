import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  pgEnum,
  integer,
  bigint,
  bigserial,
  numeric,
  jsonb,
  date,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// -----------------------------------------------------------------------------
// Enums
// -----------------------------------------------------------------------------
export const userRoleEnum = pgEnum('user_role', ['admin', 'user']);

// -----------------------------------------------------------------------------
// 1. Users
// -----------------------------------------------------------------------------
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    name: varchar('name', { length: 255 }),
    role: userRoleEnum('role').notNull().default('user'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_users_email').on(table.email),
    index('idx_users_role').on(table.role),
  ]
);

export const usersRelations = relations(users, ({ many }) => ({
  apiKeys: many(apiKeys),
  telemetryConversations: many(telemetryConversations),
  telemetryRecords: many(telemetryRecords),
  telemetryDailySummaries: many(telemetryDailySummary),
}));

// -----------------------------------------------------------------------------
// 2. API Keys
// -----------------------------------------------------------------------------
export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 128 }).notNull(),
    keyPrefix: varchar('key_prefix', { length: 16 }).notNull(),
    keyHash: varchar('key_hash', { length: 255 }).notNull().unique(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_api_keys_user_id').on(table.userId),
    index('idx_api_keys_hash').on(table.keyHash),
  ]
);

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(users, {
    fields: [apiKeys.userId],
    references: [users.id],
  }),
}));

// -----------------------------------------------------------------------------
// 3. Plugins
// -----------------------------------------------------------------------------
export const plugins = pgTable('plugins', {
  id: varchar('id', { length: 128 }).primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  description: text('description'),
  authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
  latestVersion: varchar('latest_version', { length: 64 }).notNull(),
  hasRules: boolean('has_rules').notNull().default(false),
  hasMcp: boolean('has_mcp').notNull().default(false),
  sidecars: jsonb('sidecars').notNull().default([]),
  skills: jsonb('skills').notNull().default([]),
  suggestedPrompts: jsonb('suggested_prompts').notNull().default([]),
  tags: jsonb('tags').notNull().default([]),
  downloadsCount: integer('downloads_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const pluginsRelations = relations(plugins, ({ many, one }) => ({
  versions: many(pluginVersions),
  author: one(users, {
    fields: [plugins.authorId],
    references: [users.id],
  }),
}));

export const pluginVersions = pgTable(
  'plugin_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pluginId: varchar('plugin_id', { length: 128 })
      .notNull()
      .references(() => plugins.id, { onDelete: 'cascade' }),
    version: varchar('version', { length: 64 }).notNull(),
    changelog: text('changelog'),
    filePath: text('file_path').notNull(),
    fileSize: bigint('file_size', { mode: 'number' }).notNull(),
    checksumSha256: varchar('checksum_sha256', { length: 64 }).notNull(),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_plugin_version').on(table.pluginId, table.version),
    index('idx_plugin_versions_plugin').on(table.pluginId),
  ]
);

export const pluginVersionsRelations = relations(pluginVersions, ({ one }) => ({
  plugin: one(plugins, {
    fields: [pluginVersions.pluginId],
    references: [plugins.id],
  }),
  uploader: one(users, {
    fields: [pluginVersions.uploadedBy],
    references: [users.id],
  }),
}));

// -----------------------------------------------------------------------------
// 4. Skills
// -----------------------------------------------------------------------------
export const skills = pgTable('skills', {
  id: varchar('id', { length: 128 }).primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  description: text('description'),
  license: varchar('license', { length: 64 }),
  publisher: varchar('publisher', { length: 128 }),
  authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
  latestVersion: varchar('latest_version', { length: 64 }).notNull().default('v1'),
  hasScripts: boolean('has_scripts').notNull().default(false),
  hasReferences: boolean('has_references').notNull().default(false),
  hasTemplates: boolean('has_templates').notNull().default(false),
  tags: jsonb('tags').notNull().default([]),
  suggestedPrompts: jsonb('suggested_prompts').notNull().default([]),
  downloadsCount: integer('downloads_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const skillsRelations = relations(skills, ({ many, one }) => ({
  versions: many(skillVersions),
  author: one(users, {
    fields: [skills.authorId],
    references: [users.id],
  }),
}));

export const skillVersions = pgTable(
  'skill_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    skillId: varchar('skill_id', { length: 128 })
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    version: varchar('version', { length: 64 }).notNull(),
    filePath: text('file_path').notNull(),
    fileSize: bigint('file_size', { mode: 'number' }).notNull(),
    checksumSha256: varchar('checksum_sha256', { length: 64 }).notNull(),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_skill_version').on(table.skillId, table.version),
    index('idx_skill_versions_skill').on(table.skillId),
  ]
);

export const skillVersionsRelations = relations(skillVersions, ({ one }) => ({
  skill: one(skills, {
    fields: [skillVersions.skillId],
    references: [skills.id],
  }),
  uploader: one(users, {
    fields: [skillVersions.uploadedBy],
    references: [users.id],
  }),
}));

// -----------------------------------------------------------------------------
// 5. Telemetry
// -----------------------------------------------------------------------------
export const telemetryConversations = pgTable(
  'telemetry_conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    conversationId: varchar('conversation_id', { length: 128 }).notNull(),
    title: text('title'),
    workspaceName: varchar('workspace_name', { length: 255 }),
    workspacePath: text('workspace_path'),
    isSubagent: boolean('is_subagent').default(false),
    agentName: varchar('agent_name', { length: 128 }),
    parentConversationId: varchar('parent_conversation_id', { length: 128 }),
    rootParentId: varchar('root_parent_id', { length: 128 }),
    primaryModel: varchar('primary_model', { length: 128 }),
    turns: integer('turns').notNull().default(0),
    inputTokens: bigint('input_tokens', { mode: 'number' }).notNull().default(0),
    cacheReadTokens: bigint('cache_read_tokens', { mode: 'number' }).notNull().default(0),
    outputTokens: bigint('output_tokens', { mode: 'number' }).notNull().default(0),
    thinkingTokens: bigint('thinking_tokens', { mode: 'number' }).notNull().default(0),
    responseTokens: bigint('response_tokens', { mode: 'number' }).notNull().default(0),
    totalTokens: bigint('total_tokens', { mode: 'number' }).notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
    firstAt: timestamp('first_at', { withTimezone: true }),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_user_conversation').on(table.userId, table.conversationId),
    index('idx_telemetry_conv_user').on(table.userId),
    index('idx_telemetry_conv_last_active').on(table.lastActiveAt),
    index('idx_telemetry_conv_workspace').on(table.workspaceName),
  ]
);

export const telemetryConversationsRelations = relations(
  telemetryConversations,
  ({ one }) => ({
    user: one(users, {
      fields: [telemetryConversations.userId],
      references: [users.id],
    }),
  })
);

export const telemetryRecords = pgTable(
  'telemetry_records',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    conversationId: varchar('conversation_id', { length: 128 }).notNull(),
    stepIndex: integer('step_index').notNull(),
    modelCode: integer('model_code'),
    modelName: varchar('model_name', { length: 128 }),
    backendModel: varchar('backend_model', { length: 128 }),
    inputTokens: integer('input_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    thinkingTokens: integer('thinking_tokens').notNull().default(0),
    responseTokens: integer('response_tokens').notNull().default(0),
    totalStepTokens: integer('total_step_tokens').notNull().default(0),
    latencyMs: integer('latency_ms').notNull().default(0),
    ttftMs: integer('ttft_ms').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
    tools: jsonb('tools').notNull().default([]),
    promptSummary: text('prompt_summary'),
    traceId: varchar('trace_id', { length: 128 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_user_conv_step').on(table.userId, table.conversationId, table.stepIndex),
    index('idx_telemetry_rec_user_conv').on(table.userId, table.conversationId),
    index('idx_telemetry_rec_model').on(table.backendModel),
    index('idx_telemetry_rec_created').on(table.createdAt),
  ]
);

export const telemetryDailySummary = pgTable(
  'telemetry_daily_summary',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    modelName: varchar('model_name', { length: 128 }).notNull(),
    workspaceName: varchar('workspace_name', { length: 255 }).notNull().default(''),
    turns: integer('turns').notNull().default(0),
    inputTokens: bigint('input_tokens', { mode: 'number' }).notNull().default(0),
    cacheReadTokens: bigint('cache_read_tokens', { mode: 'number' }).notNull().default(0),
    outputTokens: bigint('output_tokens', { mode: 'number' }).notNull().default(0),
    thinkingTokens: bigint('thinking_tokens', { mode: 'number' }).notNull().default(0),
    responseTokens: bigint('response_tokens', { mode: 'number' }).notNull().default(0),
    totalTokens: bigint('total_tokens', { mode: 'number' }).notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_user_date_model_ws').on(
      table.userId,
      table.date,
      table.modelName,
      table.workspaceName
    ),
    index('idx_telemetry_daily_date').on(table.date),
    index('idx_telemetry_daily_user').on(table.userId),
  ]
);

// Type inference exports
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
export type Plugin = typeof plugins.$inferSelect;
export type NewPlugin = typeof plugins.$inferInsert;
export type PluginVersion = typeof pluginVersions.$inferSelect;
export type NewPluginVersion = typeof pluginVersions.$inferInsert;
export type Skill = typeof skills.$inferSelect;
export type NewSkill = typeof skills.$inferInsert;
export type SkillVersion = typeof skillVersions.$inferSelect;
export type NewSkillVersion = typeof skillVersions.$inferInsert;
export type TelemetryConversation = typeof telemetryConversations.$inferSelect;
export type NewTelemetryConversation = typeof telemetryConversations.$inferInsert;
export type TelemetryRecord = typeof telemetryRecords.$inferSelect;
export type NewTelemetryRecord = typeof telemetryRecords.$inferInsert;
export type TelemetryDailySummary = typeof telemetryDailySummary.$inferSelect;
export type NewTelemetryDailySummary = typeof telemetryDailySummary.$inferInsert;
