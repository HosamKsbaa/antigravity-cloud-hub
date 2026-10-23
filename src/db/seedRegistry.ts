import fs from 'fs';
import path from 'path';
import os from 'os';
import { eq, notInArray } from 'drizzle-orm';
import { db, initDb } from './index.js';
import { plugins, pluginVersions, skills, skillVersions, users } from './schema.js';
import { config } from '../config.js';
import {
  inspectPluginDir,
  inspectSkillDir,
  createPackage,
  getPackageStoragePath,
} from '../services/packageService.js';
import { seedAdminUser } from './seed.js';

const PLUGINS_SOURCE_DIR =
  process.env.PLUGINS_SOURCE_DIR ||
  '/home/mr-h/Documents/maintatnce/update antigravity/antigravity-plugins-repo/plugins';

const SKILLS_SOURCE_DIR =
  process.env.SKILLS_SOURCE_DIR ||
  path.join(os.homedir(), '.gemini/config/skills');

export async function seedRegistry(): Promise<{ pluginsCount: number; skillsCount: number }> {
  console.log('[SEED-REGISTRY] Initializing database connection & DDL...');
  await initDb();

  console.log('[SEED-REGISTRY] Ensuring admin account exists...');
  const adminUser = await seedAdminUser();

  console.log(`[SEED-REGISTRY] Scanning plugins in: ${PLUGINS_SOURCE_DIR}`);
  let seededPluginsCount = 0;

  if (fs.existsSync(PLUGINS_SOURCE_DIR)) {
    const pluginEntries = fs
      .readdirSync(PLUGINS_SOURCE_DIR, { withFileTypes: true })
      .filter((ent) => ent.isDirectory() && !ent.name.startsWith('.'));

    const activePluginIds = pluginEntries.map((e) => e.name);
    if (activePluginIds.length > 0) {
      await db.delete(plugins).where(notInArray(plugins.id, activePluginIds));
    }

    for (const ent of pluginEntries) {
      const pluginDir = path.join(PLUGINS_SOURCE_DIR, ent.name);
      try {
        const meta = inspectPluginDir(pluginDir);
        if (!meta.version) {
          meta.version = '1.0.0';
        }
        if (!meta.id) {
          meta.id = ent.name;
        }
        if (!meta.name) {
          meta.name = meta.id;
        }
        const destTarGz = getPackageStoragePath('plugins', meta.id, meta.version);

        console.log(`[SEED-REGISTRY] Packaging plugin "${meta.id}" v${meta.version}...`);
        const { checksumSha256, sizeBytes } = await createPackage(pluginDir, destTarGz);

        const now = new Date();
        await db
          .insert(plugins)
          .values({
            id: meta.id,
            name: meta.name,
            displayName: meta.displayName,
            description: meta.description,
            authorId: adminUser?.id || null,
            latestVersion: meta.version,
            hasRules: meta.hasRules,
            hasMcp: meta.hasMcp,
            sidecars: meta.sidecars,
            skills: meta.skills,
            suggestedPrompts: meta.suggestedPrompts,
            tags: meta.tags,
            downloadsCount: 0,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: plugins.id,
            set: {
              name: meta.name,
              displayName: meta.displayName,
              description: meta.description,
              latestVersion: meta.version,
              hasRules: meta.hasRules,
              hasMcp: meta.hasMcp,
              sidecars: meta.sidecars,
              skills: meta.skills,
              suggestedPrompts: meta.suggestedPrompts,
              tags: meta.tags,
              updatedAt: now,
            },
          });

        await db
          .insert(pluginVersions)
          .values({
            pluginId: meta.id,
            version: meta.version,
            changelog: 'Initial seeded release from repository',
            filePath: destTarGz,
            fileSize: sizeBytes,
            checksumSha256,
            uploadedBy: adminUser?.id || null,
            createdAt: now,
          })
          .onConflictDoUpdate({
            target: [pluginVersions.pluginId, pluginVersions.version],
            set: {
              filePath: destTarGz,
              fileSize: sizeBytes,
              checksumSha256,
            },
          });

        seededPluginsCount++;
        console.log(`[SEED-REGISTRY] ✓ Plugin "${meta.id}" seeded (${sizeBytes} bytes, SHA-256: ${checksumSha256.substring(0, 12)}...)`);
      } catch (err: any) {
        console.warn(`[SEED-REGISTRY] ⚠ Failed to seed plugin in ${pluginDir}: ${err.message}`);
      }
    }
  } else {
    console.warn(`[SEED-REGISTRY] Plugins directory does not exist: ${PLUGINS_SOURCE_DIR}`);
  }

  console.log(`[SEED-REGISTRY] Scanning skills in: ${SKILLS_SOURCE_DIR}`);
  let seededSkillsCount = 0;

  if (fs.existsSync(SKILLS_SOURCE_DIR)) {
    const skillEntries = fs
      .readdirSync(SKILLS_SOURCE_DIR, { withFileTypes: true })
      .filter((ent) => ent.isDirectory() && !ent.name.startsWith('.'));

    for (const ent of skillEntries) {
      const skillDir = path.join(SKILLS_SOURCE_DIR, ent.name);
      try {
        const meta = inspectSkillDir(skillDir);
        if (!meta.version) {
          meta.version = '1.0.0';
        }
        if (!meta.id) {
          meta.id = ent.name;
        }
        if (!meta.name) {
          meta.name = meta.id;
        }
        const destTarGz = getPackageStoragePath('skills', meta.id, meta.version);

        console.log(`[SEED-REGISTRY] Packaging skill "${meta.id}" v${meta.version}...`);
        const { checksumSha256, sizeBytes } = await createPackage(skillDir, destTarGz);

        const now = new Date();
        await db
          .insert(skills)
          .values({
            id: meta.id,
            name: meta.name,
            displayName: meta.displayName,
            description: meta.description,
            license: meta.license || null,
            publisher: meta.author || 'Antigravity Team',
            authorId: adminUser?.id || null,
            latestVersion: meta.version,
            hasScripts: meta.hasScripts,
            hasReferences: meta.hasReferences,
            hasTemplates: meta.hasTemplates,
            tags: meta.tags,
            suggestedPrompts: meta.suggestedPrompts,
            downloadsCount: 0,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: skills.id,
            set: {
              name: meta.name,
              displayName: meta.displayName,
              description: meta.description,
              license: meta.license || null,
              publisher: meta.author || 'Antigravity Team',
              latestVersion: meta.version,
              hasScripts: meta.hasScripts,
              hasReferences: meta.hasReferences,
              hasTemplates: meta.hasTemplates,
              tags: meta.tags,
              suggestedPrompts: meta.suggestedPrompts,
              updatedAt: now,
            },
          });

        await db
          .insert(skillVersions)
          .values({
            skillId: meta.id,
            version: meta.version,
            filePath: destTarGz,
            fileSize: sizeBytes,
            checksumSha256,
            uploadedBy: adminUser?.id || null,
            createdAt: now,
          })
          .onConflictDoUpdate({
            target: [skillVersions.skillId, skillVersions.version],
            set: {
              filePath: destTarGz,
              fileSize: sizeBytes,
              checksumSha256,
            },
          });

        seededSkillsCount++;
        console.log(`[SEED-REGISTRY] ✓ Skill "${meta.id}" seeded (${sizeBytes} bytes, SHA-256: ${checksumSha256.substring(0, 12)}...)`);
      } catch (err: any) {
        console.warn(`[SEED-REGISTRY] ⚠ Failed to seed skill in ${skillDir}: ${err.message}`);
      }
    }
  } else {
    console.warn(`[SEED-REGISTRY] Skills directory does not exist: ${SKILLS_SOURCE_DIR}`);
  }

  console.log(`[SEED-REGISTRY] Done! Seeded ${seededPluginsCount} plugins and ${seededSkillsCount} skills.`);
  return { pluginsCount: seededPluginsCount, skillsCount: seededSkillsCount };
}

// Allow direct execution
if (process.argv[1] && process.argv[1].endsWith('seedRegistry.ts')) {
  seedRegistry()
    .then((result) => {
      console.log(`[SEED-REGISTRY] Successfully completed: ${result.pluginsCount} plugins, ${result.skillsCount} skills.`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[SEED-REGISTRY] Fatal seeding error:', err);
      process.exit(1);
    });
}
