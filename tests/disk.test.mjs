import test from 'node:test';
import assert from 'node:assert/strict';
import { DiskImage, FLAG_DIRECTORY } from '../src/disk.js';

test('disk image supports nested directories and preserves flags across rewrites', () => {
  const disk = DiskImage.format();
  disk.makeDirectory('D');
  disk.makeDirectory('D/N');
  disk.writeFile('D/N/IDEAS.TXT', new TextEncoder().encode('hello'));
  assert.equal(new TextDecoder().decode(disk.readFile('d/n/ideas.txt')), 'hello');
  assert.ok(disk.entries().find(e => e.name === 'D').flags & FLAG_DIRECTORY);
  assert.throws(() => disk.removeDirectory('D'), /not empty/i);
  disk.removeFile('D/N/IDEAS.TXT');
  disk.removeDirectory('D/N');
  disk.removeDirectory('D');
  assert.deepEqual(disk.list(), []);
});

test('disk image rejects missing parents and attempts to remove directories as files', () => {
  const disk = DiskImage.format();
  assert.throws(() => disk.makeDirectory('MISSING/CHILD'));
  disk.makeDirectory('FOLDER');
  assert.throws(() => disk.removeFile('FOLDER'));
  assert.equal(disk.readFile('FOLDER'), null);
});
