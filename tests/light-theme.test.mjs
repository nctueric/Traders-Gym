import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,readdirSync} from 'node:fs';
test('all application styles stay light regardless of system theme, preserving gain/loss choice',()=>{
 const directory=new URL('../app/',import.meta.url);for(const name of readdirSync(directory).filter(n=>n.endsWith('.css'))){const text=readFileSync(new URL(name,directory),'utf8');assert.doesNotMatch(text,/prefers-color-scheme\s*:\s*dark|color-scheme\s*:\s*dark/,name);}
 const global=readFileSync(new URL('globals.css',directory),'utf8');assert.match(global,/:root\s*\{\s*color-scheme:\s*light/);
 const workspace=readFileSync(new URL('trade-workspace.tsx',directory),'utf8');assert.match(workspace,/green-up/);assert.match(workspace,/red-up/);
});
