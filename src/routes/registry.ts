import { Router, Request, Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { eq, or, sql, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { plugins, pluginVersions, skills, skillVersions, users } from '../db/schema.js';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/rbac.js';
import {
  computeSha256,
  isValidSemVer,
  compareSemVer,
  inspectTarballBuffer,
  getPackageStoragePath,
  ITEM_ID_REGEX,
} from '../services/packageService.js';
import { config } from '../config.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max bundle upload
  },
});

export const registryRouter = Router();

function getBaseUrl(req: Request): string {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto = typeof forwardedProto === 'string' ? forwardedProto.split(',')[0].trim() : req.protocol;
  const host = (req.headers['x-forwarded-host'] as string) || req.get('host') || 'localhost:4000';
  return `${proto}://${host}`;
}

// ---------------------------------------------------------------------------
// 1. Catalog Endpoint: GET /api/registry.json
// ---------------------------------------------------------------------------
registryRouter.get('/registry.json', optionalAuthMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const baseUrl = getBaseUrl(req);

    // Fetch all plugins with their latest version record
    const allPlugins = await db.query.plugins.findMany({
      orderBy: [desc(plugins.updatedAt)],
    });

    const pluginItems: any[] = [];
    for (const p of allPlugins) {
      // Find latest version record
      const latestVer = await db.query.pluginVersions.findFirst({
        where: eq(pluginVersions.pluginId, p.id),
        orderBy: [desc(pluginVersions.createdAt)],
      });

      // Find author name if available
      let authorName = 'HosamKsbaa';
      if (p.authorId) {
        const authorUser = await db.query.users.findFirst({
          where: eq(users.id, p.authorId),
        });
        if (authorUser?.name) authorName = authorUser.name;
      }

      pluginItems.push({
        id: p.id,
        name: p.name,
        displayName: p.displayName,
        version: latestVer?.version || p.latestVersion,
        description: p.description || '',
        author: authorName,
        tags: Array.isArray(p.tags) ? p.tags : [],
        downloadUrl: `${baseUrl}/api/plugins/${encodeURIComponent(p.id)}/download`,
        checksum: latestVer?.checksumSha256 || '',
        sizeBytes: latestVer ? Number(latestVer.fileSize) : 0,
        sidecars: Array.isArray(p.sidecars) ? p.sidecars : [],
        skills: Array.isArray(p.skills) ? p.skills : [],
        hasRules: Boolean(p.hasRules),
        hasMcp: Boolean(p.hasMcp),
        suggestedPrompts: Array.isArray(p.suggestedPrompts) ? p.suggestedPrompts : [],
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      });
    }

    // Fetch all skills with their latest version record
    const allSkills = await db.query.skills.findMany({
      orderBy: [desc(skills.updatedAt)],
    });

    const skillItems: any[] = [];
    for (const s of allSkills) {
      const latestVer = await db.query.skillVersions.findFirst({
        where: eq(skillVersions.skillId, s.id),
        orderBy: [desc(skillVersions.createdAt)],
      });

      let authorName = s.publisher || 'Antigravity Team';
      if (s.authorId) {
        const authorUser = await db.query.users.findFirst({
          where: eq(users.id, s.authorId),
        });
        if (authorUser?.name) authorName = authorUser.name;
      }

      skillItems.push({
        id: s.id,
        name: s.name,
        displayName: s.displayName,
        version: latestVer?.version || s.latestVersion,
        description: s.description || '',
        author: authorName,
        license: s.license || undefined,
        tags: Array.isArray(s.tags) ? s.tags : [],
        downloadUrl: `${baseUrl}/api/skills/${encodeURIComponent(s.id)}/download`,
        checksum: latestVer?.checksumSha256 || '',
        sizeBytes: latestVer ? Number(latestVer.fileSize) : 0,
        hasScripts: Boolean(s.hasScripts),
        hasReferences: Boolean(s.hasReferences),
        hasTemplates: Boolean(s.hasTemplates),
        suggestedPrompts: Array.isArray(s.suggestedPrompts) ? s.suggestedPrompts : [],
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      });
    }

    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    res.json({
      schemaVersion: 1,
      registryName: 'Antigravity Cloud Hub',
      baseUrl,
      generatedAt: new Date().toISOString(),
      pluginCount: pluginItems.length,
      plugins: pluginItems,
      skillCount: skillItems.length,
      skills: skillItems,
    });
  } catch (error: any) {
    console.error('[REGISTRY] Failed to generate catalog:', error);
    res.status(500).json({ error: 'Failed to generate registry catalog' });
  }
});

