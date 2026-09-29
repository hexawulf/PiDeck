-- Prod-shaped PiDeck schema (2.4): what drizzle-kit push of shared/schema.ts created,
-- plus idx_users_username from the old hand-written migrations/0001 and user_sessions
-- exactly as connect-pg-simple creates it. Generated with pg_dump -s from a scratch
-- database built that way (tests/db/README: how). No data: tests insert their own.

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

CREATE TABLE public.historical_metrics (
    id integer NOT NULL,
    "timestamp" timestamp without time zone DEFAULT now() NOT NULL,
    cpu_usage integer,
    memory_usage integer,
    temperature integer,
    disk_read_speed integer,
    disk_write_speed integer,
    network_rx integer,
    network_tx integer
);

CREATE SEQUENCE public.historical_metrics_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.historical_metrics_id_seq OWNED BY public.historical_metrics.id;

CREATE TABLE public.sessions (
    id text NOT NULL,
    user_id integer,
    expires_at timestamp without time zone NOT NULL
);

CREATE TABLE public.user_sessions (
    sid character varying NOT NULL,
    sess json NOT NULL,
    expire timestamp(6) without time zone NOT NULL
);

CREATE TABLE public.users (
    id integer NOT NULL,
    username text NOT NULL,
    password_hash text NOT NULL,
    last_password_change timestamp without time zone DEFAULT now(),
    failed_login_attempts integer DEFAULT 0,
    account_locked_until timestamp without time zone
);

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;

ALTER TABLE ONLY public.historical_metrics ALTER COLUMN id SET DEFAULT nextval('public.historical_metrics_id_seq'::regclass);

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);

ALTER TABLE ONLY public.historical_metrics
    ADD CONSTRAINT historical_metrics_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT session_pkey PRIMARY KEY (sid);

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_unique UNIQUE (username);

CREATE INDEX "IDX_session_expire" ON public.user_sessions USING btree (expire);

CREATE INDEX idx_users_username ON public.users USING btree (username);

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);

