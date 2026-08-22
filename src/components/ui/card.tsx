import React from "react";
import { cn } from "@/lib/utils";

type CardTag = "div" | "h3" | "p";
type CardPartProps = React.HTMLAttributes<HTMLElement>;

function part(name: string, tag: CardTag = "div") {
  return function CardPart({ className, ...props }: CardPartProps) {
    return React.createElement(tag, {
      ...props,
      className: cn(`ui-card-${name}`, className),
    });
  };
}

export const Card = part("root");
export const CardContent = part("content");
export const CardDescription = part("description", "p");
export const CardFooter = part("footer");
export const CardHeader = part("header");
export const CardTitle = part("title", "h3");
