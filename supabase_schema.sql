-- TripWise Supabase PostgreSQL Schema
-- Run this in your Supabase Dashboard: SQL Editor -> New Query -> Run

-- Users Table
create table if not exists public.users (
  id text primary key,
  email text unique not null,
  password_hash text not null,
  salt text not null,
  name text,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- Itinerary Table (with user_id isolation)
create table if not exists public.itinerary (
  id text primary key,
  user_id text,
  destination_id text,
  name text not null,
  city text,
  country text,
  category text,
  description text,
  rating numeric default 5.0,
  image_url text,
  notes text,
  planned_date text,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- Add ownership to older installations without exposing legacy shared rows.
alter table public.itinerary add column if not exists user_id text;
alter table public.itinerary alter column user_id drop default;
create index if not exists itinerary_user_created_at_idx
  on public.itinerary (user_id, created_at desc);

-- Row Level Security
alter table public.users enable row level security;
alter table public.itinerary enable row level security;

-- Security Policies (Sanitized app access)
drop policy if exists "Allow full access to users" on public.users;
create policy "Allow full access to users"
on public.users
for all
using (true)
with check (true);

drop policy if exists "Allow full access to itinerary" on public.itinerary;
create policy "Allow full access to itinerary"
on public.itinerary
for all
using (true)
with check (true);
