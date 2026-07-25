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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Chip,
  Divider,
  CircularProgress,
  IconButton,
  Tooltip,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import CloseIcon from "@mui/icons-material/Close";
import GavelIcon from "@mui/icons-material/Gavel";
import { PageHeader } from "@/components/ui/PageHeader";
import { InfoNote } from "@/components/ui/InfoNote";
import {
  ZenttoDataGrid,
  type ColumnDef,
  type GridRow,
} from "@/components/data-grid/ZenttoDataGrid";
import {
  useAdminP2pDisputes,
  useAdminP2pTrade,
  useAdminP2pTradeMessages,
  useAdminP2pResolve,
} from "@/lib/hooks";
import { api } from "@/lib/api";
import { ENDPOINTS } from "@/lib/endpoints";
import { formatDate, fromNow } from "@/lib/format";
import type {
  AdminP2pDispute,
  AdminP2pMessage,
  P2pResolveDecision,
} from "@/lib/types";

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

/** Formatea un decimal en string a notación es-ES. */
function fmtNum(value: string | number | null | undefined, maxFrac = 8): string {
  if (value === null || value === undefined || value === "") return "0";
  const n = Number(value);
  return Number.isFinite(n)
    ? new Intl.NumberFormat("es-ES", { maximumFractionDigits: maxFrac }).format(n)
    : String(value);
}

/** total Bs = amount * priceVes (string decimales). */
function totalVes(amount: string, priceVes: string): string {
  const a = Number(amount);
  const p = Number(priceVes);
  if (!Number.isFinite(a) || !Number.isFinite(p)) return "—";
  return fmtNum(a * p, 2);
}

