import type React from "react";

interface StatProps {
  label: string;
  value: string;
  title?: string;
  className?: string;
}

export default function Stat({ label, value, title, className }: StatProps): React.JSX.Element {
  return (
    <div className={className ? `stat ${className}` : "stat"} title={title}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
