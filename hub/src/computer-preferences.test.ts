import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { sqliteD1 } from "../test/sqlite-d1.js";

test("cloud preferences migrate without losing local choices or deletion cleanup", () => {
  const folder = new URL("../migrations/", import.meta.url);
  const files = readdirSync(folder).filter(f=>f.endsWith(".sql")).sort();
  const { sqlite } = sqliteD1(files.filter(f=>f < "0020").map(f=>readFileSync(new URL(f,folder),"utf8")).join("\n"));
  sqlite.exec(`INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES('u','User','u@test.dev',1,1);
    INSERT INTO organizations(id,name,createdAt,updatedAt) VALUES('o','Org',1,1);
    INSERT INTO memberships(id,organization_id,user_id,role,createdAt,updatedAt) VALUES('m','o','u','owner',1,1);
    INSERT INTO organization_workspaces(id,organization_id,name,origin,created_at,updated_at) VALUES('w','o','Repo','github.com/test/repo',1,1),('cloud','o','Cloud','github.com/test/cloud',1,1);
    INSERT INTO organization_computers(id,organization_id,owner_user_id,name,platform,daemon_version,protocol_minimum,protocol_maximum,public_key,capabilities,registered_at,updated_at) VALUES('mac','o','u','Mac','darwin','1',1,1,'key','{}',1,1);
    INSERT INTO member_computer_preferences VALUES('o','u','w','mac');`);
  assert.throws(()=>sqlite.exec("INSERT INTO member_computer_preferences VALUES('o','u','cloud','cloud:fly-sprites')"), /FOREIGN KEY/);
  sqlite.exec(readFileSync(new URL("0020_cloud_computer_preferences.sql",folder),"utf8"));
  assert.equal(sqlite.prepare("SELECT computer_id FROM member_computer_preferences WHERE workspace_id='w'").get()?.computer_id,"mac");
  sqlite.exec("INSERT INTO member_computer_preferences VALUES('o','u','cloud','cloud:fly-sprites')");
  assert.equal(sqlite.prepare("SELECT computer_id FROM member_computer_preferences WHERE workspace_id='cloud'").get()?.computer_id,"cloud:fly-sprites");
  sqlite.exec("UPDATE member_computer_preferences SET computer_id='cloud:modal' WHERE workspace_id='cloud'");
  sqlite.exec("DELETE FROM organization_computers WHERE id='mac'");
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM member_computer_preferences").get()?.n,1);
  sqlite.exec("DELETE FROM memberships WHERE id='m'");
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM member_computer_preferences").get()?.n,0);
  assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(),[]);
  sqlite.close();
});
