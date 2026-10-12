import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

it.runIf(process.platform === "darwin")(
  "drains native work and descriptors when its Worker is terminated during execution",
  async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-native-teardown-"));
    const run = promisify(execFile);
    try {
      const nativeRoot = fileURLToPath(new URL("../native/", import.meta.url));
      const wrapper = resolve(root, "gated-kernel.c"),
        binary = resolve(root, "gated.node");
      await writeFile(
        wrapper,
        `
#include <stdlib.h>
#define lervoSynchronizeGroup originalSynchronizeGroup
#include ${JSON.stringify(resolve(nativeRoot, "sync-group.c"))}
#undef lervoSynchronizeGroup
void lervoSynchronizeGroup(LervoSyncGroup *group) {
  int marker = open(getenv("LERVO_SYNC_TEST_STARTED"), O_WRONLY | O_CREAT, 0600);
  if (marker < 0) { group->error = EIO; return; }
  close(marker);
  for (unsigned i = 0; access(getenv("LERVO_SYNC_TEST_RELEASE"), F_OK); i++) {
    if (i >= 5000) { group->error = EIO; return; }
    usleep(1000);
  }
  originalSynchronizeGroup(group);
}
`,
      );
      const headers = resolve(dirname(await realpath(process.execPath)), "../include/node");
      await run("xcrun", [
        "clang",
        "-std=c11",
        "-Wall",
        "-Wextra",
        "-Werror",
        "-DNAPI_VERSION=8",
        "-bundle",
        "-undefined",
        "dynamic_lookup",
        "-I",
        headers,
        resolve(nativeRoot, "binding.c"),
        wrapper,
        "-o",
        binary,
      ]);
      const script = `
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {readdirSync,writeFileSync,existsSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
const binary=process.argv[1],root=process.argv[2],marker=process.env.LERVO_SYNC_TEST_STARTED,release=process.env.LERVO_SYNC_TEST_RELEASE;
const empty=new Worker('',{eval:true,execArgv:[]});await new Promise((r,j)=>{empty.once('exit',r);empty.once('error',j)});
const before=readdirSync('/dev/fd').length,counts=[];
const paths=[resolve(root,'a'),resolve(root,'b')];for(const p of paths)writeFileSync(p,'fixture');
for(let i=0;i<8;i++){
 if(existsSync(marker))unlinkSync(marker);if(existsSync(release))unlinkSync(release);
 const worker=new Worker(\`const {workerData,parentPort}=require('node:worker_threads');const fs=require('node:fs');const native=require(workerData.binary);const fds=workerData.paths.map(p=>fs.openSync(p,'r+'));native.synchronize(fds).catch(()=>{});fds.forEach(fd=>fs.closeSync(fd));parentPort.postMessage('queued');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);\`,{eval:true,execArgv:[],workerData:{binary,paths}});
 await new Promise((r,j)=>{worker.once('message',r);worker.once('error',j)});
 const deadline=Date.now()+5000;while(!existsSync(marker)){assert(Date.now()<deadline);await new Promise(r=>setTimeout(r,1));}
 const stopped=worker.terminate();writeFileSync(release,'release');await stopped;
 counts.push(readdirSync('/dev/fd').length);
}
assert(counts.every(x=>x===before));console.log(JSON.stringify({before,counts}));
`;
      const result = await run(
        process.execPath,
        ["--input-type=module", "-e", script, binary, root],
        {
          timeout: 15000,
          env: {
            ...process.env,
            LERVO_SYNC_TEST_STARTED: resolve(root, "started"),
            LERVO_SYNC_TEST_RELEASE: resolve(root, "release"),
          },
        },
      );
      const observation = JSON.parse(result.stdout);
      expect(observation.counts).toEqual(Array(8).fill(observation.before));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  20000,
);