// ---------------------------------------------------------------------------
// 2. Download Plugin Bundle: GET /api/plugins/:id/download
// ---------------------------------------------------------------------------
registryRouter.get('/plugins/:id/download', async (req: Request, res: Response): Promise<void> => {
  try {
    const pluginId = String(req.params.id);
    const rawVersion = typeof req.query.version === 'string' ? req.query.version : typeof req.query.v === 'string' ? req.query.v : null;
    const requestedVersion = rawVersion ? rawVersion.trim() : null;

    // Look up plugin by id or name
    const pluginRecord = await db.query.plugins.findFirst({
      where: or(eq(plugins.id, pluginId), eq(plugins.name, pluginId)),
    });

    if (!pluginRecord) {
      res.status(404).json({
        ok: false,
        error: `Plugin '${pluginId}' not found`,
        code: 'NOT_FOUND',
      });
      return;
    }

    let versionRecord;
    if (requestedVersion) {
      versionRecord = await db.query.pluginVersions.findFirst({
        where: sql`${pluginVersions.pluginId} = ${pluginRecord.id} AND (${pluginVersions.version} = ${requestedVersion} OR ${pluginVersions.version} = ${'v' + requestedVersion})`,
      });
      if (!versionRecord) {
        res.status(404).json({
          ok: false,
          error: `Version '${requestedVersion}' of plugin '${pluginId}' not found`,
          code: 'NOT_FOUND',
        });
        return;
      }
    } else {
      versionRecord = await db.query.pluginVersions.findFirst({
        where: eq(pluginVersions.pluginId, pluginRecord.id),
        orderBy: [desc(pluginVersions.createdAt)],
      });

      if (!versionRecord) {
        res.status(404).json({
          ok: false,
          error: `No package bundle found for plugin '${pluginId}'`,
          code: 'NOT_FOUND',
        });
        return;
      }
    }

    // Resolve file path on disk
    let bundlePath = versionRecord.filePath;
    if (!fs.existsSync(bundlePath)) {
      const fallbackPath = getPackageStoragePath('plugins', pluginRecord.id, versionRecord.version);
      if (fs.existsSync(fallbackPath)) {
        bundlePath = fallbackPath;
      } else {
        res.status(404).json({
          ok: false,
          error: `Package archive file missing on disk for plugin '${pluginId}'`,
          code: 'FILE_NOT_FOUND',
        });
        return;
      }
    }

    // Increment downloads count asynchronously
    db.update(plugins)
      .set({ downloadsCount: sql`${plugins.downloadsCount} + 1` })
      .where(eq(plugins.id, pluginRecord.id))
      .catch((err) => console.error('Failed to increment plugin download count:', err));

    const stat = fs.statSync(bundlePath);
    const filename = `${pluginRecord.id}-${versionRecord.version}.tar.gz`;

    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', stat.size);
    res.setHeader('X-Checksum-Sha256', versionRecord.checksumSha256);
    res.setHeader('ETag', `"${versionRecord.checksumSha256}"`);
    res.setHeader('X-Item-Id', pluginRecord.id);
    res.setHeader('X-Item-Type', 'plugin');
    res.setHeader('X-Item-Version', versionRecord.version);
    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');

    const fileStream = fs.createReadStream(bundlePath);
    fileStream.pipe(res);
  } catch (error: any) {
    console.error('[REGISTRY] Plugin download error:', error);
    res.status(500).json({ error: 'Internal server error while streaming package' });
  }
});

