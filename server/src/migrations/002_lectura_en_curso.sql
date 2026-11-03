-- Lectura del chat con IA en curso (resumen o pedido). Vive en el servidor para que, si se
-- recarga la página, el botón siga bloqueado y no se pague dos veces la misma lectura.
alter table conversaciones
  add column lectura_inicio timestamptz,
  add column lectura_tipo text check (lectura_tipo in ('resumen', 'pedido')),
  add column lectura_error text;
