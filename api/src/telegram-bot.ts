import 'dotenv/config';
import pg from 'pg';
import { readFile } from 'node:fs/promises';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
const token = process.env.TELEGRAM_BOT_TOKEN;
const base = token ? `https://api.telegram.org/bot${token}` : '';
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

async function tg(method: string, body: Record<string, unknown> = {}) {
  const response = await fetch(`${base}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(35_000)
  });
  const data = await response.json() as any;
  if (!response.ok || !data.ok) throw new Error(data.description ?? `Telegram ${method} failed`);
  return data.result;
}
const send = (chat_id: number, text: string, extra = {}) => tg('sendMessage', { chat_id, text, ...extra });
const menu = { keyboard: [[{text:'Разместить заказ'},{text:'Посмотреть заказы'}],[{text:'Мои заказы'},{text:'Поддержать проект'}],[{text:'Помощь / Правила'}]], resize_keyboard:true, is_persistent:true };

async function profile(user: any) {
  const r = await pool.query(
    `INSERT INTO public.profiles(telegram_id,username,first_name,last_name,language)
     VALUES($1,$2,$3,$4,$5) ON CONFLICT(telegram_id) DO UPDATE SET
     username=EXCLUDED.username,first_name=EXCLUDED.first_name,last_name=EXCLUDED.last_name
     RETURNING id,is_blocked`,
    [String(user.id),user.username??null,user.first_name??'',user.last_name??null,user.language_code==='en'?'en':'ru']);
  if (!r.rowCount || r.rows[0].is_blocked) throw new Error('Профиль заблокирован или недоступен.');
  return r.rows[0].id as string;
}
async function session(id:number, state:any) {
  if (!state) return pool.query('DELETE FROM public.bot_sessions WHERE telegram_id=$1',[String(id)]);
  return pool.query(`INSERT INTO public.bot_sessions(telegram_id,state,updated_at) VALUES($1,$2::jsonb,now())
    ON CONFLICT(telegram_id) DO UPDATE SET state=EXCLUDED.state,updated_at=now()`,[String(id),JSON.stringify(state)]);
}
async function getSession(id:number) {
  const r=await pool.query("SELECT state FROM public.bot_sessions WHERE telegram_id=$1 AND updated_at>now()-interval '2 hours'",[String(id)]);
  return r.rows[0]?.state ?? null;
}
async function createOrder(telegramId:number,d:any) {
  const me=await pool.query('SELECT id FROM public.profiles WHERE telegram_id=$1 AND is_blocked=false',[String(telegramId)]);
  if (!me.rowCount) throw new Error('Профиль не найден. Нажмите /start.');
  const title=d.title || `Заказ: ${d.city}`;
  const description=d.description || 'Подробности доставки заказчик уточнит с курьером.';
  const r=await pool.query(`INSERT INTO public.orders
    (customer_id,title,pickup_address,dropoff_address,description,initial_price,city,pickup_at_text,metro_or_district,reward_amount,reward_currency)
    VALUES($1,$2,$3,'Уточняется',$4,$5,$6,$7,$8,$5,$9)
    RETURNING id,title,city,pickup_at_text,metro_or_district,reward_amount,reward_currency,status`,
    [me.rows[0].id,title,`${d.city}, ${d.metro}`,description,Number(d.amount),d.city,d.when,d.metro,d.currency]);
  await pool.query("INSERT INTO public.order_events(order_id,actor_id,event_type,payload) VALUES($1,$2,'order_created_via_bot',$3::jsonb)",
    [r.rows[0].id,me.rows[0].id,JSON.stringify({source:'telegram_bot'})]);
  return r.rows[0];
}
async function card(chat:number,o:any,claim=false,contact=false) {
  const text=[`📦 ${o.title}`,`Город: ${o.city??'—'}`,`Забрать: ${o.pickup_at_text??'—'}`,
    `Район/метро: ${o.metro_or_district??'—'}`,`Вознаграждение: ${o.reward_amount??o.initial_price??'—'} ${o.reward_currency??''}`,
    `Описание: ${o.description??'—'}`,`Статус: ${o.status}`,`ID: ${o.id}`].join('\n');
  const rows:any[]=[];
  if(claim) rows.push([{text:'Взять заказ',callback_data:`take:${o.id}`}]);
  if(contact) rows.push([{text:'Посмотреть контакты',callback_data:`contact:${o.id}`}]);
  await send(chat,text,rows.length?{reply_markup:{inline_keyboard:rows}}:{});
}
async function available(chat:number) {
  const r=await pool.query(`SELECT id,title,description,initial_price,status,city,pickup_at_text,metro_or_district,reward_amount,reward_currency
    FROM public.orders WHERE status IN('open','negotiating') AND courier_id IS NULL AND early_access_until<=now()
    ORDER BY created_at DESC LIMIT 10`);
  if(!r.rowCount) return send(chat,'Сейчас нет доступных заказов.',{reply_markup:menu});
  await send(chat,'Доступные заказы. Контакты заказчика скрыты до назначения заказа.');
  for(const o of r.rows) await card(chat,o,true,false);
}
async function mine(chat:number,telegramId:number) {
  const r=await pool.query(`SELECT o.*,me.id AS my_id FROM public.orders o JOIN public.profiles me ON me.telegram_id=$1
    WHERE o.customer_id=me.id OR o.courier_id=me.id ORDER BY o.created_at DESC LIMIT 20`,[String(telegramId)]);
  if(!r.rowCount) return send(chat,'У вас пока нет заказов.',{reply_markup:menu});
  for(const o of r.rows) await card(chat,o,false,o.courier_id===o.my_id);
}
async function claim(telegramId:number,id:string) {
  const c=await pool.connect();
  try {
    await c.query('BEGIN');
    const me=await c.query('SELECT id,is_blocked FROM public.profiles WHERE telegram_id=$1 FOR UPDATE',[String(telegramId)]);
    if(!me.rowCount||me.rows[0].is_blocked) throw new Error('Профиль недоступен.');
    const r=await c.query('SELECT * FROM public.orders WHERE id=$1 FOR UPDATE',[id]);
    if(!r.rowCount) throw new Error('Заказ не найден.');
    const o=r.rows[0];
    if(o.customer_id===me.rows[0].id) throw new Error('Нельзя взять собственный заказ.');
    if(o.courier_id||!['open','negotiating'].includes(o.status)) throw new Error('Заказ уже недоступен.');
    if(new Date(o.early_access_until).getTime()>Date.now()) throw new Error('Заказ пока недоступен.');
    const customer=await c.query('SELECT telegram_id,is_blocked FROM public.profiles WHERE id=$1 FOR UPDATE',[o.customer_id]);
    if(!customer.rowCount||customer.rows[0].is_blocked) throw new Error('Заказчик недоступен.');
    await c.query("UPDATE public.orders SET courier_id=$2,status='agreed',agreed_price=initial_price,updated_at=now() WHERE id=$1",[id,me.rows[0].id]);
    await c.query("UPDATE public.offers SET status='rejected' WHERE order_id=$1 AND status IN('pending','countered')",[id]);
    await c.query("INSERT INTO public.order_events(order_id,actor_id,event_type,payload) VALUES($1,$2,'order_claimed_via_bot',$3::jsonb)",
      [id,me.rows[0].id,JSON.stringify({source:'telegram_bot'})]);
    await c.query('COMMIT');
    return Number(customer.rows[0].telegram_id);
  } catch(e) { await c.query('ROLLBACK'); throw e; }
  finally { c.release(); }
}
async function contacts(chat:number,telegramId:number,id:string) {
  const r=await pool.query(`SELECT c.telegram_id,c.username,c.first_name,c.last_name FROM public.orders o
    JOIN public.profiles me ON me.telegram_id=$2 AND me.is_blocked=false
    JOIN public.profiles c ON c.id=o.customer_id WHERE o.id=$1 AND o.courier_id=me.id`,[id,String(telegramId)]);
  if(!r.rowCount) return send(chat,'Контакты доступны только курьеру, которому назначен этот заказ.');
  const u=r.rows[0], link=u.username?`https://t.me/${u.username}`:`tg://user?id=${u.telegram_id}`;
  return send(chat,`Контакт заказчика: ${u.first_name??''} ${u.last_name??''}\n${link}`,
    {reply_markup:{inline_keyboard:[[{text:'Написать заказчику',url:link}]]}});
}
async function donateMenu(chat:number) {
  const url=process.env.DONATION_PAYMENT_URL;
  const rows:any[]=[];
  if(url) rows.push([{text:'🏦 Ozon Банк / СБП',callback_data:'donate:qr'}]);
  rows.push([{text:'⭐ 10 звёзд',callback_data:'donate:10'},{text:'⭐ 50 звёзд',callback_data:'donate:50'},{text:'⭐ 100 звёзд',callback_data:'donate:100'}]);
  await send(chat,'Поддержать проект можно любым удобным способом. Донат добровольный и не влияет на доступ к функциям бота.',{reply_markup:{inline_keyboard:rows}});
}
async function donateQr(chat:number) {
  const url=process.env.DONATION_PAYMENT_URL;
  if(!url) return send(chat,'Ссылка для доната пока не настроена. Попробуйте позже.');
  const qrPath=process.env.DONATION_QR_FILE || new URL('../assets/ozon-donate.jpg',import.meta.url);
  try {
    const photo=await readFile(qrPath);
    const form=new FormData();
    form.append('chat_id',String(chat));
    form.append('caption','Добровольная поддержка проекта «Курьеры с торговлей» ❤️ Донат не обязателен и не влияет на доступ к функциям бота.');
    form.append('photo',new Blob([new Uint8Array(photo)],{type:'image/jpeg'}),'ozon-donate.jpg');
    const response=await fetch(`${base}/sendPhoto`,{method:'POST',body:form,signal:AbortSignal.timeout(35_000)});
    const data=await response.json() as any;
    if(!response.ok||!data.ok) throw new Error(data.description??'Telegram sendPhoto failed');
  } catch(e) {
    console.error('Donation QR image error:',e);
    await send(chat,'Не удалось показать QR-код. Используйте ссылку ниже:');
  }
  await send(chat,`Ссылка для оплаты через Ozon Банк / СБП:\n${url}\n\nДонат полностью добровольный. Все функции бота доступны бесплатно независимо от поддержки проекта.`);
}
async function donateStars(chat:number,telegramId:number,stars:number) {
  if(![10,50,100].includes(stars)) return;
  const payload=`donation:${crypto.randomUUID()}`;
  await pool.query("INSERT INTO public.star_payments(telegram_id,purpose,stars,status,payment_payload) VALUES($1,'support',$2,'pending',$3)",
    [String(telegramId),stars,payload]);
  await tg('sendInvoice',{chat_id:chat,title:'Поддержать проект',description:'Добровольный донат на развитие проекта «Курьеры с торговлей». Все функции остаются бесплатными.',payload,provider_token:'',currency:'XTR',prices:[{label:'Добровольный донат',amount:stars}]});
}


async function message(m:any) {
  if(!m.from||m.chat.type!=='private') return;
  const chat=m.chat.id, id=m.from.id, text=(m.text??'').trim();
  try { await profile(m.from); } catch(e) { return send(chat,e instanceof Error?e.message:'Ошибка профиля.'); }
  if(text.startsWith('/start')||text==='/menu') { await session(id,null); return send(chat,'Добро пожаловать! Заказы можно размещать и брать прямо здесь, без Mini App.',{reply_markup:menu}); }
  if(text==='/help'||text==='Помощь / Правила') return send(chat,'Указывайте достоверные данные, не размещайте запрещённые товары и чужие персональные данные. Контакты не видны в общей ленте. Для жалоб обратитесь к администратору.',{reply_markup:menu});
  if(text==='Посмотреть заказы'||text==='/orders') return available(chat);
  if(text==='Мои заказы'||text==='/myorders') return mine(chat,id);
  if(text==='Поддержать проект'||text==='/donate') return donateMenu(chat);
  if(text==='Разместить заказ'||text==='/neworder') { await session(id,{step:'city',data:{}}); return send(chat,'Укажите город:'); }
  const s=await getSession(id); if(!s) return send(chat,'Выберите действие в меню.',{reply_markup:menu});
  const d=s.data??{};
  if(s.step==='city') { if(!text||text.length>120)return send(chat,'Укажите город (до 120 символов).'); d.city=text; s.step='when'; await session(id,s); return send(chat,'Когда забрать заказ? Например: 12.11.2026 14:30 (местное время).'); }
  if(s.step==='when') { if(text.length<3||text.length>80)return send(chat,'Укажите дату и время (до 80 символов).'); d.when=text;s.step='metro';await session(id,s);return send(chat,'Укажите станцию метро или район (обязательно).'); }
  if(s.step==='metro') { if(!text||text.length>160)return send(chat,'Укажите станцию или район (до 160 символов).');d.metro=text;s.step='reward';await session(id,s);return send(chat,'Вознаграждение курьеру, сумма и код валюты: например 25 EUR.'); }
  if(s.step==='reward') { const x=text.match(/^(\d+(?:[.,]\d{1,2})?)\s*([A-Za-zА-Яа-я]{3})$/);const n=x?Number(x[1].replace(',','.')):NaN;
    if(!x||!Number.isFinite(n)||n<=0||n>1e9)return send(chat,'Формат: 25 EUR или 100 RUB.');d.amount=n;d.currency=x[2].toUpperCase();s.step='title';await session(id,s);return send(chat,'Краткое описание заказа (или «-»).'); }
  if(s.step==='title') { d.title=text==='-'?'':text.slice(0,200);s.step='description';await session(id,s);return send(chat,'Дополнительные детали (или «-»).'); }
  if(s.step==='description') { d.description=text==='-'?'':text.slice(0,3000);const o=await createOrder(id,d);await session(id,null);
    return send(chat,`Заказ опубликован!\n${o.city} · ${o.pickup_at_text}\n${o.metro_or_district}\nВознаграждение: ${o.reward_amount} ${o.reward_currency}\nID: ${o.id}`,{reply_markup:menu}); }
}
async function update(u:any) {
  const once=await pool.query('INSERT INTO public.bot_processed_updates(update_id) VALUES($1) ON CONFLICT DO NOTHING RETURNING update_id',[String(u.update_id)]);
  if(!once.rowCount)return;
  if(u.pre_checkout_query) {
    const q=u.pre_checkout_query,p=await pool.query("SELECT telegram_id,stars,status FROM public.star_payments WHERE payment_payload=$1 AND purpose='support'",[q.invoice_payload]);
    const ok=!!p.rowCount&&p.rows[0].telegram_id===String(q.from.id)&&p.rows[0].stars===q.total_amount&&q.currency==='XTR'&&p.rows[0].status==='pending';
    return tg('answerPreCheckoutQuery',{pre_checkout_query_id:q.id,ok,...(!ok?{error_message:'Не удалось проверить параметры платежа.'}:{})});
  }
  if(u.message?.successful_payment) {
    const p=u.message.successful_payment;
    const r=await pool.query(`UPDATE public.star_payments SET status='paid',telegram_charge_id=$2,paid_at=now()
      WHERE payment_payload=$1 AND telegram_id=$3 AND purpose='support' AND status='pending' AND stars=$4 AND $5='XTR' RETURNING id`,
      [p.invoice_payload,p.telegram_payment_charge_id,String(u.message.from.id),p.total_amount,p.currency]);
    return send(u.message.chat.id,r.rowCount?'Спасибо за донат! ❤️ Ваш вклад помогает развивать проект.':'Платёж получен, но его не удалось автоматически сверить. Обратитесь в поддержку.');
  }
  if(u.callback_query) {
    const q=u.callback_query,chat=q.message?.chat.id,data=q.data??'';if(!chat)return;
    await tg('answerCallbackQuery',{callback_query_id:q.id});
    const [action,id]=data.split(':');
    if(action==='donate') {
      if(id==='qr') return donateQr(chat);
      const amount=Number(id);
      if([10,50,100].includes(amount)) return donateStars(chat,q.from.id,amount);
      return;
    }
    if(!/^[0-9a-f-]{36}$/i.test(id??''))return;
    if(action==='take') { try { const customer=await claim(q.from.id,id);await send(chat,'Заказ закреплён за вами. Контакты доступны в разделе «Мои заказы».');await send(customer,'Ваш заказ получил курьер. Откройте «Мои заказы» для проверки статуса.'); } catch(e) { await send(chat,e instanceof Error?e.message:'Не удалось взять заказ.'); } }
    if(action==='contact') await contacts(chat,q.from.id,id);
    return;
  }
  if(u.message) await message(u.message);
}
export async function runTelegramBot() {
  if(!token||!process.env.DATABASE_URL)throw new Error('TELEGRAM_BOT_TOKEN and DATABASE_URL are required');
  await tg('deleteWebhook',{drop_pending_updates:false});
  let offset=0;console.log('Curier Telegram bot polling started');
  while(true) {
    try {
      const updates=await tg('getUpdates',{offset,timeout:25,allowed_updates:['message','callback_query','pre_checkout_query']}) as any[];
      for(const u of updates){offset=Math.max(offset,u.update_id+1);try{await update(u);}catch(e){console.error('Update failed:',e);}}
    } catch(e) { console.error('Telegram polling error:',e);await wait(3000); }
  }
}
if(process.env.RUN_TELEGRAM_BOT!=='false'&&process.env.NODE_ENV!=='test') {
  void runTelegramBot().catch(e=>{console.error('Bot stopped:',e);process.exitCode=1;});
}
