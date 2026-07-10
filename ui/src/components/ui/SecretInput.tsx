import { forwardRef, useState } from "react";
import type { ComponentPropsWithoutRef } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "./button";
import { Input } from "./input";
import { cn } from "../../lib/utils";

type SecretInputProps = Omit<ComponentPropsWithoutRef<typeof Input>, "type"> & {
  hideLabel?: string;
  revealLabel?: string;
  wrapperClassName?: string;
};

export const SecretInput = forwardRef<HTMLInputElement, SecretInputProps>(function SecretInput(
  {
    className,
    hideLabel = "隐藏密钥",
    revealLabel = "查看密钥",
    wrapperClassName,
    ...props
  },
  ref,
) {
  const [visible, setVisible] = useState(false);
  const label = visible ? hideLabel : revealLabel;

  return (
    <div className={cn("relative", wrapperClassName)}>
      <Input
        {...props}
        className={cn("pr-11", className)}
        ref={ref}
        type={visible ? "text" : "password"}
      />
      <Button
        aria-label={label}
        className="absolute right-1 top-1/2 size-8 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        onClick={() => setVisible((current) => !current)}
        onMouseDown={(event) => event.preventDefault()}
        size="icon"
        title={label}
        type="button"
        variant="ghost"
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </Button>
    </div>
  );
});
