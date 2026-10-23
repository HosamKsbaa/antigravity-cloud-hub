import * as tar from 'tar';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import { config } from '../config.js';

export const ITEM_ID_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

export interface PluginMetadata {
  id: string;
  name: string;
  displayName: string;
  version: string;
  description: string;
  author: string;
  tags: string[];
  hasRules: boolean;
  hasMcp: boolean;
  sidecars: Array<{
    id: string;
    title: string;
    hasWebUi?: boolean;
    pillLink?: string;
  }>;
  skills: string[];
  suggestedPrompts: string[];
}

export interface SkillMetadata {
  id: string;
  name: string;
  displayName: string;
  version: string;
  description: string;
  author: string;
  license?: string;
  publisher?: string;
  tags: string[];
  hasScripts: boolean;
  hasReferences: boolean;
  hasTemplates: boolean;
  suggestedPrompts: string[];
}

/**
 * Computes the SHA-256 hex checksum of a buffer or file.
 */
export function computeSha256(data: Buffer | string): string {
  if (typeof data === 'string' && fs.existsSync(data)) {
    const fileBuffer = fs.readFileSync(data);
    return crypto.createHash('sha256').update(fileBuffer).digest('hex');
  }
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Validates and parses a Semantic Version string.
 */
export function parseSemVer(
  versionStr: string
): { major: number; minor: number; patch: number; prerelease?: string } | null {
  if (!versionStr || typeof versionStr !== 'string') return null;
  const clean = versionStr.trim().replace(/^v/, '');
  const match = clean.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4] || undefined,
  };
}

/**
 * Checks if a string is valid SemVer.
 */
export function isValidSemVer(versionStr: string): boolean {
  return parseSemVer(versionStr) !== null;
}

/**
 * Compares two SemVer strings.
 * Returns > 0 if v1 > v2
 * Returns 0 if v1 == v2
 * Returns < 0 if v1 < v2
 */
export function compareSemVer(v1: string, v2: string): number {
  const p1 = parseSemVer(v1);
  const p2 = parseSemVer(v2);
  if (!p1) throw new Error(`Invalid SemVer version: "${v1}"`);
  if (!p2) throw new Error(`Invalid SemVer version: "${v2}"`);

  if (p1.major !== p2.major) return p1.major - p2.major;
  if (p1.minor !== p2.minor) return p1.minor - p2.minor;
  if (p1.patch !== p2.patch) return p1.patch - p2.patch;

  if (!p1.prerelease && p2.prerelease) return 1;
  if (p1.prerelease && !p2.prerelease) return -1;
  if (p1.prerelease && p2.prerelease) {
    return p1.prerelease.localeCompare(p2.prerelease);
  }
  return 0;
}

/**
 * Ensures all executable scripts within a directory have 0755 permissions.
 */
export function ensureExecutablePermissions(dirPath: string): void {
  if (!fs.existsSync(dirPath)) return;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      try {
        fs.chmodSync(fullPath, 0o755);
      } catch {}
      ensureExecutablePermissions(fullPath);
    } else if (entry.isFile()) {
      const isScript =
        entry.name.endsWith('.sh') ||
        entry.name.endsWith('.py') ||
        entry.name.endsWith('.mjs') ||
        entry.name.endsWith('.bash') ||
        entry.name.endsWith('.js') ||
        fullPath.includes('/scripts/');

      if (isScript) {
        try {
          fs.chmodSync(fullPath, 0o755);
        } catch {}
      }
    }
  }
}

/**
 * Parses YAML frontmatter from a SKILL.md or skill.md file.
 */
