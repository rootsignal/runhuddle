import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseHistory} from '../main/history.mjs';
const lines = rows => rows.map(JSON.stringify).join('\n');
test('history uses Codex conversation events without duplicate response items', () => {
  const result = parseHistory('codex', lines([
    {type:'response_item', payload:{type:'message',role:'user',content:[{type:'input_text',text:'hello'}]}},
    {type:'event_msg',payload:{type:'user_message',message:'hello'}},
    {type:'event_msg',payload:{type:'agent_message',message:'hi'}},
    {type:'event_msg',payload:{type:'task_started'}},
  ]));
  assert.deepEqual(result.map(m=>[m.role,m.text]), [['user','hello'],['assistant','hi']]);
});
test('history extracts text, excludes tool payloads and handles incomplete records', () => {
  const result = parseHistory('claude', lines([
    {type:'user', message:{content:'question'}},
    {type:'assistant', message:{content:[{type:'thinking',thinking:'private'}, {type:'text',text:'answer'}, {type:'tool_use',input:'hidden'}]}},
    {type:'assistant',isSidechain:true,message:{content:'subagent'}}
  ])+'\n{"partial":');
  assert.deepEqual(result.map(m=>m.text), ['question','answer']);
  assert.equal(parseHistory('copilot', lines([{type:'assistant.message',data:{content:'reply'}}]))[0].text,'reply');
});
