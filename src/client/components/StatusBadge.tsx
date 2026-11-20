import { Badge } from "@/client/components/ui/badge";
import { STATUS_LABELS, type SessionStatus } from "@/shared/sessions";

const VARIANTS = {
  queued: "secondary",
  working: "info",
  needs_input: "warning",
  awaiting_checks: "soft",
  ready: "success",
  failed: "destructive",
  stopped: "outline",
} as const;

export function StatusBadge({
  status,
  testId,
}: {
  status: SessionStatus;
  testId?: string;
}) {
  return (
    <Badge variant={VARIANTS[status]} data-testid={testId}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}
