import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../src/modules/proyectos/NuevoProyectoPage.jsx', import.meta.url), 'utf8');
const start = source.indexOf('        const folders = await ensureFoldersMigrated(projectIdParam);');
const end = source.indexOf('      } catch (e)', start);
const body = source.slice(start, end);
for (const status of ['processing', 'completed', null]) {
  const state = {};
  let subscriber;
  const item = { id: 'photo', file: { name: 'test.CR3' }, fingerprint: { marked: true } };
  const deps = {
    projectIdParam: 'existing-project', folderIdParam: 'folder', alive: true,
    ensureFoldersMigrated: async () => [{ id: 'folder', raw_folder_name: 'RAW' }],
    getProject: async () => ({ title: 'Boda existente', event_date: '2026-10-13' }),
    getJob: () => status ? { status, items: [item] } : null,
    subscribe: (_, __, callback) => { subscriber = callback; return () => {}; },
    listFingerprintsByFolder: async () => [{ id: 'photo', filename: 'test.CR3', marked: true }],
    navigate: () => assert.fail('Unexpected redirect'), reset: () => {},
  };
  for (const name of ['Title', 'EventDate', 'Existing', 'Extracting', 'Phase', 'Progress', 'Items', 'SelectedIds']) {
    deps['set' + name] = value => { state[name] = value; };
  }
  const run = new Function(...Object.keys(deps), `return (async () => { let unsub; ${body} })();`);
  await run(...Object.values(deps));
  if (status === 'processing') subscriber({ status: 'completed', items: [item] });
  assert.equal(state.Title, 'Boda existente', status);
  assert.equal(state.EventDate, '2026-10-13', status);
  assert.deepEqual(state.Existing, { projectId: 'existing-project', folderId: 'folder', folderName: 'RAW' }, status);
  assert.equal(state.Items.length, 1, status);
  assert.ok(state.SelectedIds.has('photo'), status);
}
console.log('PASS: processing, completed and persisted folders retain project metadata and selection');
