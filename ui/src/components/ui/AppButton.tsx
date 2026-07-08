import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Button } from "./button";
import { cn } from "../../lib/utils";

type AppButtonVariant = "primary" | "ghost" | "text" | "file";

type AppButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  children: ReactNode;
  variant?: AppButtonVariant;
};

export const AppButton = forwardRef<HTMLButtonElement, AppButtonProps>(function AppButton(
  { active = false, children, className = "", variant = "ghost", ...props },
  ref,
) {
  const classes = cn(buttonClass(variant), active && "active", className);

  return (
    <Button className={classes} ref={ref} type="button" variant={shadcnVariant(variant)} {...props}>
      {children}
    </Button>
  );
});

function buttonClass(variant: AppButtonVariant) {
  if (variant === "primary") return "primary action-button";
  if (variant === "text") return "text-button";
  if (variant === "file") return "file-picker action-button";
  return "ghost action-button";
}

function shadcnVariant(variant: AppButtonVariant) {
  if (variant === "primary") return "default";
  if (variant === "text") return "ghost";
  return "outline";
}