// ---------------------------------------------------------------------------
// 3. Download Skill Bundle: GET /api/skills/:id/download
// ---------------------------------------------------------------------------
registryRouter.get('/skills/:id/download', async (req: Request, res: Response): Promise<void> => {
  try {
    const skillId = String(req.params.id);
    const rawVersion = typeof req.query.version === 'string' ? req.query.version : typeof req.query.v === 'string' ? req.query.v : null;
    const requestedVersion = rawVersion ? rawVersion.trim() : null;

    const skillIdAlt1 = skillId.replace(/_/g, '-');
    const skillIdAlt2 = skillId.replace(/-/g, '_');

    // Look up skill by id or name, with hyphen/underscore tolerance
    const skillRecord = await db.query.skills.findFirst({
      where: or(
        eq(skills.id, skillId),
        eq(skills.name, skillId),
        eq(skills.id, skillIdAlt1),
        eq(skills.name, skillIdAlt1),
        eq(skills.id, skillIdAlt2),
        eq(skills.name, skillIdAlt2)
      ),
    });

    if (!skillRecord) {
      res.status(404).json({
        ok: false,
        error: `Skill '${skillId}' not found`,
        code: 'NOT_FOUND',
      });
      return;
    }

    let versionRecord;
    if (requestedVersion) {
      versionRecord = await db.query.skillVersions.findFirst({
        where: sql`${skillVersions.skillId} = ${skillRecord.id} AND (${skillVersions.version} = ${requestedVersion} OR ${skillVersions.version} = ${'v' + requestedVersion})`,
      });
      if (!versionRecord) {
        res.status(404).json({
          ok: false,
          error: `Version '${requestedVersion}' of skill '${skillId}' not found`,
          code: 'NOT_FOUND',
        });
        return;
      }
    } else {
      versionRecord = await db.query.skillVersions.findFirst({
        where: eq(skillVersions.skillId, skillRecord.id),
        orderBy: [desc(skillVersions.createdAt)],
      });

      if (!versionRecord) {
        res.status(404).json({
          ok: false,
          error: `No package bundle found for skill '${skillId}'`,
          code: 'NOT_FOUND',
        });
        return;
      }
    }

    let bundlePath = versionRecord.filePath;
    if (!fs.existsSync(bundlePath)) {
      const fallbackPath = getPackageStoragePath('skills', skillRecord.id, versionRecord.version);
      if (fs.existsSync(fallbackPath)) {
        bundlePath = fallbackPath;
      } else {
        res.status(404).json({
          ok: false,
          error: `Package archive file missing on disk for skill '${skillId}'`,
          code: 'FILE_NOT_FOUND',
        });
        return;
      }
    }

    // Increment downloads count asynchronously
    db.update(skills)
      .set({ downloadsCount: sql`${skills.downloadsCount} + 1` })
      .where(eq(skills.id, skillRecord.id))
      .catch((err) => console.error('Failed to increment skill download count:', err));

    const stat = fs.statSync(bundlePath);
    const filename = `${skillRecord.id}-${versionRecord.version}.tar.gz`;

    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', stat.size);
    res.setHeader('X-Checksum-Sha256', versionRecord.checksumSha256);
    res.setHeader('ETag', `"${versionRecord.checksumSha256}"`);
    res.setHeader('X-Item-Id', skillRecord.id);
    res.setHeader('X-Item-Type', 'skill');
    res.setHeader('X-Item-Version', versionRecord.version);
    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');

    const fileStream = fs.createReadStream(bundlePath);
    fileStream.pipe(res);
  } catch (error: any) {
    console.error('[REGISTRY] Skill download error:', error);
    res.status(500).json({ error: 'Internal server error while streaming skill package' });
  }
});