/** Trunca un texto largo para mostrar en celda. */
function truncate(value: string | null, max = 60): string {
  if (!value) return "—";
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export default function DisputasPage() {
  const disputes = useAdminP2pDisputes();
  const resolve = useAdminP2pResolve();
  const data = React.useMemo(() => disputes.data ?? [], [disputes.data]);

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState<{
    open: boolean;
    decision: P2pResolveDecision;
  }>({ open: false, decision: "release" });

  // Datos del detalle (fallback al item de la lista si el endbpoint tarda).
  const tradeQuery = useAdminP2pTrade(selectedId);
  const messagesQuery = useAdminP2pTradeMessages(selectedId);

  const listItem = React.useMemo(
    () => data.find((d) => d.id === selectedId) ?? null,
    [data, selectedId],
  );
  const trade: AdminP2pDispute | null = tradeQuery.data ?? listItem;

  const byId = React.useMemo(() => {
    const m = new Map<string, AdminP2pDispute>();
    for (const d of data) m.set(d.id, d);
    return m;
  }, [data]);

  // ── Maestro-detalle: chat del trade con carga perezosa + cache por fila ──
  const [chatCache, setChatCache] = React.useState<
    Record<string, AdminP2pMessage[] | "loading" | "error">
  >({});
  const chatRequested = React.useRef<Set<string>>(new Set());

  const handleRowExpand = React.useCallback((row: GridRow, expanded: boolean) => {
    const id = String(row.id);
    if (!expanded || chatRequested.current.has(id)) return;
    chatRequested.current.add(id);
    setChatCache((c) => ({ ...c, [id]: "loading" }));
    api
      .get<AdminP2pMessage[]>(ENDPOINTS.adminP2pTradeMessages(id))
      .then((msgs) => setChatCache((c) => ({ ...c, [id]: msgs ?? [] })))
      .catch(() => {
        // permitir reintento al volver a expandir
        chatRequested.current.delete(id);
        setChatCache((c) => ({ ...c, [id]: "error" }));
      });
  }, []);

  const detailCols = React.useMemo<ColumnDef[]>(
    () => [
      { field: "remitente", header: "Remitente", minWidth: 230 },
      { field: "mensaje", header: "Mensaje", minWidth: 320, flex: 1 },
      {
        field: "evidencia",
        header: "Evidencia de pago",
        minWidth: 170,
        renderCell: (value) => {
          const v = String(value ?? "");
          if (!v.startsWith("data:image") && !/^https?:\/\//.test(v)) return "—";
          return `<img src="${v}" alt="Evidencia de pago" style="max-height:64px;max-width:150px;border-radius:4px;display:block" />`;
        },
      },
      { field: "fecha", header: "Fecha", type: "datetime", minWidth: 170 },
    ],
    [],
  );

  const detailRows = React.useCallback(
    (row: GridRow): GridRow[] => {
      const id = String(row.id);
      const entry = chatCache[id];
      const placeholder = (key: string, mensaje: string): GridRow[] => [
        { id: `${id}-${key}`, remitente: "—", mensaje, evidencia: "", fecha: "" },
      ];
      if (!entry || entry === "loading") return placeholder("loading", "Cargando chat…");
      if (entry === "error")
        return placeholder("error", "No se pudo cargar el chat del trade. Colapsa y expande para reintentar.");
      if (entry.length === 0)
        return placeholder("empty", "Este trade no tiene mensajes en el chat.");
      const d = byId.get(id);
      return entry.map((m) => {
        const remitente =
          m.senderUserId === "system"
            ? "Sistema (escrow)"
            : d && m.senderUserId === d.buyerUserId
              ? `Comprador · ${d.buyerEmail ?? m.senderUserId}`
              : d && m.senderUserId === d.sellerUserId
                ? `Vendedor · ${d.sellerEmail ?? m.senderUserId}`
                : m.senderUserId;
        return {
          id: m.id,
          remitente,
          mensaje: m.body ?? (m.attachment ? "(evidencia adjunta)" : "(mensaje vacío)"),
          evidencia: m.attachment ?? "",
          fecha: toIso(m.createdAt),
        };
      });
    },
    [chatCache, byId],
  );

  const rows: GridRow[] = React.useMemo(
    () =>
      data.map((d) => {
        const openedBy =
          d.disputeBy === d.buyerUserId
            ? `Comprador (${d.buyerEmail ?? "—"})`
            : d.disputeBy === d.sellerUserId
              ? `Vendedor (${d.sellerEmail ?? "—"})`
              : (d.disputeBy ?? "—");
        return {
          id: d.id,
          partes: `${d.buyerEmail ?? "—"} ↔ ${d.sellerEmail ?? "—"}`,
          activo: `${fmtNum(d.amount)} ${d.asset}`,
          precioVes: `${fmtNum(d.priceVes, 2)} Bs`,
          totalVes: `${totalVes(d.amount, d.priceVes)} Bs`,
          abrioPor: openedBy,
          motivo: truncate(d.disputeReason),
          createdAt: toIso(d.createdAt),
        };
      }),
    [data],
  );

  const cols: ColumnDef[] = [
    { field: "partes", header: "Partes (comprador ↔ vendedor)", minWidth: 280, flex: 1 },
    { field: "activo", header: "Activo · monto", minWidth: 150 },
    { field: "precioVes", header: "Precio", width: 140 },
    { field: "totalVes", header: "Total Bs", width: 150 },
    { field: "abrioPor", header: "Abrió disputa", minWidth: 200 },
    { field: "motivo", header: "Motivo", minWidth: 200, flex: 1 },
    { field: "createdAt", header: "Antigüedad", type: "datetime", minWidth: 170 },
    {
      field: "acciones",
      header: "Arbitraje",
      width: 130,
      type: "actions",
      actions: [
        { icon: "visibility", label: "Revisar", action: "review", color: "primary" },
      ],
    },
  ];

  const openDetail = (action: string, row: GridRow) => {
    const d = byId.get(String(row.id));
    if (!d) return;
    setError(null);
    setSelectedId(d.id);
  };

  const closeDetail = () => {
    setSelectedId(null);
    setError(null);
  };

  const askConfirm = (decision: P2pResolveDecision) => {
    setError(null);
    setConfirm({ open: true, decision });
  };

  const cancelConfirm = () => setConfirm((c) => ({ ...c, open: false }));

  const submitResolve = async () => {
    if (!selectedId || !trade) return;
    setError(null);
    try {
      await resolve.mutateAsync({ id: selectedId, decision: confirm.decision });
      setToast(
        confirm.decision === "release"
          ? `Disputa resuelta: cripto liberado al comprador (${trade.buyerEmail ?? trade.buyerUserId}).`
          : `Disputa resuelta: reembolso al vendedor (${trade.sellerEmail ?? trade.sellerUserId}).`,
      );
      setConfirm((c) => ({ ...c, open: false }));
      closeDetail();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No se pudo resolver la disputa.",
      );
    }
  };

  return (
    <Box>
      <PageHeader
        title="Disputas P2P"
        subtitle="Arbitraje de trades P2P en disputa: revisa la evidencia de pago y decide a qué parte favorecer."
        actions={
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={() => disputes.refetch()}
          >
            Actualizar
          </Button>
        }
      />

      <InfoNote title="Cola de arbitraje">
        Cada fila es un trade <strong>en disputa</strong>. Pulsa{" "}
        <strong>Revisar</strong> para ver el detalle y el chat con la evidencia de
        pago. <strong>Liberar al comprador</strong> entrega el cripto al comprador;{" "}
        <strong>Reembolsar al vendedor</strong> devuelve el cripto al vendedor.
        Ambas acciones son <strong>irreversibles</strong>.
      </InfoNote>

      {toast && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setToast(null)}>
          {toast}
        </Alert>
      )}

      {disputes.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          No se pudo cargar la cola de disputas. Verifica tu sesión de operador y
          el backend (/admin/p2p/disputes).
        </Alert>
      )}

      <Card>
        <CardContent>
          <ZenttoDataGrid
            columns={cols}
            rows={rows}
            loading={disputes.isLoading}
            pageSize={25}
            onActionClick={openDetail}
            enableMasterDetail
            detailColumns={detailCols}
            detailRowsAccessor={detailRows}
            onRowExpand={handleRowExpand}
          />
          {!disputes.isLoading && rows.length === 0 && !disputes.isError && (
            <Typography color="text.secondary" sx={{ mt: 2 }}>
              No hay disputas P2P pendientes de arbitraje.
            </Typography>
          )}
        </CardContent>
      </Card>

      {/* Detalle del trade + chat + acciones de arbitraje */}
      <Dialog
        open={!!selectedId}
        onClose={closeDetail}
        maxWidth="md"
        fullWidth
        scroll="paper"
      >
        <DialogTitle
          sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
        >
          <Stack direction="row" spacing={1} alignItems="center">
            <GavelIcon fontSize="small" />
            <span>Arbitraje de disputa</span>
          </Stack>
          <IconButton onClick={closeDetail} size="small" aria-label="cerrar">
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {!trade ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
              <CircularProgress />
            </Box>
          ) : (
            <Stack spacing={2}>
              {/* Resumen del trade */}
              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  Detalle del trade
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Chip size="small" label={`Trade ${trade.id}`} variant="outlined" />
                  <Chip size="small" label={`Orden ${trade.orderId}`} variant="outlined" />
                  <Chip size="small" color="warning" label="En disputa" />
                </Stack>
                <Box
                  sx={{
                    mt: 1.5,
                    display: "grid",
                    gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                    gap: 1.5,
                  }}
                >
                  <Field label="Comprador (recibe cripto)" value={trade.buyerEmail ?? trade.buyerUserId} />
                  <Field label="Vendedor (recibe Bs)" value={trade.sellerEmail ?? trade.sellerUserId} />
                  <Field label="Activo · monto" value={`${fmtNum(trade.amount)} ${trade.asset}`} />
                  <Field label="Precio" value={`${fmtNum(trade.priceVes, 2)} Bs`} />
                  <Field label="Total" value={`${totalVes(trade.amount, trade.priceVes)} Bs`} />
                  <Field
                    label="Disputa abierta por"
                    value={
                      trade.disputeBy === trade.buyerUserId
                        ? `Comprador (${trade.buyerEmail ?? "—"})`
                        : trade.disputeBy === trade.sellerUserId
                          ? `Vendedor (${trade.sellerEmail ?? "—"})`
                          : (trade.disputeBy ?? "—")
                    }
                  />
                  <Field label="Creado" value={`${formatDate(trade.createdAt)} (${fromNow(trade.createdAt)})`} />
                </Box>
                {trade.disputeReason && (
                  <Alert severity="info" sx={{ mt: 1.5 }}>
                    <strong>Motivo de la disputa:</strong> {trade.disputeReason}
                  </Alert>
                )}
              </Box>

              <Divider />

              {/* Chat con evidencias */}
              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  Chat y evidencias de pago
                </Typography>
                <ChatThread
                  trade={trade}
                  messages={messagesQuery.data ?? []}
                  loading={messagesQuery.isLoading}
                  error={messagesQuery.isError}
                />
              </Box>
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, gap: 1, flexWrap: "wrap" }}>
          <Button onClick={closeDetail}>Cerrar</Button>
          <Box sx={{ flex: 1 }} />
          <Tooltip title="Reembolsa el cripto al vendedor">
            <span>
              <Button
                variant="outlined"
                color="warning"
                disabled={!trade || resolve.isPending}
                onClick={() => askConfirm("refund")}
              >
                Reembolsar al vendedor
              </Button>
            </span>
          </Tooltip>
          <Tooltip title="Libera el cripto al comprador">
            <span>
              <Button
                variant="contained"
                color="success"
                disabled={!trade || resolve.isPending}
                onClick={() => askConfirm("release")}
              >
                Liberar al comprador
              </Button>
            </span>
          </Tooltip>
        </DialogActions>
      </Dialog>

      {/* Confirmación de la decisión */}
      <Dialog open={confirm.open} onClose={cancelConfirm} maxWidth="xs" fullWidth>
        <DialogTitle>
          {confirm.decision === "release"
            ? "Liberar cripto al comprador"
            : "Reembolsar cripto al vendedor"}
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2">
            {confirm.decision === "release" ? (
              <>
                Vas a <strong>liberar {trade ? `${fmtNum(trade.amount)} ${trade.asset}` : "el cripto"}</strong>{" "}
                al comprador{" "}
                <strong>{trade?.buyerEmail ?? trade?.buyerUserId ?? ""}</strong>. Esta
                acción es irreversible.
              </>
            ) : (
              <>
                Vas a <strong>reembolsar {trade ? `${fmtNum(trade.amount)} ${trade.asset}` : "el cripto"}</strong>{" "}
                al vendedor{" "}
                <strong>{trade?.sellerEmail ?? trade?.sellerUserId ?? ""}</strong>. Esta
                acción es irreversible.
              </>
            )}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={cancelConfirm}>Cancelar</Button>
          <Button
            variant="contained"
            color={confirm.decision === "release" ? "success" : "warning"}
            onClick={submitResolve}
            disabled={resolve.isPending}
          >
            {resolve.isPending
              ? "Resolviendo…"
              : confirm.decision === "release"
                ? "Liberar al comprador"
                : "Reembolsar al vendedor"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

/** Campo etiqueta/valor del resumen. */
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" display="block">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ wordBreak: "break-word" }}>
        {value}
      </Typography>
    </Box>
  );
}

