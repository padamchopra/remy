import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {sqliteD1} from '../test/sqlite-d1.js';
import {profilePreferences} from './profile-preferences.js';
import {validProfileImage} from './profile-image.js';
test('profile pictures allow supported presets and bounded raster uploads only',()=>{
 for(const image of ['preset:cobalt-cyclops','data:image/jpeg;base64,/9j/','https://avatars.githubusercontent.com/u/1']) assert.equal(validProfileImage(image),true);
 for(const image of ['preset:missing','javascript:alert(1)','data:image/svg+xml;base64,PHN2Zz4=','data:image/jpeg;base64,'+'a'.repeat(100000),{}]) assert.equal(validProfileImage(image),false);
});
test('permission defaults persist per account without affecting other members and validate writes',async()=>{
 const root=new URL('../migrations/',import.meta.url);
 const {db,sqlite}=sqliteD1(readdirSync(root).filter(f=>f.endsWith('.sql')).sort().map(f=>readFileSync(new URL(f,root),'utf8')).join('\n'));
 try{
 sqlite.exec("INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES('a','A','a@example.com',1,1,1),('b','B','b@example.com',1,1,1)");
 const call=(user:string,mode?:string)=>profilePreferences(db,user,new Request('https://test/profile-preferences',{method:mode?'PATCH':'GET',...(mode?{body:JSON.stringify({permissionMode:mode})}:{})}));
 assert.deepEqual(await(await call('a')).json(),{permissionMode:'default'});
 assert.deepEqual(await(await call('a','plan')).json(),{permissionMode:'plan'});
 assert.deepEqual(await(await call('a')).json(),{permissionMode:'plan'});
 assert.deepEqual(await(await call('b')).json(),{permissionMode:'default'});
 assert.equal((await call('a','invalid')).status,400);
 sqlite.exec("DELETE FROM user WHERE id='a'");assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM member_preferences').get()?.n,0);
 }finally{sqlite.close();}
});
