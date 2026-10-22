import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execFileAsync=promisify(execFile);
const studio=fileURLToPath(new URL('../',import.meta.url));

test('browser timing bundle test runs from an actual Chinese and space directory',async()=>{
  const root=await mkdtemp(join(tmpdir(),'acs-路径 空格-'));
  try{
    for(const path of ['tests/editorial-timing.test.mjs','src/shared/editorial-timing.mjs',
      'src/server/production/subtitle-segmentation.mjs']){
      await mkdir(dirname(join(root,path)),{recursive:true});
      await copyFile(join(studio,path),join(root,path));
    }
    await symlink(join(studio,'node_modules'),join(root,'node_modules'),'dir');
    const env={...process.env};delete env.NODE_TEST_CONTEXT;
    const result=await execFileAsync(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=bundle for a browser',
      join(root,'tests/editorial-timing.test.mjs')],{env,timeout:30000,maxBuffer:1024*1024});
    assert.match(result.stdout,/# fail 0/u);
  }finally{await rm(root,{recursive:true,force:true});}
});
