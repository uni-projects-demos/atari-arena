import type React from "react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "default" | "outline" | "secondary" | "destructive" | "success";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  ref?: React.Ref<HTMLButtonElement>;
}

export function Button({
  className,
  variant = "default",
  type = "button",
  ...props
}: ButtonProps): React.JSX.Element {
  return (
    <button
      type={type}
      className={cn("ui-button", `ui-button--${variant}`, className)}
      {...props}
    />
  );
}
