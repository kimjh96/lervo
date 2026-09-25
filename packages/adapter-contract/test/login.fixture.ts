import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

/** Native-protocol fixture with no real credentials or provider requests. */
export async function createLoginFixture(roots: string[]) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-login-fixture-"));
  roots.push(root);
  const context = { homeDirectory: root, configurationDirectory: resolve(root, "profile") };
  await mkdir(context.configurationDirectory);
  const statePath = resolve(context.configurationDirectory, "status");
  await writeFile(statePath, "present");
  const executable = resolve(root, "provider.mjs");
  await writeFile(
    executable,
    `#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
const args=process.argv.slice(2).join(' ');
if(args==='--version'){console.log('fixture-provider 1.0');process.exit(0);}
const codex=args==='login status';
if(!codex && args!=='auth status --json')process.exit(2);
if(process.env.LERVO_LOGIN_PROBE_SECRET || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY){console.log('environment leaked');process.exit(2);}
const directory=codex?process.env.CODEX_HOME:process.env.CLAUDE_CONFIG_DIR;
if(process.cwd()!==realpathSync(process.env.HOME) || process.env.USERPROFILE!==process.env.HOME)process.exit(2);
const state=readFileSync(directory+'/status','utf8');
if(state==='hang')await new Promise((resolve)=>setTimeout(resolve,60000));
if(state==='overflow'){process.stdout.write('sensitive'.repeat(4096));process.exit(0);}
if(state==='malformed'){console.log('unrecognized sensitive output');process.exit(0);}
if(state==='absent'){
 if(codex)process.stderr.write('Not logged in\\n');else console.log(JSON.stringify({loggedIn:false}));process.exit(1);
}
if(codex)process.stderr.write(state==='api_key'?'Logged in using an API key - secret-fixture-key\\n':'Logged in using ChatGPT\\n');
else console.log(JSON.stringify({loggedIn:true,email:'private@example.invalid',orgId:'private-org',authMethod:'oauth_token'}));
process.exit(state==='conflict'?1:0);
`,
    { mode: 0o700 },
  );
  await chmod(executable, 0o700);
  return { executable, context, statePath };
}