// ---------------------------------------------------------------------------
// 4. Publish Plugin: POST /api/plugins/publish (Admin Only)
// ---------------------------------------------------------------------------
registryRouter.post(
  '/plugins/publish',
  authMiddleware,
  requireAdmin,
  upload.single('file'),
  async (req: Request, res: Response): Promise<void> => {
    let cleanupDir: (() => void) | null = null;
    try {
      if (!req.file || !req.file.buffer) {
        res.status(400).json({ error: 'Archive file (.tar.gz) is required' });
        return;
      }

      // 1. Unpack & validate manifest
      let inspected;
      try {
        inspected = inspectTarballBuffer(req.file.buffer, 'plugin');
        cleanupDir = inspected.cleanup;
      } catch (err: any) {
        res.status(400).json({
          ok: false,
          error: err.message || 'Invalid plugin bundle',
          code: 'INVALID_PACKAGE',
        });
        return;
      }

      const manifest = inspected.manifest as any;
      const pluginId = String(req.body.pluginId || req.body.id || manifest.id || manifest.name).trim();

      if (!ITEM_ID_REGEX.test(pluginId) || pluginId.includes('..')) {
        res.status(400).json({
          ok: false,
          error: `Invalid item identifier: "${pluginId}"`,
          code: 'INVALID_ID',
        });
        return;
      }

      // 2. Validate SemVer
      const formVersion = req.body.version ? String(req.body.version).trim() : null;
      const manifestVersion = String(manifest.version || '').trim();

      if (formVersion && !isValidSemVer(formVersion)) {
        res.status(400).json({
          ok: false,
          error: `Invalid SemVer version specified in request: "${formVersion}"`,
          code: 'INVALID_SEMVER',
        });
        return;
      }

      if (!isValidSemVer(manifestVersion)) {
        res.status(400).json({
          ok: false,
          error: `Invalid SemVer version in plugin.json: "${manifestVersion}"`,
          code: 'INVALID_SEMVER',
        });
        return;
      }

      const targetVersion = (formVersion || manifestVersion).replace(/^v/, '');

      // 3. Enforce strictly greater SemVer if plugin already exists
      const existing = await db.query.plugins.findFirst({
        where: eq(plugins.id, pluginId),
      });

      if (existing) {
        if (compareSemVer(targetVersion, existing.latestVersion) <= 0) {
          res.status(400).json({
            ok: false,
            error: `Version ${targetVersion} is already published or not greater than existing version ${existing.latestVersion}.`,
            code: 'VERSION_CONFLICT',
            currentLatestVersion: existing.latestVersion,
          });
          return;
        }
      }

      // 4. Save tarball to persistent storage
      const storagePath = getPackageStoragePath('plugins', pluginId, targetVersion);
      fs.mkdirSync(path.dirname(storagePath), { recursive: true });
      fs.writeFileSync(storagePath, req.file.buffer);

      const checksum = computeSha256(req.file.buffer);
      const sizeBytes = req.file.buffer.length;

      // 5. Database upsert
      const now = new Date();
      if (existing) {
        await db
          .update(plugins)
          .set({
            displayName: manifest.displayName || existing.displayName,
            description: manifest.description || existing.description,
            latestVersion: targetVersion,
            hasRules: manifest.hasRules,
            hasMcp: manifest.hasMcp,
            sidecars: manifest.sidecars || existing.sidecars,
            skills: manifest.skills || existing.skills,
            suggestedPrompts: manifest.suggestedPrompts || existing.suggestedPrompts,
            tags: manifest.tags || existing.tags,
            updatedAt: now,
          })
          .where(eq(plugins.id, pluginId));
      } else {
        await db.insert(plugins).values({
          id: pluginId,
          name: manifest.name || pluginId,
          displayName: manifest.displayName || pluginId,
          description: manifest.description || '',
          authorId: req.user?.id || null,
          latestVersion: targetVersion,
          hasRules: manifest.hasRules,
          hasMcp: manifest.hasMcp,
          sidecars: manifest.sidecars || [],
          skills: manifest.skills || [],
          suggestedPrompts: manifest.suggestedPrompts || [],
          tags: manifest.tags || [],
          downloadsCount: 0,
          createdAt: now,
          updatedAt: now,
        });
      }

      // Insert plugin version record (upsert on duplicate)
      await db
        .insert(pluginVersions)
        .values({
          pluginId,
          version: targetVersion,
          changelog: req.body.changelog ? String(req.body.changelog) : null,
          filePath: storagePath,
          fileSize: sizeBytes,
          checksumSha256: checksum,
          uploadedBy: req.user?.id || null,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: [pluginVersions.pluginId, pluginVersions.version],
          set: {
            filePath: storagePath,
            fileSize: sizeBytes,
            checksumSha256: checksum,
            changelog: req.body.changelog ? String(req.body.changelog) : null,
          },
        });

      const baseUrl = getBaseUrl(req);
      res.status(201).json({
        ok: true,
        id: pluginId,
        itemType: 'plugin',
        version: targetVersion,
        displayName: manifest.displayName || pluginId,
        checksum,
        sizeBytes,
        downloadUrl: `${baseUrl}/api/plugins/${encodeURIComponent(pluginId)}/download`,
        publishedAt: now.toISOString(),
      });
    } catch (error: any) {
      console.error('[REGISTRY] Publish plugin error:', error);
      res.status(500).json({ error: error.message || 'Failed to publish plugin' });
    } finally {
      if (cleanupDir) cleanupDir();
    }
  }
);

