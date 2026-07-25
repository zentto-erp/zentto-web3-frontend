"use client";

import * as React from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  Stack,
  Typography,
  Alert,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import { PageHeader } from "@/components/ui/PageHeader";
import { InfoNote } from "@/components/ui/InfoNote";
import {
  ZenttoDataGrid,
  type ColumnDef,
  type GridRow,
} from "@/components/data-grid/ZenttoDataGrid";
import { usePayments } from "@/lib/hooks";
import { api } from "@/lib/api";
import { ENDPOINTS } from "@/lib/endpoints";
import type { Payment } from "@/lib/types";
import { formatDate } from "@/lib/format";

/** Escapa texto para insertarlo de forma segura en el HTML del panel de detalle. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Normaliza un timestamp (epoch seg/ms o ISO) a ISO-8601 para el grid. */
function toIso(ts: number | string | null | undefined): string {
  if (ts === null || ts === undefined) return "";
  let ms: number;
  if (typeof ts === "string" && /^\d+$/.test(ts)) {
    const n = Number(ts);
    ms = n < 1e12 ? n * 1000 : n;
  } else if (typeof ts === "number") {
    ms = ts < 1e12 ? ts * 1000 : ts;
  } else {
    const d = new Date(ts as string);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString();
  }
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

export default function PagosPage() {
  const payments = usePayments();
  const data = payments.data ?? [];

  const rows: GridRow[] = React.useMemo(
    () =>
      data.map((p) => ({
        id: p.id,
        type: p.type,
        asset: p.asset,
        amount: p.amount,
        status: p.status,
        counterparty: p.counterparty ?? "—",
        createdAt: toIso(p.createdAt),
      })),
    [data],
  );

  const cols: ColumnDef[] = [
    {
      field: "type",
      header: "Tipo",
      width: 130,
      statusColors: {
        transfer: "info",
        credit: "success",
        deposit: "success",
        debit: "warning",
        withdrawal: "warning",
      },
    },
    { field: "asset", header: "Asset", width: 110 },
    { field: "amount", header: "Monto", minWidth: 140 },
    {
      field: "status",
      header: "Estado",
      width: 140,
      statusColors: {
        completed: "success",
        confirmed: "success",
        pending: "warning",
        failed: "error",
        reversed: "error",
      },
    },
    { field: "counterparty", header: "Contraparte", flex: 1, minWidth: 200 },
    { field: "createdAt", header: "Fecha", type: "datetime", minWidth: 180 },
  ];

  // ── Maestro-detalle: GET /payments/:id con carga perezosa + cache por fila ──
  const [detailCache, setDetailCache] = React.useState<
    Record<string, Payment | "loading" | "error">
  >({});
  const detailRequested = React.useRef<Set<string>>(new Set());

  const handleRowExpand = React.useCallback((row: GridRow, expanded: boolean) => {
    const id = String(row.id);
    if (!expanded || detailRequested.current.has(id)) return;
    detailRequested.current.add(id);
    setDetailCache((c) => ({ ...c, [id]: "loading" }));
    api
      .get<Payment>(ENDPOINTS.payment(id))
      .then((p) => setDetailCache((c) => ({ ...c, [id]: p })))
      .catch(() => {
        // permitir reintento al volver a expandir
        detailRequested.current.delete(id);
        setDetailCache((c) => ({ ...c, [id]: "error" }));
      });
  }, []);

  const detailHtml = React.useCallback(
    (row: GridRow): string => {
      const id = String(row.id);
      const entry = detailCache[id];
      const wrap = (inner: string) =>
        `<div style="padding:12px 8px;font-size:13px">${inner}</div>`;
      if (!entry || entry === "loading") return wrap("Cargando detalle del pago…");
      if (entry === "error")
        return wrap(
          "No se pudo cargar el detalle del pago. Colapsa y vuelve a expandir para reintentar.",
        );

      const p = entry;
      const field = (label: string, value: string) =>
        `<div style="min-width:180px;max-width:420px">` +
        `<div style="font-size:11px;opacity:.65">${label}</div>` +
        `<div style="font-size:13px;word-break:break-all">${value}</div></div>`;
      const str = (v: unknown) =>
        v === null || v === undefined || v === "" ? "—" : String(v);
      const metadata =
        p.metadata && typeof p.metadata === "object"
          ? JSON.stringify(p.metadata)
          : str(p.metadata);

      const fields = [
        field("ID del pago", esc(p.id)),
        field("Tipo", esc(String(p.type))),
        field("Monto", `${esc(p.amount)} ${esc(p.asset)}`),
        field("Estado", esc(String(p.status))),
        field("Contraparte", esc(str(p.counterparty))),
        field("Cuenta origen", esc(str(p.fromAccountId))),
        field("Cuenta destino", esc(str(p.toAccountId))),
        field("Clave de idempotencia", esc(str(p.idempotencyKey))),
        field("Motivo de fallo", esc(str(p.failureReason))),
        field("Metadata", esc(metadata)),
        field("Creado", esc(formatDate(p.createdAt))),
        field("Actualizado", esc(p.updatedAt ? formatDate(p.updatedAt as string | number) : "—")),
      ].join("");

      return wrap(`<div style="display:flex;flex-wrap:wrap;gap:16px">${fields}</div>`);
    },
    [detailCache],
  );

  return (
    <Box>
      <PageHeader
        title="Pagos"
        subtitle="Historial de movimientos de tu cuenta."
        actions={
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={() => payments.refetch()}
          >
            Actualizar
          </Button>
        }
      />

      <InfoNote title="Tu historial">
        Cada fila es un movimiento custodiado: transferencias internas, depósitos,
        retiros y otros. El <strong>estado</strong> indica si ya se liquidó.
      </InfoNote>

      {payments.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          No se pudo cargar el historial. Verifica tu sesión y el backend (:4100).
        </Alert>
      )}

      <Card>
        <CardContent>
          <ZenttoDataGrid
            columns={cols}
            rows={rows}
            loading={payments.isLoading}
            pageSize={25}
            enableMasterDetail
            detailRenderer={detailHtml}
            onRowExpand={handleRowExpand}
          />
          {!payments.isLoading && rows.length === 0 && !payments.isError && (
            <Typography color="text.secondary" sx={{ mt: 2 }}>
              Aún no hay movimientos. Acredita saldo o realiza una transferencia
              desde Cuenta / Saldo.
            </Typography>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
