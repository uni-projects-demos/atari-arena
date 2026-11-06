import React from "react";
import { cn } from "@/lib/utils";

type CardTag = "div" | "h3" | "p";
type CardPartProps = React.HTMLAttributes<HTMLElement>;

function renderPart(
  name: string,
  { className, ...props }: CardPartProps,
  tag: CardTag = "div",
): React.ReactElement {
  return React.createElement(tag, {
    ...props,
    className: cn(`ui-card-${name}`, className),
  });
}

export function Card(props: CardPartProps): React.ReactElement {
  return renderPart("root", props);
}

export function CardContent(props: CardPartProps): React.ReactElement {
  return renderPart("content", props);
}

export function CardDescription(props: CardPartProps): React.ReactElement {
  return renderPart("description", props, "p");
}

export function CardFooter(props: CardPartProps): React.ReactElement {
  return renderPart("footer", props);
}

export function CardHeader(props: CardPartProps): React.ReactElement {
  return renderPart("header", props);
}

export function CardTitle(props: CardPartProps): React.ReactElement {
  return renderPart("title", props, "h3");
}