// ---------------------------------------------------------------------------
// 5. Publish Skill: POST /api/skills/publish (Admin Only)
// ---------------------------------------------------------------------------
registryRouter.post(
  '/skills/publish',
  authMiddleware,
  requireAdmin,
  upload.single('file'),
  async (req: Request, res: Response): Promise<void> => {
    let cleanupDir: (() => void) | null = null;
    try {
      if (!req.file || !req.file.buffer) {
        res.status(400).json({ error: 'Archive file (.tar.gz) is required' });
        return;
      }

      // 1. Unpack & validate SKILL.md
      let inspected;
      try {
        inspected = inspectTarballBuffer(req.file.buffer, 'skill');
        cleanupDir = inspected.cleanup;
      } catch (err: any) {
        res.status(400).json({
          ok: false,
          error: err.message || 'Invalid skill bundle',
          code: 'INVALID_PACKAGE',
        });
        return;
      }

      const manifest = inspected.manifest as any;
      const skillId = String(req.body.skillId || req.body.id || manifest.id || manifest.name).trim();

      if (!ITEM_ID_REGEX.test(skillId) || skillId.includes('..')) {
        res.status(400).json({
          ok: false,
          error: `Invalid item identifier: "${skillId}"`,
          code: 'INVALID_ID',
        });
        return;
      }

      // 2. Validate SemVer
      const formVersion = req.body.version ? String(req.body.version).trim() : null;
      const manifestVersion = String(manifest.version || '').trim();

      if (formVersion && !isValidSemVer(formVersion)) {
        res.status(400).json({
          ok: false,
          error: `Invalid SemVer version specified in request: "${formVersion}"`,
          code: 'INVALID_SEMVER',
        });
        return;
      }

      if (!isValidSemVer(manifestVersion)) {
        res.status(400).json({
          ok: false,
          error: `Invalid SemVer version in SKILL.md: "${manifestVersion}"`,
          code: 'INVALID_SEMVER',
        });
        return;
      }

      const targetVersion = (formVersion || manifestVersion).replace(/^v/, '');

      // 3. Check existing version
      const existing = await db.query.skills.findFirst({
        where: eq(skills.id, skillId),
      });

      if (existing) {
        if (compareSemVer(targetVersion, existing.latestVersion) <= 0) {
          res.status(400).json({
            ok: false,
            error: `Version ${targetVersion} is already published or not greater than existing version ${existing.latestVersion}.`,
            code: 'VERSION_CONFLICT',
            currentLatestVersion: existing.latestVersion,
          });
          return;
        }
      }

      // 4. Save tarball to persistent storage
      const storagePath = getPackageStoragePath('skills', skillId, targetVersion);
      fs.mkdirSync(path.dirname(storagePath), { recursive: true });
      fs.writeFileSync(storagePath, req.file.buffer);

      const checksum = computeSha256(req.file.buffer);
      const sizeBytes = req.file.buffer.length;

      // 5. Database upsert
      const now = new Date();
      if (existing) {
        await db
          .update(skills)
          .set({
            displayName: manifest.displayName || existing.displayName,
            description: manifest.description || existing.description,
            latestVersion: targetVersion,
            hasScripts: Boolean(manifest.hasScripts),
            hasReferences: Boolean(manifest.hasReferences),
            hasTemplates: Boolean(manifest.hasTemplates),
            tags: manifest.tags || existing.tags,
            suggestedPrompts: manifest.suggestedPrompts || existing.suggestedPrompts,
            license: manifest.license || existing.license,
            publisher: manifest.publisher || existing.publisher,
            updatedAt: now,
          })
          .where(eq(skills.id, skillId));
      } else {
        await db.insert(skills).values({
          id: skillId,
          name: manifest.name || skillId,
          displayName: manifest.displayName || skillId,
          description: manifest.description || '',
          license: manifest.license || null,
          publisher: manifest.publisher || 'Antigravity Team',
          authorId: req.user?.id || null,
          latestVersion: targetVersion,
          hasScripts: Boolean(manifest.hasScripts),
          hasReferences: Boolean(manifest.hasReferences),
          hasTemplates: Boolean(manifest.hasTemplates),
          tags: manifest.tags || [],
          suggestedPrompts: manifest.suggestedPrompts || [],
          downloadsCount: 0,
          createdAt: now,
          updatedAt: now,
        });
      }

      await db
        .insert(skillVersions)
        .values({
          skillId,
          version: targetVersion,
          filePath: storagePath,
          fileSize: sizeBytes,
          checksumSha256: checksum,
          uploadedBy: req.user?.id || null,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: [skillVersions.skillId, skillVersions.version],
          set: {
            filePath: storagePath,
            fileSize: sizeBytes,
            checksumSha256: checksum,
          },
        });

      const baseUrl = getBaseUrl(req);
      res.status(201).json({
        ok: true,
        id: skillId,
        itemType: 'skill',
        version: targetVersion,
        displayName: manifest.displayName || skillId,
        checksum,
        sizeBytes,
        downloadUrl: `${baseUrl}/api/skills/${encodeURIComponent(skillId)}/download`,
        publishedAt: now.toISOString(),
      });
    } catch (error: any) {
      console.error('[REGISTRY] Publish skill error:', error);
      res.status(500).json({ error: error.message || 'Failed to publish skill' });
    } finally {
      if (cleanupDir) cleanupDir();
    }
  }
);

