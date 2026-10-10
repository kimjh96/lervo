import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { compileNative, nativeRoot, run } from "./native-fixture.js";

it.runIf(process.platform === "darwin")(
  "drains running and queued groups without receipts or descriptor leaks when a Worker terminates",
  async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-cas-teardown-"));
    try {
      const { binary } = await compileNative(root, "gated", {
        kernel: `
#include <errno.h>
#include <fcntl.h>
#include <stdlib.h>
#include <unistd.h>
static ssize_t gatedRead(int fd, void *bytes, size_t size) {
  int marker = open(getenv("LERVO_CAS_TEST_STARTED"), O_WRONLY | O_CREAT, 0600);
  if (marker < 0) return -1;
  close(marker);
  for (unsigned i = 0; access(getenv("LERVO_CAS_TEST_RELEASE"), F_OK); i++) {
    if (i >= 5000) { errno = EIO; return -1; }
    usleep(1000);
  }
  return read(fd, bytes, size);
}
#define read gatedRead
#define lervoExecuteCasOperation originalExecute
#include ${JSON.stringify(resolve(nativeRoot, "cas-io.c"))}
#undef lervoExecuteCasOperation
void lervoExecuteCasOperation(LervoCasOperation *operation) {
  int marker = open(getenv("LERVO_CAS_TEST_EXECUTED"), O_WRONLY | O_CREAT | O_APPEND, 0600);
  if (marker < 0) { operation->disposition = LERVO_CAS_FAILED; return; }
  (void)write(marker, "x", 1);
  close(marker);
  originalExecute(operation);
}
`,
      });
      const script = `
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {readdirSync,writeFileSync,existsSync,unlinkSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const [binary,root]=process.argv.slice(1), marker=process.env.LERVO_CAS_TEST_STARTED, release=process.env.LERVO_CAS_TEST_RELEASE, executed=process.env.LERVO_CAS_TEST_EXECUTED;
const empty=new Worker('',{eval:true,execArgv:[]});
await new Promise((r,j)=>{empty.once('exit',r);empty.once('error',j)});
const before=readdirSync('/dev/fd').length, counts=[], executions=[], target=resolve(root,'body');
writeFileSync(target,Buffer.alloc(65536,97));
for(let i=0;i<8;i++){
  if(existsSync(marker))unlinkSync(marker);
  if(existsSync(release))unlinkSync(release);
  if(existsSync(executed))unlinkSync(executed);
  const worker=new Worker(\`
    const {workerData,parentPort}=require('node:worker_threads');
    const {batch}=require(workerData.binary);
    for(let i=0;i<16;i++)batch([[workerData.target]]).then(()=>parentPort.postMessage('completed'),()=>parentPort.postMessage('rejected'));
    parentPort.postMessage('queued');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);
  \`,{eval:true,execArgv:[],workerData:{binary,target}});
  const messages=[];
  worker.on('message',m=>messages.push(m));
  await new Promise((r,j)=>{worker.once('message',r);worker.once('error',j)});
  const deadline=Date.now()+5000;
  while(!existsSync(marker)){assert(Date.now()<deadline);await new Promise(r=>setTimeout(r,1));}
  const stopped=worker.terminate();
  writeFileSync(release,'release');
  await stopped;
  assert.deepEqual(messages,['queued']);
  const ran=readFileSync(executed).length;
  assert(ran>=1 && ran<=16);
  executions.push(ran);
  counts.push(readdirSync('/dev/fd').length);
}
assert(counts.every(x=>x===before));
console.log(JSON.stringify({before,counts,executions}));
`;
      const { stdout } = await run(
        process.execPath,
        ["--input-type=module", "-e", script, binary, root],
        {
          timeout: 15000,
          env: {
            ...process.env,
            UV_THREADPOOL_SIZE: "1",
            LERVO_CAS_TEST_STARTED: resolve(root, "started"),
            LERVO_CAS_TEST_RELEASE: resolve(root, "release"),
            LERVO_CAS_TEST_EXECUTED: resolve(root, "executed"),
          },
        },
      );
      const evidence = JSON.parse(stdout);
      expect(evidence.counts).toEqual(Array(8).fill(evidence.before));
      expect(evidence.executions).toHaveLength(8);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  20000,
);

it.runIf(process.platform === "darwin")(
  "retains admission ownership after the exported function is collected",
  async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-cas-gc-"));
    try {
      const { binary } = await compileNative(root, "gc");
      const script = `
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const [binary,root]=process.argv.slice(1),target=path.join(root,'body');
fs.writeFileSync(target,Buffer.alloc(65536,97));
(async()=>{
  for(let i=0;i<8;i++){
    const native=require(binary), pending=native.batch(Array.from({length:16},()=>[target]));
    delete native.batch;
    delete require.cache[require.resolve(binary)];
    global.gc();
    await new Promise(r=>setImmediate(r));
    global.gc();
    const results=await pending;
    assert.equal(results.length,16);
    assert(results.every(r=>r.status==='complete'&&r.bytes.equals(Buffer.alloc(65536,97))));
  }
  global.gc();
  console.log('collected function ownership passed');
})().catch(e=>{console.error(e);process.exitCode=1});
`;
      const { stdout } = await run(process.execPath, ["--expose-gc", "-e", script, binary, root], {
        timeout: 15000,
      });
      expect(stdout.trim()).toBe("collected function ownership passed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  20000,
);
