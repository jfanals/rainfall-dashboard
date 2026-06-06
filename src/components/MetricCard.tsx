type MetricCardProps = {
  label: string;
  value: string;
  detail?: string;
  tone?: 'blue' | 'green' | 'amber' | 'slate';
};

export function MetricCard({ label, value, detail, tone = 'blue' }: MetricCardProps) {
  return (
    <article className={`metric metric--${tone}`}>
      <span className="metric__label">{label}</span>
      <strong className="metric__value">{value}</strong>
      {detail ? <span className="metric__detail">{detail}</span> : null}
    </article>
  );
}
