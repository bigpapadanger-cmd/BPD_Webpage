import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
// Supply an isolated PGlite module path; no project credentials or database connection.
const {PGlite} = await import(process.argv[2] || '@electric-sql/pglite');
const db = new PGlite();
let count=0;
async function check(name, fn){await fn(); console.log('PASS '+name); count++;}
const actor='11111111-1111-4111-8111-111111111111';
const input={title:'Test',body:'Body',priority:'High',timeline_days:7,responsible_roles:['ui']};
async function rpc(name,args=[]){const placeholders=args.map((_,i)=>'$'+(i+1)).join(',');const r=await db.query(`SELECT api.${name}(${placeholders}) AS result`,args);return r.rows[0].result;}
async function create(changes={}){return (await rpc('admin_create_task',[JSON.stringify({...input,...changes}),actor])).task;}
async function action(name,t){return (await rpc('admin_'+name+'_task',[t.task_code,t.version,actor])).task;}
try {
await db.exec(await readFile(new URL('./fixtures/taskboard_schema.sql',import.meta.url),'utf8'));
const migration=await readFile(new URL('../../../functions/services/supabase/admin/tasks/sql/taskboard_schema_repair.sql',import.meta.url),'utf8');
await check('migration applies over supplied RPC definitions',()=>db.exec(migration));
await check('post-migration verification script and all RPC grants',async()=>{
 const sql=await readFile(new URL('../../../functions/services/supabase/admin/tasks/sql/taskboard_verify.sql',import.meta.url),'utf8');
 const results=await db.exec(sql);
 assert.equal(results[0].rows[0].column_name,'version');
 assert.equal(results[1].rows.length,17);
 for(const row of results[1].rows){assert.equal(row.anon_can_execute,false);assert.equal(row.browser_user_can_execute,false);assert.equal(row.server_can_execute,true);}
});
await db.query('INSERT INTO identity.accounts(id) VALUES ($1)',[actor]);
let t;
await check('create, role assignment, deadline trigger and initial history',async()=>{
 t=await create();assert.equal(t.version,1);assert.equal(t.body,'Body');assert.deepEqual(t.responsible_roles,['ui']);
 const r=await db.query('SELECT deadline=created_at::date+timeline_days AS valid FROM admin.tasks WHERE id=$1',[t.id]);assert.equal(r.rows[0].valid,true);
 const h=await rpc('admin_get_task_events',[t.task_code,50,0]);assert.equal(h.events.length,1);assert.equal(h.events[0].new_data.body,'Body');
});
await check('invalid roles, missing fields, obsolete fields and invalid timeline reject atomically',async()=>{
 for(const change of [{responsible_roles:[]},{responsible_roles:['admin']},{body:null},{timeline_days:30},{description:'old'}]) await assert.rejects(create(change));
 assert.equal((await rpc('admin_list_tasks',['{}',50,0])).pagination.total,1);
});
await check('update and no-op retain optimistic concurrency and history',async()=>{
 const u=await rpc('admin_update_task',[t.task_code,t.version,JSON.stringify({body:'Changed',responsible_roles:['security']}),actor]);t=u.task;assert.equal(t.version,2);
 const noop=await rpc('admin_update_task',[t.task_code,t.version,JSON.stringify({body:'Changed'}),actor]);assert.equal(noop.changed,false);assert.equal(noop.version,2);
 await assert.rejects(rpc('admin_update_task',[t.task_code,1,JSON.stringify({body:'Stale'}),actor]),/TASK_VERSION_CONFLICT/);
 assert.equal((await rpc('admin_get_task_events',[t.task_code,50,0])).events.length,2);
});
await check('all lifecycle actions preserve valid status and nested restoration',async()=>{
 t=await action('complete',t);assert.equal(t.status,'Completed');assert.ok(t.completed_at);
 t=await action('reopen',t);assert.equal(t.status,'To Do');assert.equal(t.completed_at,null);
 t=await action('shelve',t);t=await action('archive',t);t=await action('delete',t);
 t=await action('restore_deleted',t);assert.equal(t.status,'Archived');
 t=await action('restore_archived',t);assert.equal(t.status,'Shelved');
 t=await action('unshelve',t);assert.equal(t.status,'To Do');
});
await check('repeated restore cycles in one transaction select the latest version snapshot',async()=>{
 await db.exec('BEGIN');
 let cycle=await create();
 cycle=await action('shelve',cycle);cycle=await action('archive',cycle);cycle=await action('restore_archived',cycle);cycle=await action('unshelve',cycle);
 cycle=await action('complete',cycle);cycle=await action('archive',cycle);cycle=await action('restore_archived',cycle);assert.equal(cycle.status,'Completed');
 cycle=await action('delete',cycle);cycle=await action('restore_deleted',cycle);assert.equal(cycle.status,'Completed');
 await db.exec('ROLLBACK');
});
await check('list, summary, filters, history and pagination execute',async()=>{
 assert.equal((await rpc('admin_get_task',[t.task_code,false])).task.id,t.id);
 assert.equal((await rpc('admin_list_tasks',[JSON.stringify({responsibleRole:'security',timeline_days:7}),50,0])).tasks.length,1);
 assert.equal((await rpc('admin_list_tasks',[JSON.stringify({responsibleRole:'ui'}),50,0])).tasks.length,0);
 assert.equal((await rpc('admin_get_task_summary')).active,1);
 assert.deepEqual((await rpc('admin_get_task_assignees')).roles,['owner','database','security','ui']);
 const events=await rpc('admin_get_task_activity',[2,0]);assert.equal(events.activity.length,2);assert.equal(events.pagination.hasMore,true);
 const filtered=await rpc('admin_list_task_activity',[JSON.stringify({actorAccountId:actor,eventType:'created'}),50,0]);assert.equal(filtered.activity.length,1);
 t=await action('delete',t);assert.equal((await rpc('admin_list_tasks',['{}',50,0])).tasks.length,0);
 assert.equal((await rpc('admin_list_tasks',[JSON.stringify({includeDeleted:true}),50,0])).tasks.length,1);
 await assert.rejects(rpc('admin_get_task',[t.task_code,false]),/TASK_NOT_FOUND/);
});
await check('browser roles cannot call privileged RPCs; service role can',async()=>{
 for(const role of ['anon','authenticated']) {await db.exec('SET ROLE '+role);await assert.rejects(rpc('admin_get_task_summary'),/permission denied/);await db.exec('RESET ROLE');}
 await db.exec('SET ROLE service_role');assert.equal((await rpc('admin_get_task_summary')).success,true);await db.exec('RESET ROLE');
});
await check('account deletion retains tasks/history with nullable references',async()=>{
 const before=await db.query('SELECT count(*)::int n FROM admin.task_events');await db.query('DELETE FROM identity.accounts WHERE id=$1',[actor]);
 const after=await db.query('SELECT count(*)::int n FROM admin.task_events WHERE actor_account_id IS NULL');assert.equal(after.rows[0].n,before.rows[0].n);
 const row=await db.query('SELECT creator_account_id,updated_by_account_id FROM admin.tasks WHERE id=$1',[t.id]);assert.equal(row.rows[0].creator_account_id,null);assert.equal(row.rows[0].updated_by_account_id,null);
 assert.ok((await rpc('admin_get_task_activity',[50,0])).activity.length>0);
});
await check('migration can be reapplied without deleting records',async()=>{await db.exec(migration);assert.equal((await db.query('SELECT count(*)::int n FROM admin.tasks')).rows[0].n,1);});
console.log(`${count} PostgreSQL integration checks passed.`);
} catch(e){console.error('VALIDATION FAILED:',e.message,e.detail||'',e.where||'');process.exitCode=1;} finally{await db.close();}
