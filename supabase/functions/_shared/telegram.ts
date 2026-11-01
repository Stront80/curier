import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
export const admin = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
async function hmac(keyBytes: Uint8Array, data: string) {
 const key = await crypto.subtle.importKey('raw', keyBytes, {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
 return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
}
export async function verifyTelegram(initData: string) {
 const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
 if (!botToken || !initData) throw new Error('Telegram authentication is not configured');
 const params = new URLSearchParams(initData); const hash = params.get('hash');
 if (!hash) throw new Error('Missing Telegram hash');
 const authDate = Number(params.get('auth_date') || 0);
 if (!authDate || Math.abs(Date.now()/1000-authDate) > 86400) throw new Error('Telegram initData expired');
 params.delete('hash');
 const dataCheck = [...params.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
 const secret = await hmac(new TextEncoder().encode('WebAppData'), botToken);
 const calculated = hex(await hmac(secret, dataCheck));
 if (calculated.length !== hash.length || !crypto.subtle) throw new Error('Invalid Telegram signature');
 let diff=0; for(let i=0;i<hash.length;i++) diff |= calculated.charCodeAt(i)^hash.charCodeAt(i);
 if(diff!==0) throw new Error('Invalid Telegram signature');
 const rawUser = params.get('user'); if(!rawUser) throw new Error('Missing Telegram user');
 const user = JSON.parse(rawUser);
 return {telegram_id:Number(user.id), username:user.username ?? null, first_name:user.first_name ?? '', last_name:user.last_name ?? null, language:user.language_code === 'en' ? 'en' : 'ru'};
}
export async function requireProfile(initData: string) {
 const user = await verifyTelegram(initData); const db=admin();
 const {data,error}=await db.from('profiles').upsert(user,{onConflict:'telegram_id'}).select('*').single();
 if(error) throw error; if(data.is_blocked) throw new Error('User is blocked');
 return {db,user,profile:data};
}
export const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
export const json = (body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