export function parseSkillMarkdown(content: string): {
  name: string;
  displayName: string;
  description: string;
  version: string;
  license?: string;
  publisher?: string;
  tags: string[];
  suggestedPrompts: string[];
} {
  let name = '';
  let description = '';
  let version = '1.0.0';
  let license: string | undefined;
  let publisher: string | undefined;
  let displayName = '';
  const tags: string[] = [];
  const suggestedPrompts: string[] = [];

  const fmMatch = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (fmMatch) {
    const fm = fmMatch[1];

    const nameMatch = fm.match(/^name:\s*(.+)$/m);
    if (nameMatch) {
      name = nameMatch[1].trim().replace(/^['"]|['"]$/g, '');
    }

    const verMatch =
      fm.match(/(?:version|metadata:\s*\n\s*version):\s*(.+)$/m) ||
      fm.match(/^\s*version:\s*(.+)$/m);
    if (verMatch) {
      const rawVer = verMatch[1].trim().replace(/^['"]|['"]$/g, '');
      if (rawVer) {
        if (/^v?\d+$/.test(rawVer)) {
          version = `${rawVer.replace(/^v/, '')}.0.0`;
        } else if (isValidSemVer(rawVer)) {
          version = rawVer.replace(/^v/, '');
        } else {
          version = rawVer;
        }
      } else {
        version = '';
      }
    }

    const licMatch = fm.match(/^license:\s*(.+)$/m);
    if (licMatch) {
      license = licMatch[1].trim().replace(/^['"]|['"]$/g, '');
    }

    const pubMatch =
      fm.match(/^publisher:\s*(.+)$/m) || fm.match(/^\s*publisher:\s*(.+)$/m);
    if (pubMatch) {
      publisher = pubMatch[1].trim().replace(/^['"]|['"]$/g, '');
    }

    const descBlockMatch = fm.match(
      /^description:\s*(?:[|>]-?\s*\r?\n([\s\S]*?))(?=\r?\n[a-zA-Z0-9_-]+:|$)/m
    );
    if (descBlockMatch) {
      description = descBlockMatch[1]
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .join(' ');
    } else {
      const descLineMatch = fm.match(/^description:\s*(.+)$/m);
      if (descLineMatch) {
        description = descLineLineClean(descLineMatch[1]);
      }
    }
  }

  const titleMatch = content.match(/^#\s+(.+)$/m);
  if (titleMatch) {
    displayName = titleMatch[1].replace(/^[^\w\s]+/, '').trim();
  }
  if (!displayName) {
    displayName = name;
  }

  return {
    name,
    displayName,
    description,
    version: version ? version.replace(/^v/, '').trim() : '',
    license,
    publisher,
    tags,
    suggestedPrompts,
  };
}

function descLineLineClean(val: string): string {
  return val.trim().replace(/^['"]|['"]$/g, '');
}

/**
 * Inspects a plugin directory and extracts its complete metadata.
 */
export function inspectPluginDir(dirPath: string): PluginMetadata {
  const manifestPath = path.join(dirPath, 'plugin.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing plugin.json manifest in ${dirPath}`);
  }

  let raw: any;
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err: any) {
    throw new Error(`Invalid plugin.json JSON in ${dirPath}: ${err.message}`);
  }

  const folderName = path.basename(dirPath);
  const id = String(raw.id || raw.name || '').trim();
  const name = String(raw.name || id).trim();
  const displayName = String(raw.displayName || raw.name || id || folderName).trim();
  const version = raw.version ? String(raw.version).trim() : '';
  const description = String(raw.description || '').trim();
  const author = String(raw.author || 'HosamKsbaa').trim();
  const tags: string[] = Array.isArray(raw.tags) ? raw.tags : [];
  const suggestedPrompts: string[] = Array.isArray(raw.suggestedPrompts)
    ? raw.suggestedPrompts
    : [];

  const hasRules =
    fs.existsSync(path.join(dirPath, 'rules', 'AGENTS.md')) ||
    fs.existsSync(path.join(dirPath, 'rules'));
  const hasMcp = fs.existsSync(path.join(dirPath, 'mcp_config.json'));

  const sidecars: PluginMetadata['sidecars'] = [];
  const sidecarsDir = path.join(dirPath, 'sidecars');
  if (fs.existsSync(sidecarsDir) && fs.statSync(sidecarsDir).isDirectory()) {
    for (const scName of fs.readdirSync(sidecarsDir)) {
      const scJson = path.join(sidecarsDir, scName, 'sidecar.json');
      if (fs.existsSync(scJson)) {
        try {
          const scData = JSON.parse(fs.readFileSync(scJson, 'utf8'));
          sidecars.push({
            id: scName,
            title: scData.title || scName,
            hasWebUi: Boolean(scData.entrypoint || scData.webUi || scData.hasWebUi !== false),
            pillLink: `sidecar://${id}/${scName}/`,
          });
        } catch {
          sidecars.push({
            id: scName,
            title: scName,
            hasWebUi: true,
            pillLink: `sidecar://${id}/${scName}/`,
          });
        }
      }
    }
  }

  const skills: string[] = [];
  const skillsDir = path.join(dirPath, 'skills');
  if (fs.existsSync(skillsDir) && fs.statSync(skillsDir).isDirectory()) {
    for (const skName of fs.readdirSync(skillsDir)) {
      if (
        fs.existsSync(path.join(skillsDir, skName, 'SKILL.md')) ||
        fs.existsSync(path.join(skillsDir, skName, 'skill.md'))
      ) {
        skills.push(skName);
      }
    }
  }

  return {
    id,
    name,
    displayName,
    version,
    description,
    author,
    tags,
    hasRules,
    hasMcp,
    sidecars,
    skills,
    suggestedPrompts,
  };
}

/**
 * Inspects a skill directory and extracts its complete metadata.
 */
export function inspectSkillDir(dirPath: string): SkillMetadata {
  let skillFilePath: string | null = null;
  for (const f of ['SKILL.md', 'skill.md']) {
    const candidate = path.join(dirPath, f);
    if (fs.existsSync(candidate)) {
      skillFilePath = candidate;
      break;
    }
  }

  if (!skillFilePath) {
    throw new Error(`Missing SKILL.md manifest in ${dirPath}`);
  }

  const content = fs.readFileSync(skillFilePath, 'utf8');
  const parsed = parseSkillMarkdown(content);
  const folderName = path.basename(dirPath);

  const id = parsed.name || '';
  const name = parsed.name || id;
  const displayName = parsed.displayName || name || folderName;
  const version = parsed.version ? parsed.version.trim() : '';
  const description = parsed.description || '';
  const author = parsed.publisher || 'Antigravity Team';

  const hasScripts =
    fs.existsSync(path.join(dirPath, 'scripts')) &&
    fs.statSync(path.join(dirPath, 'scripts')).isDirectory();
  const hasReferences =
    fs.existsSync(path.join(dirPath, 'references')) &&
    fs.statSync(path.join(dirPath, 'references')).isDirectory();
  const hasTemplates =
    fs.existsSync(path.join(dirPath, 'templates')) &&
    fs.statSync(path.join(dirPath, 'templates')).isDirectory();

  return {
    id,
    name,
    displayName,
    version,
    description,
    author,
    license: parsed.license,
    publisher: parsed.publisher,
    tags: parsed.tags,
    hasScripts,
    hasReferences,
    hasTemplates,
    suggestedPrompts: parsed.suggestedPrompts,
  };
}

/**
 * Packages a directory into a root-relative .tar.gz bundle.
 * Preserves 0755 mode on executable scripts.
 */
export async function createPackage(
  sourceDir: string,
  destTarGzPath: string
): Promise<{ checksumSha256: string; sizeBytes: number }> {
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Source directory does not exist: ${sourceDir}`);
  }

  // Ensure scripts are 0755
  ensureExecutablePermissions(sourceDir);

  // Ensure destination folder exists
  fs.mkdirSync(path.dirname(destTarGzPath), { recursive: true });

  const entries = fs.readdirSync(sourceDir).filter((e) => !e.startsWith('.git'));
  if (entries.length === 0) {
    throw new Error(`Source directory is empty: ${sourceDir}`);
  }

  tar.create(
    {
      gzip: true,
      cwd: sourceDir,
      file: destTarGzPath,
      sync: true,
      portable: true,
    },
    entries
  );

  const stat = fs.statSync(destTarGzPath);
  const fileBuf = fs.readFileSync(destTarGzPath);
  const checksum = crypto.createHash('sha256').update(fileBuf).digest('hex');

  return {
    checksumSha256: checksum,
    sizeBytes: stat.size,
  };
}

/**
 * Inspects an uploaded tarball buffer for a plugin or skill.
 * Unpacks to a temporary directory, validates manifest and structure, and returns metadata.
 */
export function inspectTarballBuffer(
  buffer: Buffer,
  expectedType: 'plugin' | 'skill'
): {
  manifest: PluginMetadata | SkillMetadata;
  extractedDir: string;
  cleanup: () => void;
} {
  if (!buffer || buffer.length < 2 || buffer[0] !== 0x1f || buffer[1] !== 0x8b) {
    throw new Error('Failed to decompress archive: TAR_BAD_ARCHIVE: Unrecognized archive format (gzip .tar.gz required)');
  }

  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), `agy-${expectedType}-upload-`));
  const tmpTar = path.join(tmpBase, 'package.tar.gz');
  const tmpExtract = path.join(tmpBase, 'extracted');
  fs.mkdirSync(tmpExtract, { recursive: true });
  fs.writeFileSync(tmpTar, buffer);

  try {
    tar.extract({
      file: tmpTar,
      cwd: tmpExtract,
      sync: true,
    });
  } catch (err: any) {
    try {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    } catch {}
    throw new Error(`Failed to decompress archive: ${err.message}`);
  }

  // Check if archive was packaged with a single top-level folder
  let targetDir = tmpExtract;
  const entries = fs.readdirSync(tmpExtract).filter((e) => !e.startsWith('.'));
  if (
    entries.length === 1 &&
    fs.statSync(path.join(tmpExtract, entries[0])).isDirectory()
  ) {
    const sub = path.join(tmpExtract, entries[0]);
    if (
      (expectedType === 'plugin' && fs.existsSync(path.join(sub, 'plugin.json'))) ||
      (expectedType === 'skill' &&
        (fs.existsSync(path.join(sub, 'SKILL.md')) ||
          fs.existsSync(path.join(sub, 'skill.md'))))
    ) {
      targetDir = sub;
    }
  }

  const cleanup = () => {
    try {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    } catch {}
  };

  try {
    if (expectedType === 'plugin') {
      const manifest = inspectPluginDir(targetDir);
      return { manifest, extractedDir: targetDir, cleanup };
    } else {
      const manifest = inspectSkillDir(targetDir);
      return { manifest, extractedDir: targetDir, cleanup };
    }
  } catch (err) {
    cleanup();
    throw err;
  }
}

/**
 * Resolves storage path for a plugin or skill bundle.
 */
export function getPackageStoragePath(
  type: 'plugins' | 'skills',
  id: string,
  version: string
): string {
  if (!ITEM_ID_REGEX.test(id) || id.includes('..')) {
    throw new Error(`Invalid item identifier: "${id}"`);
  }
  const base = config.storageDir;
  const resolvedPath = path.resolve(base, type, id, `${id}-${version}.tar.gz`);
  if (!resolvedPath.startsWith(path.resolve(base))) {
    throw new Error(`Storage path traversal detected: "${id}"`);
  }
  return resolvedPath;
}
