interface StatProps {
  label: string;
  value: string;
  title?: string;
}

export default function Stat({ label, value, title }: StatProps) {
  return (
    <div className="stat" title={title}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
