import type { InputHTMLAttributes, ReactNode } from "react";

type ToggleProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  children: ReactNode;
};

export function Toggle({ children, ...props }: ToggleProps) {
  return (
    <label className="toggle">
      <input type="checkbox" {...props} />
      <span>{children}</span>
    </label>
  );
}
