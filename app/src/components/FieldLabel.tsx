export function FieldLabel({
  children,
  optional,
  required,
}: {
  children: string;
  optional?: boolean;
  required?: boolean;
}) {
  return (
    <span className="field-label">
      <span>{children}</span>
      {optional && <span className="field-tag">необязательно</span>}
      {required && <span className="field-tag is-required">обязательно</span>}
    </span>
  );
}