// ---------------------------------------------------------------------------
// 6. Delete Plugin: DELETE /api/plugins/:id (Admin Only)
// ---------------------------------------------------------------------------
registryRouter.delete(
  '/plugins/:id',
  authMiddleware,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const pluginId = String(req.params.id);
      if (!ITEM_ID_REGEX.test(pluginId) || pluginId.includes('..')) {
        res.status(400).json({ ok: false, error: `Invalid item identifier: "${pluginId}"`, code: 'INVALID_ID' });
        return;
      }

      const existing = await db.query.plugins.findFirst({
        where: or(eq(plugins.id, pluginId), eq(plugins.name, pluginId)),
      });

      if (!existing) {
        res.status(404).json({ ok: false, error: `Plugin '${pluginId}' not found`, code: 'NOT_FOUND' });
        return;
      }

      // Delete from database (cascades to plugin_versions)
      await db.delete(plugins).where(eq(plugins.id, existing.id));

      // Optional disk cleanup
      const dirPath = path.resolve(config.storageDir, 'plugins', existing.id);
      if (path.resolve(dirPath).startsWith(path.resolve(config.storageDir)) && fs.existsSync(dirPath)) {
        try {
          fs.rmSync(dirPath, { recursive: true, force: true });
        } catch {}
      }

      res.json({ ok: true, message: `Plugin '${existing.id}' deleted successfully` });
    } catch (error: any) {
      console.error('[REGISTRY] Delete plugin error:', error);
      res.status(500).json({ error: 'Failed to delete plugin' });
    }
  }
);

// ---------------------------------------------------------------------------
// 7. Delete Skill: DELETE /api/skills/:id (Admin Only)
// ---------------------------------------------------------------------------
registryRouter.delete(
  '/skills/:id',
  authMiddleware,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const skillId = String(req.params.id);
      if (!ITEM_ID_REGEX.test(skillId) || skillId.includes('..')) {
        res.status(400).json({ ok: false, error: `Invalid item identifier: "${skillId}"`, code: 'INVALID_ID' });
        return;
      }

      const skillIdAlt1 = skillId.replace(/_/g, '-');
      const skillIdAlt2 = skillId.replace(/-/g, '_');

      const existing = await db.query.skills.findFirst({
        where: or(
          eq(skills.id, skillId),
          eq(skills.name, skillId),
          eq(skills.id, skillIdAlt1),
          eq(skills.name, skillIdAlt1),
          eq(skills.id, skillIdAlt2),
          eq(skills.name, skillIdAlt2)
        ),
      });

      if (!existing) {
        res.status(404).json({ ok: false, error: `Skill '${skillId}' not found`, code: 'NOT_FOUND' });
        return;
      }

      await db.delete(skills).where(eq(skills.id, existing.id));

      const dirPath = path.resolve(config.storageDir, 'skills', existing.id);
      if (path.resolve(dirPath).startsWith(path.resolve(config.storageDir)) && fs.existsSync(dirPath)) {
        try {
          fs.rmSync(dirPath, { recursive: true, force: true });
        } catch {}
      }

      res.json({ ok: true, message: `Skill '${existing.id}' deleted successfully` });
    } catch (error: any) {
      console.error('[REGISTRY] Delete skill error:', error);
      res.status(500).json({ error: 'Failed to delete skill' });
    }
  }
);

export default registryRouter;
