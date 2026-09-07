import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace, logActivity } from "@/lib/workspace";
import { PageHeader, Section, StatusPill } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CHANNELS, POST_STATUS } from "@/lib/labels";
import { shortDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/calendar")({
  head: () => ({
    meta: [
      { title: "Calendário de conteúdo · AI Marketing OS" },
      { name: "description", content: "Planeje, aprove e agende posts por canal com criativos vinculados." },
      { property: "og:title", content: "Calendário de conteúdo · AI Marketing OS" },
      { property: "og:description", content: "Do rascunho ao agendamento, com publicação simulada." },
    ],
  }),
  component: CalendarPage;
});

function CalendarPage() {
  return null;
}
