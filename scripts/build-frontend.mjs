import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const app=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../app');
const node=process.execPath;
for(const args of [
 [path.join(app,'node_modules/typescript/bin/tsc'),'--noEmit'],
 [path.join(app,'node_modules/typescript/bin/tsc'),'--noEmit','-p','tsconfig.tests.json'],
 ['--experimental-strip-types',path.join(app,'node_modules/vite/bin/vite.js'),'build','--configLoader','native'],
]){
 const result=spawnSync(node,args,{cwd:app,stdio:'inherit'});
 if(result.error)throw result.error;
 if(result.status!==0)process.exit(result.status??1);
}
