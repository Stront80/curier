import { useEffect, useState } from 'react';
import { Bell, Box, CheckCircle2, ChevronRight, CircleHelp, Globe, Heart, Home, Menu, MessageCircle, PackagePlus, ShieldCheck, Star, UserRound, X } from 'lucide-react';
import { api, money, telegram } from '../lib';

type Order = { id: string; title: string; pickup_address: string; dropoff_address: string; description: string; initial_price: number | null; status: string; created_at: string; customer_id: string; courier_id: string | null };
type OfferItem = { id: string; order_id: string; courier_id: string; proposer_id: string; parent_offer_id: string | null; amount: number | string; comment: string | null; status: string; created_at: string };
type Tab = 'orders' | 'create' | 'notifications' | 'profile';
export default function App(){
 const [tab,setTab]=useState<Tab>('orders'); const [lang,setLang]=useState<'ru'|'en'>('ru'); const [orders,setOrders]=useState<Order[]>([]); const [selected,setSelected]=useState<Order|null>(null); const [showMenu,setShowMenu]=useState(false); const [toast,setToast]=useState(''); const [busy,setBusy]=useState(false); const [user,setUser]=useState<any>(telegram?.initDataUnsafe?.user ?? null); const [token,setToken]=useState<string|null>(null); const [profileId,setProfileId]=useState<string|null>(null); const [offers,setOffers]=useState<OfferItem[]>([]); const [counterOfferId,setCounterOfferId]=useState<string|null>(null); const [offer,setOffer]=useState('150'); const [counter,setCounter]=useState(''); const [from,setFrom]=useState('ул. Ленина, 12'); const [to,setTo]=useState('ул. Садовая, 45'); const [desc,setDesc]=useState('Документы, 1 кг'); const [price,setPrice]=useState('150');
 const t=(ru:string,en:string)=>lang==='ru'?ru:en;
 useEffect(()=>{
  let cancelled=false;
  async function connect(){
    if(!telegram?.initData){setOrders([]);setToast('Диагностика: Telegram initData отсутствует');return}
    try{
      const auth=await api<{token:string;profile:{id:string;language:string}}>('/auth/telegram',{
        method:'POST',body:{initData:telegram.initData}
      });
      if(cancelled)return;
      setToken(auth.token);
      setProfileId(auth.profile.id);
      setLang(auth.profile.language==='en'?'en':'ru');
      const result=await api<{orders:Order[]}>('/orders',{token:auth.token});
      if(!cancelled)setOrders(result.orders);
    }catch(e){
      if(!cancelled){
        setToken(null);
        setOrders([]);
        setToast(e instanceof Error ? e.message : 'Ошибка авторизации');
      }
    }
  }
  connect();
  return ()=>{cancelled=true};
},[]);
 const notify=(s:string)=>{setToast(s);window.setTimeout(()=>setToast(''),3000)};
 async function createOrder(){
  if(!token){notify(t('Откройте приложение через Telegram для авторизации','Open the app through Telegram to sign in'));return}
  if(!from.trim()||!to.trim()||!desc.trim()){
    notify(t('Заполните обязательные поля','Please fill in required fields'));return
  }
  setBusy(true);
  try{
    const result=await api<{order:Order}>('/orders',{
      method:'POST',token,
      body:{
        title:desc.trim(),pickup_address:from.trim(),
        dropoff_address:to.trim(),description:desc.trim(),
        initial_price:price.trim()?Number(price):null
      }
    });
    setOrders(prev=>[result.order,...prev]);
    setTab('orders');
    notify(t('Заказ опубликован','Order published'));
  }catch{
    notify(t('Не удалось создать заказ','Could not create order'));
  }finally{setBusy(false)}
}
 async function acceptOffer(offerId: string){
  if(!token)return;
  setBusy(true);
  try{
    await api(`/offers/${encodeURIComponent(offerId)}/accept`,{method:'POST',token});
    if(selected){
      const result=await api<{orders:Order[]}>('/orders',{token});
      setOrders(result.orders);
      setSelected(prev=>prev?{...prev,status:'agreed'}:prev);
      await loadOffers(selected.id);
    }
    notify(t('Цена согласована','Offer accepted'));
  }catch{
    notify(t('Не удалось принять предложение','Could not accept offer'));
  }finally{setBusy(false)}
 }
 async function counterOffer(offerId: string){
  if(!selected||!token||Number(offer)<=0){
    notify(t('Введите корректную цену','Enter a valid price'));return
  }
  setBusy(true);
  try{
    await api(`/offers/${encodeURIComponent(offerId)}/counter`,{
      method:'POST',token,body:{amount:Number(offer),comment:counter}
    });
    setCounter('');
    setCounterOfferId(null);
    await loadOffers(selected.id);
    notify(t('Встречное предложение отправлено','Counteroffer submitted'));
  }catch(e){
    const message=e instanceof Error?e.message:'';
    notify(message==='Early access period is active'
      ?t('Период раннего доступа ещё действует','Early access is still active')
      :t('Не удалось отправить встречное предложение','Could not submit counteroffer'));
  }finally{setBusy(false)}
 }
 async function loadOffers(orderId: string){
  if(!token){setOffers([]);return}
  try{
    const result=await api<{offers:OfferItem[]}>(`/orders/${encodeURIComponent(orderId)}/offers`,{token});
    setOffers(result.offers);
  }catch{
    setOffers([]);
    notify(t('Не удалось загрузить предложения','Could not load offers'));
  }
 }
 async function placeOffer(){
  if(!selected||Number(offer)<=0){
    notify(t('Введите корректную цену','Enter a valid price'));return
  }
  if(!token){
    notify(t('Откройте приложение через Telegram для авторизации','Open the app through Telegram to sign in'));return
  }
  setBusy(true);
  try{
    await api(`/orders/${encodeURIComponent(selected.id)}/offers`,{
      method:'POST',token,body:{amount:Number(offer),comment:counter}
    });
    setCounter('');
    await loadOffers(selected.id);
    notify(t('Предложение отправлено','Offer submitted'));
  }catch(e){
    const message=e instanceof Error?e.message:'';
    notify(message==='Early access period is active'
      ?t('Для этого заказа действует период раннего доступа','Early access is active for this order')
      :message==='You already have an active offer'
      ?t('Вы уже отправили предложение по этому заказу','You already have an active offer')
      :t('Не удалось отправить предложение','Could not submit offer'));
  }finally{setBusy(false)}
}
 const support=()=>{if(telegram?.openInvoice){notify(t('Для оплаты нужно подключить серверное создание счёта Stars','Stars invoice creation must be connected on the server'))}else notify(t('Демо-режим: реальные Stars не списываются','Demo mode: no real Stars charged'))};
 const openEarly=()=>notify(t('Доступ на 24 часа будет активирован после подтверждённой оплаты Stars.','24-hour access activates after confirmed Stars payment.'));
 return <main className="app"><header className="top"><button className="iconbtn" onClick={()=>setShowMenu(true)} aria-label="Menu"><Menu/></button><div className="brand"><span className="brandmark">➤</span><div><b>Delivery Market</b><small>{t('Доставка с торгом','Negotiate. Deliver.')}</small></div></div><button className="iconbtn" onClick={()=>setTab('notifications')} aria-label="Notifications"><Bell/></button></header>
 {!selected && tab==='orders' && <><div className="hero"><div><span className="eyebrow">{t('МАРКЕТПЛЕЙС ДОСТАВКИ','DELIVERY MARKETPLACE')}</span><h1>{t('Договоритесь о цене доставки','Agree on your delivery price')}</h1><p>{t('Создайте заказ или предложите свою цену.','Post a delivery or make an offer.')}</p></div><div className="heroicon">↗</div></div><div className="sectiontitle"><h2>{t('Открытые заказы','Open orders')}</h2><span className="count">{orders.length}</span></div><div className="filters"><button className="chip active">{t('Все','All')}</button><button className="chip" onClick={()=>notify(t('Фильтр «Срочные» скоро появится','Urgent filter coming soon'))}>{t('Срочные','Urgent')}</button><button className="chip" onClick={()=>notify(t('Геофильтр будет добавлен позже','Location filter coming later'))}>{t('Рядом','Nearby')}</button></div><div className="cards">{orders.map(o=><button className="ordercard" key={o.id} onClick={()=>{setSelected(o);setOffer(String(o.initial_price??150));setOffers([]);void loadOffers(o.id)}}><div className="cardtop"><span className="tag">● {t('Открыт','Open')}</span><strong>{o.initial_price?money(o.initial_price):t('Ваша цена','Your offer')}</strong></div><h3>{o.title}</h3><p><span>↗</span> {o.pickup_address}</p><p><span>↘</span> {o.dropoff_address}</p><div className="cardbottom"><small>{t('Предложите свою цену','Make an offer')}</small><ChevronRight size={18}/></div></button>)}</div></>}
 {selected && <section className="page"><button className="back" onClick={()=>setSelected(null)}>← {t('К заказам','Back to orders')}</button><span className="tag">● {t('Открыт для предложений','Open for offers')}</span><h1>{selected.title}</h1><div className="detailbox"><p>📍 <b>{t('Откуда','Pickup')}</b><br/>{selected.pickup_address}</p><p>📍 <b>{t('Куда','Drop-off')}</b><br/>{selected.dropoff_address}</p><p>▤ <b>{t('Описание','Description')}</b><br/>{selected.description}</p><p>◷ <b>{t('Начальная цена','Starting price')}</b><br/>{selected.initial_price?money(selected.initial_price):t('Предложите цену','Make an offer')}</p></div><h2>{t('История торгов','Offer history')}</h2>{offers.length===0?<p className="hint">{t('Пока нет предложений по этому заказу.','There are no offers on this order yet.')}</p>:<div className="detailbox">{offers.map(item=>{const actionable=item.status==='pending'&&item.proposer_id!==profileId&&!offers.some(child=>child.parent_offer_id===item.id)&&(selected.status==='open'||selected.status==='negotiating');const statusLabel:Record<string,[string,string]>={pending:['Ожидает ответа','Pending'],countered:['Есть встречная цена','Countered'],accepted:['Принято','Accepted'],rejected:['Отклонено','Rejected'],withdrawn:['Отозвано','Withdrawn']};return <div key={item.id} style={{padding:'10px 0',borderBottom:'1px solid var(--border,#ddd)'}}><p><b>{money(Number(item.amount))}</b> · {item.proposer_id===profileId?t('Вы предложили','You offered'):t('Предложение другой стороны','Other party offered')}</p>{item.comment&&<p>{item.comment}</p>}<p className="hint">{statusLabel[item.status]?.[lang==='ru'?0:1]??item.status} · {new Date(item.created_at).toLocaleString(lang==='ru'?'ru-RU':'en-GB')}</p>{actionable&&<div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button className="primary" disabled={busy} onClick={()=>acceptOffer(item.id)}>{t('Принять цену','Accept offer')}</button><button className="chip" disabled={busy} onClick={()=>{setCounterOfferId(item.id);setOffer(String(item.amount));setCounter('')}}>{t('Отправить встречную цену','Send counteroffer')}</button></div>}{counterOfferId===item.id&&<div style={{marginTop:8}}>
<label>{t('Ваша встречная цена','Your counteroffer')}</label>
<div className="priceinput"><button disabled={busy} onClick={()=>setOffer(String(Math.max(1,Number(offer)-10)))}>−</button><input inputMode="numeric" value={offer} onChange={e=>setOffer(e.target.value)}/><button disabled={busy} onClick={()=>setOffer(String(Number(offer)+10))}>＋</button></div>
<label>{t('Комментарий (необязательно)','Comment (optional)')}</label>
<textarea value={counter} onChange={e=>setCounter(e.target.value)} placeholder={t('Ваши условия','Your terms')}/>
<button className="primary full" disabled={busy} onClick={()=>counterOffer(item.id)}>{busy?t('Отправка…','Sending…'):t('Отправить встречную цену','Send counteroffer')}</button>
<button className="chip" disabled={busy} onClick={()=>setCounterOfferId(null)}>{t('Отмена','Cancel')}</button>
</div>}</div>})}</div>}{selected.customer_id!==profileId&&selected.status!=='agreed'&&selected.status!=='cancelled'&&!counterOfferId&&<><h2>{t('Предложить цену','Make an offer')}</h2><label>{t('Ваша цена','Your price')}</label><div className="priceinput"><button onClick={()=>setOffer(String(Math.max(1,Number(offer)-10)))}>−</button><input inputMode="numeric" value={offer} onChange={e=>setOffer(e.target.value)}/><button onClick={()=>setOffer(String(Number(offer)+10))}>＋</button></div><label>{t('Комментарий (необязательно)','Comment (optional)')}</label><textarea value={counter} onChange={e=>setCounter(e.target.value)} placeholder={t('Например, заберу через 15 минут','For example, pickup in 15 minutes')}/><button className="primary full" disabled={busy} onClick={placeOffer}>{busy?t('Отправка…','Sending…'):t('Отправить предложение','Send offer')}</button></>}</section>}
 {!selected&&tab==='create'&&<section className="page"><h1>{t('Создать заказ','Create order')}</h1><label>{t('Откуда','Pickup address')} *</label><input value={from} onChange={e=>setFrom(e.target.value)} placeholder={t('Адрес отправления','Pickup address')}/><label>{t('Куда','Drop-off address')} *</label><input value={to} onChange={e=>setTo(e.target.value)} placeholder={t('Адрес доставки','Drop-off address')}/><label>{t('Что доставить','What to deliver')} *</label><textarea value={desc} onChange={e=>setDesc(e.target.value)} placeholder={t('Опишите отправление','Describe the item')}/><label>{t('Начальная цена, ₽ (необязательно)','Starting price (optional)')}</label><input inputMode="numeric" value={price} onChange={e=>setPrice(e.target.value)} placeholder="150"/><div className="notice"><ShieldCheck size={18}/><span>{t('Не публикуйте запрещённые к перевозке предметы.','Do not post prohibited items.')}</span></div><button className="primary full" disabled={busy} onClick={createOrder}>{busy?t('Публикация…','Publishing…'):t('Опубликовать заказ','Publish order')}</button></section>}
 {!selected&&tab==='notifications'&&<section className="page"><h1>{t('Уведомления','Notifications')}</h1><div className="notice"><Bell/><span>{t('Здесь появятся новые предложения, согласования и статусы доставок после подключения backend и Telegram-бота.','Offers, agreements and delivery updates will appear here after backend and bot integration.')}</span></div></section>}
 {!selected&&tab==='profile'&&<section className="page"><h1>{t('Профиль','Profile')}</h1><div className="profilebox"><div className="avatar">{(user?.first_name||'D').slice(0,1)}</div><div><b>{user?.first_name? `${user.first_name} ${user.last_name||''}`:'Пользователь Telegram'}</b><p className="muted">{user?.username?'@'+user.username:t('В демо-режиме','Demo mode')}</p></div></div><button className="menurow" onClick={()=>notify(t('История появится после подключения базы','History available after database setup'))}><Box/> {t('Мои заказы и доставки','My orders and deliveries')} <ChevronRight/></button><button className="menurow" onClick={openEarly}><Star/> {t('Ранний доступ · 24 часа','Early access · 24 hours')} <ChevronRight/></button><button className="menurow" onClick={support}><Heart/> {t('Поддержать проект ⭐','Support the project ⭐')} <ChevronRight/></button><button className="menurow" onClick={()=>setLang(lang==='ru'?'en':'ru')}><Globe/> {t('Язык / Language','Language')} <b>{lang.toUpperCase()}</b></button><div className="notice"><ShieldCheck/><span>{t('При передаче заказа проверяйте личность курьера. Не отправляйте паспортные данные в чат.','Verify courier identity at handover. Do not send passport data in chat.')}</span></div></section>}
 <nav className="bottomnav"><button className={tab==='orders'?'chosen':''} onClick={()=>{setSelected(null);setTab('orders')}}><Home/><span>{t('Заказы','Orders')}</span></button><button className={tab==='create'?'chosen':''} onClick={()=>{setSelected(null);setTab('create')}}><PackagePlus/><span>{t('Создать','Create')}</span></button><button className={tab==='notifications'?'chosen':''} onClick={()=>{setSelected(null);setTab('notifications')}}><MessageCircle/><span>{t('Уведомления','Alerts')}</span></button><button className={tab==='profile'?'chosen':''} onClick={()=>{setSelected(null);setTab('profile')}}><UserRound/><span>{t('Профиль','Profile')}</span></button></nav>
 {showMenu&&<div className="scrim" onClick={()=>setShowMenu(false)}><aside className="drawer" onClick={e=>e.stopPropagation()}><button className="close" onClick={()=>setShowMenu(false)}><X/></button><div className="profilebox"><div className="avatar">{(user?.first_name||'D').slice(0,1)}</div><div><b>{user?.first_name||'Delivery Market'}</b><p className="muted">Telegram Mini App</p></div></div>{[[UserRound,t('Профиль','Profile'),'profile'],[Box,t('Заказы','Orders'),'orders'],[Star,t('Ранний доступ','Early access'),'early'],[Heart,t('Поддержать проект ⭐','Support project ⭐'),'support'],[CircleHelp,t('Помощь','Help'),'help'],[Globe,'Русский / English','lang']].map(([Icon,label,action]:any)=><button className="menurow" key={action} onClick={()=>{setShowMenu(false);if(action==='profile'||action==='orders')setTab(action);if(action==='early')openEarly();if(action==='support')support();if(action==='lang')setLang(lang==='ru'?'en':'ru');if(action==='help')notify(t('Обратитесь в поддержку проекта','Contact project support'))}}><Icon size={19}/>{label}<ChevronRight size={17}/></button>)}</aside></div>}
 {toast&&<div className="toast"><CheckCircle2 size={18}/>{toast}</div>}<footer className="foot">{token?t('Подключено к серверу','Connected to server'):t('Откройте через Telegram для работы с заказами','Open through Telegram to use orders')}</footer></main>
}
