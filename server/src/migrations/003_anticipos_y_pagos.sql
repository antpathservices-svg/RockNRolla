-- Anticipo flexible: monto fijo opcional (si es null se usa anticipo_pct) y si su base incluye el envío.
alter table pedidos
  add column anticipo_centavos integer check (anticipo_centavos >= 0),
  add column anticipo_incluye_envio boolean not null default false;

-- Varios anticipos o pagos por pedido; el saldo es total − suma de pagos.
create table pagos (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references pedidos(id) on delete cascade,
  monto_centavos integer not null check (monto_centavos > 0),
  fecha date not null,
  cuenta text,
  nota text,
  usuario text,
  creado timestamptz not null default now()
);
create index pagos_pedido on pagos (pedido_id, fecha, creado);
