import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {startEpicAuthorization} from '../../../functions/services/auth/providers/epic/login.js';
const read = async p => (await readFile(new URL('../../../'+p,import.meta.url),'utf8')).replace(/import\s*\{[\s\S]*?\}\s*from\s*"[^"]+";/g,'').replace(/export /g,'');
test('RL Epic button routes signed-in users to link endpoint and signed-out users to Epic-selected verification',async()=>{
 const source=await read('public/Tabs/RocketLeague/Index/JS/connect_epic.js');
 for(const state of [{available:true,authenticated:true,active:true},{available:true,authenticated:false},{available:false},{available:true,authenticated:true,active:false}]){
  const redirects=[],alerts=[];const context={URL,console,getAuthState:async()=>state,BPD_AUTH_LINK_URL:'/api/auth/link',window:{location:{origin:'https://bpd.invalid',assign:u=>redirects.push(u)},alert:m=>alerts.push(m)}};
  vm.runInNewContext(source+';this.start=handleEpicLogin;',context);await context.start({currentTarget:{disabled:false}});
  if(!state.available){assert.equal(redirects.length,0);assert.equal(alerts.length,1);continue;}
  if(state.active===false){assert.equal(redirects[0],'/Account');continue;}
  const url=new URL(redirects[0]);assert.equal(url.pathname,state.authenticated?'/api/auth/link':'/Login');assert.equal(url.searchParams.get('provider'),'epic');assert.equal(url.searchParams.get('returnTo'),'/RocketLeague');
 }
});
test('selected Epic login starts only after session and captcha checks and consumes selection once',async()=>{
 const source=await read('public/Global/Login/JS/index.js');const calls=[];
 const location={href:'https://bpd.invalid/Login?provider=epic&returnTo=%2FRocketLeague'};
 const context={URL,document:{getElementById:()=>({}),querySelectorAll:()=>[]},window:{location,history:{state:null,replaceState:(s,t,url)=>location.href=new URL(url,location.href).href}}};
 vm.runInNewContext(source+';startProviderLogin=async p=>calls.push(p);this.ready=(session,token)=>{sessionReady=session;captchaToken=token;continueRequestedEpicLogin();};',Object.assign(context,{calls,BPD_AUTH_GOOGLE_LOGIN_URL:"/google",BPD_AUTH_DISCORD_LOGIN_URL:"/discord",BPD_AUTH_EPIC_LOGIN_URL:"/epic"}));
 context.ready(false,'token');assert.equal(calls.length,0);context.ready(true,'');assert.equal(calls.length,0);
 context.ready(true,'token');assert.deepEqual(calls,['epic']);context.ready(true,'token');assert.equal(calls.length,1);assert.equal(new URL(location.href).searchParams.get('provider'),null);
});
test('Epic authorization creates state-bound OAuth redirects for login/link/reauthorization',()=>{
 for(const mode of ['login','link','reauthorize']){
  const result=startEpicAuthorization(new Request('https://bpd.invalid/api/auth/link'),{EPIC_CLIENT_ID:'mock-client',EPIC_REDIRECT_URI:'https://bpd.invalid/api/auth/epic/callback'}, {mode,accountId:mode==='login'?null:'account-1',returnTo:'/RocketLeague'});
  const url=new URL(result.redirectUrl);assert.match(url.hostname,/(^|\.)epicgames\.com$/);assert.equal(url.searchParams.get('response_type'),'code');assert.ok(url.searchParams.get('state'));assert.ok(result.cookies.length>=3);assert.equal(result.mode,mode);
 }
});
