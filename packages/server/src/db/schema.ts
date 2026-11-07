// Drizzle table definitions. They mirror migrations/0001_init.sql (the SQL file is the source of truth;
// generated columns such as `tsv` are left out here because the app never writes them).
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastUsedAt: ts("last_used_at"),
  revokedAt: ts("revoked_at"),
});

export const sources = pgTable("sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  scope: text("scope").notNull().default("user"),
  kind: text("kind", { enum: ["message", "session", "document"] }).notNull(),
  externalId: text("external_id"),
  author: text("author"),
  content: text("content").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  occurredAt: ts("occurred_at").notNull().defaultNow(),
  createdAt: ts("created_at").notNull().defaultNow(),
  extractedAt: ts("extracted_at"),
});

export const entities = pgTable("entities", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull().default("thing"),
  aliases: text("aliases").array().notNull().default(sql`'{}'`),
  summary: text("summary"),
  tags: text("tags").array().notNull().default(sql`'{}'`),
  embedding: vector("embedding", { dimensions: 768 }),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const facts = pgTable("facts", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  scope: text("scope").notNull().default("user"),
  kind: text("kind", { enum: ["fact", "preference", "event"] }).notNull().default("fact"),
  subjectId: uuid("subject_id").notNull(),
  predicate: text("predicate").notNull(),
  objectId: uuid("object_id"),
  objectValue: text("object_value"),
  statement: text("statement").notNull(),
  context: text("context"),
  strength: real("strength"),
  validFrom: ts("valid_from").notNull(),
  validTo: ts("valid_to"),
  recordedAt: ts("recorded_at").notNull().defaultNow(),
  status: text("status", { enum: ["active", "replaced", "contradiction"] }).notNull().default("active"),
  supersededBy: uuid("superseded_by"),
  confidence: real("confidence").notNull().default(1),
  pinned: boolean("pinned").notNull().default(false),
  sourceId: uuid("source_id"),
  extractorVersion: text("extractor_version").notNull(),
  embedding: vector("embedding", { dimensions: 768 }),
});

export const chunks = pgTable("chunks", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  scope: text("scope").notNull().default("user"),
  sourceId: uuid("source_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  content: text("content").notNull(),
  embedding: vector("embedding", { dimensions: 768 }),
});

export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: uuid("target_id").notNull(),
  before: jsonb("before"),
  after: jsonb("after"),
  at: ts("at").notNull().defaultNow(),
});

export type Source = typeof sources.$inferSelect;
export type Entity = typeof entities.$inferSelect;
export type Fact = typeof facts.$inferSelect;
export type NewFact = typeof facts.$inferInsert;

/** `set_config(..., true)` = local to the current transaction. */
export const setWorkspace = (workspaceId: string) =>
  sql`select set_config('app.workspace_id', ${workspaceId}, true)`;
