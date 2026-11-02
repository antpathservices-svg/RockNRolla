-- Esquema inicial de la plataforma de pedidos.

create extension if not exists pgcrypto;

create table usuarios (
  id serial primary key,
  email text not null unique,
  nombre text,
  rol text not null check (rol in ('dueno', 'operador')),
  activo boolean not null default true,
  creado timestamptz not null default now()
);

create table ajustes (
  clave text primary key,
  valor jsonb not null,
  actualizado timestamptz not null default now(),
  actualizado_por text
);

create table conversaciones (
  id uuid primary key default gen_random_uuid(),
  origen text not null check (origen in ('whatsapp', 'archivo', 'texto', 'formulario')),
  es_prueba boolean not null default false,
  nombre_archivo text,
  cliente_nombre text,
  cliente_telefono text,
  wa_id text unique,
  resumen text,
  extraccion jsonb,
  creado timestamptz not null default now(),
  ultimo_mensaje timestamptz
);

create table mensajes (
  id bigserial primary key,
  conversacion_id uuid not null references conversaciones (id) on delete cascade,
  indice integer not null,
  wa_message_id text unique,
  rol text not null check (rol in ('cliente', 'negocio', 'sistema')),
  autor text,
  -- Texto con los datos bancarios ya ocultos.
  texto text not null default '',
  tipo text not null default 'texto',
  adjunto_nombre text,
  adjunto_media_id text,
  editado boolean not null default false,
  enviado timestamptz not null
);
create index mensajes_conversacion_idx on mensajes (conversacion_id, indice);

-- El folio es consecutivo y no se reinicia cada mes (ADR del folio).
create sequence folio_seq start 1;

create table pedidos (
  id uuid primary key default gen_random_uuid(),
  folio_num integer not null unique,
  folio text not null unique,
  conversacion_id uuid references conversaciones (id) on delete set null,
  estado text not null default 'cotizando'
    check (estado in ('cotizando', 'aceptado', 'en_preparacion', 'listo', 'completado', 'cancelado')),
  motivo_cancelacion text,
  cliente_nombre text,
  cliente_telefono text,
  cliente_tipo text,
  origen text,
  fecha_entrega date,
  hora_evento time,
  hora_desde time,
  hora_hasta time,
  tipo_entrega text check (tipo_entrega in ('domicilio', 'recoger')),
  direccion text,
  envio_centavos integer not null default 0,
  descuento_centavos integer not null default 0,
  anticipo_pct numeric not null default 50,
  cuenta_anticipo text,
  cuenta_saldo text,
  anticipo_recibido_en timestamptz,
  vigencia_hasta date,
  aprobado_en timestamptz,
  aprobado_por text,
  evento_calendario_id text,
  token_publico text unique,
  token_activo boolean not null default false,
  token_expira timestamptz,
  formulario_recibido_en timestamptz,
  extraccion jsonb,
  dudas jsonb not null default '[]',
  fuentes jsonb not null default '[]',
  es_prueba boolean not null default false,
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now()
);
create index pedidos_estado_idx on pedidos (estado, fecha_entrega);

create table pasteles (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references pedidos (id) on delete cascade,
  posicion integer not null,
  tema text,
  festejado text,
  edad text,
  personas integer,
  tipo text,
  pan text,
  relleno text,
  cubierta text,
  decoracion text,
  extras text[] not null default '{}',
  precio_centavos integer,
  precio_confirmado boolean not null default false
);
create index pasteles_pedido_idx on pasteles (pedido_id, posicion);

create table referencias (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references pedidos (id) on delete cascade,
  archivo text not null,
  mime text not null,
  creado timestamptz not null default now()
);

create table notas (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references pedidos (id) on delete cascade,
  version integer not null,
  archivo text not null,
  creado timestamptz not null default now(),
  creado_por text,
  unique (pedido_id, version)
);

create table bitacora (
  id bigserial primary key,
  entidad text not null,
  entidad_id text,
  accion text not null,
  detalle jsonb,
  usuario text,
  creado timestamptz not null default now()
);
create index bitacora_entidad_idx on bitacora (entidad, entidad_id, creado desc);
