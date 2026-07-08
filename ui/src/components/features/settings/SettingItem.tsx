import type { ComponentType, ReactNode } from "react";
import type { LucideProps } from "lucide-react";
import { cn } from "../../../lib/utils";

type SettingItemProps = {
  children: ReactNode;
  className?: string;
  description: string;
  icon: ComponentType<LucideProps>;
  title: string;
};

export function SettingItem({ children, className, description, icon: Icon, title }: SettingItemProps) {
  return (
    <div className={cn("grid min-h-[72px] grid-cols-[minmax(0,1fr)_auto] items-center gap-6 px-6 py-4", className)}>
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center text-foreground">
          <Icon className="size-5" aria-hidden="true" strokeWidth={1.9} />
        </span>
        <span className="min-w-0">
          <strong className="block truncate text-sm font-medium text-foreground">{title}</strong>
          <span className="mt-1 block text-sm text-muted-foreground">{description}</span>
        </span>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
