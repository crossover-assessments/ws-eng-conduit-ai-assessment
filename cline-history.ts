import * as fs from 'fs';
import * as path from 'path';
import JSZip from 'jszip';

export type ClineRoots = {
  taskRoots: string[];
  sessionsDir: string;
  clineDataDir: string;
  extensionDirs: string[];
};

export type ClineTask = { id: string; dir: string; files: string[] };
export type ClineSession = { id: string; dir: string; messagesFile: string; manifestFile?: string };
export type CollectedClineHistory = {
  tasks: ClineTask[];
  sessions: ClineSession[];
  uncollected: string[];
};

function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

function hasMessages(value: unknown): value is { messages: unknown[]; sessionId?: unknown } {
  return typeof value === 'object' && value !== null && Array.isArray((value as { messages?: unknown }).messages) && (value as { messages: unknown[] }).messages.length > 0;
}

function nonEmptyArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length > 0;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function resolveClineRoots(env: NodeJS.ProcessEnv, _platform: NodeJS.Platform, homedir: string): ClineRoots {
  const home = env.HOME || env.USERPROFILE || (env.HOMEDRIVE && env.HOMEPATH ? path.join(env.HOMEDRIVE, env.HOMEPATH) : undefined) || homedir;
  const configuredSessions = env.CLINE_SESSION_DATA_DIR;
  const configuredData = env.CLINE_DATA_DIR;
  const configuredDir = env.CLINE_DIR;
  const sessionsDir = configuredSessions?.trim()
    ? configuredSessions
    : configuredData?.trim()
      ? path.join(configuredData, 'sessions')
      : configuredDir?.trim()
        ? path.join(configuredDir, 'data', 'sessions')
        : path.join(home, '.cline', 'data', 'sessions');
  const taskRoots = unique([
    path.join(home, '.vscode-remote', 'data', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'tasks'),
    env.APPDATA && path.join(env.APPDATA, 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'tasks'),
    path.join(home, 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'tasks'),
    path.join(home, '.config', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'tasks'),
    path.join(home, '.vscode-server', 'data', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'tasks'),
    path.join(home, '.vscode-remote', 'data', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'tasks'),
  ].filter((entry): entry is string => Boolean(entry)));

  return {
    taskRoots,
    sessionsDir,
    clineDataDir: path.dirname(sessionsDir),
    extensionDirs: [
      path.join(home, '.vscode-server', 'extensions'),
      path.join(home, '.vscode-remote', 'extensions'),
      path.join(home, '.vscode', 'extensions'),
    ],
  };
}

function subdirectories(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => path.join(dir, entry.name));
  } catch {
    return [];
  }
}

function findUncollected(roots: string[], collectedFiles: Set<string>): string[] {
  const found = new Set<string>();
  const visit = (dir: string, depth: number) => {
    if (depth > 4) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < 4) visit(file, depth + 1);
        continue;
      }
      if (!entry.isFile() || (!entry.name.endsWith('.messages.json') && entry.name !== 'api_conversation_history.json')) continue;
      if (collectedFiles.has(file)) continue;
      const value = readJson(file);
      const qualifies = entry.name === 'api_conversation_history.json'
        ? nonEmptyArray(value)
        : hasMessages(value) && (value.sessionId === undefined || path.basename(file, '.messages.json') === value.sessionId);
      if (qualifies) found.add(file);
    }
  };
  for (const root of unique(roots)) visit(root, 0);
  return [...found].sort();
}

export function collectClineHistory(roots: ClineRoots): CollectedClineHistory {
  const tasks: ClineTask[] = [];
  const sessions: ClineSession[] = [];
  const collectedFiles = new Set<string>();

  for (const root of roots.taskRoots) {
    for (const dir of subdirectories(root)) {
      const id = path.basename(dir);
      const apiFile = path.join(dir, 'api_conversation_history.json');
      if (!nonEmptyArray(readJson(apiFile))) continue;
      const files = [apiFile, path.join(dir, 'ui_messages.json')].filter(isFile);
      tasks.push({ id, dir, files });
      files.forEach((file) => collectedFiles.add(file));
    }
  }

  for (const dir of subdirectories(roots.sessionsDir)) {
    const id = path.basename(dir);
    const messagesFile = path.join(dir, `${id}.messages.json`);
    if (!hasMessages(readJson(messagesFile))) continue;
    const manifestFile = path.join(dir, `${id}.json`);
    const session = { id, dir, messagesFile, ...(isFile(manifestFile) ? { manifestFile } : {}) };
    sessions.push(session);
    collectedFiles.add(messagesFile);
    if (session.manifestFile) collectedFiles.add(session.manifestFile);
  }

  return {
    tasks,
    sessions,
    uncollected: findUncollected([...roots.taskRoots, roots.clineDataDir], collectedFiles),
  };
}

export async function addClineHistoryToZip(zip: JSZip, collected: CollectedClineHistory): Promise<void> {
  for (const task of collected.tasks) {
    for (const file of task.files) zip.file(`cline_history/${task.id}/${path.basename(file)}`, fs.readFileSync(file));
  }
  for (const session of collected.sessions) {
    zip.file(`cline_sessions/${session.id}/${session.id}.messages.json`, fs.readFileSync(session.messagesFile));
    if (session.manifestFile) zip.file(`cline_sessions/${session.id}/${session.id}.json`, fs.readFileSync(session.manifestFile));
  }
}

export function readClineInfo(roots: ClineRoots): { extensionVersions: string[] } {
  const versions = new Set<string>();
  for (const dir of roots.extensionDirs) {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const match = entry.isDirectory() && /^saoudrizwan\.claude-dev-(.+)$/.exec(entry.name);
        if (match) versions.add(match[1]);
      }
    } catch {
      continue;
    }
  }
  return { extensionVersions: [...versions].sort() };
}

export function assessClineHistory(collected: CollectedClineHistory): { status: 'collected' | 'none' | 'silent-loss'; message: string } {
  if (collected.uncollected.length > 0 && collected.tasks.length === 0 && collected.sessions.length === 0) {
    return {
      status: 'silent-loss',
      message: `Cline chat history was found but could not be collected:\n${collected.uncollected.join('\n')}\nPlease contact support before submitting and keep the Codespace or machine unchanged.`,
    };
  }
  if (collected.tasks.length === 0 && collected.sessions.length === 0 && collected.uncollected.length === 0) {
    return { status: 'none', message: 'No Cline chat history was found.' };
  }
  const counts = [`${collected.tasks.length} task${collected.tasks.length === 1 ? '' : 's'}`, `${collected.sessions.length} session${collected.sessions.length === 1 ? '' : 's'}`];
  const uncollected = collected.uncollected.length ? ` Uncollected files: ${collected.uncollected.join(', ')}` : '';
  return { status: 'collected', message: `Collected ${counts.join(' and ')}.${uncollected}` };
}
