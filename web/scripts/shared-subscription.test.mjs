import assert from 'node:assert/strict';
import test from 'node:test';
import { shareSubscription } from '../src/lib/shared-subscription.ts';

test('sidebar and pane share one read and stream; reopening receives current state', () => {
  let starts=0, stops=0, emit, fail;
  const watch=shareSubscription((key, changed, failed)=>{starts++;emit=changed;fail=failed;return()=>stops++;});
  const sidebar=[],pane=[],reopened=[],errors=[];
  const offSidebar=watch('org', v=>sidebar.push(v), e=>errors.push(e));
  const offPane=watch('org', v=>pane.push(v), e=>errors.push(e));
  assert.equal(starts,1);
  emit(['first']);
  assert.deepEqual(pane,sidebar);
  offPane();
  emit(['second']);
  const offReopened=watch('org',v=>reopened.push(v),()=>{});
  assert.deepEqual(reopened,[['second']]);
  assert.equal(starts,1);
  fail('Offline');
  assert.deepEqual(errors,['Offline']);
  offReopened();offSidebar();
  assert.equal(stops,1);
  const next=[];
  const offNext=watch('org',v=>next.push(v),()=>{});
  assert.equal(starts,2);
  assert.deepEqual(next,[]);
  offNext();
});

test('organization streams and their cached values remain isolated',()=>{
  const emitters=new Map();
  const watch=shareSubscription((key,changed)=>{emitters.set(key,changed);return()=>{};});
  const a=[],b=[];
  const offA=watch('a',v=>a.push(v),()=>{}),offB=watch('b',v=>b.push(v),()=>{});
  emitters.get('a')(['private']);
  assert.deepEqual(a,[['private']]);assert.deepEqual(b,[]);
  offA();offB();
});
