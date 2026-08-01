// Author: Subash Karki

import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import { readRegularFileOnce } from './filesystem-snapshot.mjs';

const SHA = /^[a-f0-9]{40,64}$/;
const REF = /^refs\/(?:heads|remotes)\/(?!.*(?:\.\.|@\{|\\|\s|~|\^|:|\?|\*|\[))[A-Za-z0-9._\/-]+$/;

function textFile(file, root) {
  return readRegularFileOnce(file, root).bytes.toString('utf8').trim();
}

function optionalText(file, root) {
  try {
    return textFile(file, root);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return '';
    throw error;
  }
}

function resolveGitDirectories(workspace) {
  const marker = join(workspace, '.git');
  if (!existsSync(marker)) return null;
  const metadata = lstatSync(marker);
  let gitDirectory;
  if (metadata.isDirectory() && !metadata.isSymbolicLink()) {
    gitDirectory = realpathSync(marker);
  } else if (metadata.isFile() && !metadata.isSymbolicLink()) {
    const value = textFile(marker, workspace);
    if (!value.startsWith('gitdir: ')) throw new Error('Workspace .git file is malformed.');
    const target = value.slice('gitdir: '.length);
    gitDirectory = realpathSync(isAbsolute(target) ? target : resolve(workspace, target));
  } else {
    throw new Error('Workspace .git marker must be a regular directory or file.');
  }
  const commonValue = optionalText(join(gitDirectory, 'commondir'), gitDirectory);
  const commonDirectory = commonValue
    ? realpathSync(isAbsolute(commonValue) ? commonValue : resolve(gitDirectory, commonValue))
    : gitDirectory;
  return { gitDirectory, commonDirectory };
}

function refValue(reference, directories) {
  if (!REF.test(reference)) return '';
  const loose = optionalText(join(directories.commonDirectory, ...reference.split('/')), directories.commonDirectory);
  if (SHA.test(loose)) return loose;
  const packed = optionalText(join(directories.commonDirectory, 'packed-refs'), directories.commonDirectory);
  for (const line of packed.split(/\r?\n/)) {
    if (!line || line.startsWith('#') || line.startsWith('^')) continue;
    const [digest, name] = line.split(' ');
    if (name === reference && SHA.test(digest)) return digest;
  }
  return '';
}

function symbolicReference(file, root) {
  const value = optionalText(file, root);
  if (!value.startsWith('ref: ')) return null;
  const reference = value.slice('ref: '.length);
  return REF.test(reference) ? reference : null;
}

function remoteNames(commonDirectory) {
  const config = optionalText(join(commonDirectory, 'config'), commonDirectory);
  const names = [];
  for (const line of config.split(/\r?\n/)) {
    const match = /^\s*\[remote\s+"([A-Za-z0-9._-]+)"\]\s*$/.exec(line);
    if (match) names.push(match[1]);
  }
  return [...new Set(names)].sort();
}

export function gitMetadata(workspaceInput) {
  const workspace = realpathSync(workspaceInput);
  const directories = resolveGitDirectories(workspace);
  if (!directories) {
    return { current_branch: null, head_sha: null, origin_head: null, remotes: [] };
  }
  const head = optionalText(join(directories.gitDirectory, 'HEAD'), directories.gitDirectory);
  const headReference = head.startsWith('ref: ') ? head.slice('ref: '.length) : null;
  const validHeadReference = headReference && REF.test(headReference) ? headReference : null;
  const currentBranch = validHeadReference?.startsWith('refs/heads/')
    ? validHeadReference.slice('refs/heads/'.length)
    : null;
  const headSha = SHA.test(head) ? head : (validHeadReference ? refValue(validHeadReference, directories) : '');
  const originReference = symbolicReference(
    join(directories.commonDirectory, 'refs', 'remotes', 'origin', 'HEAD'),
    directories.commonDirectory,
  );
  return {
    current_branch: currentBranch,
    head_sha: headSha || null,
    origin_head: originReference?.startsWith('refs/remotes/origin/')
      ? originReference.slice('refs/remotes/origin/'.length)
      : null,
    remotes: remoteNames(directories.commonDirectory),
  };
}
