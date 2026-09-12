import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import type { Slate } from "@shared/schema";

/** Resolve links to retired duplicate slates without losing sport metadata. */
export function useResolvedSlate(
  slateId: number,
  slates: Slate[] | undefined,
  route: "/optimizer" | "/optimizer-pro",
) {
  const [, navigate] = useLocation();
  const active = slates?.find(s => s.id === slateId);
  const { data: resolved } = useQuery<Slate>({
    queryKey: [`/api/slates/${slateId}/resolve`],
    enabled: Number.isSafeInteger(slateId) && slateId > 0 && !!slates && !active,
  });

  useEffect(() => {
    if (!active && resolved && resolved.id !== slateId) {
      navigate(`${route}/${resolved.id}`, { replace: true });
    }
  }, [active, resolved, slateId, route, navigate]);

  return active || resolved;
}