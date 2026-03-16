import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { HelpCircle } from "lucide-react";

interface InfoTipProps {
  text: string;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
  iconClassName?: string;
}

export function InfoTip({ text, side = "top", className, iconClassName }: InfoTipProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`inline-flex cursor-help ${className || ""}`} data-testid="info-tip">
          <HelpCircle className={`w-3 h-3 text-slate-500 hover:text-slate-300 transition-colors ${iconClassName || ""}`} />
        </span>
      </TooltipTrigger>
      <TooltipContent side={side} className="max-w-[260px] text-xs leading-relaxed">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

export function LabelTip({ children, text, side = "top", className }: { children: React.ReactNode; text: string; side?: "top" | "bottom" | "left" | "right"; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`inline-flex items-center gap-1 cursor-help ${className || ""}`}>
          {children}
          <HelpCircle className="w-2.5 h-2.5 text-slate-500 opacity-60" />
        </span>
      </TooltipTrigger>
      <TooltipContent side={side} className="max-w-[260px] text-xs leading-relaxed">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}
