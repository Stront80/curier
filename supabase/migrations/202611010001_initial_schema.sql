create extension if not exists pgcrypto;
create type public.order_status as enum ('open','negotiating','agreed','picked_up','in_transit','delivered','cancelled','expired','dispute');
create table public.profiles (
 id uuid primary key default gen_random_uuid(),
 telegram_id bigint unique not null,
 username text,
 first_name text not null default '',
 last_name text,
 language text not null default 'ru' check (language in ('ru','en')),
 is_blocked boolean not null default false,
 created_at timestamptz not null default now()
);
create table public.orders (
 id uuid primary key default gen_random_uuid(),
 customer_id uuid not null references public.profiles(id),
 title text not null,
 pickup_address text not null,
 dropoff_address text not null,
 description text not null,
 initial_price numeric(12,2) check (initial_price is null or initial_price >= 0),
 agreed_price numeric(12,2) check (agreed_price is null or agreed_price >= 0),
 courier_id uuid references public.profiles(id),
 status public.order_status not null default 'open',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 early_access_until timestamptz not null default (now() + interval '10 minutes')
);
create table public.offers (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.orders(id) on delete cascade,
 courier_id uuid not null references public.profiles(id),
 amount numeric(12,2) not null check (amount > 0),
 comment text,
 status text not null default 'pending' check (status in ('pending','countered','accepted','rejected','withdrawn')),
 created_at timestamptz not null default now()
);
create table public.order_events (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.orders(id) on delete cascade,
 actor_id uuid references public.profiles(id),
 event_type text not null,
 payload jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
create table public.star_payments (
 id uuid primary key default gen_random_uuid(),
 telegram_id bigint not null,
 purpose text not null check (purpose in ('support','early_access')),
 stars integer not null check (stars > 0),
 telegram_charge_id text unique,
 status text not null default 'pending' check (status in ('pending','paid','refunded','failed')),
 access_expires_at timestamptz,
 created_at timestamptz not null default now()
);
create index orders_status_created_idx on public.orders(status, created_at desc);
create index offers_order_created_idx on public.offers(order_id, created_at desc);
create index payments_telegram_idx on public.star_payments(telegram_id, created_at desc);
-- Security-first defaults: direct anonymous table access is disabled. Edge Functions use service role after verifying Telegram initData.
alter table public.profiles enable row level security;
alter table public.orders enable row level security;
alter table public.offers enable row level security;
alter table public.order_events enable row level security;
alter table public.star_payments enable row level security;
revoke all on public.profiles, public.orders, public.offers, public.order_events, public.star_payments from anon, authenticated;

create or replace function public.accept_offer_transaction(p_offer_id uuid, p_customer_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_offer public.offers%rowtype; v_order public.orders%rowtype;
begin
 select * into v_offer from public.offers where id=p_offer_id for update;
 if not found then raise exception 'Offer not found'; end if;
 select * into v_order from public.orders where id=v_offer.order_id for update;
 if not found then raise exception 'Order not found'; end if;
 if v_order.customer_id <> p_customer_id then raise exception 'Only the customer can accept offers'; end if;
 if v_order.status not in ('open','negotiating') or v_order.courier_id is not null then raise exception 'Order is no longer available'; end if;
 update public.orders set status='agreed', courier_id=v_offer.courier_id, agreed_price=v_offer.amount, updated_at=now() where id=v_order.id;
 update public.offers set status=case when id=p_offer_id then 'accepted' else 'rejected' end where order_id=v_order.id and status in ('pending','countered');
 insert into public.order_events(order_id,actor_id,event_type,payload) values(v_order.id,p_customer_id,'offer_accepted',jsonb_build_object('offer_id',p_offer_id,'courier_id',v_offer.courier_id,'amount',v_offer.amount));
 return jsonb_build_object('order_id',v_order.id,'courier_id',v_offer.courier_id,'agreed_price',v_offer.amount,'status','agreed');
end; $$;
revoke all on function public.accept_offer_transaction(uuid,uuid) from public, anon, authenticated;