/** Hilo de chat: distingue comprador vs vendedor y renderiza adjuntos como <img>. */
function ChatThread({
  trade,
  messages,
  loading,
  error,
}: {
  trade: AdminP2pDispute;
  messages: AdminP2pMessage[];
  loading: boolean;
  error: boolean;
}) {
  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }
  if (error) {
    return (
      <Alert severity="error">
        No se pudo cargar el chat del trade (/admin/p2p/trades/:id/messages).
      </Alert>
    );
  }
  if (messages.length === 0) {
    return (
      <Typography color="text.secondary" variant="body2">
        Este trade no tiene mensajes en el chat.
      </Typography>
    );
  }

  const roleOf = (senderUserId: string): "buyer" | "seller" | "other" => {
    if (senderUserId === trade.buyerUserId) return "buyer";
    if (senderUserId === trade.sellerUserId) return "seller";
    return "other";
  };

  return (
    <Stack
      spacing={1.5}
      sx={{
        maxHeight: 360,
        overflowY: "auto",
        p: 1,
        borderRadius: 1,
        bgcolor: "action.hover",
      }}
    >
      {messages.map((m) => {
        const role = roleOf(m.senderUserId);
        const isBuyer = role === "buyer";
        const align = isBuyer ? "flex-start" : "flex-end";
        const label =
          role === "buyer"
            ? `Comprador · ${trade.buyerEmail ?? trade.buyerUserId}`
            : role === "seller"
              ? `Vendedor · ${trade.sellerEmail ?? trade.sellerUserId}`
              : `Otro · ${m.senderUserId}`;
        const bubbleColor = isBuyer ? "info.main" : "success.main";
        return (
          <Box
            key={m.id}
            sx={{ display: "flex", flexDirection: "column", alignItems: align }}
          >
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ mb: 0.25, px: 0.5 }}
            >
              {label} · {formatDate(m.createdAt)}
            </Typography>
            <Box
              sx={{
                maxWidth: "80%",
                p: 1,
                borderRadius: 2,
                borderTop: 3,
                borderColor: bubbleColor,
                bgcolor: "background.paper",
                boxShadow: 1,
              }}
            >
              {m.body && (
                <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                  {m.body}
                </Typography>
              )}
              {m.attachment && (
                <Box sx={{ mt: m.body ? 1 : 0 }}>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Evidencia de pago
                  </Typography>
                  <Box
                    component="img"
                    src={m.attachment}
                    alt="Evidencia de pago"
                    sx={{
                      mt: 0.5,
                      maxWidth: "100%",
                      maxHeight: 320,
                      borderRadius: 1,
                      border: 1,
                      borderColor: "divider",
                      cursor: "zoom-in",
                      display: "block",
                    }}
                    onClick={() => window.open(m.attachment as string, "_blank")}
                  />
                </Box>
              )}
              {!m.body && !m.attachment && (
                <Typography variant="body2" color="text.secondary">
                  (mensaje vacío)
                </Typography>
              )}
            </Box>
          </Box>
        );
      })}
    </Stack>
  );
}
