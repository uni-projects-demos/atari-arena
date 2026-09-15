import React from "react";
import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  ref?: React.Ref<HTMLInputElement>;
};

export function Input({
  className,
  ref,
  ...props
}: InputProps): React.DetailedReactHTMLElement<
  React.InputHTMLAttributes<HTMLInputElement>,
  HTMLInputElement
> {
  return React.createElement("input", { ...props, ref, className: cn("ui-input", className) });
}
